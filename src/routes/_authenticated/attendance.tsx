import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, CalendarCheck, Clock, Download, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { can } from "@/lib/access";
import { billingState } from "@/lib/billing";
import {
  attendanceByClass,
  DEFAULT_CUTOFF,
  marksFromEvents,
  overallRate,
  schoolDate,
  schoolDays,
  studentAttendance,
  type GateMarkEvent,
  type Mark,
  type SchoolCalendar,
} from "@/lib/attendance";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance, GoGuard" },
      {
        name: "description",
        content: "Class attendance counted automatically from gate scans and bus rides.",
      },
      { property: "og:title", content: "Attendance, GoGuard" },
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

  // The school's own week and the moment attendance is decided. Read with a
  // plain select so a database that hasn't had the settings columns added yet
  // still loads the page on the Monday–Friday, 10:00 defaults.
  const settings = useQuery({
    queryKey: ["attendance", "settings", org.id],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("*").eq("id", org.id).maybeSingle();
      const row = data as unknown as {
        attendance_cutoff?: string | null;
        school_calendar?: SchoolCalendar | null;
      } | null;
      return {
        cutoff: (row?.attendance_cutoff ?? DEFAULT_CUTOFF).slice(0, 5),
        calendar: (row?.school_calendar ?? {}) as SchoolCalendar,
        available: row?.attendance_cutoff != null || row?.school_calendar != null,
      };
    },
  });
  const cutoff = settings.data?.cutoff ?? DEFAULT_CUTOFF;
  const calendar = settings.data?.calendar ?? {};

  const marks = useQuery({
    queryKey: ["attendance", "events", org.id, branchId, from, to, cutoff],
    enabled: from <= to,
    queryFn: async () => {
      const start = `${from}T00:00:00+01:00`;
      const end = `${shift(to, 1)}T00:00:00+01:00`;
      const events: GateMarkEvent[] = [];
      for (let i = 0; ; i += PAGE) {
        const { data, error } = await inBranch(
          supabase
            .from("gate_logs")
            .select("member_id, action_type, timestamp")
            .eq("org_id", org.id)
            .gte("timestamp", start)
            .lt("timestamp", end)
            .order("timestamp")
            .order("id"),
          branchId,
        ).range(i, i + PAGE - 1);
        if (error) throw error;
        events.push(...((data ?? []) as GateMarkEvent[]));
        if (!data || data.length < PAGE) break;
      }
      const { data: busLogs } = await supabase
        .from("pupil_bus_logs")
        .select("member_id, timestamp")
        .eq("org_id", org.id)
        .eq("status", "boarded")
        .gte("timestamp", start)
        .lt("timestamp", end);
      const byMember = new Map<string, Set<string>>();
      for (const log of busLogs ?? []) {
        const set = byMember.get(log.member_id) ?? new Set<string>();
        set.add(schoolDate(new Date(log.timestamp)));
        byMember.set(log.member_id, set);
      }
      return marksFromEvents(
        events,
        [...byMember].map(([member_id, dayset]) => ({ member_id, bus_days: [...dayset] })),
        cutoff,
      );
    },
  });

  const days = useMemo(
    () => (from <= to ? schoolDays(from, to, today, { ...calendar, cutoff }) : []),
    [from, to, today, calendar, cutoff],
  );
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

  /** One Excel workbook, for every visible class, or for a single class. */
  async function download(onlyClass?: string | null) {
    if (!exportOpen) return;
    setBusy(true);
    try {
      const { attendanceSheets, downloadAttendanceWorkbook } =
        await import("@/lib/attendance-excel");
      const classes = onlyClass
        ? visible.filter((c) => keyOf(c.label) === onlyClass)
        : visible;
      if (!classes.length) {
        toast.error("Nothing to download for this class yet.");
        setBusy(false);
        return;
      }
      const sheets = attendanceSheets({
        orgName: branch ? `${org.name}, ${branch.name}` : org.name,
        from,
        to,
        days,
        classes,
      });
      const slug = org.name.replace(/\W+/g, "-").toLowerCase();
      const filter = onlyClass
        ? `-${(classes[0]?.label ?? "class").replace(/\W+/g, "-").toLowerCase()}`
        : classFilter === "all"
          ? ""
          : `-${classFilter.replace(/\W+/g, "-").toLowerCase()}`;
      await downloadAttendanceWorkbook(sheets, `attendance-${slug}${filter}-${from}-to-${to}.xlsx`);
      toast.success(onlyClass ? "Class workbook downloaded" : "Workbook downloaded");
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
              onClick={() => void download()}
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

      {can(!!me?.isAdmin, "export_reports") && (
        <AttendanceSettings org={org} cutoff={cutoff} calendar={calendar} available={settings.data?.available ?? false} />
      )}

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
          hint="Your school calendar"
        />
        <Stat
          icon={Users}
          label="Average attendance"
          value={rate === null ? "-" : `${rate}%`}
          hint={`${students.length} students`}
        />
        <Stat
          icon={Bus}
          label="Present today"
          value={presentToday === null ? "-" : `${presentToday} / ${students.length}`}
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
                <div className="flex items-center gap-2">
                  {canDownload && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !days.length || !exportOpen || !c.students.length}
                      onClick={() => void download(keyOf(c.label))}
                      aria-label={`Download ${c.label ?? "this class"} attendance`}
                    >
                      <Download className="size-4" /> Excel
                    </Button>
                  )}
                  <span className="font-display text-xl font-bold">
                    {c.rate === null ? "-" : `${c.rate}%`}
                  </span>
                </div>
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
                        {s.rate === null ? "-" : `${s.rate}%`}
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

/**
 * The two things a school decides for attendance: which days it is open, and
 * the time of day a pupil's presence is confirmed.
 */
function AttendanceSettings({
  org,
  cutoff,
  calendar,
  available,
}: {
  org: { id: string; classes: string[] };
  cutoff: string;
  calendar: SchoolCalendar;
  available: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(cutoff);
  const [weekdays, setWeekdays] = useState<number[]>(
    calendar.weekdays?.length ? calendar.weekdays : [1, 2, 3, 4, 5],
  );
  const [holidays, setHolidays] = useState((calendar.holidays ?? []).join(", "));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({
          attendance_cutoff: time,
          // Keep every other setting already in this block (the parent app
          // reads its call switches from here) instead of replacing it whole.
          school_calendar: {
            ...calendar,
            weekdays,
            holidays: holidays
              .split(",")
              .map((d) => d.trim())
              .filter(Boolean),
          },
        } as never)
        .eq("id", org.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Attendance settings saved");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: () =>
      toast.error("This needs the one-time attendance setup. Please ask us to switch it on."),
  });

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <Clock className="size-4" /> Attendance is taken at {cutoff}
          </p>
          <p className="text-sm text-muted-foreground">
            A pupil who goes home before {cutoff} is marked absent · {daysLabel(weekdays)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Change"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="att-cutoff">Time attendance is taken</Label>
            <Input
              id="att-cutoff"
              type="time"
              value={time}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className="sm:w-40"
            />
          </div>
          <div className="space-y-2">
            <Label>School days</Label>
            <div className="flex flex-wrap gap-2">
              {names.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setWeekdays((w) =>
                      w.includes(day) ? w.filter((d) => d !== day) : [...w, day].sort(),
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium",
                    weekdays.includes(day)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-holidays">Holidays</Label>
            <Input
              id="att-holidays"
              value={holidays}
              onChange={(e) => setHolidays(e.target.value)}
              placeholder="2026-12-25, 2026-12-26"
            />
            <p className="text-xs text-muted-foreground">
              Dates the school is closed, as yyyy-mm-dd, separated by commas.
            </p>
          </div>
          {!available && (
            <p className="rounded-xl bg-signal/15 p-3 text-sm">
              One-time setup is still needed before these settings can be saved. Until then
              attendance uses Monday to Friday and {DEFAULT_CUTOFF}.
            </p>
          )}
          <Button variant="signal" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save attendance settings
          </Button>
        </div>
      )}
    </section>
  );
}

function daysLabel(weekdays: number[]): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (!weekdays.length) return "No school days chosen";
  if (weekdays.length === 1) return `Every ${names[weekdays[0]!]}`;
  return weekdays.map((d) => names[d]).join(" · ");
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
