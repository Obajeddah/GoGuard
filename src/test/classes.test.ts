import { describe, expect, it } from "vitest";

import {
  classGroups,
  findDuplicates,
  isAllowedClass,
  nameKey,
  normaliseClasses,
} from "@/lib/classes";

const m = (
  id: string,
  full_name: string,
  primary_email: string,
  identifier_code: string | null = null,
) => ({
  id,
  full_name,
  primary_email,
  identifier_code,
});

describe("Possible duplicate students", () => {
  it("flags the same child name registered twice", () => {
    const d = findDuplicates([
      m("1", "Ada Obi", "a@x.com"),
      m("2", "Ada Obi", "a@x.com"),
      m("3", "Tobi Ade", "t@x.com"),
    ]);
    expect(d.get("1")?.others).toEqual(["2"]);
    expect(d.get("2")?.others).toEqual(["1"]);
    expect(d.has("3")).toBe(false);
  });
  it("ignores case, extra spaces and word order", () => {
    expect(nameKey("  ada   OBI ")).toBe(nameKey("Obi Ada"));
  });
  it("marks duplicates registered by different parents", () => {
    const d = findDuplicates([m("1", "Ada Obi", "mum@x.com"), m("2", "Ada Obi", "stranger@y.com")]);
    expect(d.get("1")?.differentParents).toBe(true);
  });
  it("does not mark same-parent duplicates as from different parents", () => {
    const d = findDuplicates([m("1", "Ada Obi", "Mum@x.com"), m("2", "Ada Obi", "mum@x.com")]);
    expect(d.get("1")?.differentParents).toBe(false);
  });
});

describe("School classes", () => {
  it("only accepts a class the school ticked", () => {
    expect(isAllowedClass(["Primary 1", "Primary 2"], "Primary 3")).toBe(false);
    expect(isAllowedClass(["Primary 1", "Primary 2"], "primary 2")).toBe(true);
  });
  it("accepts any class when the school hasn't set its classes", () => {
    expect(isAllowedClass([], "Year 3B")).toBe(true);
  });
  it("keeps preset classes in school order and removes repeats", () => {
    expect(normaliseClasses(["JSS 1", "Primary 1", "primary 1", "Primary 3A"])).toEqual([
      "Primary 1",
      "JSS 1",
      "Primary 3A",
    ]);
  });
  it("groups students under the school's class order, with no-class last", () => {
    const groups = classGroups(
      [
        m("1", "A", "a", "Primary 2"),
        m("2", "B", "b", "Primary 1"),
        m("3", "C", "c", null),
        m("4", "D", "d", "primary 1"),
      ],
      ["Primary 1", "Primary 2"],
    );
    expect(groups.map((g) => [g.label, g.members.length])).toEqual([
      ["Primary 1", 2],
      ["Primary 2", 1],
      [null, 1],
    ]);
  });
});
