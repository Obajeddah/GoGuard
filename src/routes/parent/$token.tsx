import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Smartphone, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  verifyParentPwaOtp,
  resendParentPwaOtp,
  getParentPwaGate,
} from "@/lib/parent-pwa.functions";
import { GateMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const pwaTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const Route = createFileRoute("/parent/$token")({
  validateSearch: z.object({}).optional(),
  loader: async ({ params }) => {
    const result = pwaTokenSchema.safeParse(params.token);
    if (!result.success) throw notFound();
    return { pwaToken: result.data };
  },
  component: ParentOtpGate,
});

function ParentOtpGate() {
  const { pwaToken } = Route.useLoaderData();
  const verifyOtp = useServerFn(verifyParentPwaOtp);
  const resendOtp = useServerFn(resendParentPwaOtp);
  const gate = useServerFn(getParentPwaGate);

  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  // This phone may already have opened the app from this link. If so there is
  // nothing to type: go straight through instead of asking for a code again.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    gate({ data: { pwaToken } })
      .then((res) => {
        if (!cancelled && res.verified) {
          window.location.replace(`/parent/app/${pwaToken}`);
          return;
        }
        if (!cancelled) setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pwaToken]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const res = await verifyOtp({ data: { pwaToken, otpCode: otp } });
      setVerified(true);
      setHasWebAuthn(res.hasWebAuthn);
      try {
        localStorage.setItem("goguard_parent_token", pwaToken);
      } catch {
        // Private browsing can block storage; the link still opens now.
      }
      toast.success("You're in. Opening your children now.");
      window.location.href = `/parent/app/${pwaToken}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setResendBusy(true);
    try {
      const res = await resendOtp({ data: { pwaToken } });
      if (res.emailed) {
        setOtp("");
        toast.success("A new code is on its way. Check your inbox and the spam folder.");
      } else {
        toast.error(
          "We couldn't email a new code just now. Use the code from your original email, or call the school office.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't send a new code.");
    } finally {
      setResendBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <GateMark className="mx-auto mb-4 size-10" />
          <Loader2 className="mx-auto size-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Opening your children…</p>
        </div>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="animate-gate-pop mx-auto size-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <Smartphone className="size-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold">You're in</h1>
          <p className="mt-2 text-muted-foreground">Opening your children…</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="animate-spin size-6 text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <GateMark className="size-10 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Welcome to GoGuard</h1>
          <p className="mt-2 text-muted-foreground">
            Your school emailed you a 6-digit code. Type it below to see{" "}
            <span className="font-medium">your children</span>. This is only needed on a phone
            that hasn't opened the app before.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-6 gap-3" role="group" aria-label="One-time code">
            {Array.from({ length: 6 }).map((_, i) => (
              <Input
                key={i}
                type="text"
                maxLength={1}
                inputMode="numeric"
                value={otp[i] ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setOtp((prev) => prev.slice(0, i) + v + prev.slice(i + 1));
                  if (v && i < 5) {
                    const nextInput = e.currentTarget.parentElement?.querySelector(
                      `input[data-index="${i + 1}"]`,
                    );
                    (nextInput as HTMLInputElement)?.focus();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !otp[i] && i > 0) {
                    const prevInput = e.currentTarget.parentElement?.querySelector(
                      `input[data-index="${i - 1}"]`,
                    );
                    (prevInput as HTMLInputElement)?.focus();
                  }
                }}
                data-index={i}
                className={cn(
                  "w-full h-14 text-center text-2xl font-mono rounded-xl border-2 transition-colors",
                  otp[i]
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted bg-background",
                )}
                autoComplete="one-time-code"
                autoFocus={i === 0}
                disabled={busy}
              />
            ))}
          </div>

          <Button
            type="submit"
            variant="signal"
            className="w-full"
            disabled={busy || otp.length < 6}
          >
            {busy ? <Loader2 className="animate-spin mr-2 size-4" /> : "Open my children"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onResend}
            disabled={resendBusy}
          >
            {resendBusy ? (
              <>
                <Loader2 className="animate-spin mr-2 size-4" /> Sending...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" /> Email me a new code
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            No email yet? Give it a minute, then check your spam folder. You can also ask the school
            office to send the link again.
          </p>
        </form>

        <div className="mt-8 rounded-xl border bg-muted/50 p-4 text-sm text-center">
          <p className="font-medium">About your code</p>
          <p className="mt-1 text-muted-foreground">
            This link is yours as a guardian. Every child you registered with the school appears in
            the app. The code works for 30 minutes. Once you've opened the app on this phone it
            stays signed in, so you won't need a code again. On a new phone, come back to this link
            and ask for a fresh code. After the first visit you can add the app to your home screen
            and it opens straight to your children.
          </p>
        </div>
      </div>
    </div>
  );
}
