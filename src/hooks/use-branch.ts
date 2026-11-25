import { useSyncExternalStore } from "react";

import { accessOf, useMe } from "@/hooks/use-me";
import { can } from "@/lib/access";

/**
 * Which branch the signed-in user is looking at. Branch staff are locked to their
 * own branch; headquarters admins on Multi-Campus Group pick one from the header
 * switcher or see "All branches" (null). The database enforces the same scoping.
 */
const KEY = "gatepass.branch";
const listeners = new Set<() => void>();

function read(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY) || null;
}

export function setSelectedBranch(id: string | null) {
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useBranch() {
  const { data: me } = useMe();
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const access = accessOf(me);
  const branches = me?.branches ?? [];
  const canSwitch = can(access, "switch_branch") && branches.length > 1;
  // Locked staff always see their branch; HQ sees the chosen one (if it still exists) or all.
  const branchId =
    me?.branchId ?? (canSwitch && branches.some((b) => b.id === stored) ? stored : null);
  const branch = branches.find((b) => b.id === branchId) ?? null;
  return {
    /** null = all branches the user can see. */
    branchId,
    branch,
    branches,
    canSwitch,
    /** More than one branch exists, so branch names are worth showing. */
    multi: branches.length > 1,
    nameOf: (id: string | null | undefined) => branches.find((b) => b.id === id)?.name ?? "",
  };
}

/** Narrow a query to the selected branch (no-op for "All branches"). */
export function inBranch<Q extends { eq: (col: string, v: string) => Q }>(
  q: Q,
  branchId: string | null,
): Q {
  return branchId ? q.eq("branch_id", branchId) : q;
}
