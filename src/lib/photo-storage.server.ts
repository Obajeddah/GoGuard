import type { supabaseAdmin as SupabaseAdminClient } from "@/integrations/supabase/client.server";

type AdminClient = typeof SupabaseAdminClient;

const BUCKET = "photos";

/** Bytes + mime type out of a browser `data:` URL. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [meta, b64] = dataUrl.split(",");
  const contentType = /data:(.*?);base64/.exec(meta ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

/**
 * The photos bucket is private and normally created in the dashboard. Creating
 * it on first use means a fresh project (or a deleted bucket) never loses a
 * registration to a "Bucket not found" error.
 */
async function ensureBucket(supabaseAdmin: AdminClient): Promise<void> {
  const { error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!error) return;
  const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    console.error("[photos] could not create bucket:", createErr.message);
  }
}

/**
 * Stores a photo in the private `photos` bucket and returns its path.
 * Runs with the service role so a parent registering from a public link, or a
 * staff member without MFA, is not blocked by storage policies.
 */
export async function uploadPhoto(
  supabaseAdmin: AdminClient,
  path: string,
  dataUrl: string,
): Promise<string> {
  const { bytes, contentType } = decodeDataUrl(dataUrl);
  const put = () =>
    supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });

  let { error } = await put();
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucket(supabaseAdmin);
    ({ error } = await put());
  }
  if (error) {
    console.error("[photos] upload failed", path, error.message);
    throw new Error(
      `A photo couldn't be uploaded (${error.message}). Please try a smaller or different picture.`,
    );
  }
  return path;
}
