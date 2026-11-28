import { describe, expect, it } from "vitest";

import {
  attendanceByClass,
  marksFromEvents,
  schoolDate,
  schoolDays,
  studentAttendance,
} from "@/lib/attendance";
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
    expect(schoolDays("2026-11-02", "2026-11-30", "2026-11-03")).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
  });
  it("uses the Lagos date, so a 23:30 UTC scan counts for the next day", () => {
    expect(schoolDate(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
  });
});

describe("Automatic attendance", () => {
  const rows = studentAttendance(
    members,
    [
      {
        member_id: "a",
        gate_days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
        bus_days: [],
      },
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

describe("The school's own calendar", () => {
  it("skips holidays and respects chosen weekdays", () => {
    expect(
      schoolDays("2026-11-02", "2026-11-08", "2026-11-30", {
        weekdays: [1, 2, 3, 4, 5, 6],
        holidays: ["2026-11-04"],
      }),
    ).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });
});

describe("Attendance cut-off", () => {
  const day = (h: number, m = 0) =>
    `2026-11-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+01:00`;

  it("counts a pupil still in school at the cut-off", () => {
    const marks = marksFromEvents(
      [
        { member_id: "a", action_type: "check_in", timestamp: day(7, 40) },
        { member_id: "a", action_type: "check_out", timestamp: day(15) },
      ],
      [],
      "10:00",
    );
    expect(marks[0]?.gate_days).toEqual(["2026-11-02"]);
  });

  it("marks absent a pupil sent home before the cut-off", () => {
    const marks = marksFromEvents(
      [
        { member_id: "b", action_type: "check_in", timestamp: day(7, 45) },
        { member_id: "b", action_type: "check_out", timestamp: day(9, 30) },
      ],
      [],
      "10:00",
    );
    expect(marks).toEqual([]);
  });

  it("counts them again when they come back after the cut-off", () => {
    const marks = marksFromEvents(
      [
        { member_id: "c", action_type: "check_in", timestamp: day(7, 45) },
        { member_id: "c", action_type: "check_out", timestamp: day(9, 30) },
        { member_id: "c", action_type: "check_in", timestamp: day(11) },
      ],
      [],
      "10:00",
    );
    expect(marks[0]?.gate_days).toEqual(["2026-11-02"]);
  });

  it("counts a bus pupil even with no gate scan", () => {
    const marks = marksFromEvents([], [{ member_id: "d", bus_days: ["2026-11-02"] }], "10:00");
    expect(marks[0]).toEqual({
      member_id: "d",
      gate_days: [],
      bus_days: ["2026-11-02"],
    });
  });
});
