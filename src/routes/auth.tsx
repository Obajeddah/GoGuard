import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";

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
      { title: "Sign in · GoGuard" },
      {
        name: "description",
        content: "Sign in to GoGuard as a school administrator or member of gate staff.",
      },
      { property: "og:title", content: "Sign in · GoGuard" },
      {
        property: "og:description",
        content: "Sign in to GoGuard as a school administrator or member of gate staff.",
      },
    ],
  }),
  component: AuthPage,
});

/**
 * The verification emails link to /auth?token_hash=…&type=… so the link a
 * parent or school sees stays on goguard.ng instead of pointing at the
 * Supabase project URL. The token is swapped for a session here.
 */
function readConfirmLink(): { tokenHash: string; type: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get("token_hash");
  if (!tokenHash) return null;
  return { tokenHash, type: params.get("type") || "email" };
}

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmLink] = useState(readConfirmLink);
  const [confirming, setConfirming] = useState(() => readConfirmLink() !== null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirmLink) return;
    let cancelled = false;
    const attempt = (type: string) =>
      supabase.auth.verifyOtp({ token_hash: confirmLink.tokenHash, type: type as EmailOtpType });

    (async () => {
      let { error } = await attempt(confirmLink.type);
      if (error && confirmLink.type !== "email") ({ error } = await attempt("email"));
      if (cancelled) return;
      // Drop the token from the address bar whether it worked or not.
      window.history.replaceState({}, "", window.location.pathname);
      if (error) {
        setConfirming(false);
        setConfirmError(
          /expired|invalid/i.test(error.message)
            ? "That verification link has expired or was already used. Sign in below, or use \"Forgot password?\" to get a new one."
            : error.message,
        );
        return;
      }
      const me = await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
      if (cancelled) return;
      setConfirming(false);
      navigate({ to: homeFor(accessOf(me)) });
    })();

    return () => {
      cancelled = true;
    };
  }, [confirmLink, navigate, queryClient]);

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

  if (confirming) {
    return (
      <AuthFrame>
        <div className="text-center">
          <Loader2 className="mx-auto size-7 animate-spin text-primary" />
          <h1 className="mt-5 text-2xl font-bold">Confirming your email</h1>
          <p className="mt-2 text-muted-foreground">One moment while we finish setting up.</p>
        </div>
      </AuthFrame>
    );
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
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Password">
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
                className="size-5"
              />
              Keep me signed in for 90 days
            </label>
            {(confirmError || error) && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {confirmError || error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Sign in
            </Button>
          </form>
          <div className="mt-4 flex justify-between text-sm">
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="text-muted-foreground hover:text-foreground"
            >
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
          <p className="mt-1 text-muted-foreground">
            Enter your email and we'll send you a link to choose a new one.
          </p>
          <form onSubmit={onForgot} className="mt-6 space-y-4">
            <Field label="Email">
              <Input
                id="email-forgot"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            {notice && (
              <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
                {notice}
              </p>
            )}
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
