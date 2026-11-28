import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTACT_GUARDIAN_EMAIL,
  CONTACT_MEMBER_EMAIL,
  CONTACT_MEMBER_PHONE,
  CONTACT_ORG_PHONE,
  decryptContact,
  decryptGuardianRow,
  decryptMemberRow,
  decryptOrgRow,
  emailIndex,
  encryptContact,
  isEncryptedValue,
  normalizeEmail,
  normalizePhone,
  readContact,
} from "@/lib/contact-crypto.server";

const KEY = "CONTACT_ENCRYPTION_KEY" as const;
const PREVIOUS = "CONTACT_ENCRYPTION_KEY_PREVIOUS" as const;
const ENV_KEYS = [KEY, PREVIOUS] as const;
const env = process.env as Record<string, string | undefined>;

describe("contact encryption", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = env[key];
    env[KEY] = randomBytes(32).toString("base64");
    delete env[PREVIOUS];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete env[key];
      else env[key] = saved[key];
    }
  });

  it("round-trips an email and a phone number", () => {
    const email = encryptContact("Parent@Example.com", CONTACT_MEMBER_EMAIL);
    const phone = encryptContact("+234 801 234 5678", CONTACT_MEMBER_PHONE);

    expect(email).toMatch(/^v1\./);
    expect(phone).toMatch(/^v1\./);
    expect(email).not.toContain("Parent");
    expect(phone).not.toContain("234");
    expect(decryptContact(email, CONTACT_MEMBER_EMAIL)).toBe("Parent@Example.com");
    expect(decryptContact(phone, CONTACT_MEMBER_PHONE)).toBe("+234 801 234 5678");
  });

  it("uses a fresh IV so the same address encrypts differently each time", () => {
    const a = encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL);
    const b = encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL);
    expect(a).not.toBe(b);
    expect(decryptContact(a, CONTACT_MEMBER_EMAIL)).toBe(decryptContact(b, CONTACT_MEMBER_EMAIL));
  });

  it("refuses a value moved to another field", () => {
    const email = encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)!;
    expect(() => decryptContact(email, CONTACT_MEMBER_PHONE)).toThrow(/could not be decrypted/);
  });

  it("refuses a tampered ciphertext", () => {
    const value = encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)!;
    const parts = value.split(".");
    const raw = Buffer.from(parts[3]!, "base64url");
    raw[0] = raw[0]! ^ 0xff;
    parts[3] = raw.toString("base64url");
    expect(() => decryptContact(parts.join("."), CONTACT_MEMBER_EMAIL)).toThrow();
  });

  it("reads with the previous key during a rotation", () => {
    const oldKey = env[KEY]!;
    const value = encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)!;
    env[KEY] = randomBytes(32).toString("base64");
    expect(() => decryptContact(value, CONTACT_MEMBER_EMAIL)).toThrow();
    env[PREVIOUS] = oldKey;
    expect(decryptContact(value, CONTACT_MEMBER_EMAIL)).toBe("mum@example.com");
  });

  it("returns empty values as null instead of encrypting them", () => {
    expect(encryptContact("", CONTACT_MEMBER_EMAIL)).toBeNull();
    expect(encryptContact("   ", CONTACT_ORG_PHONE)).toBeNull();
    expect(encryptContact(null, CONTACT_GUARDIAN_EMAIL)).toBeNull();
  });

  it("fails loudly when the key is missing or the wrong size", () => {
    delete env[KEY];
    expect(() => encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)).toThrow(
      /Missing CONTACT_ENCRYPTION_KEY/,
    );
    env[KEY] = "too-short";
    expect(() => encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)).toThrow(/32 bytes/);
  });

  it("passes legacy plaintext through so the app works before the backfill", () => {
    expect(decryptContact("mum@example.com", CONTACT_MEMBER_EMAIL)).toBe("mum@example.com");
    expect(readContact(null, "0801 234 5678", CONTACT_MEMBER_PHONE)).toBe("0801 234 5678");
    expect(readContact(encryptContact("a@b.co", CONTACT_MEMBER_EMAIL), null, CONTACT_MEMBER_EMAIL)).toBe(
      "a@b.co",
    );
  });

  it("treats an unreadable value as missing rather than crashing a send run", () => {
    env[KEY] = randomBytes(32).toString("base64");
    const broken =
      "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA";
    expect(readContact(broken, null, CONTACT_MEMBER_EMAIL)).toBeNull();
  });

  it("builds a stable, one-way blind index", () => {
    const a = emailIndex("  Parent@Example.com ");
    const b = emailIndex("parent@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toContain("parent");
    expect(emailIndex("other@example.com")).not.toBe(a);
    expect(emailIndex("")).toBeNull();
  });

  it("changes the blind index when the key changes", () => {
    const before = emailIndex("mum@example.com");
    env[KEY] = randomBytes(32).toString("base64");
    expect(emailIndex("mum@example.com")).not.toBe(before);
  });

  it("normalizes addresses and phone numbers the same way everywhere", () => {
    expect(normalizeEmail("  A@B.CO ")).toBe("a@b.co");
    expect(normalizePhone("+234 (801) 234-5678")).toBe("+2348012345678");
    expect(normalizePhone("0801 234 5678")).toBe("08012345678");
    expect(normalizePhone("  ")).toBeNull();
  });

  it("recognises ciphertext", () => {
    expect(isEncryptedValue(encryptContact("a@b.co", CONTACT_MEMBER_EMAIL))).toBe(true);
    expect(isEncryptedValue("a@b.co")).toBe(false);
  });

  it("decrypts whole rows for the senders", () => {
    const member = decryptMemberRow({
      id: "m1",
      primary_email: null,
      primary_email_enc: encryptContact("mum@example.com", CONTACT_MEMBER_EMAIL),
      primary_phone: null,
      primary_phone_enc: encryptContact("08012345678", CONTACT_MEMBER_PHONE),
    });
    expect(member.primary_email).toBe("mum@example.com");
    expect(member.primary_phone).toBe("08012345678");

    const guardian = decryptGuardianRow({
      id: "g1",
      email: null,
      email_enc: encryptContact("aunt@example.com", CONTACT_GUARDIAN_EMAIL),
    });
    expect(guardian.email).toBe("aunt@example.com");

    const org = decryptOrgRow({
      id: "o1",
      emergency_phone: null,
      emergency_phone_enc: encryptContact("+2348012345678", CONTACT_ORG_PHONE),
    });
    expect(org.emergency_phone).toBe("+2348012345678");
  });
});
