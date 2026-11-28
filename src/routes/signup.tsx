import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MailCheck } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { checkOrgEmail, getSignupConfig } from "@/lib/signup.functions";
import { signupMetadata, signupPlan } from "@/lib/signup-rules";
import { SignupCaptcha } from "@/components/signup-captcha";
import { orgEmailPolicyError } from "@/lib/email-domain";
import { termsFor, type OrgType } from "@/lib/org-terms";
import { TRIAL_DAYS, PLANS, PLAN_IDS, formatNaira, type PlanId } from "@/lib/billing";
import { AuthFrame, Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/signup")({
  validateSearch: z.object({ plan: z.string().optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Register your school · GoGuard" },
      {
        name: "description",
        content: "Set up GoGuard for your school in a few minutes.",
      },
      { property: "og:title", content: "Register your school · GoGuard" },
      {
        property: "og:description",
        content: "Set up GoGuard for your school in a few minutes.",
      },
    ],
  }),
  component: SignupPage,
});

const schema = z.object({
  orgName: z.string().trim().min(2, "Enter your school's name").max(120),
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(8, "Use at least 8 characters").max(72),
});

/** GoGuard is school-only for now; other org types stay supported internally. */
const TYPE: OrgType = "school";

function SignupPage() {
  const check = useServerFn(checkOrgEmail);
  const config = useQuery({ queryKey: ["signup-config"], queryFn: () => getSignupConfig() });
  const { plan: planParam } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [plan, setPlan] = useState<PlanId>(() => signupPlan(planParam));
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const type = TYPE;
  const [form, setForm] = useState({
    orgName: "",
    fullName: "",
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const terms = termsFor(type);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
    const policy = form.email ? orgEmailPolicyError(form.email, type) : null;
    if (policy) next["email"] = policy;
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;

    setBusy(true);
    try {
      const res = await check({ data: { email: parsed.data.email, type, plan, captchaToken } });
      if (!res.ok) {
        setErrors({ email: res.error });
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`,
          data: {
            signup_kind: "org_admin",
            org_name: parsed.data.orgName,
            org_type: type,
            full_name: parsed.data.fullName,
            // The emergency line is added after sign-in, from Settings, where
            // it is encrypted. Sending it here would write it in plain text
            // through the signup trigger.
            ...signupMetadata(res.ticket, plan),
          },
        },
      });
      if (error) {
        setErrors({
          form: /already/i.test(error.message)
            ? "An account with this email already exists. Try signing in instead."
            : /school domain/i.test(error.message) || /database error/i.test(error.message)
              ? "Please use your school's official email address."
              : error.message,
        });
        return;
      }
      setSentTo(parsed.data.email);
} catch (err) {
        console.error("[signup] Error:", err);
        setErrors({ form: err instanceof Error ? err.message : "Something went wrong. Please try again." });
      } finally {
      setBusy(false);
      setCaptchaToken("");
      setCaptchaVersion((v) => v + 1);
    }
  }

  if (sentTo) {
    return (
      <AuthFrame>
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <MailCheck className="size-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">Check your inbox</h1>
          <p className="mt-2 text-muted-foreground">
            We've sent a verification link to{" "}
            <span className="font-medium text-foreground">{sentTo}</span>. Open it to activate your
            account, then sign in.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1 className="text-3xl font-bold">Register your school</h1>
      <p className="mt-1 text-muted-foreground">
        Verify your official school email to get started.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <Field label="Plan">
          <select
            aria-label="Plan"
            value={plan}
            onChange={(e) => {
              const next = signupPlan(e.target.value);
              setPlan(next);
              void navigate({ search: { plan: next }, replace: true });
            }}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {PLAN_IDS.map((id) => (
              <option key={id} value={id}>
                {PLANS[id].label} · {formatNaira(PLANS[id].amountNaira)}/month
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan === "basic"
              ? `${TRIAL_DAYS}-day free trial. No payment needed.`
              : "No free trial. Payment required to activate this plan."}
          </p>
        </Field>
        <div className="space-y-4">
          <Field label="School name" error={errors["orgName"]}>
            <Input
              value={form.orgName}
              onChange={set("orgName")}
              placeholder="Greenfield Academy"
            />
          </Field>
          <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
            You can add the emergency line parents should call right after your first sign-in, from
            Settings. It is stored encrypted and never written in plain text.
          </p>
        </div>

        <div className="space-y-4 border-t pt-5">
          <p className="text-sm font-semibold">Administrator account</p>
          <Field label="Full name" error={errors["fullName"]}>
            <Input value={form.fullName} onChange={set("fullName")} autoComplete="name" />
          </Field>
          <Field
            label="Official school email"
            hint="Must be on your school's own domain, e.g. admin@greenfield.edu.ng"
            error={errors["email"]}
          >
            <Input type="email" value={form.email} onChange={set("email")} autoComplete="email" />
          </Field>
          <Field label="Password" hint="At least 8 characters." error={errors["password"]}>
            <Input
              type="password"
              value={form.password}
              onChange={set("password")}
              autoComplete="new-password"
            />
          </Field>
        </div>

        {config.data?.turnstileSiteKey ? (
          <SignupCaptcha
            key={captchaVersion}
            siteKey={config.data.turnstileSiteKey}
            onToken={setCaptchaToken}
          />
        ) : config.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading security check…</p>
        ) : null}
        {errors["form"] && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors["form"]}
          </p>
        )}

        <Button
          type="submit"
          variant="signal"
          size="lg"
          className="w-full"
          disabled={busy || (config.data?.turnstileSiteKey && !captchaToken)}
        >
          {busy && <Loader2 className="animate-spin" />}{" "}
          {plan === "basic" ? "Start free trial" : "Register school"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already registered?{" "}
          <Link to="/auth" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}
