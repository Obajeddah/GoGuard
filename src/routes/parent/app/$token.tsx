import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Smartphone, AlertCircle, RefreshCw, MapPin, Bus, CheckCircle2, Clock, UserRound, Bell, WifiOff, LogOut, Phone } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { format, formatDistanceToNow } from "date-fns";

import { getParentChildStatus, registerParentWebAuthn } from "@/lib/parent-pwa.functions";
import { subscribePush } from "@/lib/push-notifications.server";
import { GateMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { termsFor } from "@/lib/org-terms";

const pwaTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const Route = createFileRoute("/parent/app/$token")({
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

  // Register service worker for PWA and push notifications
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/parent-sw.js").catch((err) => {
        console.warn("SW registration failed:", err);
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ParentHeader pwaToken={pwaToken} />
      <main className="pb-20 px-4">
        <Outlet />
      </main>
    </div>
  );
}

function ParentHeader({ pwaToken }: { pwaToken: string }) {
  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GateMark className="size-6" />
          <span className="font-display font-semibold">GoGuard Parent</span>
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

function ParentChildStatus() {
  const { pwaToken } = Route.useLoaderData();
  const getStatus = useServerFn(getParentChildStatus);
  const registerWebAuthn = useServerFn(registerParentWebAuthn);

  interface SiblingInfo {
    id: string;
    name: string;
    class: string | null;
    usesBus: boolean;
    busTrackToken: string | null;
    photoPath: string | null;
    current: boolean;
  }

  interface ChildStatus {
    id: string;
    name: string;
    class: string | null;
    branch: string | null;
    orgName: string;
    orgType: "school" | "estate" | "corporate" | string;
    emergencyPhone: string | null;
    photoPath: string | null;
    usesBus: boolean;
    gateStatus: string;
    parentLinkToken: string; // For push notifications
    latestGate: {
      action: string;
      at: string;
      guardian: string | null;
      guard: string | null;
    } | null;
    bus: {
      bus: {
        number: string;
        plate: string | null;
        route: string | null;
        driver: string | null;
        attendant: string | null;
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
    } | null;
  }

  const [status, setStatus] = useState<{
    child: ChildStatus;
    siblings: SiblingInfo[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showWebAuthnPrompt, setShowWebAuthnPrompt] = useState(false);

  async function loadStatus() {
    try {
      setError(null);
      const data = await getStatus({ data: { pwaToken } });
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
      toast.error("Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadStatus();
  }

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [pwaToken]);

  useEffect(() => {
    if (status && !showWebAuthnPrompt) {
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((available) => {
          if (available) {
            setShowWebAuthnPrompt(true);
          }
        });
      }
    }
  }, [status]);

  function urlBase64ToUint8Array(base64String: string): BufferSource {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Register for push notifications
  useEffect(() => {
    if (status && "serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready.then(async (registration) => {
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          try {
            const vapidPublicKey = import.meta.env["VITE_VAPID_PUBLIC_KEY"];
            if (vapidPublicKey && status.child.parentLinkToken) {
              const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
              });
              await subscribePush({
                data: {
                  parentLinkToken: status.child.parentLinkToken,
                  subscription: {
                    endpoint: subscription.endpoint,
                    keys: {
                      p256dh: btoa(
                        String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!)),
                      ),
                      auth: btoa(
                        String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!)),
                      ),
                    },
                  },
                  userAgent: navigator.userAgent,
                },
              });
            }
          } catch (err) {
            console.warn("Push subscription failed:", err);
          }
        }
      });
    }
  }, [status]);

  async function setupWebAuthn() {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "GoGuard Parent", id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(pwaToken),
            name: "Parent App",
            displayName: "GoGuard Parent App",
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin size-8 text-primary" />
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

  const { child, siblings } = status;
  const terms = termsFor(child.orgType as "school" | "estate" | "corporate");

  return (
    <div className="mx-auto max-w-md space-y-4">
      {siblings.length > 1 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Your Children</h3>
              <span className="text-sm text-muted-foreground">{siblings.length} children linked</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {siblings.map((sib) => (
                <Button
                  key={sib.id}
                  variant={sib.current ? "signal" : "outline"}
                  className="whitespace-nowrap shrink-0 flex items-center gap-2"
                  onClick={() => {
                    window.location.href = `/parent/app/${pwaToken}`;
                  }}
                >
                  {sib.photoPath && (
                    <img src={sib.photoPath} alt={sib.name} className="size-8 rounded-full object-cover" />
                  )}
                  <span>{sib.name}</span>
                  {sib.usesBus && <Bus className="size-3" />}
                  {sib.current && <CheckCircle2 className="size-3 text-primary" />}
                </Button>
              ))}
            </div>
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
            {child.photoPath && (
              <img src={child.photoPath} alt={child.name} className="size-16 rounded-full object-cover border-2 border-primary/20" />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={cn("rounded-xl p-4 text-center text-lg font-semibold", getStatusColor(child.gateStatus, child.usesBus))}>
            {getStatusIcon(child.gateStatus, child.usesBus)}
            <div className="mt-1">{getStatusLabel(child.gateStatus, child.usesBus)}</div>
            {child.latestGate && (
              <div className="mt-2 text-sm opacity-90">
                {formatDistanceToNow(new Date(child.latestGate.at), { addSuffix: true })} via {child.latestGate.guardian || child.latestGate.guard}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <UserRound className="size-4" /> Gate Status
            </h3>
            {child.latestGate ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-xs text-muted-foreground">Last Action</p>
                  <p className="font-medium capitalize">{child.latestGate.action === "check_in" ? "Arrived" : "Left"}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50">
                  <p className="text-xs text-muted-foreground">Time</p>
                  <p className="font-medium">{format(new Date(child.latestGate.at), "HH:mm")}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 col-span-2">
                  <p className="text-xs text-muted-foreground">Scanned By</p>
                  <p className="font-medium">{child.latestGate.guardian || child.latestGate.guard || "Guard"}</p>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">No gate activity today</p>
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
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold">Bus {child.bus.bus.number}</p>
                          <p className="text-sm text-muted-foreground">{child.bus.bus.route || "School route"}</p>
                        </div>
                        <Badge variant={child.bus.ride ? "default" : "secondary"}>
                          {child.bus.ride ? "On Route" : "Not Started"}
                        </Badge>
                      </div>
                      {child.bus.ride && (
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="size-4" />
                            <span>Direction: {child.bus.ride.direction === "to_school" ? "To School" : "To Home"}</span>
                          </div>
                          {child.bus.lastSeen && (
                            <div className="flex items-center gap-2">
                              <MapPin className="size-4" />
                              <span className="font-medium">{child.bus.lastSeen.place}</span>
                              <Badge variant={child.bus.lastSeen.stale ? "destructive" : "default"} className="ml-auto">
                                {child.bus.lastSeen.stale ? "Stale" : "Live"}
                              </Badge>
                            </div>
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
              <Button variant="outline" className="w-full" onClick={() => window.open(`tel:${child.emergencyPhone}`)}>
                <Phone className="mr-2 size-4" /> Call School: {child.emergencyPhone}
              </Button>
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

      <div className="text-center text-xs text-muted-foreground">
        Last updated: {format(new Date(), "HH:mm:ss")}{" "}
        {typeof navigator !== "undefined" && !navigator.onLine && (
          <span className="ml-2 flex items-center gap-1 text-destructive">
            <WifiOff className="size-3" /> Offline
          </span>
        )}
      </div>
    </div>
  );
}

function getStatusColor(gateStatus: string, usesBus: boolean): string {
  switch (gateStatus) {
    case "in_school":
      return "bg-green-100 text-green-800";
    case "picked_up":
      return "bg-blue-100 text-blue-800";
    case "on_bus":
      return "bg-purple-100 text-purple-800";
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
    case "on_bus":
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
    case "on_bus":
      return usesBus ? "On the Bus" : "In Transit";
    default:
      return "Unknown";
  }
}