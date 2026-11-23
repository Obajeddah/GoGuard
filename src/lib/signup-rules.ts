import { isPlanId, type PlanId } from "./billing";

/**
 * The plan is a pricing choice made on the signup form, but the trial decision
 * is never client-controlled: only Basic Gate gets one. The server records the
 * plan on the sign-up ticket and the database derives the entitlement from it.
 */
export function signupPlan(value: unknown): PlanId {
  return typeof value === "string" && isPlanId(value) ? value : "basic";
}

export function signupMetadata(ticket: string, plan: PlanId) {
  return { signup_ticket: ticket, plan };
}

export function captchaConfigured(siteKey: string | undefined, secretKey: string | undefined) {
  return Boolean(siteKey && secretKey);
}
