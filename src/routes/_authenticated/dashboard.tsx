import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { Copy, Link2, PhoneCall, RefreshCw, ScanLine, Share2, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { readAll } from "@/lib/pagination";
import { termsFor } from "@/lib/org-terms";
import { can } from "@/lib/access";
import { AppShell } from "@/components/app-shell";
import { LogRow, type GateLogRow } from "@/components/log-row";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Live gate activity — GoGuard" },
      {
        name: "description",
        content: "Every check-in and check-out at your gate today, as it happens.",
      },
      { property: "og:title", content: "Live gate activity — GoGuard" },
      {
        property: "og:description",
        content: "Every check-in and check-out at your gate today, as it happens.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <Dashboard />
    </AppShell>
  ),
});

function Dashboard() {
  const { data: me } = useMe();
  const org = me!.org!;
  const terms = termsFor(org.type);
  const isAdmin = !!me?.isAdmin;
  const queryClient = useQueryClient();
  const branch = useBranch();
  const registrationBranch =
    branch.branch ?? branch.branches.find((b) => b.is_main) ?? branch.branches[0];
  const [since] = useState(() => startOfDay(new Date()).toISOString());

  const logsQuery = useQuery({
    queryKey: ["gate-logs", "today", org.id, branch.branchId, since],
    queryFn: async () => {
      return readAll((from, to) =>
        inBranch(
          supabase
            .from("gate_logs")
            .select(
              "id, action_type, timestamp, member_id, member_name, verified_guardian_name, guard_name",
            )
            .gte("timestamp", since)
            .eq("org_id", org.id)
            .order("timestamp", { ascending: false })
            .order("id"),
          branch.branchId,
        ).range(from, to),
      );
    },
  });

  const countsQuery = useQuery({
    queryKey: ["counts", org.id, branch.branchId],
    queryFn: async () => {
      const [m, g] = await Promise.all([
        inBranch(
          supabase
            .from("members")
            .select("id", { count: "exact", head: true })
            .eq("org_id", org.id),
          branch.branchId,
        ),
        inBranch(
          supabase
            .from("guardians")
            .select("id", { count: "exact", head: true })
            .eq("org_id", org.id),
          branch.branchId,
        ),
      ]);
      return { members: m.count ?? 0, guardians: g.count ?? 0 };
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`gate-logs-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "gate_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["gate-logs"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const logs = logsQuery.data ?? [];
  const stats = useMemo(() => {
    const latest = new Map<string, string>();
    for (const l of [...logs].reverse()) latest.set(l.member_id, l.action_type);
    return {
      in: logs.filter((l) => l.action_type === "check_in").length,
      out: logs.filter((l) => l.action_type === "check_out").length,
      onSite: [...latest.values()].filter((a) => a === "check_in").length,
    };
  }, [logs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {me?.fullName ? `Welcome, ${me.fullName.split(" ")[0]}` : org.name}
          </p>
          <h1 className="text-3xl font-bold">Today at the gate</h1>
        </div>
        <Button asChild variant="ink">
          <Link to="/scanner">
            <ScanLine /> Open scanner
          </Link>
        </Button>
      </div>

      {isAdmin && !org.emergency_phone && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-signal/50 bg-signal/10 p-4">
          <PhoneCall className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Add your emergency line.</span>{" "}
            <span className="text-muted-foreground">
              {terms.owner}s will see it in every gate email, so they can call you about anything
              unexpected.
            </span>
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings">Add number</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label={terms.checkInHint} value={stats.in} tone="in" />
        <Stat label={terms.checkOutHint} value={stats.out} tone="out" />
        <Stat label="On site" value={stats.onSite} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="min-w-0 rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Live activity</h2>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="animate-gate-ring absolute inline-flex size-full rounded-full bg-checkin [animation-iteration-count:infinite]" />
                <span className="relative inline-flex size-2 rounded-full bg-checkin" />
              </span>
              Live
            </span>
          </div>
          {logsQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-medium">No activity yet today</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Each scan will appear here the moment it happens.
              </p>
            </div>
          ) : (
            <ul className="mt-2 divide-y">
              {logs.slice(0, 50).map((l) => (
                <LogRow key={l.id} log={l as GateLogRow} terms={terms} />
              ))}
            </ul>
          )}
        </section>

        <div className="min-w-0 space-y-6">
          {can(isAdmin, "manage_registration_link") && registrationBranch && (
            <RegistrationLinkCard
              branchId={registrationBranch.id}
              token={registrationBranch.registration_token}
              orgName={org.name}
              ownerLabel={terms.owner.toLowerCase()}
            />
          )}
          <section className="rounded-3xl border bg-card p-5">
            <h2 className="text-lg font-bold">Directory</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-muted p-4">
                <p className="font-display text-3xl font-bold">
                  {countsQuery.data?.members ?? "–"}
                </p>
                <p className="text-xs text-muted-foreground">{terms.members}</p>
              </div>
              <div className="rounded-2xl bg-muted p-4">
                <p className="font-display text-3xl font-bold">
                  {countsQuery.data?.guardians ?? "–"}
                </p>
                <p className="text-xs text-muted-foreground">{terms.guardians}</p>
              </div>
            </div>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to="/members">
                <Users /> {isAdmin ? "Manage" : "View"} {terms.members.toLowerCase()}
              </Link>
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "in" | "out" }) {
  return (
    <div
      className={
        tone === "in"
          ? "rounded-2xl bg-checkin p-4 text-checkin-foreground"
          : tone === "out"
            ? "rounded-2xl bg-checkout p-4 text-checkout-foreground"
            : "rounded-2xl bg-ink p-4 text-ink-foreground"
      }
    >
      <p className="font-display text-3xl font-bold md:text-4xl">{value}</p>
      <p className="text-xs font-medium opacity-90 md:text-sm">{label}</p>
    </div>
  );
}

function RegistrationLinkCard({
  branchId,
  token,
  orgName,
  ownerLabel,
}: {
  branchId: string;
  token: string;
  orgName: string;
  ownerLabel: string;
}) {
  const queryClient = useQueryClient();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/register/${token}`;

  const regenerate = useMutation({
    mutationFn: async () => {
      const next = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase
        .from("branches")
        .update({ registration_token: next })
        .eq("id", branchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("New link ready. The previous link no longer works.");
    },
    onError: () => toast.error("Couldn't create a new link. Please try again."),
  });

  return (
    <section className="overflow-hidden rounded-3xl bg-gradient-ink p-5 text-ink-foreground">
      <div className="flex items-center gap-2">
        <Link2 className="size-5 text-signal" />
        <h2 className="text-lg font-bold">Registration link</h2>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Share this one link with every {ownerLabel}. They register up to four trusted guardians — no
        app or account needed — and each registration appears here automatically.
      </p>
      <div className="mt-4 break-all rounded-xl bg-ink-foreground/10 px-3 py-2.5 font-mono text-xs">
        {link}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="signal"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast.success("Link copied");
          }}
        >
          <Copy /> Copy link
        </Button>
        <Button asChild variant="secondary">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `${orgName} now uses GoGuard for safe drop-off and pick-up. Please register the people allowed to collect your child here: ${link}`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            <Share2 /> WhatsApp
          </a>
        </Button>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-foreground">
            <RefreshCw className="size-3" /> Replace link
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the registration link?</AlertDialogTitle>
            <AlertDialogDescription>
              The current link will stop working immediately. Families already registered keep their
              passes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => regenerate.mutate()}>Replace link</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
