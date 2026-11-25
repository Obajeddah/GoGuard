import { describe, expect, it } from "vitest";
import {
  billingState,
  nextPaidUntil,
  planAmountKobo,
  planPriceNaira,
  PLANS,
  TRIAL_DAYS,
} from "@/lib/billing";

const signup = new Date("2026-11-01T09:00:00Z");
const at = (days: number) => new Date(signup.getTime() + days * 86_400_000);
const trialEnd = at(14).toISOString();
const unpaid = { trial_ends_at: trialEnd, paid_until: null };

describe("School subscription pricing and limits", () => {
  it("charges Basic Gate ₦7,500 monthly", () => {
    expect(planAmountKobo("basic")).toBe(750_000);
  });
  it("includes one branch on Basic Gate", () => {
    expect(PLANS.basic.includedBranches).toBe(1);
  });
  it("includes no buses on Basic Gate", () => {
    expect(PLANS.basic.maxBuses).toBe(0);
  });
  it("charges Campus Standard ₦14,800 monthly", () => {
    expect(planAmountKobo("standard")).toBe(1_480_000);
  });
  it("includes one branch on Campus Standard", () => {
    expect(PLANS.standard.includedBranches).toBe(1);
  });
  it("includes four buses on Campus Standard", () => {
    expect(PLANS.standard.maxBuses).toBe(4);
  });
  it("charges Multi-Campus Group ₦19,200 monthly", () => {
    expect(planAmountKobo("group", 3)).toBe(1_920_000);
  });
  it("includes three branches on Multi-Campus Group", () => {
    expect(PLANS.group.includedBranches).toBe(3);
  });
  it("includes six buses on Multi-Campus Group", () => {
    expect(PLANS.group.maxBuses).toBe(6);
  });
  it("adds ₦3,000 monthly per branch beyond three", () => {
    expect(planPriceNaira("group", 4)).toBe(22_200);
    expect(planPriceNaira("group", 5)).toBe(25_200);
  });
  it("offers the free trial only on Basic Gate", () => {
    expect(PLANS.basic.trial).toBe(true);
    expect(PLANS.standard.trial).toBe(false);
    expect(PLANS.group.trial).toBe(false);
  });
  it("gives a fourteen-day free trial", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe("Trial and feature locks", () => {
  it("allows gate emails during the trial", () => {
    expect(billingState(unpaid, at(13)).canSendEmails).toBe(true);
  });
  it("allows spreadsheet exports during the trial", () => {
    expect(billingState(unpaid, at(13)).canExport).toBe(true);
  });
  it("locks transport during the trial even if a paid tier is selected", () => {
    expect(billingState({ ...unpaid, plan: "standard" }, at(13)).transportActive).toBe(false);
  });
  it("locks multiple branches during the trial", () => {
    expect(billingState({ ...unpaid, plan: "group" }, at(13)).multiBranch).toBe(false);
  });
  it("halts emails at trial expiry without payment", () => {
    expect(billingState(unpaid, at(14)).canSendEmails).toBe(false);
  });
  it("blocks exports at trial expiry without payment", () => {
    expect(billingState(unpaid, at(14)).canExport).toBe(false);
  });
  it("keeps transport locked on paid Basic Gate", () => {
    expect(
      billingState({ ...unpaid, plan: "basic", paid_until: at(45).toISOString() }, at(15))
        .transportActive,
    ).toBe(false);
  });
  it("unlocks four buses for paid Campus Standard", () => {
    const state = billingState(
      { ...unpaid, plan: "standard", paid_until: at(45).toISOString() },
      at(15),
    );
    expect(state.transportActive).toBe(true);
    expect(state.maxBuses).toBe(4);
    expect(state.multiBranch).toBe(false);
  });
  it("unlocks multiple branches for paid Multi-Campus Group", () => {
    expect(
      billingState({ ...unpaid, plan: "group", paid_until: at(45).toISOString() }, at(15))
        .multiBranch,
    ).toBe(true);
  });
  it("restores emails and export after payment", () => {
    const state = billingState(
      { ...unpaid, plan: "basic", paid_until: at(45).toISOString() },
      at(15),
    );
    expect(state.canSendEmails).toBe(true);
    expect(state.canExport).toBe(true);
  });
});

describe("Payment periods", () => {
  it("keeps unused Basic trial days", () => {
    expect(nextPaidUntil(unpaid, "basic", at(3)).toISOString()).toBe("2026-12-15T09:00:00.000Z");
  });
  it("starts a paid transport plan immediately without adding trial days", () => {
    expect(nextPaidUntil(unpaid, "standard", at(3)).toISOString()).toBe("2026-12-04T09:00:00.000Z");
  });
  it("extends the same plan from its active paid period", () => {
    expect(
      nextPaidUntil(
        { ...unpaid, plan: "basic", paid_until: "2027-01-10T00:00:00.000Z" },
        "basic",
        at(20),
      ).toISOString(),
    ).toBe("2027-02-10T00:00:00.000Z");
  });
});
