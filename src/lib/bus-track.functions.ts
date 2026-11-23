import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  isStale,
  parentSeesLocation,
  placeKey,
  placeLabel,
  pupilStates,
  type BusLogStatus,
  type PupilState,
  type TripDirection,
} from "./bus";

/**
 * Public bus tracking for parents of bus pupils. Possession of the pupil's
 * 64-char tracking code is the credential (same model as guardian passes).
 */
export const getBusTracking = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m } = await supabaseAdmin
      .from("members")
      .select("id, org_id, full_name, identifier_code, uses_bus, bus_id, primary_email, branch:branches(name), org:organizations(name, emergency_phone)")
      .eq("bus_track_token", data.token.toLowerCase())
      .maybeSingle();
    if (!m || !m.uses_bus || !m.org) return null;
    const { data: transport } = await supabaseAdmin.rpc("org_transport_active", { _org_id: m.org_id });
    if (!transport) return null;

    // Other bus children registered by the same parent email at this school (any branch).
    const { data: sibs } = await supabaseAdmin
      .from("members")
      .select("full_name, bus_track_token, branch:branches(name), bus:buses(bus_number)")
      .eq("org_id", m.org_id)
      .eq("primary_email", m.primary_email)
      .eq("uses_bus", true)
      .order("full_name");
    const children = (sibs ?? []).map((c) => ({
      name: c.full_name,
      token: c.bus_track_token,
      branch: (c.branch as { name: string } | null)?.name ?? null,
      bus: (c.bus as { bus_number: string } | null)?.bus_number ?? null,
      current: c.bus_track_token === data.token.toLowerCase(),
    }));

    const base = {
      children,
      childName: m.full_name,
      branchName: (m.branch as { name: string } | null)?.name ?? null,
      className: m.identifier_code,
      orgName: m.org.name,
      emergencyPhone: m.org.emergency_phone,
    };
    if (!m.bus_id) return { ...base, bus: null, ride: null, child: null, lastSeen: null };

    const [{ data: bus }, { data: trip }] = await Promise.all([
      supabaseAdmin
        .from("buses")
        .select("bus_number, plate_number, route_axis, driver_name, attendant_name")
        .eq("id", m.bus_id)
        .maybeSingle(),
      supabaseAdmin
        .from("bus_trips")
        .select("id, direction, started_at, current_lat, current_lng, current_speed, last_ping_at, location_paused, location_requested_at")
        .eq("bus_id", m.bus_id)
        .eq("status", "in_transit")
        .maybeSingle(),
    ]);

    // Latest event for this child: within the current ride, or the last 18 hours otherwise.
    let logQuery = supabaseAdmin
      .from("pupil_bus_logs")
      .select("status, timestamp, guardian_name")
      .eq("member_id", m.id)
      .order("timestamp", { ascending: false })
      .limit(1);
    logQuery = trip
      ? logQuery.eq("trip_id", trip.id)
      : logQuery.gte("timestamp", new Date(Date.now() - 18 * 3600_000).toISOString());
    const { data: logs } = await logQuery;
    const last = logs?.[0] ?? null;
    const state: PupilState = pupilStates(
      [m.id],
      last ? [{ member_id: m.id, status: last.status as BusLogStatus, timestamp: last.timestamp }] : [],
    ).get(m.id)!;

    const onBoard = !!trip && parentSeesLocation(true, state);
    // Opening "Where is my child?" asks the bus device for one fresh location
    // (even if the driver paused it), at most once a minute per ride.
    const wantsFresh = onBoard && (trip!.location_paused || isStale(trip!.last_ping_at, Date.now()));
    if (wantsFresh) {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      await supabaseAdmin
        .from("bus_trips")
        .update({ location_requested_at: new Date().toISOString() })
        .eq("id", trip!.id)
        .or(`location_requested_at.is.null,location_requested_at.lt.${cutoff}`);
    }
    const showLocation = onBoard && trip!.current_lat != null && trip!.current_lng != null;
    const place = showLocation ? await areaName(supabaseAdmin, trip!.current_lat!, trip!.current_lng!) : null;
    return {
      ...base,
      bus: bus
        ? {
            number: bus.bus_number,
            plate: bus.plate_number,
            route: bus.route_axis,
            driver: bus.driver_name,
            attendant: bus.attendant_name,
          }
        : null,
      ride: trip ? { direction: trip.direction as TripDirection, startedAt: trip.started_at } : null,
      child: last ? { state, at: last.timestamp, guardianName: last.guardian_name } : null,
      // Last-seen area only (no map, no coordinates), and only while this child is on board.
      lastSeen: showLocation
        ? { place, at: trip!.last_ping_at, stale: isStale(trip!.last_ping_at, Date.now()), updating: wantsFresh }
        : null,
    };
  });

export type BusTracking = NonNullable<Awaited<ReturnType<typeof getBusTracking>>>;

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Area name for a position, cached per ~100 m square; null if the map service can't name it. */
async function areaName(admin: Admin, lat: number, lng: number): Promise<string | null> {
  const latKey = placeKey(lat);
  const lngKey = placeKey(lng);
  const { data: cached } = await admin
    .from("place_names")
    .select("name")
    .eq("lat_key", latKey)
    .eq("lng_key", lngKey)
    .maybeSingle();
  if (cached) return cached.name;
  let name: string | null = null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${latKey}&lon=${lngKey}`,
      { headers: { "User-Agent": "GatePass/1.0 (school bus last-seen)", "Accept-Language": "en" }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: Record<string, string> };
    name = placeLabel(body.address);
  } catch {
    return null;
  }
  await admin.from("place_names").upsert({ lat_key: latKey, lng_key: lngKey, name }, { onConflict: "lat_key,lng_key" });
  return name;
}
