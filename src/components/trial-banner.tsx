import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Lock } from "lucide-react";

import type { Me } from "@/hooks/use-me";
import { billingState, isPlanId, PLANS, TRIAL_LOCK_MESSAGE } from "@/lib/billing";
import { Button } from "@/components/ui/button";

/** Trial / unpaid notice for school administrators. */
export function TrialBanner({ org }: { org: NonNullable<Me["org"]> }) {
  const state = billingState(org);
  if (state.status === "active") return null;

  if (state.status === "expired") {
    const chosen =
      isPlanId(org.plan) && org.plan !== "basic" && !org.paid_until ? PLANS[org.plan].label : null;
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-2xl bg-destructive p-4 text-destructive-foreground"
      >
        <AlertTriangle className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            {chosen ? `Pay to start ${chosen}.` : "Your plan isn't active."}
          </span>{" "}
          <span className="opacity-90">
            Parent emails, downloads, buses and branches are paused until you pay. Scanning still
            works.
          </span>
        </p>
        <Button asChild size="sm" variant="secondary">
          <Link to="/settings" hash="billing">
            Choose a plan
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
      <Clock className="size-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">
          Basic Gate free trial: {state.daysLeft} {state.daysLeft === 1 ? "day" : "days"} left.
        </span>{" "}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Lock className="size-3.5" /> {TRIAL_LOCK_MESSAGE}
        </span>
      </p>
      <Button asChild size="sm" variant="outline">
        <Link to="/settings" hash="billing">
          View plans
        </Link>
      </Button>
    </div>
  );
}
