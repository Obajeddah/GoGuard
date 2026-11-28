import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { GateMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const TOKEN_KEY = "goguard_parent_token";

const TOKEN_RE = /[a-f0-9]{64}/i;

/** The link a parent already opened. A home-screen app on iPhone keeps its own
 * storage, separate from Safari, but the cookie is shared, so both are read. */
export function savedParentToken(): string | null {
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && /^[a-f0-9]{64}$/i.test(saved)) return saved.toLowerCase();
  } catch {
    // Private browsing can refuse storage; the cookie below still works.
  }
  try {
    const cookie = document.cookie.match(/(?:^|;\s*)goguard_parent_token=([a-f0-9]{64})/i);
    const value = cookie?.[1];
    return value ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/parent/app")({
  head: () => ({
    meta: [
      { title: "GoGuard" },
      { name: "theme-color", content: "#1d3a30" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
  }),
  component: ParentAppEntry,
});

function ParentAppEntry() {
  // This page is also the parent of the per-family page. When a family link is
  // open we must show that child page and never redirect, otherwise the phone
  // would bounce between the two addresses forever.
  const params = useParams({ strict: false }) as { token?: string };
  const childToken = params.token;
  const [pasted, setPasted] = useState("");
  const [checking, setChecking] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);

  useEffect(() => {
    if (childToken) return;
    const token = savedParentToken();
    if (token) {
      window.location.replace(`/parent/app/${token}`);
      return;
    }
    setChecking(false);
    setNeedsLink(true);
  }, [childToken]);

  if (childToken) return <Outlet />;

  function open() {
    const token = pasted.match(TOKEN_RE)?.[0]?.toLowerCase();
    if (!token) {
      toast.error("Paste the full link from the email the school sent you.");
      return;
    }
    try {
      localStorage.setItem(TOKEN_KEY, token);
      document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax; Secure`;
    } catch {
      // Private mode can refuse storage; the link still opens this time.
    }
    window.location.href = `/parent/app/${token}`;
  }

  if (checking && !needsLink) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <GateMark className="mx-auto size-10" />
        <h1 className="mt-4 text-2xl font-bold">GoGuard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the link the school sent you, once. After that this icon opens your children
          straight away.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <label className="text-sm font-medium" htmlFor="parent-link">
            Paste your GoGuard link
          </label>
          <Input
            id="parent-link"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="https://goguard.ng/parent/…"
            autoComplete="off"
            inputMode="url"
          />
          <Button variant="signal" className="w-full" onClick={open}>
            Open my children <ArrowRight className="ml-1 size-4" />
          </Button>
          <p className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
            <Smartphone className="mt-0.5 size-3.5 shrink-0" />
            No link? Check the email from your school, or ask the school office to resend your
            parent app invitation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
