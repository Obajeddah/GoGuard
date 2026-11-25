import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Administrators must finish two-step sign-in (an authenticator app code) before
 * they see any school data. The database enforces the same rule for admin sessions.
 */
export function TwoStepGate({ children }: { children: ReactNode }) {
  const aal = useQuery({
    queryKey: ["aal"],
    queryFn: async () => {
      const [{ data: level }, { data: factors }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      return {
        current: level?.currentLevel ?? "aal1",
        verified: (factors?.totp ?? []).filter((f) => f.status === "verified"),
        unverified: (factors?.all ?? []).filter(
          (f) => f.factor_type === "totp" && f.status !== "verified",
        ),
      };
    },
    staleTime: 30_000,
  });

  if (aal.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (aal.data?.current === "aal2") return <>{children}</>;
  const factor = aal.data?.verified[0];
  return factor ? (
    <Challenge factorId={factor.id} />
  ) : (
    <Enroll stale={aal.data?.unverified.map((f) => f.id) ?? []} />
  );
}

function useDone() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries();
  };
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-3xl border bg-card p-6">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <ShieldCheck className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">{title}</h1>
        {children}
      </div>
      <button
        type="button"
        className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        onClick={async () => {
          await queryClient.cancelQueries();
          queryClient.clear();
          await supabase.auth.signOut();
          navigate({ to: "/auth", replace: true });
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function CodeForm({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code"
        aria-label="6-digit code"
        className="h-12 text-center font-mono text-xl tracking-[0.4em]"
        autoFocus
      />
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
        {busy && <Loader2 className="animate-spin" />} Verify
      </Button>
    </form>
  );
}

function Challenge({ factorId }: { factorId: string }) {
  const done = useDone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Frame title="Two-step sign-in">
      <p className="mt-1 text-muted-foreground">
        Enter the 6-digit code from your authenticator app.
      </p>
      <CodeForm
        busy={busy}
        error={error}
        onSubmit={async (code) => {
          setBusy(true);
          setError(null);
          const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
          setBusy(false);
          if (error) setError("That code didn't work. Check the time on your phone and try again.");
          else await done();
        }}
      />
    </Frame>
  );
}

function Enroll({ stale }: { stale: string[] }) {
  const done = useDone();
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of stale) await supabase.auth.mfa.unenroll({ factorId: id });
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "GoGuard",
        friendlyName: `GoGuard ${new Date().toISOString().slice(0, 16)}`,
      });
      if (cancelled) return;
      if (error || !data) setFailed(true);
      else setSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Frame title="Set up two-step sign-in">
      <p className="mt-1 text-muted-foreground">
        Administrator accounts need a code from an authenticator app (Google Authenticator,
        Microsoft Authenticator or similar) each time they sign in.
      </p>
      {failed ? (
        <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Couldn't start the setup. Refresh the page to try again.
        </p>
      ) : !setup ? (
        <Loader2 className="mt-6 size-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <ol className="mt-5 space-y-1 text-sm">
            <li>1. Scan this code with your authenticator app.</li>
            <li>2. Type the 6-digit code it shows.</li>
          </ol>
          <div className="mt-4 flex justify-center rounded-2xl bg-background p-4">
            <img src={setup.qr} alt="Two-step sign-in QR code" className="size-44" />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Can't scan? Enter this key:{" "}
            <span className="select-all break-all font-mono text-foreground">{setup.secret}</span>
          </p>
          <CodeForm
            busy={busy}
            error={error}
            onSubmit={async (code) => {
              setBusy(true);
              setError(null);
              const { error } = await supabase.auth.mfa.challengeAndVerify({
                factorId: setup.id,
                code,
              });
              setBusy(false);
              if (error)
                setError("That code didn't work. Check the time on your phone and try again.");
              else await done();
            }}
          />
        </>
      )}
    </Frame>
  );
}
