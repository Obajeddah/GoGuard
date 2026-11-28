import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { MAX_GUARDIANS } from "./org-terms";
import { isAllowedClass } from "./classes";
import { createParentPwaToken } from "./parent-pwa.functions";

const photoDataUrl = z
  .string()
  .max(2_000_000, "Photo is too large")
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Invalid photo");

const tokenSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{16,64}$/i, "Invalid link");

/** Children in one registration must share the same guardians and the same
 * bus. A different guardian or a different bus means a separate registration. */
export const MAX_CHILDREN_PER_REGISTRATION = 5;

export const getRegistrationOrg = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient<Database>(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
            h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: rows, error } = await sb.rpc("get_registration_branch", { _token: data.token });
    if (error) throw new Error("We couldn't open this registration link.");
    const row = rows?.[0];
    const { readContact, CONTACT_ORG_PHONE } = await import("@/lib/contact-crypto.server");
    return row
      ? {
          id: row.org_id,
          name: row.org_name,
          type: row.org_type,
          emergencyPhone: readContact(
            row.emergency_phone_enc,
            row.emergency_phone,
            CONTACT_ORG_PHONE,
          ),
          // Branch name only matters when the school has more than one campus.
          branchName: row.branch_count > 1 ? row.branch_name : null,
          classes: row.classes ?? [],
          transport: row.transport === true,
        }
      : null;
  });

const guardianSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  relationship: z.string().trim().min(1, "Relationship is required").max(60),
  email: z.string().trim().email("Enter a valid email").max(255),
  photo: photoDataUrl,
  receive_general_notifications: z.boolean(),
});

const childSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  identifier_code: z.string().trim().max(60).optional().default(""),
  photo: photoDataUrl,
});

const registrationSchema = z.object({
  token: tokenSchema,
  website: z.string().max(0).optional(), // honeypot
  siteUrl: z.string().url(), // Client's origin for email links
  // Two or three children can go in one form when the same guardians collect
  // them and they ride the same bus.
  members: z.array(childSchema).min(1).max(MAX_CHILDREN_PER_REGISTRATION),
  uses_bus: z.boolean().optional().default(false),
  parent: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().max(30).optional().default(""),
  }),
  guardians: z.array(guardianSchema).min(1).max(MAX_GUARDIANS),
});

export type RegistrationInput = z.input<typeof registrationSchema>;

/**
 * Public submission from the shared registration link. Anonymous parents can't
 * write to the database or storage directly, so after validating the link
 * token this uses the privileged client to store the wards, guardians and
 * photos. Every child in one submission shares a family link, which is what the
 * parent app uses to show them all under one sign-in.
 */
export const submitRegistration = createServerFn({ method: "POST" })
  .validator((input: unknown) => registrationSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      encryptContact,
      emailIndex,
      readContact,
      CONTACT_MEMBER_EMAIL,
      CONTACT_MEMBER_PHONE,
      CONTACT_GUARDIAN_EMAIL,
      CONTACT_ORG_PHONE,
      decryptGuardianRow,
    } = await import("@/lib/contact-crypto.server");

    const { data: rows } = await supabaseAdmin.rpc("get_registration_branch", {
      _token: data.token,
    });
    const link = rows?.[0];
    const org = link
      ? {
          id: link.org_id,
          name: link.org_name,
          type: link.org_type,
          emergency_phone: readContact(
            link.emergency_phone_enc,
            link.emergency_phone,
            CONTACT_ORG_PHONE,
          ),
          classes: link.classes,
          transport: link.transport === true,
          branchId: link.branch_id,
        }
      : null;
    if (!org)
      throw new Error(
        "This registration link is no longer active. Please ask the school for the current link.",
      );
    const classes = org.classes ?? [];
    for (const child of data.members) {
      if (classes.length && !child.identifier_code)
        throw new Error("Please choose each child's class.");
      if (!isAllowedClass(classes, child.identifier_code))
        throw new Error("Please choose each child's class from the list.");
    }
    const chosenClass = (code: string) =>
      classes.find((c) => c.toLowerCase() === code.toLowerCase()) ?? code;

    const parentEmail = data.parent.email.toLowerCase();
    const parentHash = emailIndex(parentEmail);
    const emailEnc = encryptContact(parentEmail, CONTACT_MEMBER_EMAIL);
    const phoneEnc = encryptContact(data.parent.phone, CONTACT_MEMBER_PHONE);

    // One address belongs to one person. The same guardian looking after
    // siblings passes, but an address already used by a different guardian is
    // refused so no family receives another family's updates.
    const guardianClashes = await (await import("./email-rules.server")).findEmailClashes(
      data.guardians.map((g) => ({ email: g.email, name: g.name })),
    );
    if (guardianClashes.length)
      throw new Error(
        `${guardianClashes[0]} is already registered with GoGuard by someone else. Please use a different email address, or ask the school office for help.`,
      );

    // A family registering another child keeps the link they already use, so
    // the parent app never splits siblings across two invitations.
    // Matched on the blind index, so the address itself is never compared in
    // the database. Rows from before the backfill have no index yet, so the
    // legacy column is tried second until step 2 empties it.
    let existingFamily: { parent_link_token: string | null } | null = null;
    if (parentHash) {
      const { data } = await supabaseAdmin
        .from("members")
        .select("parent_link_token")
        .eq("org_id", org.id)
        .eq("parent_email_hash", parentHash)
        .not("parent_link_token", "is", null)
        .limit(1)
        .maybeSingle();
      existingFamily = data;
    }
    if (!existingFamily) {
      const { data } = await supabaseAdmin
        .from("members")
        .select("parent_link_token")
        .eq("org_id", org.id)
        .ilike("primary_email", parentEmail)
        .not("parent_link_token", "is", null)
        .limit(1)
        .maybeSingle();
      existingFamily = data;
    }
    const parentLinkToken = existingFamily?.parent_link_token ?? crypto.randomUUID();

    const createdIds: string[] = [];

    try {
      const { uploadPhoto } = await import("./photo-storage.server");
      const upload = (path: string, dataUrl: string) => uploadPhoto(supabaseAdmin, path, dataUrl);

      const members: {
        id: string;
        full_name: string;
        uses_bus: boolean;
        bus_track_token: string | null;
      }[] = [];

      for (const child of data.members) {
        const { data: member, error: memberErr } = await supabaseAdmin
          .from("members")
          .insert({
            org_id: org.id,
            branch_id: org.branchId,
            full_name: child.full_name,
            identifier_code: chosenClass(child.identifier_code) || null,
            parent_or_owner_name: data.parent.name,
            // Plaintext columns are written empty on purpose: the encrypted
            // value and its blind index are the only copies.
            primary_email: null,
            primary_email_enc: emailEnc,
            parent_email_hash: parentHash,
            primary_phone: null,
            primary_phone_enc: phoneEnc,
            uses_bus: org.transport && data.uses_bus,
            parent_link_token: parentLinkToken,
          })
          .select("id, full_name, uses_bus, bus_track_token")
          .single();
        if (memberErr || !member)
          throw new Error("We couldn't save your registration. Please try again.");
        createdIds.push(member.id);
        members.push(member);

        const path = await upload(`${org.id}/${member.id}/member.jpg`, child.photo);
        await supabaseAdmin.from("members").update({ photo_path: path }).eq("id", member.id);
      }

      // The guardians are the same people for every child in this form, so each
      // face is uploaded once and reused on each child's guardian record.
      const guardianPhotos: string[] = [];
      for (const [i, g] of data.guardians.entries()) {
        guardianPhotos.push(
          await upload(`${org.id}/${createdIds[0]}/guardian-${i}.jpg`, g.photo),
        );
      }

      const passesByMember: {
        id: string;
        name: string;
        relationship: string;
        email: string;
        hash: string;
      }[][] = [];

      for (const member of members) {
        const passes: {
          id: string;
          name: string;
          relationship: string;
          email: string;
          hash: string;
        }[] = [];
        for (const [i, g] of data.guardians.entries()) {
          const { data: row, error } = await supabaseAdmin
            .from("guardians")
            .insert({
              member_id: member.id,
              org_id: org.id,
              name: g.name,
              relationship: g.relationship,
              email: null,
              email_enc: encryptContact(g.email.toLowerCase(), CONTACT_GUARDIAN_EMAIL),
              email_hash: emailIndex(g.email),
              receive_general_notifications: g.receive_general_notifications,
            })
            .select("id, name, relationship, email, email_enc, unique_qr_hash")
            .single();
          if (error || !row)
            throw new Error("We couldn't save one of the guardians. Please try again.");
          await supabaseAdmin
            .from("guardians")
            .update({ photo_path: guardianPhotos[i] ?? null })
            .eq("id", row.id);
          // Saving the photo re-issues the guardian's pass code, so read the
          // code back after the upload: the one from the insert is stale and
          // would show a barcode the gate scanner rejects.
          const { data: fresh } = await supabaseAdmin
            .from("guardians")
            .select("unique_qr_hash")
            .eq("id", row.id)
            .single();
          passes.push({
            id: row.id,
            name: row.name,
            relationship: row.relationship,
            email: decryptGuardianRow(row).email ?? g.email,
            hash: fresh?.unique_qr_hash ?? row.unique_qr_hash,
          });
        }
        passesByMember.push(passes);
      }

      // One parent app link for the whole family.
      const pwaUrl = (
        await createParentPwaToken({
          data: {
            memberId: members[0]!.id,
            orgId: org.id,
            parentLinkToken,
            siteUrl: data.siteUrl,
          },
        })
      ).pwaUrl;

      // Every guardian gets their own barcode by email, for every child. A mail
      // failure never undoes a registration.
      let passesEmailed = 0;
      for (const member of members) {
        const mailed = await (
          await import("./pass-email.server")
        ).sendPassEmailsForMember({
          memberId: member.id,
          siteUrl: data.siteUrl,
          parentAppUrl: pwaUrl,
        });
        passesEmailed += mailed.sent;
        if (mailed.failed || mailed.error)
          console.error("[registration] pass emails:", mailed.failed, mailed.error);
      }

      return {
        orgName: org.name,
        orgType: org.type,
        emergencyPhone: org.emergency_phone,
        members: members.map((member, idx) => ({
          id: member.id,
          name: member.full_name,
          passes: passesByMember[idx] ?? [],
        })),
        pwaToken: pwaUrl,
        passesEmailed,
        busTrackToken: members[0]?.uses_bus ? members[0]?.bus_track_token ?? null : null,
      };
    } catch (e) {
      if (createdIds.length) {
        await supabaseAdmin.from("guardians").delete().in("member_id", createdIds);
        await supabaseAdmin.from("members").delete().in("id", createdIds);
      }
      throw e instanceof Error ? e : new Error("Registration didn't go through. Please try again.");
    }
  });

/** Public digital pass lookup. Possession of the 64-char pass code is the credential. */
export const getPass = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readContact, CONTACT_ORG_PHONE } = await import("@/lib/contact-crypto.server");
    const { data: g } = await supabaseAdmin
      .from("guardians")
      .select(
        "name, relationship, photo_path, unique_qr_hash, member:members(full_name, identifier_code), org:organizations(name, type, emergency_phone, emergency_phone_enc)",
      )
      .eq("unique_qr_hash", data.hash)
      .maybeSingle();
    if (!g) return null;
    let photoUrl: string | null = null;
    if (g.photo_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("photos")
        .createSignedUrl(g.photo_path, 60 * 60);
      photoUrl = signed?.signedUrl ?? null;
    }
    return {
      name: g.name,
      relationship: g.relationship,
      hash: g.unique_qr_hash,
      photoUrl,
      memberName: g.member?.full_name ?? "",
      identifier: g.member?.identifier_code ?? "",
      orgName: g.org?.name ?? "",
      orgType: g.org?.type ?? "school",
      emergencyPhone: readContact(
        g.org?.emergency_phone_enc,
        g.org?.emergency_phone,
        CONTACT_ORG_PHONE,
      ),
    };
  });
