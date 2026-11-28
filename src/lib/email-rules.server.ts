/**
 * One email address belongs to one person in GoGuard.
 *
 * Reusing an address for a different guardian splits a child's alerts between
 * two people and can send private updates to the wrong parent, so every place
 * that saves a guardian checks here first. The same person (same name) may of
 * course look after siblings, so a repeated address with the same name is fine.
 */
export type EmailPerson = { email: string; name: string };

const lower = (value: string) => value.trim().toLowerCase();
const person = (value: string) => lower(value).replace(/\s+/g, " ");

/** Returns the addresses that cannot be used, lower-cased. */
export async function findEmailClashes(entries: EmailPerson[]): Promise<string[]> {
  const clashes = new Set<string>();
  const namesByEmail = new Map<string, Set<string>>();

  for (const entry of entries) {
    const email = lower(entry.email);
    if (!email || !email.includes("@")) continue;
    const names = namesByEmail.get(email) ?? new Set<string>();
    names.add(person(entry.name));
    namesByEmail.set(email, names);
  }

  // The same address twice in one form means two different people.
  for (const [email, names] of namesByEmail) if (names.size > 1) clashes.add(email);

  const emails = Array.from(namesByEmail.keys());
  if (!emails.length) return Array.from(clashes);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { emailIndex } = await import("@/lib/contact-crypto.server");
  // Guardian addresses are encrypted, so the comparison uses the blind index.
  // A new row gets one when it is saved, which is how this check sees it.
  const hashes = emails.map((email) => emailIndex(email)).filter((h): h is string => !!h);
  const [{ data: guardians }, { data: legacy }, { data: staff }] = await Promise.all([
    hashes.length
      ? supabaseAdmin.from("guardians").select("email_hash, name").in("email_hash", hashes)
      : Promise.resolve({ data: [] as { email_hash: string | null; name: string }[] }),
    // Rows the backfill has not reached yet still hold a plain address. This is
    // how the check keeps working during the rollout; step 2 empties the column
    // and this query simply finds nothing.
    supabaseAdmin.from("guardians").select("email, name").in("email", emails),
    supabaseAdmin.from("profiles").select("email, full_name").in("email", emails),
  ]);

  const emailByHash = new Map(
    emails.map((email) => [emailIndex(email) ?? "", email] as const).filter(([h]) => h),
  );
  for (const row of guardians ?? []) {
    const email = emailByHash.get(row.email_hash ?? "") ?? "";
    const names = namesByEmail.get(email);
    if (!names) continue;
    // Matching name means the same person registering another child.
    if (!names.has(person(row.name ?? ""))) clashes.add(email);
  }
  for (const row of legacy ?? []) {
    const email = lower(row.email ?? "");
    const names = namesByEmail.get(email);
    if (!names) continue;
    if (!names.has(person(row.name ?? ""))) clashes.add(email);
  }

  // Staff accounts are never shared with a guardian.
  for (const row of staff ?? []) {
    const email = lower(row.email ?? "");
    if (email) clashes.add(email);
  }

  return Array.from(clashes);
}
