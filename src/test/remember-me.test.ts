import { describe, expect, it } from "vitest";

import { rememberRecord, shouldEndSession } from "@/lib/remember-me";

const now = new Date("2026-11-01T08:00:00Z").getTime();
const day = 86_400_000;
const open = { aliveMarker: true, markersSupported: true };
const reopened = { aliveMarker: false, markersSupported: true };

describe("Keep me signed in", () => {
  it("keeps a ticked sign-in for 89 days, even after the browser is closed", () => {
    expect(shouldEndSession(rememberRecord(true, now), now + 89 * day, reopened)).toBe(false);
  });
  it("ends a ticked sign-in after 90 days", () => {
    expect(shouldEndSession(rememberRecord(true, now), now + 90 * day, open)).toBe(true);
  });
  it("ends an unticked sign-in once the browser has been closed", () => {
    expect(shouldEndSession(rememberRecord(false, now), now + 60_000, reopened)).toBe(true);
  });
  it("keeps an unticked sign-in while the browser stays open", () => {
    expect(shouldEndSession(rememberRecord(false, now), now + 3_600_000, open)).toBe(false);
  });
});
