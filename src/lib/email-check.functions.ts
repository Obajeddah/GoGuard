import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const guardian = z.object({
  email: z.string().trim().email().max(255),
  name: z.string().trim().min(1).max(120),
});

/**
 * Tells the staff forms which guardian addresses are already taken by someone
 * else, so a reused email is caught before anything is saved or emailed.
 */
export const checkGuardianEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ guardians: z.array(guardian).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { findEmailClashes } = await import("./email-rules.server");
    return { clashes: await findEmailClashes(data.guardians) };
  });
