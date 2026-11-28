import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Smartphone, AlertCircle, RefreshCw, MapPin, Bus, CheckCircle2, Clock, UserRound, Bell, WifiOff, LogOut, Phone, Home, School } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { format, formatDistanceToNow } from "date-fns";

import { getParentChildStatus, registerParentWebAuthn } from "@/lib/parent-pwa.functions";
import { drainParentEmails } from "@/lib/email-retry.functions";
import { runParentPickupWatch } from "@/lib/pickup-watch.functions";
import { supabase } from "@/integrations/supabase/client";
import { getPushPublicKey, subscribePush } from "@/lib/push-notifications.server";
import { GateMark } from "@/components/brand";
import { ParentInstallGuide } from "@/components/parent-install-guide";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { termsFor } from "@/lib/org-terms";

const pwaTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const Route = createFileRoute("/parent/app/$token")({
  head: () => ({
    meta: [
      { title: "GoGuard" },
      { name: "theme-color", content: "#1d3a30" },
      { name: "apple-mobile-web-app-title", content: "GoGuard" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png" },
    ],
  }),
  validateSearch: z.object({}).optional(),
  loader: async ({ params }) => {
    const result = pwaTokenSchema.safeParse(params.token);
    if (!result.success) throw new Error("Invalid token");
    return { pwaToken: result.data };
  },
  component: ParentAppLayout,
});
function ParentAppLayout() {
  const { pwaToken } = Route.useLoaderData();
  // The school's own name sits beside the brand, so the app always says which
  // school a family belongs to.
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (orgName) document.title = `GoGuard · ${orgName}`;
  }, [orgName]);

  // Register service worker for PWA and push notifications
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/parent-sw.js", { updateViaCache: "none" })
        // Phones keep an old copy of the worker until it is asked to check
        // again; without this an existing install never gains push support.
        .then((reg) => reg.update())
        .catch((err) => {
          console.warn("SW registration failed:", err);
        });
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ParentHeader pwaToken={pwaToken} orgName={orgName} />
      <main className="pb-20 px-4 pt-5">
        <ParentChildStatus onOrgName={setOrgName} />
      </main>
    </div>
  );
}

function ParentHeader({ pwaToken, orgName }: { pwaToken: string; orgName: string | null }) {
  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GateMark className="size-6 shrink-0" />
          <span className="truncate font-display font-semibold">
            GoGuard
            {orgName ? <span className="font-normal text-muted-foreground"> • {orgName}</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.location.href = `/parent/${pwaToken}`}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function ParentChildStatus({ onOrgName }: { onOrgName?: (name: string) => void }) {
  const { pwaToken } = Route.useLoaderData();
  const getStatus = useServerFn(getParentChildStatus);
  const registerWebAuthn = useServerFn(registerParentWebAuthn);

  interface ChildStatus {
    id: string;
    name: string;
    class: string | null;
    branch: string | null;
    orgName: string;
    orgType: "school" | "estate" | "corporate" | string;
    emergencyPhone: string | null;
    photoPath: string | null;
    photoUrl: string | null;
    usesBus: boolean;
    gateStatus: string;
    place: string | null;
    statusAt: string | null;
    statusNote: string | null;
    parentLinkToken: string; // For push notifications
    latestGate: {
      action: string;
      at: string;
      guardian: string | null;
      guard: string | null;
    } | null;
    lastEvent: {
      label: string;
      at: string;
      by: string | null;
      byRole: "Guardian" | "Attendant" | "Driver" | "Guard" | "Crew" | null;
    } | null;
          bus: {
        bus: {
          id: string;
          number: string;
          plate: string | null;
          route: string | null;
          driver: string | null;
          driverPhone: string | null;
          attendant: string | null;
          attendantPhone: string | null;
        } | null;
      ride: {
        direction: string;
        startedAt: string | null;
      } | null;
      lastSeen: {
        place: string;
        at: string | null;
        stale: boolean | null;
      } | null;
      journey: {
        direction: string;
        phase: string;
        startedAt: string | null;
      } | null;
      lastRide: {
        direction: string;
        startedAt: string | null;
        endedAt: string | null;
      } | null;
      } | null;
    recentLogs: { type: string; at: string; label: string }[];
  }

  const [status, setStatus] = useState<{
    child: ChildStatus;
    children: ChildStatus[];
    parentLinkToken: string | null;
    hasWebAuthn: boolean;
    push?: { devices: number; lastUsedAt: string | null };
  } | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  // Which child's card is open. The whole family comes down in one response, so
  // switching children is instant and does not need a round trip.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showWebAuthnPrompt, setShowWebAuthnPrompt] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [notifState, setNotifState] = useState<"unknown" | "on" | "off" | "denied" | "unsupported">(
    "unknown",
  );
  const drain = useServerFn(drainParentEmails);
  const publicKeyFn = useServerFn(getPushPublicKey);
  const pickupWatch = useServerFn(runParentPickupWatch);
  const lastWatch = useRef(0);
  const inFlight = useRef(false);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remember this link on the phone: the home-screen icon opens /parent/app/
  // and redirects here, and push notifications use it to deep-link back.
  useEffect(() => {
    try {
      localStorage.setItem("goguard_parent_token", pwaToken);
      // A home-screen app on iPhone does not share saved browser storage with
      // Safari, but it does share cookies, so the link is kept there too.
      document.cookie = `goguard_parent_token=${pwaToken}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax; Secure`;
    } catch {
      // Storage can be blocked in private browsing; the session still works.
    }
    navigator.serviceWorker?.ready
      .then((reg) => reg.active?.postMessage({ type: "parent-token", token: pwaToken }))
      .catch(() => {});
  }, [pwaToken]);

  async function loadStatus(force = false) {
    if (inFlight.current && !force) return;
    inFlight.current = true;
    try {
      setError(null);
      const data = await getStatus({ data: { pwaToken } });
      setStatus(data);
      if (data.child?.orgName) onOrgName?.(data.child.orgName);
      setLastUpdated(new Date());
      if (!data.hasWebAuthn) setUnlocked(true);
      // "Alerts on" must mean the server really holds this phone.
      if ("Notification" in window && Notification.permission === "granted") {
        setNotifState(data.push?.devices ? "on" : "off");
      }
      // The half-hour and one-hour pick-up warnings are checked here too, so
      // they still go out at the right minute without a scheduler. At most one
      // check every five minutes.
      if (Date.now() - lastWatch.current > 5 * 60_000) {
        lastWatch.current = Date.now();
        void pickupWatch({ data: { pwaToken } }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }

  /** One tap: read the latest gate and bus state now, and retry any email that
   * failed earlier, so the screen is right even when mail delivery isn't. */
  async function onRefresh() {
    setRefreshing(true);
    await loadStatus(true);
    try {
      await drain({ data: { limit: 10 } });
    } catch {
      // Email retry is best effort; the screen is already up to date.
    }
  }

  /** A database change for any of this parent's children is the earliest
   * signal available, so the screen updates within a second. */
  useEffect(() => {
    const memberIds = (status?.children ?? []).map((c) => c.id);
    if (!memberIds.length) return;
    const filter = `member_id=in.(${memberIds.join(",")})`;
    const busIds = (status?.children ?? [])
      .map((c) => c.bus?.bus?.id)
      .filter((id): id is string => !!id);
    const soon = () => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      pendingRefresh.current = setTimeout(() => void loadStatus(), 800);
    };
    let channel = supabase
      .channel(`parent-live-${memberIds.join("-")}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gate_logs", filter },
        soon,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pupil_bus_logs", filter },
        soon,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transport_notices", filter },
        soon,
      );
    // The ride itself: starting and ending shows up on the parent's screen the
    // moment the driver taps, not on the next poll.
    if (busIds.length) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bus_trips", filter: `id=in.(${busIds.join(",")})` },
        soon,
      );
    }
    channel.subscribe();
    return () => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      supabase.removeChannel(channel);
    };
  }, [(status?.children ?? []).map((c) => c.id + (c.bus?.bus?.id ?? "")).join(",")]);

  /**
   * A home-screen app can stay open for days and keep running the code it
   * loaded, so a new release never reaches the phone. This compares the page
   * the server is serving now with the one on screen and reloads when they
   * differ, no need to delete and re-add the icon.
   */
  useEffect(() => {
    const current = Array.from(document.querySelectorAll('script[src*="/assets/"]'))
      .map((el) => new URL((el as HTMLScriptElement).src).pathname)
      .sort()
      .join("|");
    if (!current) return;

    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(window.location.pathname, {
          cache: "no-store",
          headers: { accept: "text/html" },
        });
        if (res.ok) {
          const html = await res.text();
          const fresh = Array.from(html.matchAll(/src="([^"]*\/assets\/[^"]+)"/g))
            .flatMap((m) => (m[1] ? [new URL(m[1], window.location.origin).pathname] : []))
            .sort()
            .join("|");
          if (fresh && fresh !== current) {
            window.location.reload();
            return;
          }
        }
      } catch {
        // Offline or a slow network: keep showing the app that is already open.
      } finally {
        busy = false;
      }
    };

    const interval = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void loadStatus();
    }, 8_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadStatus();
    };
    const onOnline = () => void loadStatus();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [pwaToken]);

  useEffect(() => {
    // Never ask a parent to set up biometrics twice: once it is saved on the
    // server, the offer has done its job.
    if (status && !status.hasWebAuthn && !showWebAuthnPrompt) {
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((available) => {
          if (available) {
            setShowWebAuthnPrompt(true);
          }
        });
      }
    }
  }, [status]);

  function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /** Save this device as a notification target. Browsers only allow this from a
   * tap, so it is a button rather than something that runs on its own. */
  async function saveSubscription(): Promise<boolean> {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifState("unsupported");
      return false;
    }
    if (Notification.permission === "denied") {
      setNotifState("denied");
      return false;
    }
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setNotifState(permission === "denied" ? "denied" : "off");
      return false;
    }
    // Ask the server which key to subscribe with, so the phone and the sender
    // always use the same pair. Fall back to the key baked in at build time.
    let vapidPublicKey: string | undefined = import.meta.env["VITE_VAPID_PUBLIC_KEY"];
    try {
      const serverKey = await publicKeyFn();
      if (serverKey?.publicKey) vapidPublicKey = serverKey.publicKey;
    } catch {
      // Older deployment without the endpoint: the built-in key still works.
    }
    const parentLinkToken = status?.parentLinkToken ?? status?.child.parentLinkToken;
    if (!vapidPublicKey || !parentLinkToken) {
      setNotifState("unsupported");
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
      let existing = await registration.pushManager.getSubscription();
      if (existing) {
        // A subscription made with an older key cannot receive anything; drop
        // it and register again with the current one.
        const current = existing.options?.applicationServerKey;
        const currentBytes = current ? new Uint8Array(current as ArrayBuffer) : null;
        const wanted = keyBytes;
        const same =
          !!currentBytes &&
          currentBytes.length === wanted.length &&
          currentBytes.every((b, i) => b === wanted[i]);
        if (!same) {
          await existing.unsubscribe();
          existing = null;
        }
      }
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        }));
      const keys = subscription.toJSON().keys ?? {};
      await subscribePush({
        data: {
          parentLinkToken,
          pwaToken,
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: keys["p256dh"] ?? "",
              auth: keys["auth"] ?? "",
            },
          },
          userAgent: navigator.userAgent,
        },
      });
      setNotifState("on");
      // Re-read so the badge reflects what the server actually saved.
      void loadStatus(true);
      return true;
    } catch (err) {
      console.warn("Push subscription failed:", err);
      setNotifState("off");
      return false;
    }
  }

  async function enableNotifications() {
    const ok = await saveSubscription();
    if (ok) toast.success("Notifications on. You'll get gate and bus alerts on this phone.");
    else if (Notification.permission === "denied")
      toast.error("This phone has blocked notifications for GoGuard. Allow them in the browser settings.");
    else toast.error("Notifications aren't available on this browser.");
  }

  // One quiet nudge per visit, and only while alerts are still off. Once they
  // are on, the app never talks about notifications again, only about the
  // child.
  const reminded = useRef(false);
  useEffect(() => {
    if (reminded.current || notifState !== "off") return;
    reminded.current = true;
    toast.message("Turn on alerts", {
      description: "Get a message when your child is picked up or dropped off.",
      action: { label: "Turn on", onClick: () => void enableNotifications() },
      duration: 12000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifState]);

  // If the parent already allowed notifications, keep the device registered
  // quietly (browsers rotate subscriptions).
  useEffect(() => {
    if (!(status?.parentLinkToken ?? status?.child.parentLinkToken)) return;
    if (!("Notification" in window)) {
      setNotifState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setNotifState("denied");
      return;
    }
    if (Notification.permission === "granted") void saveSubscription();
    else setNotifState("off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.parentLinkToken]);

  async function unlockWithBiometrics() {
    if (!window.PublicKeyCredential) return;
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: [],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (cred) setUnlocked(true);
    } catch {
      // User cancelled or no credential registered; the locked screen stays.
    }
  }

  async function setupWebAuthn() {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "GoGuard", id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(pwaToken),
            name: "Parent App",
            displayName: "GoGuard parent app",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            requireResidentKey: false,
          },
          timeout: 60000,
          attestation: "none",
        },
      });

      if (credential) {
        const rawId = (credential as PublicKeyCredential & { rawId: ArrayBuffer }).rawId;
        const credentialId = btoa(String.fromCharCode(...new Uint8Array(rawId)));
        await registerWebAuthn({ data: { pwaToken, credentialId } });
        toast.success("Biometric unlock enabled!");
        setShowWebAuthnPrompt(false);
      }
    } catch (err) {
      console.error("WebAuthn setup failed:", err);
      toast.error("Could not set up biometric unlock");
    }
  }

  useEffect(() => {
    if (status?.hasWebAuthn && !unlocked) void unlockWithBiometrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.hasWebAuthn]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin size-8 text-primary" />
      </div>
    );
  }

  // When a biometric lock is set, the app stays locked until it is satisfied.
  if (status?.hasWebAuthn && !unlocked) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-8">
        <Card>
          <CardContent className="space-y-4 pt-6 text-center">
            <h2 className="text-xl font-bold">Unlock GoGuard</h2>
            <p className="text-sm text-muted-foreground">
              Use your fingerprint or face to open your children's status.
            </p>
            <Button variant="signal" className="w-full" onClick={() => void unlockWithBiometrics()}>
              Unlock
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = `/parent/${pwaToken}`;
              }}
            >
              Use access code instead
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto size-12 text-destructive" />
        <h2 className="mt-4 text-xl font-semibold">Unable to load status</h2>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={onRefresh}>
          <RefreshCw className="mr-2 size-4" /> Try Again
        </Button>
      </div>
    );
  }

  const { children } = status;
  const child = children.find((c) => c.id === selectedId) ?? status.child;
  const terms = termsFor(child.orgType as "school" | "estate" | "corporate");

  return (
    <div className="mx-auto max-w-md space-y-4">
      {/* Always reachable: pulls the latest gate and bus state immediately and
          retries any parent email that failed, even if mail is down. */}
      <div className="flex items-center gap-2">
        <Button
          variant="signal"
          className="flex-1"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
          {refreshing ? "Updating…" : "Refresh now"}
        </Button>
        {notifState === "on" ? (
          <Badge variant="secondary" className="h-10 gap-1 px-3">
            <Bell className="size-3.5" /> Alerts on
          </Badge>
        ) : (
          <Button variant="outline" className="h-10" onClick={enableNotifications}>
            <Bell className="mr-2 size-4" /> Alerts
          </Button>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {lastUpdated ? `Updated ${format(lastUpdated, "h:mm:ss a")}` : "Loading…"} · this screen
        updates by itself
      </p>

      <ParentInstallGuide alertsOn={notifState === "on"} onEnableAlerts={enableNotifications} />

      {notifState === "off" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 pt-4">
            <Bell className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Turn on phone alerts</p>
              <p className="text-muted-foreground">
                Get a notification the moment your child is scanned at the gate or boards the bus.
              </p>
            </div>
            <Button size="sm" variant="signal" onClick={enableNotifications}>
              Turn on
            </Button>
          </CardContent>
        </Card>
      )}
      {notifState === "denied" && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 text-sm">
            <p className="font-medium">Alerts are blocked on this phone</p>
            <p className="mt-1 text-muted-foreground">
              Open your browser settings for this site and allow notifications, then tap Alerts
              again.
            </p>
          </CardContent>
        </Card>
      )}

      {children.length > 1 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Your Children</h3>
              <span className="text-sm text-muted-foreground">
                {children.length} children linked
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {children.map((c) => (
                <Button
                  key={c.id}
                  variant={c.id === child.id ? "signal" : "outline"}
                  className="whitespace-nowrap shrink-0 flex items-center gap-2"
                  onClick={() => setSelectedId(c.id)}
                >
                  {c.photoUrl && (
                    <img src={c.photoUrl} alt={c.name} className="size-8 rounded-full object-cover" />
                  )}
                  <span>{c.name}</span>
                  {c.usesBus && <Bus className="size-3" />}
                  {c.id === child.id && <CheckCircle2 className="size-3 text-primary" />}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Tap a name to see that child's gate and bus status.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold">{child.name}</h2>
              <p className="text-sm text-muted-foreground">
                {child.class && `${terms.identifier}: ${child.class}`}
                {child.branch && ` · ${child.branch}`}
              </p>
            </div>
            {child.photoUrl && (
              <img
                src={child.photoUrl}
                alt={child.name}
                className="size-16 rounded-full object-cover border-2 border-primary/20"
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={cn("rounded-xl p-4 text-center text-lg font-semibold", getStatusColor(child.gateStatus, child.usesBus))}>
            {getStatusIcon(child.gateStatus, child.usesBus)}
            <div className="mt-1">{getStatusLabel(child.gateStatus, child.usesBus)}</div>
            {child.statusNote && <div className="mt-1 text-sm opacity-90">{child.statusNote}</div>}
            {child.statusAt && (
              <div className="mt-1 text-xs opacity-80">
                {formatDistanceToNow(new Date(child.statusAt), { addSuffix: true })}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <UserRound className="size-4" /> Last action
            </h3>
            {child.lastEvent ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/50 col-span-2">
                  <p className="text-xs text-muted-foreground">What happened</p>
                  <p className="font-medium">{child.lastEvent.label}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-xs text-muted-foreground">When</p>
                  <p className="font-medium">{eventTime(child.lastEvent.at)}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-xs text-muted-foreground">Recorded by</p>
                  {child.lastEvent.by ? (
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {child.lastEvent.byRole && (
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                          {child.lastEvent.byRole}
                        </span>
                      )}
                      <p className="truncate font-medium">{child.lastEvent.by}</p>
                    </div>
                  ) : (
                    <p className="truncate font-medium">Not recorded</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">No gate or bus activity yet</p>
            )}
          </div>

          {child.usesBus && child.bus && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bus className="size-4" /> School Bus
                </h3>
                {child.bus.bus && (
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-4">
                      {/* Where the child is right now, so the bus section can never
                          read "on the bus" for a child still at home or in class. */}
                      {child.place && (
                        <div className="mb-3 flex items-center gap-2 rounded-xl bg-background/70 px-3 py-2 text-sm">
                          {child.place === "At home" ? (
                            <Home className="size-4 shrink-0 text-muted-foreground" />
                          ) : child.place === "In school" ? (
                            <School className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <Bus className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-semibold">{child.place}</span>
                          {child.statusAt && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              since {eventTime(child.statusAt)}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold">Bus {child.bus.bus.number}</p>
                          <p className="text-sm text-muted-foreground">{child.bus.bus.route || "School route"}</p>
                        </div>
                        <Badge variant={child.bus.ride ? "default" : "secondary"}>
                          {child.bus.ride
                            ? "On Route"
                            : child.bus.lastRide
                              ? "Ride Ended"
                              : "Not Started"}
                        </Badge>
                      </div>
                      {/* The ride is over: say when, so "Picking up / To school"
                          can never look like it is still happening. */}
                      {!child.bus.ride && child.bus.lastRide && (
                        <div className="mb-3 flex items-center gap-2 rounded-xl bg-background/70 px-3 py-2 text-sm">
                          <Bus className="size-4 shrink-0 text-muted-foreground" />
                          <span className="font-semibold">
                            {child.bus.lastRide.direction === "to_home"
                              ? "Afternoon ride finished"
                              : "Morning ride finished"}
                          </span>
                          {child.bus.lastRide.endedAt && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {eventTime(child.bus.lastRide.endedAt)}
                            </span>
                          )}
                        </div>
                      )}
                      {child.gateStatus === "ride_ended" && (
                        <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          <span className="font-semibold">Drop-off not recorded.</span> This is usually
                          a missed tap on the bus. The school can confirm.
                        </div>
                      )}
                      {child.bus.journey && (
                        <div className="space-y-2 text-sm">
                          {/* Where the ride is heading: what the driver started,
                              not a guess from the position. */}
                          <div className="rounded-xl bg-background/70 px-3 py-2">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                              <span className="text-primary">
                                {child.bus.journey.phase === "picking_up" ? "Picking up" : "Dropping off"}
                              </span>
                              <span className="h-px flex-1 bg-primary/30" />
                              <span className="text-muted-foreground">
                                {child.bus.journey.direction === "to_school" ? "To school" : "To drop-off points"}
                              </span>
                            </div>
                          </div>
                          {child.bus.lastSeen && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <MapPin className="size-4 shrink-0" />
                              <span className="truncate">{child.bus.lastSeen.place}</span>
                              {child.bus.lastSeen.at && (
                                <span className="ml-auto shrink-0 text-xs">
                                  {formatDistanceToNow(new Date(child.bus.lastSeen.at), {
                                    addSuffix: true,
                                  })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {(child.bus.bus.driverPhone || child.bus.bus.attendantPhone) && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {child.bus.bus.driverPhone && (
                            <Button asChild variant="outline" size="sm">
                              <a href={`tel:${child.bus.bus.driverPhone.replace(/[^+0-9]/g, "")}`}>
                                <Phone className="mr-1 size-4" /> Call driver
                              </a>
                            </Button>
                          )}
                          {child.bus.bus.attendantPhone && (
                            <Button asChild variant="outline" size="sm">
                              <a
                                href={`tel:${child.bus.bus.attendantPhone.replace(/[^+0-9]/g, "")}`}
                              >
                                <Phone className="mr-1 size-4" /> Call attendant
                              </a>
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}

          {child.emergencyPhone && (
            <>
              <Separator />
              <div className="space-y-1">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(`tel:${child.emergencyPhone}`)}
                >
                  <Phone className="mr-2 size-4" /> Call school
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  For emergencies only.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {showWebAuthnPrompt && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Smartphone className="size-5 text-primary" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold">Quick access with Face ID / Touch ID</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Set up biometric unlock so you don't need to enter the code next time.
                </p>
                <Button variant="signal" className="mt-3 w-full" onClick={setupWebAuthn}>
                  Enable Biometric Unlock
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Everything that already happened, kept at the bottom so the live
          status stays the first thing a parent sees. */}
      <Card>
        <CardContent className="pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Recent activity</h3>
            <span className="text-sm text-muted-foreground">Last 5 days</span>
          </div>
          {child.recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity for this child.</p>
          ) : (
            <ul className="space-y-2">
              {child.recentLogs.map((log, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{log.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(log.at), "EEE d MMM, h:mm a")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {typeof navigator !== "undefined" && !navigator.onLine && (
        <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <WifiOff className="size-3" /> Showing the last update while offline
        </p>
      )}
    </div>
  );
}

/** A scan from an earlier day must never read like it happened today. */
function eventTime(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return format(at, sameDay ? "h:mm a" : "EEE d MMM, h:mm a");
}

function getStatusColor(gateStatus: string, usesBus: boolean): string {
  switch (gateStatus) {
    case "in_school":
      return "bg-green-100 text-green-800";
    case "picked_up":
      return "bg-blue-100 text-blue-800";
    case "dropped_off":
      return "bg-blue-100 text-blue-800";
    case "on_bus":
      return "bg-purple-100 text-purple-800";
    case "awaiting_bus":
      return "bg-amber-100 text-amber-800";
    case "ride_ended":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function getStatusIcon(gateStatus: string, usesBus: boolean) {
  switch (gateStatus) {
    case "in_school":
      return <CheckCircle2 className="mx-auto size-8" />;
    case "picked_up":
      return <UserRound className="mx-auto size-8" />;
    case "dropped_off":
      return <UserRound className="mx-auto size-8" />;
    case "on_bus":
      return <Bus className="mx-auto size-8" />;
    case "awaiting_bus":
      return <Clock className="mx-auto size-8" />;
    case "ride_ended":
      return <Bus className="mx-auto size-8" />;
    default:
      return <Clock className="mx-auto size-8" />;
  }
}

function getStatusLabel(gateStatus: string, usesBus: boolean): string {
  switch (gateStatus) {
    case "in_school":
      return "In School";
    case "picked_up":
      return "Picked Up";
    case "dropped_off":
      return usesBus ? "Dropped Off" : "Left School";
    case "on_bus":
      return usesBus ? "On the Bus" : "In Transit";
    case "awaiting_bus":
      return usesBus ? "Awaiting Pickup" : "In Transit";
    case "ride_ended":
      return "Ride Ended";
    default:
      return "No activity yet today";
  }
}