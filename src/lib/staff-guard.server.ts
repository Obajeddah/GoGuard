// Server-only: load with `await import()` inside server function handlers.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { billingState } from "@/lib/billing";

export interface AdminContext {
  orgId: string;
  /** null = headquarters admin (every branch). */
  branchId: string | null;
  plan: ReturnType<typeof billingState>;
}

/**
 * Verifies the caller is an administrator who finished two-step sign-in, and
 * returns their school, branch and plan. Use before any privileged write.
 */
export async function requireAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  claims: unknown,
): Promise<AdminContext> {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Only your school's administrator can do this.");
  if ((claims as { aal?: string }).aal !== "aal2") throw new Error("Finish two-step sign-in first.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, branch_id, organization:organizations(plan, trial_ends_at, paid_until)")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.org_id || !profile.organization) throw new Error("No school found for this account.");
  return {
    orgId: profile.org_id,
    branchId: profile.branch_id,
    plan: billingState(profile.organization as { plan: string; trial_ends_at: string; paid_until: string | null }),
  };
}

/** The admin may manage this branch: HQ manages all branches of the school, branch admins only their own. */
export function assertBranch(admin: AdminContext, branch: { id: string; org_id: string } | null) {
  if (!branch || branch.org_id !== admin.orgId) throw new Error("Branch not found.");
  if (admin.branchId && admin.branchId !== branch.id) throw new Error("You can only manage your own branch.");
}
