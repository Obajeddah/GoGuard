import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe, accessOf } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import {
  createGuard,
  createBranchAdmin,
  decideGuardRequest,
  removeGuard,
} from "@/lib/staff.functions";
import { Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GateStaff() {
  const { data: me } = useMe();
  const orgId = me?.org?.id;
  const queryClient = useQueryClient();
  const branch = useBranch();
  const create = useServerFn(createGuard);
  const createAdmin = useServerFn(createBranchAdmin);
  const decide = useServerFn(decideGuardRequest);
  const access = accessOf(me);
  const [role, setRole] = useState("guard");
  const [targetBranch, setTargetBranch] = useState("");
  const branchId = branch.branchId ?? targetBranch ?? null;
  const remove = useServerFn(removeGuard);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", phone: "" });

  const staffQuery = useQuery({
    queryKey: ["staff", orgId, branch.branchId],
    enabled: !!orgId,
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        inBranch(
          supabase
            .from("profiles")
            .select("id, branch_id, full_name, email, phone, created_at")
            .order("created_at"),
          branch.branchId,
        ),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      return (profiles ?? [])
        .map((p) => ({
          ...p,
          roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
        }))
        .filter((p) => p.roles.some((r) => r === "guard" || r === "admin"));
    },
  });

  const add = useMutation({
    mutationFn: () => {
      const target = branchId || (branch.branches.length === 1 ? branch.branches[0]?.id : null);
      if (!target) throw new Error("Select a branch before creating an account.");
      return (role === "admin" ? createAdmin : create)({ data: { ...form, branch_id: target } });
    },
    onSuccess: () => {
      toast.success(`Account created. Share the sign-in details with ${form.full_name}.`);
      setForm({ full_name: "", email: "", password: "", phone: "" });
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the account."),
  });

  const del = useMutation({
    mutationFn: (userId: string) => remove({ data: { userId } }),
    onSuccess: () => {
      toast.success("Access removed");
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove this account."),
  });

  const requests = useQuery({
    queryKey: ["guard-requests", orgId, branch.branchId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await inBranch(
        supabase
          .from("staff_requests")
          .select("id, full_name, email, branch_id")
          .eq("status", "pending")
          .order("created_at"),
        branch.branchId,
      );
      if (error) throw error;
      return data;
    },
  });
  const decision = useMutation({
    mutationFn: (input: { id: string; approve: boolean }) => decide({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      queryClient.invalidateQueries({ queryKey: ["guard-requests"] });
      toast.success("Request updated");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section id="gate-staff" className="min-w-0 scroll-mt-24">
        <h2 className="text-xl font-bold">School team</h2>
        <p className="text-muted-foreground">
          Create a sign-in for each guard. They use the same Sign in page, can view live activity
          and reports, and scan passes — but can't change any settings or records.
        </p>
        <ul className="mt-5 space-y-2">
          {staffQuery.isLoading && (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
          {staffQuery.data?.map((s) => {
            const isAdmin = s.roles.includes("admin");
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <ShieldCheck className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.full_name || s.email}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {isAdmin ? "Administrator" : "Gate staff"} · {s.email}
                  </p>
                </div>
                {s.id !== me?.userId && (!isAdmin || (access.isHq && !!s.branch_id)) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${s.full_name}`}
                    disabled={del.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${s.full_name}? They will no longer be able to sign in.`))
                        del.mutate(s.id);
                    }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {!!requests.data?.length && (
          <div className="mt-6 space-y-3">
            <h3 className="font-semibold">Guard requests</h3>
            {requests.data.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 border-b py-3">
                <div className="min-w-0 flex-1">
                  <p>{r.full_name}</p>
                  <p className="break-all text-sm text-muted-foreground">
                    {r.email} · {branch.nameOf(r.branch_id)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={decision.isPending}
                  onClick={() => decision.mutate({ id: r.id, approve: true })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decision.isPending}
                  onClick={() => decision.mutate({ id: r.id, approve: false })}
                >
                  Decline
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="h-fit rounded-3xl border bg-card p-5">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <UserPlus className="size-5" /> New gate staff account
        </h3>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          {access.isHq && access.multiBranch && (
            <Field label="Account type">
              <select
                aria-label="Account type"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="guard">Guard</option>
                <option value="admin">Branch administrator</option>
              </select>
            </Field>
          )}
          {!branch.branchId && branch.branches.length > 1 && (
            <Field label="Branch">
              <select
                aria-label="Staff branch"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="">Choose branch</option>
                {branch.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!branchId && branch.branches.length !== 1}
            onClick={async () => {
              const selected =
                branch.branches.find((b) => b.id === branchId) ??
                (branch.branches.length === 1 ? branch.branches[0] : null);
              if (!selected || !orgId) return;
              await navigator.clipboard.writeText(
                `${window.location.origin}/onboard/guard?org=${orgId}&branch=${selected.id}&code=${selected.guard_invite_token}`,
              );
              toast.success("Guard invite link copied");
            }}
          >
            Copy guard invite link
          </Button>
          <Field label="Full name">
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label="Email" hint="Used as their sign-in. It doesn't need to be a real inbox.">
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Password" hint="At least 8 characters. Share it with the guard in person.">
            <Input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
          <Field label="Phone (optional)">
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </Field>
          <Button type="submit" variant="signal" className="w-full" disabled={add.isPending}>
            {add.isPending && <Loader2 className="animate-spin" />} Create account
          </Button>
        </form>
      </section>
    </div>
  );
}
