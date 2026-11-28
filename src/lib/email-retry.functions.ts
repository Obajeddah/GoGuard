import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Retry anything that still needs to reach a parent.
 *
 * This deployment has no scheduled job, so a ride email that failed once would
 * otherwise never be tried again. Every parent-app refresh and every bus sync
 * calls this: it picks up recent unsent notices and sends them. It only ever
 * mails the parents already stored on the notice, so it cannot be used to send
 * anything anywhere else.
 */
export const drainParentEmails = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ limit: z.number().int().min(1).max(20).optional() })
      .optional()
      .parse(input ?? {}) ?? {},
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emailConfigured } = await import("./email.server");
    if (!emailConfigured()) return { sent: 0, checked: 0 };

    const limit = data.limit ?? 10;
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();

    const { data: notices } = await supabaseAdmin
      .from("transport_notices")
      .select("id, org_id, member_id, guardian_id, kind, message")
      .is("emailed_at", null)
      .in("kind", ["pupil_boarded", "pupil_dropped_off"])
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!notices?.length) return { sent: 0, checked: 0 };

    const { deliverRideNotice } = await import("./bus-email.server");
    let sent = 0;
    for (const notice of notices) sent += await deliverRideNotice(notice);
    return { sent, checked: notices.length };
  });
