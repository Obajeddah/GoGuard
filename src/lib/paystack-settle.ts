import { nextPaidUntil, normalisePlan, type BillingInput } from "@/lib/billing";

/** The organisation fields a successful payment writes. */
export function settlementUpdate(org: BillingInput, plan: string, now: Date = new Date()) {
  return { plan: normalisePlan(plan), paid_until: nextPaidUntil(org, plan, now).toISOString() };
}
