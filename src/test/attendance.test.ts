import { describe, expect, it } from "vitest";

import { attendanceByClass, schoolDate, schoolDays, studentAttendance } from "@/lib/attendance";
import { attendanceSheets } from "@/lib/attendance-excel";

const members = [
  { id: "a", full_name: "Ada Obi", identifier_code: "Primary 1" },
  { id: "b", full_name: "Bolu Ade", identifier_code: "Primary 1" },
  { id: "c", full_name: "Chidi Eze", identifier_code: "Primary 2" },
];
// Mon 2 Nov – Fri 6 Nov 2026
const week = schoolDays("2026-11-02", "2026-11-08", "2026-11-30");

describe("School days", () => {
  it("counts Monday to Friday only", () => {
    expect(week).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });
  it("never counts days that haven't happened yet", () => {
    expect(schoolDays("2026-11-02", "2026-11-30", "2026-11-03")).toEqual(["2026-11-02", "2026-11-03"]);
  });
  it("uses the Lagos date, so a 23:30 UTC scan counts for the next day", () => {
    expect(schoolDate(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
  });
});

describe("Automatic attendance", () => {
  const rows = studentAttendance(
    members,
    [
      { member_id: "a", gate_days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], bus_days: [] },
      { member_id: "b", gate_days: ["2026-11-02"], bus_days: ["2026-11-03"] },
    ],
    week,
  );
  it("marks a student present when seen at the gate", () => {
    expect(rows[0]!.present).toBe(5);
    expect(rows[0]!.rate).toBe(100);
  });
  it("marks a student present when seen on the school bus", () => {
    expect(rows[1]!.marks["2026-11-03"]).toBe("bus");
    expect(rows[1]!.present).toBe(2);
    expect(rows[1]!.byBus).toBe(1);
    expect(rows[1]!.absent).toBe(3);
  });
  it("marks a student absent on days with no gate or bus record", () => {
    expect(rows[2]!.present).toBe(0);
    expect(rows[2]!.rate).toBe(0);
  });
  it("lists every class the school ticked, even with no students", () => {
    const groups = attendanceByClass(rows, ["Primary 1", "Primary 2", "Primary 3"]);
    expect(groups.map((g) => g.label)).toEqual(["Primary 1", "Primary 2", "Primary 3"]);
    expect(groups[2]!.students).toEqual([]);
    expect(groups[0]!.rate).toBe(70);
  });
  it("exports only the classes passed to the workbook", () => {
    const groups = attendanceByClass(rows, ["Primary 1", "Primary 2"]);
    const sheets = attendanceSheets({
      orgName: "Greenfield Academy",
      from: "2026-11-02",
      to: "2026-11-06",
      days: week,
      classes: [groups[0]!],
    });
    expect(sheets.map((s) => s.sheet)).toEqual(["Summary", "Primary 1"]);
  });
});
