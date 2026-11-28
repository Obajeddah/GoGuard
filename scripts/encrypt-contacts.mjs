#!/usr/bin/env node
// Encrypt the contact details that are already stored.
//
// Usage (after contact-encryption-1-add.sql has been applied):
//
//   CONTACT_ENCRYPTION_KEY=... \
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/encrypt-contacts.mjs
//
// Add --verify to read a sample back and decrypt it.
//
// The same key the app uses must be passed. The script never prints an address
// or a number; it only prints how many rows it handled. Running it again is
// safe: rows that already have a ciphertext are skipped.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PREFIX = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ENV = "CONTACT_ENCRYPTION_KEY";
const PAGE = 200;

const CONTEXTS = {
  memberEmail: "member.email",
  memberPhone: "member.phone",
  guardianEmail: "guardian.email",
  orgPhone: "org.emergency_phone",
};

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file: the variables may already be in the environment.
}

function key() {
  const raw = (process.env[KEY_ENV] ?? "").trim();
  if (!raw) {
    console.error(
      `Missing ${KEY_ENV}. Use the same value as the deployed app (openssl rand -base64 32).`,
    );
    process.exit(1);
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    console.error(`${KEY_ENV} must be 32 bytes (base64 or 64 hex characters).`);
    process.exit(1);
  }
  return buf;
}

const MASTER = key();
const INDEX_KEY = Buffer.from(
  hkdfSync("sha256", MASTER, Buffer.from("goguard.contact.v1"), Buffer.from("blind-index"), 32),
);

const b64 = (buf) => buf.toString("base64url");
const aad = (context) => Buffer.from(`goguard:${context}`, "utf8");

function encrypt(value, context) {
  const plain = typeof value === "string" ? value.trim() : "";
  if (!plain) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", MASTER, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

function decrypt(value, context) {
  if (!value) return null;
  if (!value.startsWith(`${PREFIX}.`)) return value;
  const [, iv, tag, data] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", MASTER, Buffer.from(iv, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

const normaliseEmail = (value) => {
  const email = (value ?? "").trim().toLowerCase();
  return email || null;
};
const index = (value) => {
  const email = normaliseEmail(value);
  return email ? createHmac("sha256", INDEX_KEY).update(email, "utf8").digest("hex") : null;
};

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const counts = { members: 0, guardians: 0, organisations: 0, deliveries: 0, skipped: 0 };
let failures = 0;

function fail(table, message) {
  failures++;
  console.error(`${table}: ${message}`);
}

async function migrateMembers() {
  for (;;) {
    const { data, error } = await db
      .from("members")
      .select("id, primary_email, primary_phone, primary_email_enc, primary_phone_enc, parent_email_hash")
      .is("primary_email_enc", null)
      .order("id")
      .limit(PAGE);
    if (error) return fail("members", error.message);
    if (!data?.length) break;

    for (const row of data) {
      if (!row.primary_email && !row.primary_phone) {
        counts.skipped++;
        // Nothing to encrypt: an empty marker keeps the query from fetching it
        // again. It reads as "no contact on file".
        const { error: skipErr } = await db
          .from("members")
          .update({ primary_email_enc: "" })
          .eq("id", row.id);
        if (skipErr) fail("members", skipErr.message);
        continue;
      }
      const patch = {
        primary_email_enc: encrypt(row.primary_email, CONTEXTS.memberEmail),
        primary_phone_enc: encrypt(row.primary_phone, CONTEXTS.memberPhone),
        parent_email_hash: row.parent_email_hash ?? index(row.primary_email),
      };
      if (!patch.primary_email_enc && row.primary_email) {
        fail("members", "could not encrypt an address");
        continue;
      }
      const { error: writeErr } = await db.from("members").update(patch).eq("id", row.id);
      if (writeErr) fail("members", writeErr.message);
      else counts.members++;
    }
  }

  // Rows that already have ciphertext but no index (an interrupted earlier run).
  for (;;) {
    const { data, error } = await db
      .from("members")
      .select("id, primary_email, primary_email_enc, parent_email_hash")
      .not("primary_email_enc", "is", null)
      .neq("primary_email_enc", "")
      .is("parent_email_hash", null)
      .order("id")
      .limit(PAGE);
    if (error) return fail("members", error.message);
    if (!data?.length) break;
    for (const row of data) {
      let email = null;
      try {
        email = decrypt(row.primary_email_enc, CONTEXTS.memberEmail);
      } catch {
        fail("members", "could not read a stored value (wrong key?)");
        continue;
      }
      const hash = index(email);
      if (!hash) continue;
      const { error: hashErr } = await db
        .from("members")
        .update({ parent_email_hash: hash })
        .eq("id", row.id);
      if (hashErr) fail("members", hashErr.message);
    }
  }
}

async function migrateGuardians() {
  for (;;) {
    const { data, error } = await db
      .from("guardians")
      .select("id, email, phone, email_enc, email_hash")
      .is("email_enc", null)
      .order("id")
      .limit(PAGE);
    if (error) return fail("guardians", error.message);
    if (!data?.length) break;

    for (const row of data) {
      if (!row.email) {
        counts.skipped++;
        const { error: skipErr } = await db
          .from("guardians")
          .update({ email_enc: "" })
          .eq("id", row.id);
        if (skipErr) fail("guardians", skipErr.message);
        continue;
      }
      const encrypted = encrypt(row.email, CONTEXTS.guardianEmail);
      if (!encrypted) {
        fail("guardians", "could not encrypt an address");
        continue;
      }
      const { error: writeErr } = await db
        .from("guardians")
        .update({ email_enc: encrypted, email_hash: index(row.email) })
        .eq("id", row.id);
      if (writeErr) fail("guardians", writeErr.message);
      else counts.guardians++;
    }
  }
}

async function migrateOrganisations() {
  for (;;) {
    const { data, error } = await db
      .from("organizations")
      .select("id, emergency_phone, emergency_phone_enc")
      .is("emergency_phone_enc", null)
      .order("id")
      .limit(PAGE);
    if (error) return fail("organizations", error.message);
    if (!data?.length) break;

    for (const row of data) {
      if (!row.emergency_phone) {
        counts.skipped++;
        // Store a marker so this row is not fetched again.
        const { error: skipErr } = await db
          .from("organizations")
          .update({ emergency_phone_enc: "" })
          .eq("id", row.id);
        if (skipErr) fail("organizations", skipErr.message);
        continue;
      }
      const encrypted = encrypt(row.emergency_phone, CONTEXTS.orgPhone);
      const { error: writeErr } = await db
        .from("organizations")
        .update({ emergency_phone_enc: encrypted })
        .eq("id", row.id);
      if (writeErr) fail("organizations", writeErr.message);
      else counts.organisations++;
    }
  }
}

// The delivery log exists to stop a parent getting the same notice twice.
// It only needs to compare addresses, so it keeps the blind index, never the
// address itself.
async function migrateDeliveries() {
  for (;;) {
    const { data, error } = await db
      .from("email_deliveries")
      .select("source_table, source_id, email")
      .like("email", "%@%")
      .limit(PAGE);
    if (error) return fail("email_deliveries", error.message);
    if (!data?.length) break;

    for (const row of data) {
      const hashed = index(row.email);
      if (!hashed) continue;
      const { error: writeErr } = await db
        .from("email_deliveries")
        .update({ email: hashed })
        .eq("source_table", row.source_table)
        .eq("source_id", row.source_id)
        .eq("email", row.email);
      if (writeErr) fail("email_deliveries", writeErr.message);
      else counts.deliveries++;
    }
  }
}

async function verify() {
  const problems = [];
  const { data: member } = await db
    .from("members")
    .select("primary_email_enc, primary_phone_enc")
    .not("primary_email_enc", "is", null)
    .limit(1)
    .maybeSingle();
  if (member?.primary_email_enc) {
    try {
      if (!decrypt(member.primary_email_enc, CONTEXTS.memberEmail)) {
        problems.push("a stored member email decrypted to nothing");
      }
    } catch {
      problems.push("a stored member email could not be decrypted with this key");
    }
  }

  const { data: guardian } = await db
    .from("guardians")
    .select("email_enc")
    .not("email_enc", "is", null)
    .limit(1)
    .maybeSingle();
  if (guardian?.email_enc) {
    try {
      if (!decrypt(guardian.email_enc, CONTEXTS.guardianEmail)) {
        problems.push("a stored guardian email decrypted to nothing");
      }
    } catch {
      problems.push("a stored guardian email could not be decrypted with this key");
    }
  }

  const { count: leftMembers } = await db
    .from("members")
    .select("id", { count: "exact", head: true })
    .not("primary_email", "is", null);
  const { count: leftGuardians } = await db
    .from("guardians")
    .select("id", { count: "exact", head: true })
    .not("email", "is", null);
  const { count: leftOrgs } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .not("emergency_phone", "is", null);

  console.log(
    `Verify: ${leftMembers ?? 0} member addresses, ${leftGuardians ?? 0} guardian addresses and ${leftOrgs ?? 0} school numbers still in plaintext (step 2 empties them).`,
  );
  if (problems.length) {
    for (const problem of problems) console.error(`Verify: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("Verify: stored ciphertext decrypts with this key.");
  }
}

console.log("Encrypting stored contact details. No address or number is printed.");
await migrateMembers();
await migrateGuardians();
await migrateOrganisations();
await migrateDeliveries();

console.log(
  `Encrypted ${counts.members} member rows, ${counts.guardians} guardian rows, ${counts.organisations} school numbers, ${counts.deliveries} delivery records. Skipped ${counts.skipped} rows with nothing to encrypt.`,
);

if (process.argv.includes("--verify")) await verify();

if (failures) {
  console.error(`${failures} row(s) could not be encrypted. Fix the error above and run again.`);
  process.exitCode = 1;
} else {
  console.log(
    "Next: run contact-encryption-2-finalize.sql in the Supabase SQL editor, then check that a parent email still arrives.",
  );
}
