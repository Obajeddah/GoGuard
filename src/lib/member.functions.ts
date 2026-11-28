import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_GUARDIANS } from "./org-terms";

/**
 * Adds a student and their guardians from the school's own app.
 *
 * The browser never sees the encryption key, so the addresses and numbers are
 * encrypted here, on the server, before the row is written. The plaintext
 * contact columns stay empty: the encrypted value and the blind index are the
 * only copies of the address.
 */
export const createMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        branchId: z.string().uuid(),
        fullName: z.string().trim().min(1).max(120),
        identifierCode: z.string().trim().max(60).optional().default(""),
        parentName: z.string().trim().max(120).optional().default(""),
        email: z.string().trim().email("Enter a valid email").max(255),
        phone: z.string().trim().max(30).optional().default(""),
        guardians: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              relationship: z.string().trim().min(1).max(60),
              email: z.string().trim().email("Enter a valid email").max(255),
              notify: z.boolean(),
            }),
          )
          .max(MAX_GUARDIANS)
          .optional()
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { encryptContact, emailIndex, CONTACT_MEMBER_EMAIL, CONTACT_MEMBER_PHONE, CONTACT_GUARDIAN_EMAIL } =
      await import("@/lib/contact-crypto.server");
    const { findEmailClashes } = await import("./email-rules.server");

    // One address belongs to one person. A guardian whose address is already
    // used by someone else is left out rather than given another child's
    // account; the caller is told how many were skipped.
    const clashes = new Set(
      await findEmailClashes(data.guardians.map((g) => ({ email: g.email, name: g.name }))),
    );
    const accepted = data.guardians.filter((g) => !clashes.has(g.email.trim().toLowerCase()));

    const email = data.email.trim().toLowerCase();
    const { data: member, error } = await supabase
      .from("members")
      .insert({
        org_id: data.orgId,
        branch_id: data.branchId,
        full_name: data.fullName.trim(),
        identifier_code: data.identifierCode.trim() || null,
        parent_or_owner_name: data.parentName.trim() || null,
        primary_email: null,
        primary_email_enc: encryptContact(email, CONTACT_MEMBER_EMAIL),
        parent_email_hash: emailIndex(email),
        primary_phone: null,
        primary_phone_enc: encryptContact(data.phone, CONTACT_MEMBER_PHONE),
      })
      .select("id")
      .single();
    if (error || !member) throw new Error("Could not save the student's details.");

    const saved: { id: string; email: string }[] = [];
    for (const g of accepted) {
      const address = g.email.trim().toLowerCase();
      const { data: row, error: gErr } = await supabase
        .from("guardians")
        .insert({
          member_id: member.id,
          org_id: data.orgId,
          name: g.name.trim(),
          relationship: g.relationship.trim(),
          email: null,
          email_enc: encryptContact(address, CONTACT_GUARDIAN_EMAIL),
          email_hash: emailIndex(address),
          receive_general_notifications: g.notify,
        })
        .select("id")
        .single();
      if (gErr || !row) {
        // Leave nothing half-saved: the caller deletes the member, and the
        // guardian rows go with it.
        throw new Error(`Could not save ${g.name.trim()}'s details.`);
      }
      saved.push({ id: row.id, email: address });
    }

    return {
      memberId: member.id,
      guardians: saved,
      skipped: data.guardians.length - accepted.length,
    };
  });

/**
 * Saves a student's name, class, parent name or branch.
 *
 * The edit function in the database also rewrites the parent's email and phone,
 * so the encrypted values are read on the server and passed back unchanged. The
 * school never receives the family's contact details, not even to preserve
 * them, and nothing on that path is ever decrypted.
 */
export const updateMemberDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        pin: z.string().regex(/^\d{4}$/, "Enter the 4-digit edit code"),
        fullName: z.string().trim().min(1).max(120),
        identifierCode: z.string().trim().max(60).optional().default(""),
        parentName: z.string().trim().max(120).optional().default(""),
        branchId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Read the stored ciphertext with the privileged client: a school account
    // cannot select these columns at all (see
    // supabase/contact-encryption-2-finalize.sql), and the edit function below
    // checks that this user may edit this student before anything is written.
    // The values stay encrypted end to end on this path.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member, error } = await supabaseAdmin
      .from("members")
      .select(
        "primary_email, primary_email_enc, primary_phone, primary_phone_enc, parent_email_hash",
      )
      .eq("id", data.memberId)
      .maybeSingle();
    if (error || !member)
      throw new Error("We couldn't find this student's record. Please try again.");

    // Rows saved before encryption have no ciphertext yet. Rather than showing
    // or storing the address, encrypt it here on the server.
    const { encryptContact, emailIndex, CONTACT_MEMBER_EMAIL, CONTACT_MEMBER_PHONE } =
      await import("@/lib/contact-crypto.server");
    const emailEnc =
      member.primary_email_enc ||
      encryptContact(member.primary_email, CONTACT_MEMBER_EMAIL);
    const phoneEnc =
      member.primary_phone_enc ||
      encryptContact(member.primary_phone, CONTACT_MEMBER_PHONE);
    const emailHash =
      member.parent_email_hash || emailIndex(member.primary_email);

    const { data: result, error: rpcError } = await supabase.rpc("edit_member", {
      _member_id: data.memberId,
      _pin: data.pin,
      _full_name: data.fullName,
      _class: data.identifierCode ?? "",
      _parent_name: data.parentName ?? "",
      _email_enc: emailEnc,
      _phone_enc: phoneEnc,
      _email_hash: emailHash,
      _branch_id: data.branchId,
    });
    if (rpcError) throw new Error(rpcError.message);
    return result as string;
  });
