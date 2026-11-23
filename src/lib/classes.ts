// Classes a school offers, grouping students by class, and spotting possible duplicate registrations.

/** Common Nigerian school classes a school can tick. Schools can add their own too (e.g. "Primary 3A"). */
export const PRESET_CLASSES = [
  "Creche",
  "Pre-Nursery",
  "Nursery 1",
  "Nursery 2",
  "Nursery 3",
  "Primary 1",
  "Primary 2",
  "Primary 3",
  "Primary 4",
  "Primary 5",
  "Primary 6",
  "JSS 1",
  "JSS 2",
  "JSS 3",
  "SS 1",
  "SS 2",
  "SS 3",
] as const;

export const MAX_CLASSES = 80;

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/** Cleans a class list: trims, drops blanks and case-insensitive repeats, keeps presets in school order. */
export function normaliseClasses(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const c = tidy(raw).slice(0, 40);
    const k = c.toLowerCase();
    if (!c || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  const presetIndex = (c: string) => PRESET_CLASSES.findIndex((p) => p.toLowerCase() === c.toLowerCase());
  const presets = out.filter((c) => presetIndex(c) >= 0).sort((a, b) => presetIndex(a) - presetIndex(b));
  const custom = out.filter((c) => presetIndex(c) < 0);
  return [...presets, ...custom].slice(0, MAX_CLASSES);
}

/** True when a parent's chosen class is allowed. Schools that haven't set classes accept any value. */
export function isAllowedClass(schoolClasses: string[], chosen: string): boolean {
  if (schoolClasses.length === 0) return true;
  const c = tidy(chosen).toLowerCase();
  return schoolClasses.some((s) => s.toLowerCase() === c);
}

/**
 * Name key used to compare registrations: case, spacing, punctuation and word order
 * are ignored, so "Ada  Obi", "obi ada" and "Ada-Obi" count as the same child.
 */
export function nameKey(fullName: string): string {
  return fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

export interface DuplicateInfo {
  /** Other registrations with the same name. */
  others: string[];
  /** The matching registrations were made from different parent emails. */
  differentParents: boolean;
}

export function findDuplicates<T extends { id: string; full_name: string; primary_email: string }>(
  members: T[],
): Map<string, DuplicateInfo> {
  const groups = new Map<string, T[]>();
  for (const m of members) {
    const k = nameKey(m.full_name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const result = new Map<string, DuplicateInfo>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const emails = new Set(list.map((m) => m.primary_email.trim().toLowerCase()));
    for (const m of list) {
      result.set(m.id, {
        others: list.filter((o) => o.id !== m.id).map((o) => o.id),
        differentParents: emails.size > 1,
      });
    }
  }
  return result;
}

/** Class headings in display order: the school's own order, then any older free-typed classes, then none. */
export function classGroups<T extends { identifier_code: string | null }>(
  members: T[],
  schoolClasses: string[],
): { label: string | null; members: T[] }[] {
  const byClass = new Map<string, { label: string; members: T[] }>();
  const none: T[] = [];
  for (const m of members) {
    const c = m.identifier_code ? tidy(m.identifier_code) : "";
    if (!c) {
      none.push(m);
      continue;
    }
    const k = c.toLowerCase();
    const entry = byClass.get(k) ?? { label: schoolClasses.find((s) => s.toLowerCase() === k) ?? c, members: [] };
    entry.members.push(m);
    byClass.set(k, entry);
  }
  const ordered: { label: string | null; members: T[] }[] = [];
  for (const s of schoolClasses) {
    const e = byClass.get(s.toLowerCase());
    if (e) {
      ordered.push(e);
      byClass.delete(s.toLowerCase());
    }
  }
  const rest = [...byClass.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  ordered.push(...rest);
  if (none.length) ordered.push({ label: null, members: none });
  return ordered;
}
