import { redactText, redactValue } from "@/lib/redact";
import { describeError } from "@/lib/error-capture";

const PASS_HASH = "9f2c1d4b8a7e6f5c3b2a1908d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8";

describe("redactText", () => {
  it("keeps the first letter of an email and the domain", () => {
    expect(redactText("Registered by qa.admin@greenfield-qa-academy.com")).toBe(
      "Registered by q***@greenfield-qa-academy.com",
    );
  });

  it("masks a Supabase JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactText(`apikey ${jwt}`)).toBe("apikey [jwt]");
  });

  it("masks bearer tokens", () => {
    expect(redactText("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("masks Supabase publishable and secret keys", () => {
    expect(redactText("key=sb_publishable_AbCdEf123456")).toContain("sb_publishable_[redacted]");
    expect(redactText("key=sb_secret_ZyXwVu987654")).toContain("sb_secret_[redacted]");
  });

  it("masks Paystack secret keys but keeps the mode", () => {
    expect(redactText("using sk_test_abc123def456ghi789")).toBe("using sk_test_[redacted]");
    expect(redactText("using sk_live_abc123def456ghi789")).toBe("using sk_live_[redacted]");
  });

  it("masks inline passwords in connection strings", () => {
    expect(redactText("postgres://postgres:s3cret@db.example.com:5432/app")).toBe(
      "postgres://postgres:[redacted]@db.example.com:5432/app",
    );
  });

  it("masks QR pass codes and other long hex identifiers", () => {
    expect(redactText(`/pass/${PASS_HASH}`)).toBe("/pass/[hash]");
  });

  it("masks grouped card numbers", () => {
    expect(redactText("card 4111 1111 1111 1111 charged")).toBe("card [card] charged");
  });

  it("masks Nigerian and international phone numbers", () => {
    expect(redactText("call +234 801 234 5678")).toBe("call [phone]");
    expect(redactText("call 08012345678")).toBe("call [phone]");
    expect(redactText("call +14155552671")).toBe("call [phone]");
  });

  it("masks token-bearing query parameters", () => {
    expect(redactText("GET /register?token=abcdef123456&x=1")).toBe(
      "GET /register?token=[redacted]&x=1",
    );
    expect(redactText("/pass?hash=" + "a".repeat(20))).toBe("/pass?hash=[redacted]");
  });

  it("leaves ordinary diagnostics untouched", () => {
    const plain =
      "TypeError: cannot read properties of undefined at src/routes/_authenticated/members.tsx:42:7";
    expect(redactText(plain)).toBe(plain);
    expect(redactText("2026-11-25T14:05:00.000Z gate scan ok")).toBe(
      "2026-11-25T14:05:00.000Z gate scan ok",
    );
  });

  it("is idempotent", () => {
    const raw = `qa.admin@school.edu.ng ${PASS_HASH} sk_live_abc123def456 ${"Bearer"} abcdef1234567890`;
    const once = redactText(raw);
    expect(redactText(once)).toBe(once);
  });
});

describe("redactValue", () => {
  it("redacts nested strings without mutating the input", () => {
    const input = {
      guardian: { email: "a.parent@school.edu.ng", phone: "+234 802 111 2233" },
      ok: true,
      count: 3,
    };
    const out = redactValue(input);

    expect(out.guardian.email).toBe("a***@school.edu.ng");
    expect(out.guardian.phone).toBe("[phone]");
    expect(out.ok).toBe(true);
    expect(out.count).toBe(3);
    expect(input.guardian.email).toBe("a.parent@school.edu.ng");
  });

  it("walks arrays and Errors", () => {
    const out = redactValue(["admin@school.edu.ng", new Error("failed for admin@school.edu.ng")]);
    expect(out[0]).toBe("a***@school.edu.ng");
    expect(String(out[1])).toContain("a***@school.edu.ng");
  });

  it("survives circular references", () => {
    const loop: Record<string, unknown> = { email: "loop@school.edu.ng" };
    loop["self"] = loop;

    expect(() => redactValue(loop)).not.toThrow();
    expect(redactValue(loop)["self"]).toBe("[circular]");
  });

  it("stops at the depth limit", () => {
    const deep = { a: { b: { c: { d: { e: "deep@school.edu.ng" } } } } };
    expect(redactValue(deep).a.b.c.d).toBe("[depth-limit]");
  });
});

describe("error-capture integration", () => {
  it("redacts the text a log line would carry", () => {
    const error = new Error("signup failed for qa.admin@greenfield-qa-academy.com");
    const described = describeError(error);

    expect(described).not.toContain("qa.admin@");
    expect(described).toContain("q***@greenfield-qa-academy.com");
  });

  it("keeps the cause chain while redacting each level", () => {
    const cause = new Error("supabase said no for parent@school.edu.ng");
    const error = new Error("outer failure", { cause });
    const described = describeError(error);

    expect(described).toContain("outer failure");
    expect(described).toContain("caused by");
    expect(described).not.toContain("parent@school.edu.ng");
  });
});
