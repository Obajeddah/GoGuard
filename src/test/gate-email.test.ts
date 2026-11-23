import { describe, expect, it } from "vitest";

import { gateEmail } from "@/lib/gate-email";

const input = {
  action: "check_in" as const,
  memberName: "<Ada> & Co",
  guardianName: "Bola",
  orgName: "Greenfield Academy",
  emergencyPhone: "+234 801 234 5678",
  siteUrl: "https://goguard.example/",
  recipient: { email: "parent@example.com", name: "Parent", reason: "parent" as const },
};

describe("gate email", () => {
  it("names the child, school and action in the subject", () => {
    const mail = gateEmail(input);
    expect(mail.subject).toContain("<Ada> & Co");
    expect(mail.subject).toContain("arrived at Greenfield Academy");
  });
  it("escapes names and keeps the emergency phone tappable", () => {
    const mail = gateEmail(input);
    expect(mail.html).toContain("&lt;Ada&gt; &amp; Co");
    expect(mail.html).toContain('href="tel:+2348012345678"');
  });
  it("uses the check-out wording for departures", () => {
    expect(gateEmail({ ...input, action: "check_out" }).subject).toContain("left Greenfield Academy");
  });
});
