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
    return row
      ? {
          id: row.org_id,
          name: row.org_name,
          type: row.org_type,
          emergencyPhone: row.emergency_phone,
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

const registrationSchema = z.object({
  token: tokenSchema,
  website: z.string().max(0).optional(), // honeypot
  siteUrl: z.string().url(), // Client's origin for email links
  member: z.object({
    full_name: z.string().trim().min(1).max(120),
    identifier_code: z.string().trim().max(60).optional().default(""),
    photo: photoDataUrl.optional(),
    uses_bus: z.boolean().optional().default(false),
  }),
  parent: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().max(30).optional().default(""),
  }),
  guardians: z.array(guardianSchema).min(1).max(MAX_GUARDIANS),
});

export type RegistrationInput = z.input<typeof registrationSchema>;

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [meta, b64] = dataUrl.split(",");
  const contentType = /data:(.*?);base64/.exec(meta ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

/**
 * Public submission from the shared registration link. Anonymous parents can't
 * write to the database or storage directly, so after validating the link
 * token this uses the privileged client to store the ward, guardians and photos.
 */
export const submitRegistration = createServerFn({ method: "POST" })
  .validator((input: unknown) => registrationSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin.rpc("get_registration_branch", {
      _token: data.token,
    });
    const link = rows?.[0];
    const org = link
      ? {
          id: link.org_id,
          name: link.org_name,
          type: link.org_type,
          emergency_phone: link.emergency_phone,
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
    if (classes.length && !data.member.identifier_code)
      throw new Error("Please choose your child's class.");
    if (!isAllowedClass(classes, data.member.identifier_code))
      throw new Error("Please choose your child's class from the list.");
    const chosenClass =
      classes.find((c) => c.toLowerCase() === data.member.identifier_code.toLowerCase()) ??
      data.member.identifier_code;

    const { data: member, error: memberErr } = await supabaseAdmin
      .from("members")
      .insert({
        org_id: org.id,
        branch_id: org.branchId,
        full_name: data.member.full_name,
        identifier_code: chosenClass || null,
        parent_or_owner_name: data.parent.name,
        primary_email: data.parent.email.toLowerCase(),
        primary_phone: data.parent.phone || null,
        uses_bus: org.transport && data.member.uses_bus,
      })
      .select("id, uses_bus, bus_track_token, parent_link_token")
      .single();
    if (memberErr || !member)
      throw new Error("We couldn't save your registration. Please try again.");

    try {
      const upload = async (path: string, dataUrl: string) => {
        const { bytes, contentType } = decodeDataUrl(dataUrl);
        const { error } = await supabaseAdmin.storage
          .from("photos")
          .upload(path, bytes, { contentType, upsert: true });
        if (error) throw new Error("A photo couldn't be uploaded. Please try a different picture.");
        return path;
      };

      if (data.member.photo) {
        const path = await upload(`${org.id}/${member.id}/member.jpg`, data.member.photo);
        await supabaseAdmin.from("members").update({ photo_path: path }).eq("id", member.id);
      }

      const passes: {
        id: string;
        name: string;
        relationship: string;
        email: string;
        hash: string;
      }[] = [];
      for (const g of data.guardians) {
        const { data: row, error } = await supabaseAdmin
          .from("guardians")
          .insert({
            member_id: member.id,
            org_id: org.id,
            name: g.name,
            relationship: g.relationship,
            email: g.email.toLowerCase(),
            receive_general_notifications: g.receive_general_notifications,
          })
          .select("id, name, relationship, email, unique_qr_hash")
          .single();
        if (error || !row)
          throw new Error("We couldn't save one of the guardians. Please try again.");
        const path = await upload(`${org.id}/${member.id}/${row.id}.jpg`, g.photo);
        await supabaseAdmin.from("guardians").update({ photo_path: path }).eq("id", row.id);
        passes.push({
          id: row.id,
          name: row.name,
          relationship: row.relationship,
          email: row.email,
          hash: row.unique_qr_hash,
        });
      }

      return {
        orgName: org.name,
        orgType: org.type,
        emergencyPhone: org.emergency_phone,
        memberName: data.member.full_name,
        busTrackToken: member.uses_bus ? member.bus_track_token : null,
        passes,
        // Create PWA token for parent app access
        pwaToken: (
          await createParentPwaToken({
            data: {
              memberId: member.id,
              orgId: org.id,
              parentLinkToken: member.parent_link_token!,
              siteUrl: data.siteUrl,
            },
          })
        ).pwaUrl,
      };
    } catch (e) {
      await supabaseAdmin.from("members").delete().eq("id", member.id);
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
    const { data: g } = await supabaseAdmin
      .from("guardians")
      .select(
        "name, relationship, photo_path, unique_qr_hash, member:members(full_name, identifier_code), org:organizations(name, type, emergency_phone)",
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
      emergencyPhone: g.org?.emergency_phone ?? null,
    };
  });
