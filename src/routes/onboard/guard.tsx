import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getGuardInvite, submitGuardInvite } from "@/lib/staff.functions";
import { AuthFrame, Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const searchSchema = z.object({
  org: z.string().uuid(),
  branch: z.string().uuid(),
  code: z.string().regex(/^[a-f0-9]{64}$/i),
  role: z.enum(["guard", "admin"]).optional(),
});
export const Route = createFileRoute("/onboard/guard")({
  validateSearch: (input) => {
    const value = searchSchema.safeParse(input);
    return value.success ? value.data : { org: "", branch: "", code: "" };
  },
  head: () => ({
    meta: [
      { title: "Join your school gate team · GoGuard" },
      { name: "description", content: "Request guard access for your school's branch." },
      { property: "og:title", content: "Join your school gate team · GoGuard" },
      { property: "og:description", content: "Request guard access for your school's branch." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GuardOnboarding,
});
function GuardOnboarding() {
  const invite = Route.useSearch();
  const submit = useServerFn(submitGuardInvite);
  const info = useQuery({
    queryKey: ["guard-invite", invite],
    enabled: !!invite.org,
    queryFn: () => getGuardInvite({ data: invite }),
  });
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const isAdminInvite = info.data?.role === "admin" || invite.role === "admin";
  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold">
        {sent
          ? isAdminInvite
            ? "Administrator account ready"
            : "Request submitted"
          : isAdminInvite
            ? "Set up your branch administrator account"
            : "Join the gate team"}
      </h1>
      {sent ? (
        <>
          <p className="mt-3 text-muted-foreground">
            {isAdminInvite
              ? "You can sign in now and manage your branch."
              : "Your school administrator will review your request before you can scan passes."}
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth">Sign in</Link>
          </Button>
        </>
      ) : info.isLoading ? (
        <p className="mt-3">Loading invitation…</p>
      ) : !info.data ? (
        <p className="mt-3 text-destructive">
          This invitation is unavailable. Ask your school for a new link.
        </p>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">
            {info.data.orgName}
            {info.data.branchName ? ` · ${info.data.branchName}` : ""}
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await submit({ data: { ...invite, ...form } });
                setSent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not submit your request.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Full name">
              <Input
                required
                minLength={2}
                maxLength={120}
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                required
                type="tel"
                minLength={7}
                maxLength={30}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                required
                type="email"
                maxLength={255}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Password">
              <Input
                required
                type="password"
                minLength={8}
                maxLength={72}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {isAdminInvite ? "Create administrator account" : "Request access"}
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}
