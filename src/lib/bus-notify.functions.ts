import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Bus events told to the school and to parents the moment they happen.
 *
 * The bus device writes its logs straight to the database so a weak signal
 * never loses a boarding. This module is the step that follows a successful
 * write: it records a transport notice (which is what the school's activity
 * feed shows) and sends the parent / school emails immediately, instead of
 * waiting for a scheduled job that may not be running.
 */

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function callerOrg(sb: Admin, userId: string) {
  const { data } = await sb.from("profiles").select("org_id, branch_id").eq("id", userId).maybeSingle();
  return data;
}

const timeText = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });

/* -------------------------------------------------------------------------- */
/* Boarded / dropped off                                                      */
/* -------------------------------------------------------------------------- */

export const notifyRideEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        tripId: z.string().uuid(),
        memberId: z.string().uuid(),
        status: z.enum(["boarded", "dropped_off"]),
        guardianId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mine = await callerOrg(supabaseAdmin, context.userId);
    if (!mine) return { sent: 0 };

    const { data: trip } = await supabaseAdmin
      .from("bus_trips")
      .select("id, org_id, bus_id, direction, started_at")
      .eq("id", data.tripId)
      .maybeSingle();
    if (!trip || trip.org_id !== mine.org_id) return { sent: 0 };

    const [{ data: bus }, { data: member }, { data: org }] = await Promise.all([
      supabaseAdmin
        .from("buses")
        .select("bus_number, plate_number, driver_name, driver_phone")
        .eq("id", trip.bus_id)
        .maybeSingle(),
      supabaseAdmin
        .from("members")
        .select(
          "id, full_name, identifier_code, primary_email, primary_email_enc, parent_or_owner_name, bus_track_token, parent_link_token, bus_id",
        )
        .eq("id", data.memberId)
        .maybeSingle(),
      supabaseAdmin
        .from("organizations")
        .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
        .eq("id", trip.org_id)
        .maybeSingle(),
    ]);
    const { decryptOrgRow } = await import("@/lib/contact-crypto.server");
    const orgDecrypted = org ? decryptOrgRow(org) : null;
    if (!member || !orgDecrypted || member.bus_id !== trip.bus_id) return { sent: 0 };

    const kind = data.status === "boarded" ? "pupil_boarded" : "pupil_dropped_off";
    const { data: existing } = await supabaseAdmin
      .from("transport_notices")
      .select("id")
      .eq("trip_id", trip.id)
      .eq("member_id", member.id)
      .eq("kind", kind)
      .limit(1)
      .maybeSingle();

    const boarded = data.status === "boarded";
    const direction = trip.direction === "to_home" ? "afternoon drop-off" : "morning pick-up";
    const message = boarded
      ? `${member.full_name}${member.identifier_code ? ` (${member.identifier_code})` : ""} boarded Bus ${bus?.bus_number ?? ""} for the ${direction}.`
      : `${member.full_name}${member.identifier_code ? ` (${member.identifier_code})` : ""} was dropped off from Bus ${bus?.bus_number ?? ""}.`;

    // The notice is both what the school feed shows and the retry queue. If one
    // already exists but was never emailed (mail hiccup, signal lost mid-send),
    // keep it and try the send again instead of skipping it forever.
    let noticeId = existing?.id ?? null;
    if (!noticeId) {
      const { data: created, error } = await supabaseAdmin
        .from("transport_notices")
        .insert({
          org_id: trip.org_id,
          branch_id: mine.branch_id,
          bus_id: trip.bus_id,
          trip_id: trip.id,
          member_id: member.id,
          guardian_id: data.guardianId ?? null,
          kind,
          message,
        })
        .select("id")
        .single();
      if (error || !created) {
        console.error("[bus] could not record ride notice", error);
        return { sent: 0 };
      }
      noticeId = created.id;
    } else {
      const { data: sentAlready } = await supabaseAdmin
        .from("transport_notices")
        .select("emailed_at")
        .eq("id", noticeId)
        .maybeSingle();
      if (sentAlready?.emailed_at) return { sent: 0, already: true };
    }

    const { deliverRideNotice } = await import("./bus-email.server");
    const sent = await deliverRideNotice({
      id: noticeId,
      org_id: trip.org_id,
      member_id: member.id,
      guardian_id: data.guardianId ?? null,
      kind,
      message,
    });
    return { sent, message };
  });

/* -------------------------------------------------------------------------- */
/* Driver emergency and tamper alerts                                         */
/* -------------------------------------------------------------------------- */

export const alertFleet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        busId: z.string().uuid(),
        tripId: z.string().uuid().nullable().optional(),
        kind: z.enum(["driver_emergency", "driver_logout", "driver_tamper"]),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mine = await callerOrg(supabaseAdmin, context.userId);
    if (!mine) return { alerted: false };

    const [{ data: bus }, { data: org }] = await Promise.all([
      supabaseAdmin
        .from("buses")
        .select("id, org_id, branch_id, bus_number, plate_number, route_axis, driver_name, driver_phone")
        .eq("id", data.busId)
        .maybeSingle(),
      supabaseAdmin
        .from("organizations")
        .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
        .eq("id", mine.org_id)
        .maybeSingle(),
    ]);
    const { decryptOrgRow } = await import("@/lib/contact-crypto.server");
    const orgDecrypted = org ? decryptOrgRow(org) : null;
    if (!bus || !orgDecrypted || bus.org_id !== orgDecrypted.id) return { alerted: false };

    const at = timeText(new Date().toISOString());
    const where = data.lat != null && data.lng != null ? ` Last location: https://maps.google.com/?q=${data.lat},${data.lng}` : "";
    const driver = bus.driver_name || "The driver";
    const message =
      data.kind === "driver_emergency"
        ? `DRIVER EMERGENCY on Bus ${bus.bus_number} at ${at}. ${driver} pressed the emergency button.${where}`
        : data.kind === "driver_tamper"
          ? `DRIVER TAMPER on Bus ${bus.bus_number} at ${at}. The bus device reported a problem with the ride.${where}`
          : `BUS DEVICE OFFLINE: the Bus ${bus.bus_number} login signed out at ${at}${data.tripId ? " during a ride" : ""}.${where}`;

    const { data: notice, error } = await supabaseAdmin
      .from("transport_notices")
      .insert({
        org_id: orgDecrypted.id,
        branch_id: bus.branch_id,
        bus_id: bus.id,
        trip_id: data.tripId ?? null,
        member_id: null,
        guardian_id: null,
        kind: data.kind,
        message,
      })
      .select("id")
      .single();
    if (error || !notice) console.error("[bus] could not record fleet alert", error);

    if (!notice) return { alerted: false };
    const { deliverFleetNotice } = await import("./fleet-alert.server");
    const result = await deliverFleetNotice({
      id: notice.id,
      org_id: orgDecrypted.id,
      bus_id: bus.id,
      kind: data.kind,
      message,
    });
    return { alerted: result.emailed || result.whatsapped, ...result, message };
  });

/* -------------------------------------------------------------------------- */
/* A bus that has gone quiet                                                  */
/* -------------------------------------------------------------------------- */

/** A ride with no position for this long is treated as a problem. */
const OFFLINE_AFTER_MIN = 10;

/**
 * Watches every ride in progress for this school. A bus that stops reporting
 * its position, or a ride whose device was switched off, is an alert for the
 * office. One alert per ride, never a stream of them.
 */
export const checkBusHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).optional().parse(input ?? {}) ?? {})
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mine = await callerOrg(supabaseAdmin, context.userId);
    if (!mine) return { alerted: 0 };

    const { data: trips } = await supabaseAdmin
      .from("bus_trips")
      .select("id, bus_id, started_at, last_ping_at, buses(bus_number, driver_name, login_active)")
      .eq("org_id", mine.org_id)
      .eq("status", "in_transit")
      .limit(50);
    if (!trips?.length) return { alerted: 0 };

    const now = Date.now();
    const { deliverFleetNotice } = await import("./fleet-alert.server");
    let alerted = 0;

    for (const trip of trips) {
      const bus = trip.buses as {
        bus_number: string;
        driver_name: string | null;
        login_active: boolean;
      } | null;
      const started = trip.started_at ? new Date(trip.started_at).getTime() : now;
      const last = trip.last_ping_at ? new Date(trip.last_ping_at).getTime() : started;
      const silentMin = Math.floor((now - last) / 60_000);
      if (silentMin < OFFLINE_AFTER_MIN) continue;

      const { data: existing } = await supabaseAdmin
        .from("transport_notices")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("kind", "driver_offline")
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      const message =
        bus?.login_active === false
          ? `BUS TAMPER: the Bus ${bus?.bus_number ?? ""} login was switched off during a ride at ${timeText(new Date().toISOString())}.`
          : `BUS OFFLINE: Bus ${bus?.bus_number ?? ""} has not reported its position for ${silentMin} minutes during a ride.`;

      const { data: notice } = await supabaseAdmin
        .from("transport_notices")
        .insert({
          org_id: mine.org_id,
          branch_id: mine.branch_id,
          bus_id: trip.bus_id,
          trip_id: trip.id,
          member_id: null,
          kind: "driver_offline",
          message,
        })
        .select("id")
        .single();
      if (!notice) continue;

      await deliverFleetNotice({
        id: notice.id,
        org_id: mine.org_id,
        bus_id: trip.bus_id,
        kind: "driver_offline",
        message,
      });
      alerted++;
    }
    return { alerted };
  });
