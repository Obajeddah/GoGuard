import { createFileRoute, Link } from "@tanstack/react-router";

import { Brand } from "@/components/brand";
import { PlanCards } from "@/components/plan-cards";
import { PlanComparison } from "@/components/plan-comparison";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/lib/billing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — GoGuard" },
      {
        name: "description",
        content:
          "GoGuard for schools: Basic Gate ₦7,500/month with a 14-day free trial, School Standard ₦14,800/month with buses, Multi-School Group ₦19,200/month for several branches.",
      },
      { property: "og:title", content: "Pricing — GoGuard" },
      { property: "og:description", content: "From ₦7,500 a month. Basic Gate starts with a 14-day free trial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Brand />
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Register</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:pt-14">
        <h1 className="text-4xl font-extrabold md:text-5xl">Pricing</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Start with Basic Gate free for {TRIAL_DAYS} days. Upgrade any time.
        </p>
        <div className="mt-8">
          <PlanCards
            action={(id) => (
              <Button asChild variant={id === "standard" ? "signal" : "default"} size="lg" className="w-full">
                <Link to="/signup" search={{ plan: id }}>
                  {id === "basic" ? "Start free trial" : "Get started"}
                </Link>
              </Button>
            )}
          />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Billed monthly. Pay by card, bank transfer or USSD.</p>
        <PlanComparison />
      </main>
    </div>
  );
}
