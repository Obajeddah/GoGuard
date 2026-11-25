import type { ReactNode } from "react";
import { Check, Lock } from "lucide-react";

import {
  EXTRA_BRANCH_NAIRA,
  formatNaira,
  PLAN_IDS,
  PLANS,
  TRIAL_DAYS,
  TRIAL_LOCK_MESSAGE,
  type PlanId,
} from "@/lib/billing";
import { cn } from "@/lib/utils";

const PLAN_COPY: Record<PlanId, { note: string; limits: string; features: string[] }> = {
  basic: {
    note: "Gate passes for one school.",
    limits: "1 branch · no buses",
    features: [
      "QR gate scanning",
      "Guardian photo check at the gate",
      "Gate guard app",
      "Parent email alerts",
      "Automatic attendance",
      "CSV and Excel reports",
    ],
  },
  standard: {
    note: "Gate passes plus your school buses.",
    limits: "1 branch · up to 4 buses",
    features: [
      "Everything in Basic Gate",
      "Transport module and live fleet map",
      "Bus app for drivers",
      "Pick-up and drop-off alerts for bus parents",
    ],
  },
  group: {
    note: "For schools with multiple branches.",
    limits: "Up to 3 branches · up to 6 buses",
    features: [
      "Everything in School Standard",
      "Each branch sees only its own data",
      "Branch switcher for headquarters",
      "Reports filtered by branch and class",
      `${formatNaira(EXTRA_BRANCH_NAIRA)}/month for each extra branch`,
    ],
  },
};

/**
 * The three plan cards; `action` renders each card's button. `trialLock` greys out the
 * paid tiers with the upgrade badge (used while a school chooses the free trial).
 */
export function PlanCards({
  action,
  trialLock = false,
  highlight = "standard",
  current,
}: {
  action: (plan: PlanId) => ReactNode;
  trialLock?: boolean;
  highlight?: PlanId;
  current?: PlanId | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {PLAN_IDS.map((id) => {
        const plan = PLANS[id];
        const copy = PLAN_COPY[id];
        const locked = trialLock && !plan.trial;
        const featured = id === highlight && !locked;
        return (
          <div
            key={id}
            className={cn(
              "relative flex flex-col rounded-3xl p-6",
              featured ? "bg-gradient-ink text-ink-foreground shadow-pass" : "border bg-card",
              locked && "opacity-60",
            )}
          >
            {current === id ? (
              <span className="absolute right-5 top-5 rounded-full bg-checkin px-2.5 py-0.5 text-xs font-semibold text-checkin-foreground">
                Your plan
              </span>
            ) : (
              plan.trial && (
                <span className="absolute right-5 top-5 rounded-full bg-signal px-2.5 py-0.5 text-xs font-semibold text-signal-foreground">
                  {TRIAL_DAYS}-day free trial
                </span>
              )
            )}
            <p className="font-display text-xl font-semibold">{plan.label}</p>
            <p
              className={cn("mt-1 text-sm", featured ? "text-ink-muted" : "text-muted-foreground")}
            >
              {copy.note}
            </p>
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-4xl font-extrabold">
                {formatNaira(plan.amountNaira)}
              </span>
              <span
                className={cn("text-sm", featured ? "text-ink-muted" : "text-muted-foreground")}
              >
                per month
              </span>
            </p>
            <p
              className={cn("mt-1 text-sm font-medium", featured ? "text-signal" : "text-primary")}
            >
              {copy.limits}
            </p>
            {!plan.trial && (
              <p
                className={cn(
                  "mt-1 text-xs",
                  featured ? "text-ink-muted" : "text-muted-foreground",
                )}
              >
                No free trial
              </p>
            )}
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {copy.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      featured ? "text-signal" : "text-checkin",
                    )}
                  />
                  {f}
                </li>
              ))}
            </ul>
            {locked && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" /> {TRIAL_LOCK_MESSAGE}
              </p>
            )}
            <div className="mt-6">{action(id)}</div>
          </div>
        );
      })}
    </div>
  );
}
