/**
 * What each role may do in the signed-in app. Database policies enforce the
 * same rules; this module only decides what the interface offers.
 */
export type AppPage =
  | "/dashboard"
  | "/members"
  | "/scanner"
  | "/reports"
  | "/attendance"
  | "/fleet"
  | "/team"
  | "/settings";

export type AdminAction =
  | "manage_members"
  | "manage_staff"
  | "manage_registration_link"
  | "edit_org_profile"
  | "export_reports"
  | "view_passes"
  | "manage_fleet"
  | "manage_branches"
  | "switch_branch";

export interface AccessInput {
  isAdmin: boolean;
  isGuard?: boolean;
  /** A bus login (the only account that operates a bus and sends its location). */
  isBus?: boolean;
  /** Headquarters account: not tied to one branch. */
  isHq?: boolean;
  /** Campus Standard or Multi-Campus Group is paid and active. */
  transport?: boolean;
  /** Multi-Campus Group is paid and active. */
  multiBranch?: boolean;
}

const GATE_PAGES: AppPage[] = ["/dashboard", "/members", "/scanner", "/reports", "/attendance"];

/** Pages in the main app a signed-in user can open. */
export function pagesFor(a: AccessInput): AppPage[] {
  if (a.isAdmin) return [...GATE_PAGES, ...(a.transport ? (["/fleet"] as AppPage[]) : []), "/team", "/settings"];
  if (a.isGuard) return GATE_PAGES;
  return [];
}

/** Bus logins use the bus app; admins may open it to watch a bus (they never send location). */
export function canOpenBusApp(a: AccessInput): boolean {
  return !!a.transport && (!!a.isBus || a.isAdmin);
}

/** Only a bus login's device reports where the bus is. */
export function sendsBusLocation(a: AccessInput): boolean {
  return !!a.isBus && !a.isAdmin;
}

/** Where a user lands after signing in. */
export function homeFor(a: AccessInput): "/dashboard" | "/bus-app" | "/gate-scanner" {
  if (a.isAdmin) return "/dashboard";
  if (a.isBus) return "/bus-app";
  if (a.isGuard) return "/gate-scanner";
  return "/dashboard";
}

/** Only admins have admin powers; guards and bus logins have none. */
export function can(input: AccessInput | boolean, action: AdminAction): boolean {
  const a = typeof input === "boolean" ? { isAdmin: input } : input;
  if (!a.isAdmin) return false;
  if (action === "manage_fleet") return !!a.transport;
  if (action === "manage_branches" || action === "edit_org_profile") return a.isHq !== false;
  if (action === "switch_branch") return a.isHq !== false && !!a.multiBranch;
  return true;
}
