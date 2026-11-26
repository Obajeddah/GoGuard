import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const pwaTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Invalid token");
const otpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

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
 * Get child status for parent PWA (gate + bus)
 */
export const getParentChildStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ pwaToken: pwaTokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: tokenRow, error } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("id, member_id, org_id, otp_verified_at")
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

    // Get member with org, bus, and latest gate status
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select(
        `
        id,
        full_name,
        identifier_code,
        uses_bus,
        bus_id,
        bus_track_token,
        org:organizations(name, type, emergency_phone),
        branch:branches(name),
        photo_path
      `,
      )
      .eq("id", tokenRow.member_id)
      .maybeSingle();

    if (memberError || !member) {
      throw new Error("Child not found.");
    }

    // Get latest gate log for this member
    const { data: latestGate } = await supabaseAdmin
      .from("gate_logs")
      .select("action_type, timestamp, verified_guardian_name, guard_name")
      .eq("member_id", member.id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get bus tracking if child uses bus
    let busInfo = null;
    if (member.uses_bus && member.bus_id && member.bus_track_token) {
      const { data: bus } = await supabaseAdmin
        .from("buses")
        .select("bus_number, plate_number, route_axis, driver_name, attendant_name")
        .eq("id", member.bus_id)
        .maybeSingle();

      const { data: trip } = await supabaseAdmin
        .from("bus_trips")
        .select(
          "id, direction, started_at, current_lat, current_lng, current_speed, last_ping_at, location_paused, location_requested_at",
        )
        .eq("bus_id", member.bus_id)
        .eq("status", "in_transit")
        .maybeSingle();

      let lastSeen = null;
      if (trip) {
        const { data: logs } = await supabaseAdmin
          .from("pupil_bus_logs")
          .select("status, timestamp, guardian_name")
          .eq("member_id", member.id)
          .eq("trip_id", trip.id)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Use the same logic as getBusTracking for place name
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
            place: cached?.name || "On the bus",
            at: trip.last_ping_at,
            stale:
              trip.last_ping_at != null && trip.last_ping_at !== ""
                ? Date.now() - new Date(trip.last_ping_at).getTime() > 5 * 60 * 1000
                : null,
          };
        }
      }

      busInfo = {
        bus: bus
          ? {
              number: bus.bus_number,
              plate: bus.plate_number,
              route: bus.route_axis,
              driver: bus.driver_name,
              attendant: bus.attendant_name,
            }
          : null,
        ride: trip ? { direction: trip.direction, startedAt: trip.started_at } : null,
        lastSeen,
      };
    }

    // Determine gate status
    let gateStatus = "unknown";
    if (latestGate) {
      const hoursAgo = (Date.now() - new Date(latestGate.timestamp).getTime()) / (1000 * 60 * 60);
      if (latestGate.action_type === "check_in") {
        gateStatus = hoursAgo < 2 ? "in_school" : "picked_up";
      } else if (latestGate.action_type === "check_out") {
        gateStatus = "picked_up";
      }
    }

    // Siblings for this parent (same parent_link_token)
    const { data: parentLinkData } = await supabaseAdmin
      .from("members")
      .select("parent_link_token")
      .eq("id", member.id)
      .maybeSingle();

    const parentLinkToken = parentLinkData?.parent_link_token;
    interface SiblingRow {
      id: string;
      full_name: string;
      identifier_code: string | null;
      uses_bus: boolean;
      bus_track_token: string;
      parent_link_token: string;
      photo_path: string | null;
    }
    let siblings: SiblingRow[] = [];
    if (parentLinkToken) {
      const { data } = await supabaseAdmin
        .from("members")
        .select(
          "id, full_name, identifier_code, uses_bus, bus_track_token, parent_link_token, photo_path",
        )
        .eq("parent_link_token", parentLinkToken);
      siblings = data ?? [];
    }

    const siblingChildren = (siblings ?? []).map((s) => ({
      id: s.id,
      name: s.full_name,
      class: s.identifier_code,
      usesBus: s.uses_bus,
      busTrackToken: s.bus_track_token,
      photoPath: s.photo_path,
      current: s.id === member.id,
    }));

    return {
      child: {
        id: member.id,
        name: member.full_name,
        class: member.identifier_code,
        branch: member.branch?.name,
        orgName: member.org?.name,
        orgType: member.org?.type,
        emergencyPhone: member.org?.emergency_phone,
        photoPath: member.photo_path,
        usesBus: member.uses_bus,
        gateStatus,
        latestGate: latestGate
          ? {
              action: latestGate.action_type,
              at: latestGate.timestamp,
              guardian: latestGate.verified_guardian_name,
              guard: latestGate.guard_name,
            }
          : null,
        bus: busInfo,
      },
      siblings: siblingChildren,
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

    if (tokenRow.otp_verified_at) {
      return { success: true, message: "Already verified." };
    }

    // Generate new OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from("parent_pwa_tokens")
      .update({ otp_code: otpCode, otp_expires_at: otpExpiresAt })
      .eq("id", tokenRow.id);

    // TODO: Send OTP via email/SMS using notification system
    // For now, return the code (in production, send via email/sms)
    return { success: true, otpCode };
  });
