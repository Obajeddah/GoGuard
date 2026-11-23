import { addMonths } from "date-fns";

/**
 * GoGuard subscription rules for schools. Prices are in naira, billed monthly.
 * Only Basic Gate comes with a free trial; the paid tiers unlock buses and branches.
 */
export const PLANS = {
  basic: {
    id: "basic",
    label: "Basic Gate",
    amountNaira: 7_500,
    includedBranches: 1,
    maxBuses: 0,
    transport: false,
    multiBranch: false,
    trial: true,
  },
  standard: {
    id: "standard",
    label: "School Standard",
    amountNaira: 14_800,
    includedBranches: 1,
    maxBuses: 4,
    transport: true,
    multiBranch: false,
    trial: false,
  },
  group: {
    id: "group",
    label: "Multi-School Group",
    amountNaira: 19_200,
    includedBranches: 3,
    maxBuses: 6,
    transport: true,
    multiBranch: true,
    trial: false,
  },
} as const;

export type PlanId = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export const TRIAL_DAYS = 14;
/** Each branch beyond the three included in Multi-School Group. */
export const EXTRA_BRANCH_NAIRA = 3_000;
export const TRIAL_LOCK_MESSAGE = "Upgrade to paid plan to unlock Transport & Multi-Branch features.";

export function isPlanId(plan: string | null | undefined): plan is PlanId {
  return !!plan && plan in PLANS;
}

/** Older plan ids that may still sit on past payment rows. */
const LEGACY: Record<string, { plan: PlanId; months: number }> = {
  monthly: { plan: "basic", months: 1 },
  yearly: { plan: "basic", months: 12 },
  transport: { plan: "standard", months: 1 },
  session: { plan: "standard", months: 12 },
};

/** The current plan id for any plan id ever stored on a payment. */
export function normalisePlan(plan: string): PlanId {
  return isPlanId(plan) ? plan : (LEGACY[plan]?.plan ?? "basic");
}

function monthsOf(plan: string): number {
  return isPlanId(plan) ? 1 : (LEGACY[plan]?.months ?? 1);
}

export function extraBranches(plan: PlanId, branchCount: number): number {
  return plan === "group" ? Math.max(0, branchCount - PLANS.group.includedBranches) : 0;
}

/** Monthly price in naira, including the extra-branch add-on for Multi-School Group. */
export function planPriceNaira(plan: PlanId, branchCount = 1): number {
  return PLANS[plan].amountNaira + extraBranches(plan, branchCount) * EXTRA_BRANCH_NAIRA;
}

/** Paystack charges in kobo (1 naira = 100 kobo). */
export function planAmountKobo(plan: PlanId, branchCount = 1): number {
  return planPriceNaira(plan, branchCount) * 100;
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

export interface BillingInput {
  plan?: string | null;
  trial_ends_at: string | null;
  paid_until: string | null;
}

/**
 * New `paid_until` after a successful payment. Renewing the same plan adds a month
 * after the current paid period; Basic Gate also keeps unused trial days. Switching
 * to a different plan starts the new plan today.
 */
export function nextPaidUntil(org: BillingInput, plan: string, now: Date = new Date()): Date {
  const target = normalisePlan(plan);
  const samePlan = normalisePlan(org.plan ?? "basic") === target;
  const paidActive = time(org.paid_until) > now.getTime();
  let start = now.getTime();
  if (samePlan && paidActive) start = time(org.paid_until);
  if (target === "basic" && (samePlan || !paidActive)) start = Math.max(start, time(org.trial_ends_at));
  return addMonths(new Date(start), monthsOf(plan));
}

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}

export type BillingStatus = "trial" | "active" | "expired";

export interface BillingState {
  status: BillingStatus;
  /** The plan whose features are on right now; Basic Gate during the trial, null when lapsed. */
  plan: PlanId | null;
  /** Whole days left in the trial or paid period (0 when expired). */
  daysLeft: number;
  /** Gate emails go out only while trialling or paid. */
  canSendEmails: boolean;
  /** Spreadsheet export works only while trialling or paid. */
  canExport: boolean;
  /** Buses, the bus app and ride alerts: School Standard or Multi-School Group, paid. */
  transportActive: boolean;
  /** Branches, branch switcher and branch-filtered exports: Multi-School Group, paid. */
  multiBranch: boolean;
  maxBuses: number;
}

const DAY = 86_400_000;

export function billingState(org: BillingInput, now: Date = new Date()): BillingState {
  const t = now.getTime();
  const paid = time(org.paid_until);
  const trial = time(org.trial_ends_at);
  if (paid > t) {
    const plan = normalisePlan(org.plan ?? "basic");
    const p = PLANS[plan];
    return {
      status: "active",
      plan,
      daysLeft: Math.ceil((paid - t) / DAY),
      canSendEmails: true,
      canExport: true,
      transportActive: p.transport,
      multiBranch: p.multiBranch,
      maxBuses: p.maxBuses,
    };
  }
  if (trial > t)
    return {
      status: "trial",
      plan: "basic",
      daysLeft: Math.ceil((trial - t) / DAY),
      canSendEmails: true,
      canExport: true,
      transportActive: false,
      multiBranch: false,
      maxBuses: 0,
    };
  return {
    status: "expired",
    plan: null,
    daysLeft: 0,
    canSendEmails: false,
    canExport: false,
    transportActive: false,
    multiBranch: false,
    maxBuses: 0,
  };
}
