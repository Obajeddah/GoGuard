import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Records a check-in / check-out for the guardian whose QR pass was scanned.
 * Runs as the signed-in guard (RLS: same organization, guard/admin role).
 */
export const recordGateAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        guardianId: z.string().uuid(),
        action: z.enum(["check_in", "check_out"]),
        /** Set when a scan made offline is sent later: keeps the real scan time and avoids double entries. */
        clientId: z.string().uuid().optional(),
        scannedAt: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: guardian } = await supabase
      .from("guardians")
      .select("id, member_id, org_id")
      .eq("id", data.guardianId)
      .maybeSingle();
    if (!guardian) throw new Error("This pass isn't registered with your organization.");

    const { data: log, error } = await supabase
      .from("gate_logs")
      .insert({
        org_id: guardian.org_id,
        member_id: guardian.member_id,
        guardian_id: guardian.id,
        scanned_by_guard_id: userId,
        action_type: data.action,
        ...(data.clientId ? { client_id: data.clientId } : {}),
        ...(data.scannedAt ? { timestamp: data.scannedAt } : {}),
      })
      .select("id, timestamp, action_type, member_name, verified_guardian_name")
      .single();
    if (error?.code === "23505" && data.clientId) {
      // Already sent (offline retry): return the stored entry.
      const { data: existing } = await supabase
        .from("gate_logs")
        .select("id, timestamp, action_type, member_name, verified_guardian_name")
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (existing) return existing;
    }
    if (error || !log) throw new Error("Could not record this gate action. Please try again.");

    // Parents are told the moment the scan happens. The scan itself has already
    // been saved, so a mail problem never blocks the gate.
    try {
      const { sendGateEmailNow } = await import("@/lib/instant-email.server");
      await sendGateEmailNow(log.id, process.env["URL"] ?? "https://goguard.ng");
    } catch (mailError) {
      const { redactValue } = await import("@/lib/redact");
      console.error("[gate] instant email failed", redactValue(mailError));
    }

    return log;
  });
