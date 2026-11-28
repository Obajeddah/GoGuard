import type { Sheet } from "write-excel-file/browser";

import type { ClassAttendance, Mark } from "@/lib/attendance";

const MARK_CELL: Record<Mark, { value: string; backgroundColor: string; color: string }> = {
  gate: { value: "P", backgroundColor: "#DCF2E3", color: "#14532D" },
  bus: { value: "B", backgroundColor: "#DCE8F7", color: "#1E3A5F" },
  absent: { value: "A", backgroundColor: "#FBE1DC", color: "#7F1D1D" },
};

const HEAD = { fontWeight: "bold", backgroundColor: "#1F3B2D", color: "#FFFFFF" } as const;

/** Excel sheet names: max 31 characters, no []:*?/\ and unique. */
function sheetNames(labels: string[]): string[] {
  const used = new Set<string>(["summary"]);
  return labels.map((l) => {
    const base = l.replace(/[[\]:*?/\\]/g, "-").slice(0, 28) || "Class";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const shortDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
};

/** A workbook with a summary sheet and one sheet per class. */
export function attendanceSheets(input: {
  orgName: string;
  from: string;
  to: string;
  days: string[];
  classes: ClassAttendance[];
}): Sheet<Blob>[] {
  const { orgName, from, to, days, classes } = input;
  const labels = classes.map((c) => c.label ?? "No class");
  const names = sheetNames(labels);

  const summary: Sheet<Blob> = {
    sheet: "Summary",
    columns: [{ width: 28 }, { width: 12 }, { width: 14 }, { width: 16 }],
    data: [
      [{ value: `${orgName} attendance`, fontWeight: "bold", fontSize: 14 }],
      [`${from} to ${to} · ${days.length} school days`],
      ["P = present (gate) · B = present (school bus) · A = absent"],
      [],
      [
        { value: "Class", ...HEAD },
        { value: "Students", ...HEAD },
        { value: "Days present", ...HEAD },
        { value: "Attendance %", ...HEAD },
      ],
      ...classes.map((c, i) => [
        labels[i],
        c.students.length,
        c.students.reduce((n, s) => n + s.present, 0),
        c.rate === null ? "-" : c.rate,
      ]),
    ],
  };

  const perClass: Sheet<Blob>[] = classes.map((c, i) => ({
    sheet: names[i] ?? `Class ${i + 1}`,
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
    columns: [
      { width: 28 },
      ...days.map(() => ({ width: 11 })),
      { width: 9 },
      { width: 9 },
      { width: 9 },
      { width: 13 },
    ],
    data: [
      [
        { value: "Student", ...HEAD },
        ...days.map((d) => ({ value: shortDay(d), ...HEAD, align: "center" as const })),
        { value: "Present", ...HEAD },
        { value: "By bus", ...HEAD },
        { value: "Absent", ...HEAD },
        { value: "Attendance %", ...HEAD },
      ],
      ...(c.students.length
        ? c.students.map((s) => [
            s.name,
            ...days.map((d) => ({
              ...MARK_CELL[s.marks[d] ?? "absent"],
              align: "center" as const,
            })),
            s.present,
            s.byBus,
            s.absent,
            s.rate === null ? "-" : s.rate,
          ])
        : [["No students registered in this class yet."]]),
    ],
  }));

  return [summary, ...perClass];
}

export async function downloadAttendanceWorkbook(sheets: Sheet<Blob>[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(sheets).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
