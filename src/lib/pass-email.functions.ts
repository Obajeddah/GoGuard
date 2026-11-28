import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Emails the passes for a student the signed-in staff member can already see.
 * Used after "Add student" so guardians get their barcode straight away.
 */
export const sendMemberPassEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ memberId: z.string().uuid(), siteUrl: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: member } = await context.supabase
      .from("members")
      .select("id, parent_link_token")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!member) throw new Error("That student isn't in your school.");

    // If the family already has a parent app link, include it. Never create one
    // here: that would email a fresh access code on every pass resend.
    let parentAppUrl: string | null = null;
    if (member.parent_link_token) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: tokenRow } = await supabaseAdmin
        .from("parent_pwa_tokens")
        .select("pwa_token")
        .eq("parent_link_token", member.parent_link_token)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (tokenRow?.pwa_token)
        parentAppUrl = `${data.siteUrl.replace(/\/$/, "")}/parent/${tokenRow.pwa_token}`;
    }

    const { sendPassEmailsForMember } = await import("./pass-email.server");
    return sendPassEmailsForMember({
      memberId: data.memberId,
      siteUrl: data.siteUrl,
      parentAppUrl,
    });
  });
