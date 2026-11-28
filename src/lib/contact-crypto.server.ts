// Server-only: how parent, guardian and school contact details are kept.
//
// Addresses and phone numbers are encrypted with AES-256-GCM before they reach
// the database, so the stored value is useless without the key that lives only
// in the server environment. Each value is bound to its field (the AAD), so a
// guardian email cannot be swapped into a phone column and still decrypt.
//
// Looking a family up by email (registration, sibling passes) needs a stable
// value to compare, which a random-IV ciphertext cannot give. Each address
// therefore also gets a blind index: HMAC-SHA256 with a key derived from the
// same secret. The index is one-way: it finds a row, but it does not reveal the
// address.
//
// Format: v1.<iv>.<tag>.<ciphertext>, all base64url.
// Plain values that predate encryption (or a not-yet-migrated row) are read
// as-is, so the app keeps working while the backfill runs.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const CONTACT_MEMBER_EMAIL = "member.email";
export const CONTACT_MEMBER_PHONE = "member.phone";
export const CONTACT_GUARDIAN_EMAIL = "guardian.email";
export const CONTACT_ORG_PHONE = "org.emergency_phone";

export type ContactContext =
  | typeof CONTACT_MEMBER_EMAIL
  | typeof CONTACT_MEMBER_PHONE
  | typeof CONTACT_GUARDIAN_EMAIL
  | typeof CONTACT_ORG_PHONE;

const PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ENV = "CONTACT_ENCRYPTION_KEY";
const PREVIOUS_KEY_ENV = "CONTACT_ENCRYPTION_KEY_PREVIOUS";

const b64 = (buf: Buffer) => buf.toString("base64url");

/**
 * The key is either 32 raw bytes in base64 or 64 hex characters. Anything else
 * is a configuration mistake, and using it would silently store values we
 * cannot read back, so it fails loudly instead.
 */
function parseKey(name: string, raw: string): Buffer {
  const value = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `${name} must be 32 bytes: keep the base64 value from \`openssl rand -base64 32\` (or 64 hex characters).`,
    );
  }
  return buf;
}

function currentKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw?.trim()) {
    throw new Error(
      `Missing ${KEY_ENV}. Contact details cannot be read or saved until the server has its encryption key.`,
    );
  }
  return parseKey(KEY_ENV, raw);
}

/** Previous key, accepted for reading during a key rotation. */
function previousKeys(): Buffer[] {
  const raw = process.env[PREVIOUS_KEY_ENV];
  if (!raw?.trim()) return [];
  return [parseKey(PREVIOUS_KEY_ENV, raw)];
}

function blindKey(): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      currentKey(),
      Buffer.from("goguard.contact.v1"),
      Buffer.from("blind-index"),
      32,
    ),
  );
}

const aad = (context: ContactContext) => Buffer.from(`goguard:${context}`, "utf8");

/** Encrypts one value. Empty or missing values stay null; nothing is invented. */
export function encryptContact(
  value: string | null | undefined,
  context: ContactContext,
): string | null {
  const plain = typeof value === "string" ? value.trim() : "";
  if (!plain) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join(".");
}

/**
 * Decrypts one stored value. Values without the version prefix are returned
 * unchanged: they are from before encryption and the backfill will replace
 * them. A value that looks encrypted but fails authentication throws, because
 * that means the key is wrong or the record was altered.
 */
export function decryptContact(
  value: string | null | undefined,
  context: ContactContext,
): string | null {
  if (!value) return null;
  if (!value.startsWith(`${PREFIX}.`)) return value;

  const parts = value.split(".");
  if (parts.length !== 4) throw new Error("Stored contact value is malformed");
  const [, ivPart, tagPart, dataPart] = parts;

  let lastError: unknown = null;
  for (const key of [currentKey(), ...previousKeys()]) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart!, "base64url"), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(context));
      decipher.setAuthTag(Buffer.from(tagPart!, "base64url"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(dataPart!, "base64url")),
        decipher.final(),
      ]);
      return plain.toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Stored contact value could not be decrypted", { cause: lastError });
}

/**
 * Reads an encrypted column, falling back to the legacy plaintext column while
 * the backfill is in progress. A record that cannot be decrypted is treated as
 * missing rather than taking down the whole notification run, and the error is
 * logged without the value.
 */
export function readContact(
  encrypted: string | null | undefined,
  legacy: string | null | undefined,
  context: ContactContext,
): string | null {
  try {
    const value = decryptContact(encrypted, context);
    if (value) return value;
  } catch {
    console.error("[contact] could not decrypt one stored value");
  }
  try {
    return decryptContact(legacy, context);
  } catch {
    console.error("[contact] could not read one legacy value");
    return null;
  }
}

/** Lower-cased, trimmed address. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return email || null;
}

/** Digits with an optional leading +, so formatting never splits one number. */
export function normalizePhone(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return digits ? `${plus ? "+" : ""}${digits}` : null;
}

/**
 * Blind index for an email address: hex HMAC-SHA256, safe to store and index
 * but not reversible. Case and surrounding spaces never matter.
 */
export function emailIndex(value: string | null | undefined): string | null {
  const email = normalizeEmail(value);
  if (!email) return null;
  return createHmac("sha256", blindKey()).update(email, "utf8").digest("hex");
}

/** True when a value is already ciphertext (used by the backfill script). */
export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}.`);
}

/* -------------------------------------------------------------------------- */
/* Row helpers                                                                */
/* -------------------------------------------------------------------------- */

type MemberContactFields = {
  primary_email?: string | null;
  primary_email_enc?: string | null;
  primary_phone?: string | null;
  primary_phone_enc?: string | null;
};

type GuardianContactFields = {
  email?: string | null;
  email_enc?: string | null;
};

type OrgContactFields = {
  emergency_phone?: string | null;
  emergency_phone_enc?: string | null;
};

/** Replaces `primary_email` / `primary_phone` with their decrypted values. */
export function decryptMemberRow<T extends MemberContactFields>(row: T): T {
  return {
    ...row,
    primary_email: readContact(row.primary_email_enc, row.primary_email, CONTACT_MEMBER_EMAIL),
    primary_phone: readContact(row.primary_phone_enc, row.primary_phone, CONTACT_MEMBER_PHONE),
  } as T;
}

/** Replaces `email` with its decrypted value. */
export function decryptGuardianRow<T extends GuardianContactFields>(row: T): T {
  return {
    ...row,
    email: readContact(row.email_enc, row.email, CONTACT_GUARDIAN_EMAIL),
  } as T;
}

/** Replaces `emergency_phone` with its decrypted value. */
export function decryptOrgRow<T extends OrgContactFields>(row: T): T {
  return {
    ...row,
    emergency_phone: readContact(row.emergency_phone_enc, row.emergency_phone, CONTACT_ORG_PHONE),
  } as T;
}
