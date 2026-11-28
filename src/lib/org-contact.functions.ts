import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The school's emergency line is the one contact number parents are meant to
 * call, and it is stored encrypted like every other contact detail. These two
 * functions are the only way the admin app reads or writes it: the column is
 * not readable from a signed-in browser session, and the value is decrypted on
 * the server for the school that owns it.
 */
async function myOrg(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabaseAdmin.from("profiles").select("org_id").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (!profile?.org_id) return null;
  return {
    orgId: profile.org_id,
    isAdmin: !!roles?.some((r) => r.role === "admin"),
  };
}

/** Read the line for the signed-in school. Returns null when none is set. */
export const getOrgEmergencyLine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mine = await myOrg(context.userId);
    if (!mine) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readContact, CONTACT_ORG_PHONE } = await import("@/lib/contact-crypto.server");
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("emergency_phone, emergency_phone_enc")
      .eq("id", mine.orgId)
      .maybeSingle();
    // Before the encryption columns exist the plain column is the only one.
    if (error) return null;
    if (!data) return null;
    return readContact(data.emergency_phone_enc, data.emergency_phone, CONTACT_ORG_PHONE);
  });

/** Save the line. Empty clears it. Administrators only. */
export const saveOrgEmergencyLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        phone: z
          .string()
          .trim()
          .max(30)
          .regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + only"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const mine = await myOrg(context.userId);
    if (!mine) throw new Error("We couldn't find your school. Please sign in again.");
    if (!mine.isAdmin) throw new Error("Only an administrator can change the emergency line.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptContact, CONTACT_ORG_PHONE } = await import("@/lib/contact-crypto.server");
    const phone = data.phone.trim();
    const { error } = await supabaseAdmin
      .from("organizations")
      .update({
        emergency_phone: null,
        emergency_phone_enc: phone ? encryptContact(phone, CONTACT_ORG_PHONE) : null,
      })
      .eq("id", mine.orgId);
    if (error) throw new Error("Couldn't save the emergency line. Please try again.");
    return { phone: phone || null };
  });
