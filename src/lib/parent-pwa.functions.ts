import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailConfigured, sendEmail } from "./email.server";
import { EMAIL, escapeHtml } from "./email-template";

const pwaTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Invalid token");
const otpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

/** The direction of the ride a bus log belongs to, whichever shape the join returns. */
function busTripDirection(row: unknown): string | null {
  const trip = (row as { trip?: unknown } | null)?.trip;
  if (!trip) return null;
  const one = Array.isArray(trip) ? trip[0] : trip;
  return (one as { direction?: string | null } | undefined)?.direction ?? null;
}

async function signedPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("photos").createSignedUrls([path], 60 * 60);
  return data?.[0]?.signedUrl ?? null;
}

/**
 * Every child covered by one parent sign-in. The link belongs to the guardian,
 * not to a single child, so children registered together (same guardians, same
 * bus) all appear in the same app.
 */
async function familyMemberIds(
  anchorId: string,
  orgId: string,
  parentLinkToken: string | null,
): Promise<string[]> {
  let token = parentLinkToken;
  if (!token) {
    const { data } = await supabaseAdmin
      .from("members")
      .select("parent_link_token")
      .eq("id", anchorId)
      .maybeSingle();
    token = data?.parent_link_token ?? null;
  }

  const ids: string[] = [];
  if (token) {
    const { data } = await supabaseAdmin
      .from("members")
      .select("id")
      .eq("org_id", orgId)
      .eq("parent_link_token", token)
      .order("full_name");
    for (const row of data ?? []) ids.push(row.id);
  }
  if (!ids.includes(anchorId)) ids.push(anchorId);
  return ids;
}

/** Full live status for one child: gate, bus, rides, photo. */
async function buildChildStatus(
  memberId: string,
  allowCallDriver: boolean,
  allowCallAttendant: boolean,
) {
  const { data: member } = await supabaseAdmin
    .from("members")
    .select(
      `
        id,
        full_name,
        identifier_code,
        uses_bus,
        bus_id,
        bus_track_token,
        parent_link_token,
        photo_path,
        org:organizations(name, type, emergency_phone, emergency_phone_enc),
        branch:branches(name)
      `,
    )
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return null;

  const photoUrl = await signedPhotoUrl(member.photo_path);

  const { data: latestGate } = await supabaseAdmin
    .from("gate_logs")
    .select("action_type, timestamp, verified_guardian_name, guard_name")
    .eq("member_id", member.id)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  let busInfo = null;
  let busRow: {
    id: string;
    bus_number: string;
    plate_number: string | null;
    route_axis: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    attendant_name: string | null;
    attendant_phone: string | null;
  } | null = null;
  // The ride that is running right now, and what this child has done on it.
  // Status has to come from the current ride: a boarding yesterday must not
  // leave a child "on the bus" all night.
  let activeTrip: { id: string; direction: string; started_at: string | null } | null = null;
  // The ride that has just finished, so a parent is told it ended instead of
  // seeing "on route" until the next morning.
  let lastRide: {
    id: string;
    direction: string;
    startedAt: string | null;
    endedAt: string | null;
  } | null = null;
  let tripLog: {
    status: string;
    timestamp: string;
    guardian_name: string | null;
    recorded_by: string | null;
  } | null = null;
  if (member.uses_bus && member.bus_id) {
    const { data: bus } = await supabaseAdmin
      .from("buses")
      .select(
        "id, bus_number, plate_number, route_axis, driver_name, driver_phone, attendant_name, attendant_phone",
      )
      .eq("id", member.bus_id)
      .maybeSingle();
    busRow = bus ?? null;

    // The latest ride on this bus, whatever its status. Reading only the
    // "in_transit" row kept showing a ride the driver had already ended, and
    // broke when a bus had more than one open trip.
    const { data: latestTrip } = await supabaseAdmin
      .from("bus_trips")
      .select(
        "id, direction, status, started_at, ended_at, current_lat, current_lng, current_speed, last_ping_at, location_paused, location_requested_at",
      )
      .eq("bus_id", member.bus_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const startedMs = latestTrip?.started_at ? new Date(latestTrip.started_at).getTime() : 0;
    const lastPingMs = latestTrip?.last_ping_at ? new Date(latestTrip.last_ping_at).getTime() : 0;
    // The bus phone reports every few seconds while the app is open. Half an
    // hour of silence (when it is not deliberately paused) means that ride is
    // over, even if the phone never managed to send its "end ride".
    const wentQuiet =
      lastPingMs > 0 && !latestTrip?.location_paused && Date.now() - lastPingMs > 30 * 60_000;
    // A ride left open overnight must never keep a child "on the bus" all day.
    const running =
      latestTrip?.status === "in_transit" &&
      !latestTrip.ended_at &&
      !wentQuiet &&
      Date.now() - startedMs < 10 * 3_600_000;
    const trip = running ? latestTrip : null;
    lastRide =
      latestTrip && !running
        ? {
            id: latestTrip.id,
            direction: latestTrip.direction,
            startedAt: latestTrip.started_at,
            endedAt: latestTrip.ended_at ?? latestTrip.last_ping_at,
          }
        : null;

    let lastSeen = null;
    if (trip) {
      const { data: logs } = await supabaseAdmin
        .from("pupil_bus_logs")
        .select("status, timestamp, guardian_name, recorded_by")
        .eq("member_id", member.id)
        .eq("trip_id", trip.id)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      activeTrip = { id: trip.id, direction: trip.direction, started_at: trip.started_at };
      tripLog = logs
        ? {
            status: logs.status,
            timestamp: logs.timestamp,
            guardian_name: logs.guardian_name,
            recorded_by: logs.recorded_by,
          }
        : null;

      // Use the same logic as getBusTracking for the place name.
      if (trip.current_lat && trip.current_lng) {
        const latKey = Math.round(trip.current_lat * 10000);
        const lngKey = Math.round(trip.current_lng * 10000);
        const { data: cached } = await supabaseAdmin
          .from("place_names")
          .select("name")
          .eq("lat_key", latKey)
          .eq("lng_key", lngKey)
          .maybeSingle();

        lastSeen = {
          // The bus's own position, never the child's state: saying "On the bus"
          // here made every parent read it as "my child is on the bus".
          place: cached?.name || "On the way",
          at: trip.last_ping_at,
          stale:
            trip.last_ping_at != null && trip.last_ping_at !== ""
              ? Date.now() - new Date(trip.last_ping_at).getTime() > 5 * 60 * 1000
              : null,
        };
      }

      busInfo = {
        bus: bus
          ? {
              id: bus.id,
              number: bus.bus_number,
              plate: bus.plate_number,
              route: bus.route_axis,
              driver: bus.driver_name,
              driverPhone: allowCallDriver ? bus.driver_phone : null,
              attendant: bus.attendant_name,
              attendantPhone: allowCallAttendant ? bus.attendant_phone : null,
            }
          : null,
        ride: { direction: trip.direction, startedAt: trip.started_at },
        journey: {
          direction: trip.direction,
          phase: trip.direction === "to_home" ? "dropping_off" : "picking_up",
          startedAt: trip.started_at,
        },
        lastSeen,
        lastRide,
      };
    } else {
      busInfo = {
        bus: bus
          ? {
              id: bus.id,
              number: bus.bus_number,
              plate: bus.plate_number,
              route: bus.route_axis,
              driver: bus.driver_name,
              driverPhone: allowCallDriver ? bus.driver_phone : null,
              attendant: bus.attendant_name,
              attendantPhone: allowCallAttendant ? bus.attendant_phone : null,
            }
          : null,
        ride: null,
        journey: null,
        lastSeen: null,
        lastRide,
      };
    }
  }

  // The bus is part of the child's day too: a drop-off from the school bus
  // moves them out of school just as a gate scan does. Without this a child
  // handed over by the bus stayed "In School" until the next morning.
  const { data: latestBusLogRaw } = await supabaseAdmin
    .from("pupil_bus_logs")
    .select(
      "status, timestamp, guardian_name, guardian_id, recorded_by, trip_id, trip:bus_trips(direction)",
    )
    .eq("member_id", member.id)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestBusLog = latestBusLogRaw as
    | {
        status: string;
        timestamp: string;
        guardian_name: string | null;
        guardian_id: string | null;
        recorded_by: string | null;
        trip_id: string;
        trip: { direction: string | null } | { direction: string | null }[] | null;
      }
    | null;
  const busDirection = busTripDirection(latestBusLog);

  // Who was involved in a bus scan: the guardian the child was handed to, or
  // the crew member holding the phone. A boarding is always crew.
  let crewRow: { driver_profile_id: string | null; attendant_profile_id: string | null } | null =
    null;
  if (member.bus_id) {
    const { data } = await supabaseAdmin
      .from("bus_crew")
      .select("driver_profile_id, attendant_profile_id")
      .eq("bus_id", member.bus_id)
      .maybeSingle();
    crewRow = data ?? null;
  }
  const crewIds = Array.from(
    new Set(
      [tripLog?.recorded_by, latestBusLog?.recorded_by].filter((id): id is string => !!id),
    ),
  );
  const crewNames = new Map<string, string>();
  if (crewIds.length) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", crewIds);
    for (const p of data ?? []) if (p.full_name) crewNames.set(p.id, p.full_name);
  }

  type RecordedBy = { name: string; role: "Guardian" | "Attendant" | "Driver" | "Guard" | "Crew" };
  const crewRecorder = (profileId: string | null): RecordedBy | null => {
    if (!profileId) return null;
    const name = crewNames.get(profileId) ?? null;
    const role =
      crewRow?.attendant_profile_id === profileId
        ? "Attendant"
        : crewRow?.driver_profile_id === profileId
          ? "Driver"
          : busRow?.attendant_name
            ? "Attendant"
            : busRow?.driver_name
              ? "Driver"
              : "Crew";
    const resolved = name ?? (role === "Driver" ? busRow?.driver_name : busRow?.attendant_name);
    return resolved ? { name: resolved, role } : null;
  };
  const busRecorder = (row: {
    guardian_name: string | null;
    recorded_by: string | null;
  } | null): RecordedBy | null => {
    if (!row) return null;
    const guardian = row.guardian_name?.trim();
    if (guardian) return { name: guardian, role: "Guardian" };
    return crewRecorder(row.recorded_by);
  };

  let gateStatus = "unknown";
  let statusAt: string | null = null;
  let statusNote: string | null = null;
  // Where the child actually is right now. The status chip says what happened;
  // this says where that leaves them, which is what parents ask for.
  let place: string | null = null;

  const gateAt = latestGate?.timestamp ? new Date(latestGate.timestamp).getTime() : 0;
  const busAt = latestBusLog?.timestamp ? new Date(latestBusLog.timestamp).getTime() : 0;

  if (activeTrip) {
    // A ride is running: only this ride counts. A pupil who has not been
    // scanned onto the bus yet is waiting for it, not already on board.
    const goingHome = activeTrip.direction === "to_home";
    if (tripLog?.status === "boarded") {
      gateStatus = "on_bus";
      statusNote = "On the bus";
      place = "On the bus";
      statusAt = tripLog.timestamp;
    } else if (tripLog?.status === "dropped_off") {
      // A morning drop is the child arriving at school, an afternoon one is the
      // child reaching home. Same log, two very different places.
      gateStatus = goingHome ? "dropped_off" : "in_school";
      statusNote = goingHome ? "Dropped off at home" : "Dropped off at school";
      place = goingHome ? "At home" : "In school";
      statusAt = tripLog.timestamp;
    } else {
      gateStatus = "awaiting_bus";
      statusNote = goingHome
        ? "Waiting for the bus to drop off"
        : "Waiting for the bus to pick up";
      place = goingHome ? "In school" : "At home";
      statusAt = activeTrip.started_at;
    }
  } else if (
    lastRide &&
    latestBusLog?.trip_id === lastRide.id &&
    latestBusLog.status === "boarded" &&
    busAt > gateAt
  ) {
    // The driver ended the ride while this child still read as on board. Most
    // of the time it is a missed tap, so say it calmly instead of alarming
    // anyone: the school can confirm.
    gateStatus = "ride_ended";
    statusNote = "Ride ended. Drop-off wasn't recorded, the school will confirm.";
    statusAt = lastRide.endedAt;
  } else if (latestBusLog?.status === "dropped_off" && busAt > gateAt) {
    // The ride is over, so a boarding from it no longer means "on the bus".
    const goingHome = busDirection ? busDirection === "to_home" : !!latestBusLog.guardian_name;
    gateStatus = goingHome ? "dropped_off" : "in_school";
    statusNote = goingHome ? "Dropped off at home" : "Dropped off at school";
    place = goingHome ? "At home" : "In school";
    statusAt = latestBusLog.timestamp;
  } else if (latestGate) {
    if (latestGate.action_type === "check_in") {
      // A child who checked in and never scanned out is still in school, even
      // if the scan was hours ago. Never guess "picked up" from age alone,
      // but a check-in from yesterday must not read as "in school" today.
      const hoursAgo = (Date.now() - gateAt) / 3_600_000;
      if (hoursAgo > 16) {
        gateStatus = "unknown";
        statusNote = "No gate or bus scan yet today";
      } else {
        gateStatus = "in_school";
        place = "In school";
        statusNote = `Scanned in at the gate${
          latestGate.verified_guardian_name ? ` by ${latestGate.verified_guardian_name}` : ""
        }`;
      }
    } else if (latestGate.action_type === "check_out") {
      gateStatus = "picked_up";
      place = "At home";
      statusNote = `Picked up at the gate${
        latestGate.verified_guardian_name ? ` by ${latestGate.verified_guardian_name}` : ""
      }`;
    }
    statusAt = latestGate.timestamp;
  }

  // Recent activity for the last five days, so a parent can see what happened
  // without digging through emails.
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { data: gateLogs } = await supabaseAdmin
    .from("gate_logs")
    .select("action_type, timestamp, verified_guardian_name, guard_name")
    .eq("member_id", member.id)
    .gte("timestamp", fiveDaysAgo)
    .order("timestamp", { ascending: false })
    .limit(25);
  const { data: busLogs } = await supabaseAdmin
    .from("pupil_bus_logs")
    .select("status, timestamp, guardian_name, trip:bus_trips(direction)")
    .eq("member_id", member.id)
    .gte("timestamp", fiveDaysAgo)
    .order("timestamp", { ascending: false })
    .limit(25);
  const recentLogs = [
    ...(gateLogs ?? []).map((g) => ({
      type: g.action_type === "check_in" ? "gate_in" : "gate_out",
      at: g.timestamp,
      label:
        g.action_type === "check_in"
          ? `Checked in at the gate${g.verified_guardian_name ? ` by ${g.verified_guardian_name}` : ""}`
          : `Picked up${g.verified_guardian_name ? ` by ${g.verified_guardian_name}` : ""}`,
    })),
    ...(busLogs ?? []).map((b) => {
      const goingHome = busTripDirection(b) === "to_home";
      return {
        type: b.status === "boarded" ? "bus_board" : "bus_drop",
        at: b.timestamp,
        label:
          b.status === "boarded"
            ? "Picked up by the school bus"
            : goingHome || (busTripDirection(b) === null && !!b.guardian_name)
              ? "Dropped off at home"
              : "Dropped off at school",
      };
    }),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);

  // The single most recent thing that happened, from either the gate or the
  // bus, so the "last action" lines can never disagree with the status above.
  const busPerson = busRecorder(latestBusLog);
  const gatePerson: RecordedBy | null = latestGate
    ? latestGate.verified_guardian_name?.trim()
      ? { name: latestGate.verified_guardian_name.trim(), role: "Guardian" }
      : latestGate.guard_name?.trim()
        ? { name: latestGate.guard_name.trim(), role: "Guard" }
        : null
    : null;

  const lastEvent =
    latestBusLog && busAt >= gateAt
      ? {
          label:
            latestBusLog.status === "boarded"
              ? "Picked up by the school bus"
              : busDirection === "to_home" || (!busDirection && !!latestBusLog.guardian_name)
                ? "Dropped off at home"
                : "Dropped off at school",
          at: latestBusLog.timestamp,
          by: busPerson?.name ?? null,
          byRole: busPerson?.role ?? null,
        }
      : latestGate
        ? {
            label:
              latestGate.action_type === "check_in"
                ? "Checked in at the gate"
                : "Picked up from school",
            at: latestGate.timestamp,
            by: gatePerson?.name ?? null,
            byRole: gatePerson?.role ?? null,
          }
        : null;

  const { readContact, CONTACT_ORG_PHONE } = await import("@/lib/contact-crypto.server");
  return {
    id: member.id,
    name: member.full_name,
    class: member.identifier_code,
    branch: member.branch?.name,
    orgName: member.org?.name,
    orgType: member.org?.type,
    emergencyPhone: readContact(
      member.org?.emergency_phone_enc,
      member.org?.emergency_phone,
      CONTACT_ORG_PHONE,
    ),
    photoPath: member.photo_path,
    photoUrl,
    usesBus: member.uses_bus,
    allowCallDriver,
    allowCallAttendant,
    gateStatus,
    place,
    statusAt,
    statusNote,
    parentLinkToken: member.parent_link_token,
    latestGate: latestGate
      ? {
          action: latestGate.action_type,
          at: latestGate.timestamp,
          guardian: latestGate.verified_guardian_name,
          guard: latestGate.guard_name,
        }
      : null,
    lastEvent,
    bus: busInfo,
    recentLogs,
  };
}

/**
 * Verify OTP for parent PWA access
 */
export const verifyParentPwaOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ pwaToken: pwaTokenSchema, otpCode: otpCodeSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select(
        "id, member_id, org_id, otp_code, otp_expires_at, otp_verified_at, webauthn_credential_id",
      )
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();

    if (error || !tokenRow) {
      throw new Error("Invalid or expired link.");
    }

    if (tokenRow.otp_verified_at) {
      // Already verified, check for WebAuthn credential
      return {
        verified: true,
        hasWebAuthn: !!tokenRow.webauthn_credential_id,
        memberId: tokenRow.member_id,
        orgId: tokenRow.org_id,
      };
    }

    if (!tokenRow.otp_code || tokenRow.otp_code !== data.otpCode) {
      throw new Error("Incorrect code. Please try again.");
    }

    if (tokenRow.otp_expires_at && new Date(tokenRow.otp_expires_at) < new Date()) {
      throw new Error("Code has expired. Please request a new link.");
    }

    // Mark OTP as verified
    await supabaseAdmin
      .from("parent_pwa_tokens")
      .update({ otp_verified_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    return {
      verified: true,
      hasWebAuthn: !!tokenRow.webauthn_credential_id,
      memberId: tokenRow.member_id,
      orgId: tokenRow.org_id,
    };
  });

/**
 * Get every child this parent can see (gate + bus), with the first child as the
 * one to show when the app opens.
 */
export const getParentChildStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ pwaToken: pwaTokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("id, member_id, org_id, parent_link_token, otp_verified_at, webauthn_credential_id")
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();

    if (error || !tokenRow || !tokenRow.otp_verified_at) {
      throw new Error("Access denied. Please verify your code first.");
    }

    // Update last accessed
    await supabaseAdmin
      .from("parent_pwa_tokens")
      .update({ last_accessed_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    // Mark parent_app_installed if first access
    await supabaseAdmin
      .from("members")
      .update({
        parent_app_installed: true,
        parent_app_installed_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.member_id)
      .eq("parent_app_installed", false);

    // Whether the school lets parents phone the crew from this app. Read on its
    // own so a school that hasn't added the setting yet still gets the default.
    const { data: orgSettings } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", tokenRow.org_id)
      .maybeSingle();
    const orgRow = orgSettings as unknown as {
      allow_parent_calls?: boolean;
      school_calendar?: {
        parent_app?: { allow_driver_calls?: boolean; allow_attendant_calls?: boolean };
      } | null;
    } | null;
    const callsOn = orgRow?.allow_parent_calls !== false;
    const savedCalls = orgRow?.school_calendar?.parent_app;
    const allowCallDriver = callsOn && savedCalls?.allow_driver_calls !== false;
    const allowCallAttendant = callsOn && savedCalls?.allow_attendant_calls !== false;

    // How many phones are actually registered for alerts. The app says "alerts
    // on" only when the server really holds a device, so a parent is never told
    // they will be notified when the registration didn't happen.
    let pushDevices = 0;
    let pushLastUsedAt: string | null = null;
    if (tokenRow.parent_link_token) {
      const { data: devices } = await supabaseAdmin
        .from("push_subscriptions")
        .select("last_used_at, created_at")
        .eq("parent_link_token", tokenRow.parent_link_token);
      pushDevices = devices?.length ?? 0;
      for (const device of devices ?? []) {
        const at = device.last_used_at ?? device.created_at;
        if (at && (!pushLastUsedAt || at > pushLastUsedAt)) pushLastUsedAt = at;
      }
    }

    const ids = await familyMemberIds(tokenRow.member_id, tokenRow.org_id, tokenRow.parent_link_token);
    const built = await Promise.all(
      ids.map((id) => buildChildStatus(id, allowCallDriver, allowCallAttendant)),
    );
    const children = built.filter((c): c is NonNullable<typeof c> => c !== null);
    if (!children.length) throw new Error("Child not found.");

    // The child whose registration created the link is the one that opens first.
    const selected = children.find((c) => c.id === tokenRow.member_id) ?? children[0];
    if (!selected) throw new Error("Child not found.");

    return {
      child: selected,
      children,
      parentLinkToken: selected.parentLinkToken,
      hasWebAuthn: !!tokenRow.webauthn_credential_id,
      push: { devices: pushDevices, lastUsedAt: pushLastUsedAt },
    };
  });

/**
 * Register WebAuthn credential for biometric auth
 */
export const registerParentWebAuthn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ pwaToken: pwaTokenSchema, credentialId: z.string() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("id, otp_verified_at")
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();

    if (error || !tokenRow || !tokenRow.otp_verified_at) {
      throw new Error("Access denied.");
    }

    await supabaseAdmin
      .from("parent_pwa_tokens")
      .update({ webauthn_credential_id: data.credentialId })
      .eq("id", tokenRow.id);

    return { success: true };
  });

/**
 * Resend OTP for parent PWA access
 */
export const resendParentPwaOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ pwaToken: pwaTokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("id, member_id, org_id, otp_verified_at")
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();

    if (error || !tokenRow) {
      throw new Error("Invalid link.");
    }

    // Always send a fresh code, verified link or not: a parent opening the app
    // on a new phone needs one, and silently doing nothing is what made
    // "Resend" look broken.
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from("parent_pwa_tokens")
      .update({ otp_code: otpCode, otp_expires_at: otpExpiresAt })
      .eq("id", tokenRow.id);

    let emailed = false;
    if (emailConfigured()) {
      try {
        emailed = await sendParentPwaOtpEmail(tokenRow.id, otpCode);
      } catch {
        emailed = false;
      }
    }

    // The code itself is never returned to the browser: it only belongs in the
    // parent's inbox.
    return { success: true, emailed };
  });

/**
 * Whether this link already needs a code at all. A studied link opens straight
 * into the app, so a parent is never asked for a code they no longer need.
 */
export const getParentPwaGate = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ pwaToken: pwaTokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: tokenRow } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("otp_verified_at, webauthn_credential_id")
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();
    return {
      verified: !!tokenRow?.otp_verified_at,
      hasWebAuthn: !!tokenRow?.webauthn_credential_id,
    };
  });

/**
 * Picture-steps for saving the app and turning alerts on. Kept to tables and
 * inline styles so Gmail, Outlook and Apple Mail all draw it.
 */
function parentSetupEmailHtml(): string {
  const chip = (glyph: string, glyphSize: string, caption: string) =>
    `<td width="33%" align="center" style="padding:3px;">
      <div style="border:2px solid ${EMAIL.inkSoft};border-radius:14px;background:${EMAIL.card};padding:12px 6px;">
        <div style="font:700 ${glyphSize} ${EMAIL.font};color:${EMAIL.ink};line-height:1.1;">${glyph}</div>
        <div style="margin-top:6px;font:600 9px/12px ${EMAIL.font};letter-spacing:.06em;text-transform:uppercase;color:${EMAIL.muted};">${escapeHtml(
          caption,
        )}</div>
      </div>
    </td>`;

  const steps = (items: string[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items
      .map(
        (text, i) => `<tr>
      <td width="26" valign="top" style="padding:0 6px 8px 0;">
        <div style="width:20px;height:20px;border-radius:10px;background:${EMAIL.ink};color:${EMAIL.card};font:700 11px/20px ${EMAIL.font};text-align:center;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:0 0 8px;font:400 14px/21px ${EMAIL.font};color:${EMAIL.text};">${escapeHtml(
        text,
      )}</td>
    </tr>`,
      )
      .join("")}</table>`;

  const card = (title: string, glyphs: string, items: string[]) =>
    `<div style="margin:0 0 14px;padding:14px;border:1px solid ${EMAIL.border};border-radius:16px;background:${EMAIL.card};">
      <p style="margin:0 0 10px;font:700 11px/15px ${EMAIL.font};letter-spacing:.14em;text-transform:uppercase;color:${EMAIL.muted};">${escapeHtml(
        title,
      )}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>${glyphs}</tr></table>
      ${steps(items)}
    </div>`;

  const android = card(
    "Android phone, Chrome",
    chip("⋮", "22px", "Top right") +
      chip("Add to Home screen", "11px", "Tap this") +
      chip("▣", "22px", "New icon"),
    [
      "Open this email's link in Chrome. If it opened inside another app, tap its ⋯ menu and choose “Open in Chrome”.",
      "Tap the three dots (⋮) at the top right of Chrome, then tap “Add to Home screen”, then “Add”.",
      "Close Chrome. The GoGuard icon is now with your other apps. Open GoGuard from there, not from this email.",
    ],
  );

  const iphone = card(
    "iPhone, Safari",
    chip("↑", "24px", "Bottom bar") +
      chip("Add to Home Screen", "11px", "Tap this") +
      chip("▣", "22px", "New icon"),
    [
      "Open this email's link in Safari. In Gmail, tap ⋯ at the top and choose “Open in Safari”.",
      "Tap the share button (a square with an arrow up) at the bottom of the screen, scroll down and tap “Add to Home Screen”, then “Add”.",
      "Close Safari. Open GoGuard from the new icon on your Home Screen. On iPhone, alerts only work after this step.",
    ],
  );

  const alerts = `<div style="margin:0 0 4px;padding:14px;border:1px solid ${EMAIL.border};border-radius:16px;background:#fdf3e0;">
    <p style="margin:0 0 10px;font:700 11px/15px ${EMAIL.font};letter-spacing:.14em;text-transform:uppercase;color:${EMAIL.muted};">Then turn alerts on</p>
    ${steps([
      "Open GoGuard from the new icon. At the top of the page, tap “Alerts”.",
      "When your phone asks about notifications, tap “Allow”. That is what makes the phone ring when your child is scanned.",
      "The page will show “Alerts on”. If it does not, open your phone's Settings, find GoGuard (or the browser) and allow notifications.",
    ])}
  </div>`;

  return `<h2 style="margin:6px 0 8px;font:800 18px/24px ${EMAIL.font};color:${EMAIL.ink};">Save GoGuard to your phone</h2>
  <p style="margin:0 0 14px;font:400 14px/21px ${EMAIL.font};color:${EMAIL.text};">This turns the link into an app icon, so you can open it with one tap and get an alert the moment your child is scanned at the gate or on the bus. Choose the pictures for your phone:</p>
  ${android}
  ${iphone}
  ${alerts}`;
}

/**
 * Send OTP email for parent PWA access
 */
async function sendParentPwaOtpEmail(pwaTokenId: string, otpCode: string): Promise<boolean> {
  const { data: tokenRow } = await supabaseAdmin
    .from("parent_pwa_tokens")
    .select(
      "pwa_token, parent_link_token, member:members(full_name, primary_email, primary_email_enc, parent_or_owner_name), org:organizations(name)",
    )
    .eq("id", pwaTokenId)
    .maybeSingle();

  const { decryptMemberRow } = await import("@/lib/contact-crypto.server");
  if (!tokenRow?.member) return false;
  const member = decryptMemberRow(tokenRow.member);
  if (!member.primary_email) return false;

  const { sendEmail } = await import("./email.server");
  const subject = tokenRow.org?.name
    ? `${tokenRow.org.name} parent app access code`
    : "Your parent app access code";
  const text = [
    `Hello ${member.parent_or_owner_name || "there"},`,
    "",
    `Your children are registered at ${tokenRow.org?.name || "the school"}.`,
    `Your 6-digit access code is: ${otpCode}`,
    "",
    `This code works for 30 minutes. Use it at: ${tokenRow.pwa_token ? `https://goguard.ng/parent/${tokenRow.pwa_token}` : "the Parent App link"}`,
    "",
    "If you didn't expect this, please contact the school.",
  ].join("\n");

  const accessUrl = tokenRow.pwa_token
    ? `https://goguard.ng/parent/${tokenRow.pwa_token}`
    : "https://goguard.ng/parent";
  const { emailButton, emailFooter, emailLayout, emailNote, emailParagraph } = await import(
    "./email-template"
  );
  const html = emailLayout({
    orgName: tokenRow.org?.name ?? null,
    label: "Parent app",
    preheader: `Your GoGuard access code is ${otpCode}`,
    heading: "Your Parent App access code",
    intro: `Use this code to see your children's gate status and bus updates.`,
    body: `<p style="margin:0 0 18px;text-align:center;font:800 32px/40px 'Courier New',monospace;letter-spacing:8px;color:#15332c;">${otpCode}</p>
${emailButton("Open the parent app", accessUrl)}
${emailNote("This code works for 30 minutes. Once the app is open on your phone it stays signed in, so you won't need a code again. If you didn't expect this, contact the school.")}
${emailParagraph("Never share this code with anyone.")}
${parentSetupEmailHtml()}`,
    footerNote: emailFooter(tokenRow.org?.name),
    siteUrl: "https://goguard.ng",
  });

  try {
    await sendEmail({
      to: member.primary_email,
      subject,
      text,
      html,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the parent app link for a family. One link per guardian, not per
 * child: registering a second child with the same guardians reuses the link the
 * family already has, so the app shows every child together.
 */
export const createParentPwaToken = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        orgId: z.string().uuid(),
        parentLinkToken: z.string().uuid(),
        siteUrl: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { memberId, orgId, parentLinkToken, siteUrl } = data;
    const baseUrl = siteUrl.replace(/\/$/, "");

    const { data: existing } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("id, pwa_token, otp_verified_at")
      .eq("org_id", orgId)
      .eq("parent_link_token", parentLinkToken)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.pwa_token) {
      // An unverified link needs a working code; a verified one already works.
      if (!existing.otp_verified_at) {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        await supabaseAdmin
          .from("parent_pwa_tokens")
          .update({
            otp_code: otpCode,
            otp_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          })
          .eq("id", existing.id);
        if (emailConfigured()) await sendParentPwaOtpEmail(existing.id, otpCode);
      }
      return {
        success: true,
        pwaToken: existing.pwa_token,
        pwaUrl: `${baseUrl}/parent/${existing.pwa_token}`,
        reused: true,
      };
    }

    // Generate 64-char PWA token
    const pwaToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .insert({
        member_id: memberId,
        org_id: orgId,
        parent_link_token: parentLinkToken,
        pwa_token: pwaToken,
        otp_code: otpCode,
        otp_expires_at: otpExpiresAt,
      })
      .select("id")
      .single();

    if (error || !tokenRow) {
      throw new Error("Failed to create PWA token");
    }

    // Send OTP via email
    if (emailConfigured()) {
      await sendParentPwaOtpEmail(tokenRow.id, otpCode);
    }

    return {
      success: true,
      pwaToken,
      pwaUrl: `${baseUrl}/parent/${pwaToken}`,
    };
  });
