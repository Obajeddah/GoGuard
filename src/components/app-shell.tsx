import type { ReactNode } from "react";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  Bus,
  CalendarCheck,
  Clock,
  LayoutDashboard,
  Loader2,
  LogOut,
  ScanLine,
  Settings,
  UserCog,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { accessOf, useMe } from "@/hooks/use-me";
import { termsFor } from "@/lib/org-terms";
import { pagesFor, type AppPage } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
import { TrialBanner } from "@/components/trial-banner";
import { TwoStepGate } from "@/components/two-step-gate";
import { setSelectedBranch, useBranch } from "@/hooks/use-branch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  adminOnly,
  tone = "light",
}: {
  children: ReactNode;
  adminOnly?: boolean;
  tone?: "light" | "dark";
}) {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const terms = termsFor(me?.org?.type);

  const nav: { to: AppPage; label: string; icon: typeof LayoutDashboard }[] = [
    { to: "/dashboard", label: "Live", icon: LayoutDashboard },
    { to: "/members", label: terms.members, icon: Users },
    { to: "/scanner", label: "Scanner", icon: ScanLine },
    { to: "/reports", label: "Reports", icon: BarChart3 },
    { to: "/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/fleet", label: "Fleet", icon: Bus },
    { to: "/team", label: "Team", icon: UserCog },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  const access = accessOf(me);
  const allowed = pagesFor(access);
  const visible = nav.filter((n) => allowed.includes(n.to));
  const branch = useBranch();
  const roleLabel = me?.isAdmin
    ? me.branchId
      ? "Branch administrator"
      : branch.multi
        ? "Headquarters"
        : "Administrator"
    : me?.isBus
      ? "Bus login"
      : "Gate staff";

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div
      className={cn(
        "min-h-screen pb-24 md:pb-0",
        tone === "dark" && "dark bg-background text-foreground",
      )}
    >
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Brand to="/dashboard" />
          {me?.org && (
            <div className="hidden min-w-0 border-l pl-4 leading-tight sm:block">
              <p className="truncate text-sm font-medium">{me.org.name}</p>
              <p className="text-xs text-muted-foreground">
                {roleLabel}
                {me.branchId && branch.multi && ` · ${branch.nameOf(me.branchId)}`}
              </p>
            </div>
          )}
          {branch.canSwitch && (
            <Select
              value={branch.branchId ?? "all"}
              onValueChange={(v) => setSelectedBranch(v === "all" ? null : v)}
            >
              <SelectTrigger className="h-9 w-auto min-w-36 max-w-48 gap-1.5" aria-label="Branch">
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branch.branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {visible.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="ml-auto md:ml-0"
            aria-label="Sign out"
          >
            <LogOut /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !me?.org && me?.pendingRequest ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <Clock className="mx-auto size-10 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-bold">
              {me.pendingRequest.status === "declined"
                ? "Request declined"
                : "Waiting for approval"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {me.pendingRequest.status === "declined"
                ? "The school didn't approve this account."
                : "Your school will approve your gate staff account soon. Check back later."}
            </p>
          </div>
        ) : !me?.org ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <h1 className="text-2xl font-bold">No organisation linked</h1>
            <p className="mt-2 text-muted-foreground">
              This account isn't connected to a school or organisation. Ask your administrator to
              add you, or register a new one.
            </p>
            <Button asChild className="mt-6">
              <Link to="/signup">Register</Link>
            </Button>
          </div>
        ) : me.isBus && !me.isAdmin ? (
          <Navigate to="/bus-app" replace />
        ) : adminOnly && !me.isAdmin ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <h1 className="text-2xl font-bold">Administrator access required</h1>
            <p className="mt-2 text-muted-foreground">
              Your gate staff account can view activity and scan passes, but can't change settings.
            </p>
            <Button asChild className="mt-6">
              <Link to="/scanner">Open scanner</Link>
            </Button>
          </div>
        ) : (
          <MaybeTwoStep admin={me.isAdmin}>
            {me.isAdmin && (
              <div className="mb-6">
                <TrialBanner org={me.org} />
              </div>
            )}
            {children}
          </MaybeTwoStep>
        )}
      </main>

      {visible.length > 1 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <div
            className="mx-auto grid max-w-md"
            style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
          >
            {visible.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 py-2.5 font-medium text-muted-foreground",
                  visible.length > 6 ? "text-[10px]" : "text-[11px]",
                )}
                activeProps={{ className: "text-primary" }}
              >
                <n.icon className="size-5" />
                <span className="max-w-full truncate">{n.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function MaybeTwoStep({ admin, children }: { admin: boolean; children: ReactNode }) {
  return admin ? <TwoStepGate>{children}</TwoStepGate> : <>{children}</>;
}
