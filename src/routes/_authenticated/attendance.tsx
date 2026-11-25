import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bus, CalendarCheck, Download, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { can } from "@/lib/access";
import { billingState } from "@/lib/billing";
import {
  attendanceByClass,
  overallRate,
  schoolDate,
  schoolDays,
  studentAttendance,
  type AttendanceMarks,
  type Mark,
} from "@/lib/attendance";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — GoGuard" },
      {
        name: "description",
        content: "Class attendance counted automatically from gate scans and bus rides.",
      },
      { property: "og:title", content: "Attendance — GoGuard" },
      {
        property: "og:description",
        content: "Class attendance counted automatically from gate scans and bus rides.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <AttendancePage />
    </AppShell>
  ),
});

const PAGE = 1000;

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function presets(today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  const monday = shift(today, -((d.getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = shift(monthStart, -1);
  return [
    { label: "This week", from: monday, to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
  ];
}

const MARK_STYLE: Record<Mark, string> = {
  gate: "bg-checkin",
  bus: "bg-primary",
  absent: "bg-checkout/25",
};

function AttendancePage() {
  const { data: me } = useMe();
  const { branchId, branch } = useBranch();
  const org = me!.org!;
  const today = schoolDate(new Date());
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const members = useQuery({
    queryKey: ["attendance", "members", org.id, branchId],
    queryFn: async () => {
      const all: { id: string; full_name: string; identifier_code: string | null }[] = [];
      for (let i = 0; ; i += PAGE) {
        const { data, error } = await inBranch(
          supabase
            .from("members")
            .select("id, full_name, identifier_code")
            .eq("org_id", org.id)
            .order("id"),
          branchId,
        ).range(i, i + PAGE - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return all;
    },
  });

  const marks = useQuery({
    queryKey: ["attendance", "marks", org.id, from, to],
    enabled: from <= to,
    queryFn: async () => {
      const all: AttendanceMarks[] = [];
      for (let i = 0; ; i += PAGE) {
        const { data, error } = await supabase
          .rpc("attendance_marks", { _from: from, _to: to })
          .range(i, i + PAGE - 1);
        if (error) throw error;
        all.push(...((data ?? []) as AttendanceMarks[]));
        if (!data || data.length < PAGE) break;
      }
      return all;
    },
  });

  const days = useMemo(() => (from <= to ? schoolDays(from, to, today) : []), [from, to, today]);
  const students = useMemo(
    () => studentAttendance(members.data ?? [], marks.data ?? [], days),
    [members.data, marks.data, days],
  );
  const classes = useMemo(
    () => attendanceByClass(students, org.classes ?? []),
    [students, org.classes],
  );
  const keyOf = (label: string | null) => label ?? "__none__";

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return classes
      .filter((c) => classFilter === "all" || keyOf(c.label) === classFilter)
      .map((c) => {
        const students = term
          ? c.students.filter((s) => s.name.toLowerCase().includes(term))
          : c.students;
        return { ...c, students, rate: overallRate(students) };
      })
      .filter((c) => !term || c.students.length);
  }, [classes, classFilter, q]);

  const todayInRange = days.includes(today);
  const presentToday = todayInRange
    ? students.filter((s) => s.marks[today] !== "absent").length
    : null;
  const rate = overallRate(students);
  const loading = members.isLoading || marks.isLoading;
  const canDownload = can(!!me?.isAdmin, "export_reports");
  const exportOpen = billingState(org).canExport;
  const recent = days.slice(-10);

  async function download() {
    if (!exportOpen) return;
    setBusy(true);
    try {
      const { attendanceSheets, downloadAttendanceWorkbook } =
        await import("@/lib/attendance-excel");
      const sheets = attendanceSheets({
        orgName: branch ? `${org.name} — ${branch.name}` : org.name,
        from,
        to,
        days,
        classes: visible,
      });
      const slug = org.name.replace(/\W+/g, "-").toLowerCase();
      const filter =
        classFilter === "all" ? "" : `-${classFilter.replace(/\W+/g, "-").toLowerCase()}`;
      await downloadAttendanceWorkbook(sheets, `attendance-${slug}${filter}-${from}-to-${to}.xlsx`);
    } catch {
      toast.error("Couldn't create the Excel file. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Attendance</h1>
          <p className="text-muted-foreground">
            Counted automatically from gate scans and bus rides.
          </p>
        </div>
        {canDownload && (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="signal"
              onClick={download}
              disabled={busy || loading || !days.length || !exportOpen}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Download />} Download Excel (visible)
            </Button>
            <p className="text-xs text-muted-foreground">
              {classFilter === "all" && !q.trim()
                ? "Includes all classes and students."
                : "Matches the class and search filters above."}
            </p>
            {!exportOpen && (
              <p className="text-xs text-muted-foreground">Downloads resume once you subscribe.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {presets(today).map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition",
                from === p.from && to === p.to
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="att-from">From</Label>
          <Input
            id="att-from"
            type="date"
            value={from}
            max={to}
            min={shift(to, -366)}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="att-to">To</Label>
          <Input
            id="att-to"
            type="date"
            value={to}
            min={from}
            max={shift(from, 366)}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={CalendarCheck}
          label="School days"
          value={String(days.length)}
          hint="Monday to Friday"
        />
        <Stat
          icon={Users}
          label="Average attendance"
          value={rate === null ? "—" : `${rate}%`}
          hint={`${students.length} students`}
        />
        <Stat
          icon={Bus}
          label="Present today"
          value={presentToday === null ? "—" : `${presentToday} / ${students.length}`}
          hint={todayInRange ? "Gate or bus" : "Today isn't in this period"}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          aria-label="Class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="h-10 rounded-md border bg-background px-3 text-sm sm:w-56"
        >
          <option value="all">All classes ({students.length})</option>
          {classes.map((c) => (
            <option key={keyOf(c.label)} value={keyOf(c.label)}>
              {c.label ?? "No class"} ({c.students.length})
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a student"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-checkin" /> Present at the gate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> Present by bus
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-checkout/25" /> Absent
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : marks.isError ? (
        <p className="rounded-2xl border bg-card py-12 text-center text-muted-foreground">
          Couldn't load attendance. Please refresh.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border bg-card py-12 text-center text-muted-foreground">
          No students found.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((c) => (
            <section key={keyOf(c.label)} className="overflow-hidden rounded-2xl border bg-card">
              <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h2 className="font-bold">{c.label ?? "No class"}</h2>
                  <p className="text-xs text-muted-foreground">
                    {c.students.length} {c.students.length === 1 ? "student" : "students"}
                  </p>
                </div>
                <span className="font-display text-xl font-bold">
                  {c.rate === null ? "—" : `${c.rate}%`}
                </span>
              </header>
              {c.students.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No students registered in this class yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {c.students.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.present} present{s.byBus ? ` (${s.byBus} by bus)` : ""} · {s.absent}{" "}
                          absent
                        </p>
                      </div>
                      <div className="hidden gap-1 md:flex" aria-hidden>
                        {recent.map((d) => (
                          <span
                            key={d}
                            title={d}
                            className={cn("size-3 rounded-sm", MARK_STYLE[s.marks[d] ?? "absent"])}
                          />
                        ))}
                      </div>
                      <span
                        className={cn(
                          "w-12 text-right font-mono text-sm font-semibold",
                          s.rate !== null && s.rate < 75 ? "text-checkout" : "text-foreground",
                        )}
                      >
                        {s.rate === null ? "—" : `${s.rate}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" /> {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
