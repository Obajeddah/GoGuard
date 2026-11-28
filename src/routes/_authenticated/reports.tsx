import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { endOfDay, format, startOfDay, startOfMonth, subDays } from "date-fns";
import { Download, Loader2, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { readAll } from "@/lib/pagination";
import { termsFor } from "@/lib/org-terms";
import { can } from "@/lib/access";
import { billingState } from "@/lib/billing";
import { downloadCsv, toCsv } from "@/lib/csv";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Gate reports · GoGuard" },
      {
        name: "description",
        content: "Search and export your full check-in and check-out history.",
      },
      { property: "og:title", content: "Gate reports · GoGuard" },
      {
        property: "og:description",
        content: "Search and export your full check-in and check-out history.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <Reports />
    </AppShell>
  ),
});

type ActionFilter = "all" | "check_in" | "check_out";

function Reports() {
  const { data: me } = useMe();
  const { branchId } = useBranch();
  const org = me!.org!;
  const terms = termsFor(org.type);
  const [from, setFrom] = useState(() => format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [action, setAction] = useState<ActionFilter>("all");
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("all");

  const logsQuery = useQuery({
    queryKey: ["gate-logs", "report", org.id, branchId, from, to, action],
    queryFn: async () => {
      let query = inBranch(
        supabase
          .from("gate_logs")
          .select(
            "id, action_type, timestamp, member_name, verified_guardian_name, guard_name, member:members(identifier_code)",
          )
          .gte("timestamp", startOfDay(new Date(`${from}T00:00:00`)).toISOString())
          .lte("timestamp", endOfDay(new Date(`${to}T00:00:00`)).toISOString())
          .eq("org_id", org.id)
          .order("timestamp", { ascending: false })
          .order("id"),
        branchId,
      );
      if (action !== "all") query = query.eq("action_type", action);
      return readAll((from, to) => query.range(from, to));
    },
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (logsQuery.data ?? []).filter(
      (l) => classFilter === "all" || (l.member?.identifier_code ?? "__none__") === classFilter,
    );
    if (!term) return list;
    return list.filter((l) =>
      [l.member_name, l.verified_guardian_name, l.guard_name, l.member?.identifier_code]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(term)),
    );
  }, [logsQuery.data, q, classFilter]);

  function exportCsv() {
    if (!billingState(org).canExport) return;
    const csv = toCsv(
      rows.map((l) => ({
        date: format(new Date(l.timestamp), "yyyy-MM-dd"),
        time: format(new Date(l.timestamp), "HH:mm:ss"),
        action: l.action_type === "check_in" ? terms.checkIn : terms.checkOut,
        [terms.member.toLowerCase()]: l.member_name ?? "",
        [terms.identifier.toLowerCase()]: l.member?.identifier_code ?? "",
        [terms.guardian.toLowerCase()]: l.verified_guardian_name ?? "",
        verified_by: l.guard_name ?? "",
      })),
    );
    downloadCsv(
      `gatepass-${org.name.replace(/\W+/g, "-").toLowerCase()}-${from}-to-${to}.csv`,
      csv,
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            {rows.length} {rows.length === 1 ? "entry" : "entries"} in this period
          </p>
        </div>
        {can(!!me?.isAdmin, "export_reports") && (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="signal"
              onClick={exportCsv}
              disabled={!rows.length || !billingState(org).canExport}
            >
              <Download /> Download spreadsheet
            </Button>
            {!billingState(org).canExport && (
              <p className="text-xs text-muted-foreground">Downloads resume once you subscribe.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          {[
            { label: "Today", from: new Date(), to: new Date() },
            { label: "Last 7 days", from: subDays(new Date(), 6), to: new Date() },
            { label: "This month", from: startOfMonth(new Date()), to: new Date() },
          ].map((p) => {
            const f = format(p.from, "yyyy-MM-dd");
            const t = format(p.to, "yyyy-MM-dd");
            return (
              <button
                key={p.label}
                onClick={() => {
                  setFrom(f);
                  setTo(t);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm font-medium transition",
                  from === f && to === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="flex rounded-lg bg-muted p-1">
            {(["all", "check_in", "check_out"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={cn(
                  "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition",
                  action === a ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {a === "all" ? "All" : a === "check_in" ? terms.checkIn : terms.checkOut}
              </button>
            ))}
          </div>
        </div>
        <select
          aria-label="Class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="h-10 rounded-md border bg-background px-3 text-sm sm:col-span-3"
        >
          <option value="all">All classes</option>
          {org.classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__none__">No class</option>
        </select>
        <div className="relative sm:col-span-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search by ${terms.member.toLowerCase()}, ${terms.guardian.toLowerCase()} or staff name`}
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {logsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">No activity in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>{terms.member}</TableHead>
                <TableHead>{terms.guardian}</TableHead>
                <TableHead className="hidden md:table-cell">Verified by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {format(new Date(l.timestamp), "MMM d, h:mm a")}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        l.action_type === "check_in"
                          ? "bg-checkin/15 text-checkin"
                          : "bg-checkout/15 text-checkout",
                      )}
                    >
                      {l.action_type === "check_in" ? terms.checkInHint : terms.checkOutHint}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{l.member_name}</p>
                    {l.member?.identifier_code && (
                      <p className="text-xs text-muted-foreground">{l.member.identifier_code}</p>
                    )}
                  </TableCell>
                  <TableCell>{l.verified_guardian_name ?? "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">{l.guard_name ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
