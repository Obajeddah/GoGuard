import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const photoDataUrl = z
  .string()
  .max(2_000_000, "Photo is too large")
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Invalid photo");

/**
 * Uploads a face photo for a student or guardian the signed-in staff member can
 * already see, then saves the path. The upload itself runs server-side so photo
 * storage works even before the bucket exists and regardless of storage rules.
 */
export const uploadProfilePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        kind: z.enum(["member", "guardian"]),
        id: z.string().uuid(),
        photo: photoDataUrl,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let path: string;

    if (data.kind === "member") {
      const { data: member } = await supabase
        .from("members")
        .select("id, org_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!member) throw new Error("That student isn't in your school.");
      path = `${member.org_id}/${member.id}/member.jpg`;
    } else {
      const { data: guardian } = await supabase
        .from("guardians")
        .select("id, org_id, member_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!guardian) throw new Error("That guardian isn't in your school.");
      path = `${guardian.org_id}/${guardian.member_id}/${guardian.id}.jpg`;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadPhoto } = await import("@/lib/photo-storage.server");
    await uploadPhoto(supabaseAdmin, path, data.photo);

    const { error } =
      data.kind === "member"
        ? await supabaseAdmin.from("members").update({ photo_path: path }).eq("id", data.id)
        : await supabaseAdmin.from("guardians").update({ photo_path: path }).eq("id", data.id);
    if (error) {
      console.error("[photos] could not save photo path:", error.message);
      throw new Error("The photo was uploaded but couldn't be saved. Please try again.");
    }
    return { path };
  });
