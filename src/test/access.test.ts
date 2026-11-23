import { describe, expect, it } from "vitest";

import { can, canOpenBusApp, homeFor, pagesFor, sendsBusLocation } from "@/lib/access";

const guard = { isAdmin: false, isGuard: true };
const driver = { isAdmin: false, isBus: true, transport: true };

describe("Gate staff access", () => {
  it("lets gate staff open Live, Students, Scanner, Reports and Attendance", () => {
    expect(pagesFor(guard)).toEqual(["/dashboard", "/members", "/scanner", "/reports", "/attendance"]);
  });
  it("hides Settings and Fleet from gate staff", () => {
    expect(pagesFor({ ...guard, transport: true })).not.toContain("/settings");
    expect(pagesFor({ ...guard, transport: true })).not.toContain("/fleet");
  });
  it("gives gate staff no admin actions", () => {
    for (const action of [
      "manage_members",
      "manage_staff",
      "manage_registration_link",
      "edit_org_profile",
      "export_reports",
      "view_passes",
      "manage_fleet",
    ] as const) {
      expect(can(guard, action)).toBe(false);
    }
  });
  it("gives admins Settings and every action", () => {
    expect(pagesFor({ isAdmin: true })).toContain("/settings");
    expect(can(true, "manage_staff")).toBe(true);
  });
});

describe("Transport package", () => {
  it("shows Fleet to admins only when the package is on", () => {
    expect(pagesFor({ isAdmin: true, transport: false })).not.toContain("/fleet");
    expect(pagesFor({ isAdmin: true, transport: true })).toContain("/fleet");
    expect(can({ isAdmin: true, transport: false }, "manage_fleet")).toBe(false);
  });
  it("lets admins manage buses only when transport entitlement is active", () => {
    expect(can({ isAdmin: true, transport: true }, "manage_fleet")).toBe(true);
    expect(can({ isAdmin: true, transport: false }, "manage_fleet")).toBe(false);
  });
  it("closes the bus app for crew when transport isn't paid for after the trial", () => {
    expect(canOpenBusApp({ ...driver, transport: false })).toBe(false);
  });
  it("sends bus logins to the bus app and guards to the gate scanner", () => {
    expect(homeFor(driver)).toBe("/bus-app");
    expect(homeFor(guard)).toBe("/gate-scanner");
    expect(homeFor({ isAdmin: true })).toBe("/dashboard");
  });
  it("gives bus crew no gate pages and no admin actions", () => {
    expect(pagesFor(driver)).toEqual([]);
    expect(can(driver, "manage_members")).toBe(false);
  });
  it("closes the bus app when the package is off", () => {
    expect(canOpenBusApp(driver)).toBe(true);
    expect(canOpenBusApp({ ...driver, transport: false })).toBe(false);
    expect(canOpenBusApp(guard)).toBe(false);
  });
});

 describe("Bus location source", () => {
  it("allows only a bus login to send location", () => {
    expect(sendsBusLocation({ isAdmin: false, isBus: true })).toBe(true);
    expect(sendsBusLocation({ isAdmin: true, isBus: true })).toBe(false);
    expect(sendsBusLocation({ isAdmin: true })).toBe(false);
    expect(sendsBusLocation(guard)).toBe(false);
  });
});
