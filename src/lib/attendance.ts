/**
 * Automatic attendance. A student counts as present on a school day when they
 * were seen at the gate (check-in or check-out) or on a school bus that day.
 * Nobody marks a register by hand.
 */
import { classGroups } from "@/lib/classes";

export const SCHOOL_TIME_ZONE = "Africa/Lagos";

/** How a student was seen on a day. Bus wins when both happened. */
export type Mark = "gate" | "bus" | "absent";

export interface AttendanceMarks {
  member_id: string;
  gate_days: string[];
  bus_days: string[];
}

export interface AttendanceMember {
  id: string;
  full_name: string;
  identifier_code: string | null;
}

export interface StudentAttendance {
  id: string;
  name: string;
  className: string | null;
  marks: Record<string, Mark>;
  present: number;
  byBus: number;
  absent: number;
  /** Whole percent, or null when the period has no school days yet. */
  rate: number | null;
}

export interface ClassAttendance {
  label: string | null;
  students: StudentAttendance[];
  /** Average of the students' rates, or null with no students / days. */
  rate: number | null;
}

/** Calendar date (yyyy-MM-dd) in the school's time zone. */
export function schoolDate(d: Date, tz: string = SCHOOL_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Monday–Friday dates from `from` to `to` (inclusive), never past `today`. */
export function schoolDays(from: string, to: string, today: string): string[] {
  const end = to < today ? to : today;
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < 400; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function studentAttendance(
  members: AttendanceMember[],
  marks: AttendanceMarks[],
  days: string[],
): StudentAttendance[] {
  const byMember = new Map(marks.map((m) => [m.member_id, m]));
  return members.map((m) => {
    const seen = byMember.get(m.id);
    const gate = new Set(seen?.gate_days ?? []);
    const bus = new Set(seen?.bus_days ?? []);
    const dayMarks: Record<string, Mark> = {};
    let present = 0;
    let byBus = 0;
    for (const day of days) {
      const mark: Mark = bus.has(day) ? "bus" : gate.has(day) ? "gate" : "absent";
      dayMarks[day] = mark;
      if (mark !== "absent") present++;
      if (mark === "bus") byBus++;
    }
    return {
      id: m.id,
      name: m.full_name,
      className: m.identifier_code?.trim() || null,
      marks: dayMarks,
      present,
      byBus,
      absent: days.length - present,
      rate: days.length ? Math.round((present / days.length) * 100) : null,
    };
  });
}

function average(rates: (number | null)[]): number | null {
  const r = rates.filter((x): x is number => x !== null);
  return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null;
}

/**
 * Students grouped by class in school order. Every class the school ticked is
 * listed, even with no students, so missing registrations stand out.
 */
export function attendanceByClass(students: StudentAttendance[], schoolClasses: string[]): ClassAttendance[] {
  const groups = classGroups(
    students.map((s) => ({ ...s, identifier_code: s.className })),
    schoolClasses,
  );
  const seen = new Set(groups.map((g) => g.label?.toLowerCase()));
  const out: ClassAttendance[] = groups.map((g) => {
    const list = [...g.members].sort((a, b) => a.name.localeCompare(b.name));
    return { label: g.label, students: list, rate: average(list.map((s) => s.rate)) };
  });
  for (const c of schoolClasses) {
    if (!seen.has(c.toLowerCase())) out.push({ label: c, students: [], rate: null });
  }
  const order = (label: string | null) => {
    if (label === null) return Number.MAX_SAFE_INTEGER;
    const i = schoolClasses.findIndex((c) => c.toLowerCase() === label.toLowerCase());
    return i === -1 ? schoolClasses.length : i;
  };
  return out.sort((a, b) => order(a.label) - order(b.label));
}

export function overallRate(students: StudentAttendance[]): number | null {
  return average(students.map((s) => s.rate));
}
