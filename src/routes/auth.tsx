import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { accessOf, meQueryOptions } from "@/hooks/use-me";
import { homeFor } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthFrame, Field } from "@/components/auth-frame";
import { saveRememberChoice } from "@/lib/remember-me";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — GoGuard" },
      { name: "description", content: "Sign in to GoGuard as a school administrator or member of gate staff." },
      { property: "og:title", content: "Sign in — GoGuard" },
      { property: "og:description", content: "Sign in to GoGuard as a school administrator or member of gate staff." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      setError(
        /confirm/i.test(error.message)
          ? "Please confirm your email first. Check your inbox for the verification link."
          : "That email and password don't match. Please try again.",
      );
      return;
    }
    saveRememberChoice(remember);
    const me = await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    setBusy(false);
    navigate({ to: homeFor(accessOf(me)) });
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    setNotice("If an account exists for that email, we've sent a reset link.");
  }

  return (
    <AuthFrame>
      {mode === "signin" ? (
        <>
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="mt-1 text-muted-foreground">
            For school administrators, gate staff and bus crew. Parents don't need an account.
          </p>
          <form onSubmit={onSignIn} className="mt-6 space-y-4">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} className="size-5" />
              Keep me signed in for 90 days
            </label>
            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Sign in
            </Button>
          </form>
          <div className="mt-4 flex justify-between text-sm">
            <button type="button" onClick={() => setMode("forgot")} className="text-muted-foreground hover:text-foreground">
              Forgot password?
            </button>
            <Link to="/signup" className="font-medium text-primary">
              Register your school
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold">Reset your password</h1>
          <p className="mt-1 text-muted-foreground">Enter your email and we'll send you a link to choose a new one.</p>
          <form onSubmit={onForgot} className="mt-6 space-y-4">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            {notice && <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{notice}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Send reset link
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode("signin")}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to sign in
          </button>
        </>
      )}
    </AuthFrame>
  );
}
