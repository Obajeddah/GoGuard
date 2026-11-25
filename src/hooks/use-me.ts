import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { billingState } from "@/lib/billing";
import type { OrgType } from "@/lib/org-terms";

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  is_main: boolean;
  registration_token: string;
  guard_invite_token: string;
}

export interface Me {
  userId: string;
  email: string;
  fullName: string;
  org: {
    id: string;
    name: string;
    type: OrgType;
    admin_email: string;
    emergency_phone: string | null;
    trial_ends_at: string;
    paid_until: string | null;
    plan: string;
    classes: string[];
  } | null;
  /** The user's own branch; null for headquarters accounts (all branches). */
  branchId: string | null;
  /** Branches this user can see (all of them for headquarters). */
  branches: Branch[];
  isAdmin: boolean;
  isGuard: boolean;
  /** A bus login. */
  isBus: boolean;
  /** Has a pending guard request waiting for the school's approval. */
  pendingRequest: { full_name: string; status: string } | null;
}

export const meQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const [{ data: profile }, { data: roles }, { data: branches }, { data: request }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select(
            "full_name, branch_id, organization:organizations(id, name, type, admin_email, emergency_phone, trial_ends_at, paid_until, plan, classes)",
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase
          .from("branches")
          .select("id, name, address, is_main, registration_token, guard_invite_token")
          .order("is_main", { ascending: false })
          .order("name"),
        supabase
          .from("staff_requests")
          .select("full_name, status")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
    return {
      userId: user.id,
      email: user.email ?? "",
      fullName: profile?.full_name ?? "",
      org: (profile?.organization as Me["org"]) ?? null,
      branchId: profile?.branch_id ?? null,
      branches: (branches ?? []) as Branch[],
      isAdmin: !!roles?.some((r) => r.role === "admin"),
      isGuard: !!roles?.some((r) => r.role === "guard"),
      isBus: !!roles?.some((r) => r.role === "bus"),
      pendingRequest: request ?? null,
    };
  },
  staleTime: 60_000,
});

/** The permission flags `src/lib/access.ts` needs, read from the signed-in user. */
export function accessOf(me: Me | null | undefined) {
  const state = me?.org ? billingState(me.org) : null;
  return {
    isAdmin: !!me?.isAdmin,
    isGuard: !!me?.isGuard,
    isBus: !!me?.isBus,
    isHq: !!me && me.branchId === null,
    transport: !!state?.transportActive,
    multiBranch: !!state?.multiBranch,
  };
}

export function useMe() {
  return useQuery(meQueryOptions);
}
