import { describe, expect, it } from "vitest";
import { signupMetadata, signupPlan, captchaConfigured } from "@/lib/signup-rules";
import { readAll } from "@/lib/pagination";

describe("school signup protection", () => {
  it("requires both captcha keys, not a missing secret", () => {
    expect(captchaConfigured("site", undefined)).toBe(false);
    expect(captchaConfigured(undefined, "secret")).toBe(false);
    expect(captchaConfigured("site", "secret")).toBe(true);
  });
  it("passes the security ticket and chosen plan to account creation", () => {
    expect(signupMetadata("issued-ticket", "standard")).toEqual({
      signup_ticket: "issued-ticket",
      plan: "standard",
    });
  });
  it("never puts a client-controlled trial flag in auth metadata", () => {
    expect(signupMetadata("ticket", "basic")).not.toHaveProperty("trial");
    expect(signupMetadata("ticket", "group")).not.toHaveProperty("trial");
  });
  it("falls back to Basic Gate for unknown plans", () => {
    expect(signupPlan("group")).toBe("group");
    expect(signupPlan("standard")).toBe("standard");
    expect(signupPlan("free-forever")).toBe("basic");
    expect(signupPlan(undefined)).toBe("basic");
  });
});
describe("complete exports", () => {
  it("includes records beyond 1,000 without duplicating page boundaries", async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const result = await readAll((from, to) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    );
    expect(result).toEqual(rows);
    expect(result.at(-1)?.id).toBe(1202);
  });
  it("does not return partial results when a page fails", async () => {
    await expect(
      readAll(
        (from) =>
          Promise.resolve({ data: from ? null : [1, 2], error: from ? new Error("failed") : null }),
        2,
      ),
    ).rejects.toThrow("failed");
  });
});
