import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The school office opening GoGuard runs the watch for its own children. */
export const runPickupWatchNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ reopen: z.boolean().optional() }).optional().parse(input ?? {}) ?? {},
  )
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("org_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.org_id) return { sent: 0, stage: 0 };
    const { runPickupWatch } = await import("./pickup-watch.server");
    return runPickupWatch(profile.org_id);
  });

/**
 * A parent opening their app runs the watch for every child on their link,
 * cheap, and it means the reminder still goes out precisely at the half hour
 * even if nobody at the school has a screen open.
 */
export const runParentPickupWatch = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ pwaToken: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: token } = await supabaseAdmin
      .from("parent_pwa_tokens")
      .select("member_id, org_id, parent_link_token, otp_verified_at")
      .eq("pwa_token", data.pwaToken)
      .maybeSingle();
    if (!token?.otp_verified_at) return { sent: 0, stage: 0 };

    // Every child on this guardian's link, not just the one that registered.
    let memberIds: string[] = [token.member_id];
    if (token.parent_link_token) {
      const { data: members } = await supabaseAdmin
        .from("members")
        .select("id")
        .eq("org_id", token.org_id)
        .eq("parent_link_token", token.parent_link_token);
      if (members?.length) memberIds = members.map((m) => m.id);
    }

    const { runPickupWatch } = await import("./pickup-watch.server");
    return runPickupWatch(token.org_id, memberIds);
  });
