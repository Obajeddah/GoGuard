import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { confirmPayment } from "@/lib/payment.functions";

export const Route = createFileRoute("/_authenticated/payment")({
  validateSearch: z.object({ reference: z.string().optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Payment — GoGuard" },
      { name: "description", content: "Confirming your GoGuard subscription payment." },
      { property: "og:title", content: "Payment — GoGuard" },
      { property: "og:description", content: "Confirming your GoGuard subscription payment." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <PaymentResult />
    </AppShell>
  ),
});

function PaymentResult() {
  const { reference } = Route.useSearch();
  const confirm = useServerFn(confirmPayment);
  const queryClient = useQueryClient();
  const valid = !!reference && /^gp_[a-f0-9]{32}$/.test(reference);

  const q = useQuery({
    queryKey: ["payment", reference],
    enabled: valid,
    queryFn: () => confirm({ data: { reference: reference! } }),
    // Bank transfers can take a minute to land; keep checking while pending.
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 5000 : false),
  });
  const status = valid ? q.data?.status : "failed";

  useEffect(() => {
    if (status === "paid") queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [status, queryClient]);

  const view =
    status === "paid"
      ? {
          icon: <CheckCircle2 className="size-12 text-checkin" />,
          title: "Payment received",
          body: "Thank you. Your subscription is active.",
        }
      : status === "failed"
        ? {
            icon: <XCircle className="size-12 text-destructive" />,
            title: "Payment not completed",
            body: "No money was taken. You can try again from Settings.",
          }
        : status === "pending"
          ? {
              icon: <Clock className="size-12 text-signal" />,
              title: "Waiting for your payment",
              body: "Transfers can take a few minutes. This page updates on its own.",
            }
          : {
              icon: <Loader2 className="size-12 animate-spin text-muted-foreground" />,
              title: "Checking your payment",
              body: "One moment.",
            };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-3xl border bg-card p-8 text-center">
      {view.icon}
      <h1 className="mt-4 text-2xl font-bold">{view.title}</h1>
      <p className="mt-2 text-muted-foreground">{view.body}</p>
      <Button asChild className="mt-6">
        <Link to={status === "paid" ? "/dashboard" : "/settings"}>
          {status === "paid" ? "Go to dashboard" : "Back to Settings"}
        </Link>
      </Button>
    </div>
  );
}
