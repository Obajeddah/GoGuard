import type { PlanId } from "./billing";

export function signupMetadata(ticket: string, plan: PlanId) {
  return { signup_ticket: ticket, plan, trial: plan === "basic" };
}

export function captchaConfigured(siteKey: string | undefined, secretKey: string | undefined) {
  return Boolean(siteKey && secretKey);
}