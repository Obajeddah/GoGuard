import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const email = z.string().trim().email("Enter a valid email").max(255);
const password = z.string().min(8, "Password must be at least 8 characters").max(72);
const phone = z.string().trim().max(30).optional().default("");

async function adminCtx(context: { supabase: any; userId: string; claims: unknown }) {
  const { requireAdmin, assertBranch } = await import("@/lib/staff-guard.server");
  const admin = await requireAdmin(context.supabase, context.userId, context.claims);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { admin, assertBranch, supabaseAdmin };
}

async function createAccount(
  sb: Admin,
  input: { email: string; password: string; full_name: string },
): Promise<string> {
  const { data: created, error } = await sb.auth.admin.createUser({
    email: input.email.toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error || !created.user) {
    throw new Error(
      error?.message?.includes("already")
        ? "An account with this email already exists."
        : "Could not create the account.",
    );
  }
  return created.user.id;
}

async function addStaff(
  sb: Admin,
  uid: string,
  row: {
    org_id: string;
    branch_id: string | null;
    full_name: string;
    email: string;
    phone: string | null;
  },
  role: "guard" | "admin" | "bus",
) {
  const { error: pErr } = await sb.from("profiles").insert({ id: uid, ...row });
  const { error: rErr } = pErr
    ? { error: pErr }
    : await sb.from("user_roles").insert({ user_id: uid, role });
  if (pErr || rErr) {
    await sb.auth.admin.deleteUser(uid);
    throw new Error("Could not set up the account.");
  }
}

/** Admin creates a gate guard for one branch. */
export const createGuard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        full_name: z.string().trim().min(1).max(120),
        email,
        password,
        phone,
        branch_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, assertBranch, supabaseAdmin } = await adminCtx(context);
    const { data: branch } = await supabaseAdmin
      .from("branches")
      .select("id, org_id")
      .eq("id", data.branch_id)
      .maybeSingle();
    assertBranch(admin, branch);
    const uid = await createAccount(supabaseAdmin, data);
    await addStaff(
      supabaseAdmin,
      uid,
      {
        org_id: admin.orgId,
        branch_id: data.branch_id,
        full_name: data.full_name,
        email: data.email.toLowerCase(),
        phone: data.phone || null,
      },
      "guard",
    );
    return { id: uid };
  });

/** HQ admin on Multi-Campus Group creates an administrator for one branch. */
export const createBranchAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        full_name: z.string().trim().min(1).max(120),
        email,
        password,
        phone,
        branch_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, assertBranch, supabaseAdmin } = await adminCtx(context);
    if (admin.branchId) throw new Error("Only headquarters can add branch administrators.");
    if (!admin.plan.multiBranch)
      throw new Error("Branch administrators need the Multi-Campus Group plan.");
    const { data: branch } = await supabaseAdmin
      .from("branches")
      .select("id, org_id")
      .eq("id", data.branch_id)
      .maybeSingle();
    assertBranch(admin, branch);
    const uid = await createAccount(supabaseAdmin, data);
    await addStaff(
      supabaseAdmin,
      uid,
      {
        org_id: admin.orgId,
        branch_id: data.branch_id,
        full_name: data.full_name,
        email: data.email.toLowerCase(),
        phone: data.phone || null,
      },
      "admin",
    );
    return { id: uid };
  });

/** Removes a guard or branch administrator. Headquarters admins and bus logins can't be removed here. */
export const removeGuard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, supabaseAdmin } = await adminCtx(context);
    if (data.userId === context.userId) throw new Error("You can't remove yourself.");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("org_id, branch_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile || profile.org_id !== admin.orgId) throw new Error("Staff member not found.");
    if (admin.branchId && profile.branch_id !== admin.branchId)
      throw new Error("You can only manage your own branch.");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (roles?.some((r) => r.role === "bus")) throw new Error("Bus logins are managed in Fleet.");
    if (roles?.some((r) => r.role === "admin") && (profile.branch_id === null || admin.branchId))
      throw new Error("This administrator can't be removed here.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("Could not remove this account.");
    return { ok: true };
  });

/** Approve or decline a guard who signed up through a branch invite link. */
export const decideGuardRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, assertBranch, supabaseAdmin } = await adminCtx(context);
    const { data: req } = await supabaseAdmin
      .from("staff_requests")
      .select("id, org_id, branch_id, user_id, full_name, phone, email, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!req || req.status !== "pending") throw new Error("This request was already handled.");
    assertBranch(admin, { id: req.branch_id, org_id: req.org_id });
    if (data.approve) {
      await addStaff(
        supabaseAdmin,
        req.user_id,
        {
          org_id: req.org_id,
          branch_id: req.branch_id,
          full_name: req.full_name,
          email: req.email,
          phone: req.phone,
        },
        "guard",
      );
    } else {
      await supabaseAdmin.auth.admin.deleteUser(req.user_id);
    }
    await supabaseAdmin
      .from("staff_requests")
      .update({
        status: data.approve ? "approved" : "declined",
        decided_at: new Date().toISOString(),
        decided_by: context.userId,
      })
      .eq("id", req.id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Staff invite link (public): /onboard/guard?org=…&branch=…&code=…&role=admin
// The same link token, but a branch administrator is created with admin access
// instead of being sent through guard approval.
// ---------------------------------------------------------------------------
const inviteSchema = z.object({
  org: z.string().uuid(),
  branch: z.string().uuid(),
  code: z.string().regex(/^[a-f0-9]{64}$/i),
  role: z.enum(["guard", "admin"]).optional().default("guard"),
});

async function inviteBranch(sb: Admin, i: z.infer<typeof inviteSchema>) {
  const { data } = await sb
    .from("branches")
    .select("id, org_id, name, guard_invite_token, organization:organizations(name)")
    .eq("id", i.branch)
    .maybeSingle();
  if (!data || data.org_id !== i.org || data.guard_invite_token !== i.code.toLowerCase())
    return null;
  return data;
}

export const getGuardInvite = createServerFn({ method: "GET" })
  .validator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const b = await inviteBranch(supabaseAdmin, data);
    if (!b) return null;
    const { count } = await supabaseAdmin
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("org_id", b.org_id);
    return {
      orgName: b.organization?.name ?? "",
      branchName: (count ?? 1) > 1 ? b.name : null,
      role: data.role,
    };
  });

export const submitGuardInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    inviteSchema
      .extend({
        full_name: z.string().trim().min(2, "Enter your full name").max(120),
        phone: z.string().trim().min(7, "Enter your phone number").max(30),
        email,
        password,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const b = await inviteBranch(supabaseAdmin, data);
    if (!b) throw new Error("This invite link is no longer active. Ask the school for a new one.");

    // Administrator invite: the link is only shared by headquarters, so the
    // account is created with admin access straight away, no guard approval.
    if (data.role === "admin") {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("plan, trial_ends_at, paid_until")
        .eq("id", b.org_id)
        .maybeSingle();
      const { billingState } = await import("@/lib/billing");
      if (!org || !billingState(org).multiBranch)
        throw new Error(
          "Administrator invites need the Multi-Campus Group plan. Ask the school office.",
        );
      const adminUid = await createAccount(supabaseAdmin, data);
      await addStaff(
        supabaseAdmin,
        adminUid,
        {
          org_id: b.org_id,
          branch_id: b.id,
          full_name: data.full_name,
          email: data.email.toLowerCase(),
          phone: data.phone,
        },
        "admin",
      );
      return { ok: true, admin: true };
    }

    const uid = await createAccount(supabaseAdmin, data);
    const { error } = await supabaseAdmin.from("staff_requests").insert({
      org_id: b.org_id,
      branch_id: b.id,
      user_id: uid,
      full_name: data.full_name,
      phone: data.phone,
      email: data.email.toLowerCase(),
    });
    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error("Couldn't send your request. Please try again.");
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Bus logins: one per bus; its device is the bus's only location source.
// ---------------------------------------------------------------------------
async function busFor(sb: Admin, busId: string) {
  const { data } = await sb
    .from("buses")
    .select("id, org_id, branch_id, bus_number, login_user_id, login_email, login_active")
    .eq("id", busId)
    .maybeSingle();
  return data;
}

async function fleetAdmin(
  context: { supabase: any; userId: string; claims: unknown },
  busId: string,
) {
  const ctx = await adminCtx(context);
  if (!ctx.admin.plan.transportActive)
    throw new Error("Buses need the Campus Standard or Multi-Campus Group plan.");
  const bus = await busFor(ctx.supabaseAdmin, busId);
  if (!bus || bus.org_id !== ctx.admin.orgId) throw new Error("Bus not found.");
  if (ctx.admin.branchId && bus.branch_id !== ctx.admin.branchId)
    throw new Error("You can only manage your own branch.");
  return { ...ctx, bus };
}

export const createBusLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ busId: z.string().uuid(), email, password }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, bus } = await fleetAdmin(context, data.busId);
    if (bus.login_user_id)
      throw new Error("This bus already has a login. Change its password instead.");
    const name = `Bus ${bus.bus_number}`;
    const uid = await createAccount(supabaseAdmin, {
      email: data.email,
      password: data.password,
      full_name: name,
    });
    await addStaff(
      supabaseAdmin,
      uid,
      {
        org_id: bus.org_id,
        branch_id: bus.branch_id,
        full_name: name,
        email: data.email.toLowerCase(),
        phone: null,
      },
      "bus",
    );
    const { error } = await supabaseAdmin
      .from("buses")
      .update({ login_user_id: uid, login_email: data.email.toLowerCase(), login_active: true })
      .eq("id", bus.id);
    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error("Could not link the login to this bus.");
    }
    return { ok: true };
  });

export const setBusLoginPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ busId: z.string().uuid(), password }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, bus } = await fleetAdmin(context, data.busId);
    if (!bus.login_user_id) throw new Error("This bus has no login yet.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(bus.login_user_id, {
      password: data.password,
    });
    if (error) throw new Error("Could not change the password.");
    return { ok: true };
  });

/** Switch a bus login off (blocks sign-in and every bus action at once) or back on. */
export const setBusLoginActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ busId: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, bus } = await fleetAdmin(context, data.busId);
    if (!bus.login_user_id) throw new Error("This bus has no login yet.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(bus.login_user_id, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (error) throw new Error("Could not update this login.");
    await supabaseAdmin.from("buses").update({ login_active: data.active }).eq("id", bus.id);
    return { ok: true };
  });
