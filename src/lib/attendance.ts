/**
 * Automatic attendance. A student counts as present on a school day when they
 * were seen at the gate (check-in or check-out) or on a school bus that day.
 * Nobody marks a register by hand.
 */
import { classGroups } from "@/lib/classes";

export const SCHOOL_TIME_ZONE = "Africa/Lagos";

/** The moment attendance is decided, local time. */
export const DEFAULT_CUTOFF = "10:00";

/**
 * A school's own week. Weekdays use JavaScript numbering (0 = Sunday), and a
 * holiday is never a school day even when it falls on a weekday.
 */
export interface SchoolCalendar {
  weekdays?: number[] | undefined;
  holidays?: string[] | undefined;
  cutoff?: string | undefined;
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * School dates from `from` to `to` (inclusive), never past `today`. Defaults to
 * Monday–Friday; a school can choose its own days and block out holidays.
 */
export function schoolDays(
  from: string,
  to: string,
  today: string,
  calendar?: SchoolCalendar,
): string[] {
  const end = to < today ? to : today;
  const weekdays = calendar?.weekdays?.length ? calendar.weekdays : DEFAULT_WEEKDAYS;
  const holidays = new Set(calendar?.holidays ?? []);
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < 400; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    if (weekdays.includes(d.getUTCDay()) && !holidays.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Local clock time (HH:MM) of a timestamp, in the school's time zone. */
export function schoolTime(value: string | Date, tz: string = SCHOOL_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export interface GateMarkEvent {
  member_id: string;
  action_type: "check_in" | "check_out";
  timestamp: string;
}

/**
 * Presence from real gate events, decided at the school's cut-off time.
 *
 * A pupil who came in and then went home before the cut-off (for school fees,
 * a clinic visit, anything) was not in school for the day and is marked absent.
 * A pupil still in school at the cut-off, or who arrived later and stayed, has
 * their day counted the moment they pass the cut-off.
 */
export function marksFromEvents(
  events: GateMarkEvent[],
  busMarks: { member_id: string; bus_days: string[] }[],
  cutoff: string = DEFAULT_CUTOFF,
): AttendanceMarks[] {
  // Group one pupil's day, so a check-out can be read against the check-in it ends.
  const days = new Map<string, GateMarkEvent[]>();
  for (const event of events) {
    const key = `${event.member_id}|${schoolDate(new Date(event.timestamp))}`;
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  const gate = new Map<string, Set<string>>();
  for (const [key, list] of days) {
    const [memberId, day] = key.split("|") as [string, string];
    const sorted = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const counts = sorted.some((checkIn) => {
      if (checkIn.action_type !== "check_in") return false;
      // A check-in counts for the day unless the pupil left again before the
      // cut-off and never came back (sent home for fees, for instance).
      const leftBeforeCutoff = sorted.some(
        (e) =>
          e.action_type === "check_out" &&
          e.timestamp > checkIn.timestamp &&
          schoolTime(e.timestamp) < cutoff,
      );
      const cameBack = sorted.some(
        (e) => e.action_type === "check_in" && e.timestamp > checkIn.timestamp,
      );
      return !leftBeforeCutoff || cameBack;
    });
    if (!counts) continue;
    const set = gate.get(memberId) ?? new Set<string>();
    set.add(day);
    gate.set(memberId, set);
  }
  const bus = new Map(busMarks.map((m) => [m.member_id, new Set(m.bus_days)]));
  const ids = new Set([...gate.keys(), ...bus.keys()]);
  return [...ids].map((id) => ({
    member_id: id,
    gate_days: [...(gate.get(id) ?? [])].sort(),
    bus_days: [...(bus.get(id) ?? [])].sort(),
  }));
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
export function attendanceByClass(
  students: StudentAttendance[],
  schoolClasses: string[],
): ClassAttendance[] {
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
