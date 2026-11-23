import { describe, expect, it } from "vitest";
import { signupMetadata, captchaConfigured } from "@/lib/signup-rules";
import { readAll } from "@/lib/pagination";

describe("school signup protection", () => {
  it("requires both captcha keys, not a missing secret", () => {
    expect(captchaConfigured("site", undefined)).toBe(false);
    expect(captchaConfigured(undefined, "secret")).toBe(false);
    expect(captchaConfigured("site", "secret")).toBe(true);
  });
  it("passes the security ticket to account creation", () => {
    expect(signupMetadata("issued-ticket", "basic").signup_ticket).toBe("issued-ticket");
  });
  it("gives the trial only to Basic Gate", () => {
    expect(signupMetadata("ticket", "basic").trial).toBe(true);
    expect(signupMetadata("ticket", "standard").trial).toBe(false);
    expect(signupMetadata("ticket", "group").trial).toBe(false);
  });
});
describe("complete exports", () => {
  it("includes records beyond 1,000 without duplicating page boundaries", async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const result = await readAll((from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
    expect(result).toEqual(rows);
    expect(result.at(-1)?.id).toBe(1202);
  });
  it("does not return partial results when a page fails", async () => {
    await expect(readAll((from) => Promise.resolve({ data: from ? null : [1, 2], error: from ? new Error("failed") : null }), 2)).rejects.toThrow("failed");
  });
});