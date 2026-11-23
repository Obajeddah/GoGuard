import { describe, expect, it } from "vitest";

import { orgEmailPolicyError } from "@/lib/email-domain";
import { gateRecipients, type RecipientGuardian } from "@/lib/notification-recipients";

describe("School signup email must be on the school's own domain", () => {
  it("rejects a gmail address for a school", () => {
    expect(orgEmailPolicyError("head@gmail.com", "school")).not.toBeNull();
  });
  it("accepts an institution domain for a school", () => {
    expect(orgEmailPolicyError("admin@greenfield.edu.ng", "school")).toBeNull();
  });
  it("does not apply the school rule to estates", () => {
    expect(orgEmailPolicyError("manager@gmail.com", "estate")).toBeNull();
  });
});

const guardians: RecipientGuardian[] = [
  { id: "g1", name: "Aunt Ada", email: "ada@example.com", receive_general_notifications: false },
  { id: "g2", name: "Driver Tunde", email: "tunde@example.com", receive_general_notifications: true },
  { id: "g3", name: "Grandma", email: "grandma@example.com", receive_general_notifications: false },
];

describe("Gate scan notification recipients", () => {
  const emails = (actingGuardianId: string) =>
    gateRecipients({ parentEmail: "Parent@Example.com", actingGuardianId, guardians }).map(
      (r) => r.email,
    );

  it("always notifies the registering parent", () => {
    expect(emails("g1")).toContain("parent@example.com");
  });
  it("notifies the guardian who was scanned even if they opted out of general notifications", () => {
    expect(emails("g1")).toContain("ada@example.com");
  });
  it("notifies other guardians only when they opted in", () => {
    expect(emails("g1")).toEqual(["parent@example.com", "ada@example.com", "tunde@example.com"]);
  });
  it("does not email the same address twice", () => {
    const list = gateRecipients({
      parentEmail: "ada@example.com",
      actingGuardianId: "g1",
      guardians,
    });
    expect(list.filter((r) => r.email === "ada@example.com")).toHaveLength(1);
  });
});
