import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfDay } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Keyboard,
  Loader2,
  ShieldAlert,
  User,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { recordGateAction } from "@/lib/gate.functions";
import { beep, extractPassHash } from "@/lib/beep";
import { termsFor } from "@/lib/org-terms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { checkPass, PASS_REJECTION } from "@/lib/pass-check";

interface ScanResult {
  guardian: { id: string; name: string; relationship: string; photoUrl: string | null };
  member: {
    id: string;
    full_name: string;
    identifier_code: string | null;
    photoUrl: string | null;
  };
  guardians: { id: string; name: string; relationship: string; photoUrl: string | null }[];
  lastAction: { action_type: "check_in" | "check_out"; timestamp: string } | null;
}

async function lookupPass(hash: string, orgId: string): Promise<ScanResult | string> {
  const { data: g } = await supabase
    .from("guardians")
    .select("id, name, relationship, photo_path, member_id, org_id, unique_qr_hash")
    .eq("unique_qr_hash", hash)
    .maybeSingle();
  const check = checkPass(hash, g, { orgId });
  if (!check.ok || !g) return PASS_REJECTION[check.ok ? "unknown" : check.reason];
  const [{ data: member }, { data: all }, { data: last }] = await Promise.all([
    supabase
      .from("members")
      .select("id, full_name, identifier_code, photo_path")
      .eq("id", g.member_id)
      .single(),
    supabase
      .from("guardians")
      .select("id, name, relationship, photo_path")
      .eq("member_id", g.member_id)
      .order("created_at"),
    supabase
      .from("gate_logs")
      .select("action_type, timestamp")
      .eq("member_id", g.member_id)
      .gte("timestamp", startOfDay(new Date()).toISOString())
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!member) return PASS_REJECTION.unknown;
  const paths = [member.photo_path, ...(all ?? []).map((x) => x.photo_path)].filter(
    (p): p is string => !!p,
  );
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from("photos").createSignedUrls(paths, 60 * 30);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  const url = (p: string | null) => (p ? (urls[p] ?? null) : null);
  return {
    guardian: { id: g.id, name: g.name, relationship: g.relationship, photoUrl: url(g.photo_path) },
    member: {
      id: member.id,
      full_name: member.full_name,
      identifier_code: member.identifier_code,
      photoUrl: url(member.photo_path),
    },
    guardians: (all ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      relationship: x.relationship,
      photoUrl: url(x.photo_path),
    })),
    lastAction: last ?? null,
  };
}

export function GateScanner() {
  const { data: me } = useMe();
  const terms = termsFor(me?.org?.type);
  const queryClient = useQueryClient();
  const record = useServerFn(recordGateAction);

  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
    isScanning: boolean;
  } | null>(null);
  const busyRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [invalid, setInvalid] = useState<string | false>(false);
  const orgRef = useRef<string | null>(null);
  orgRef.current = me?.org?.id ?? null;
  const [saving, setSaving] = useState<"check_in" | "check_out" | null>(null);
  const [done, setDone] = useState<{
    action: "check_in" | "check_out";
    name: string;
    time: string;
  } | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const handleCode = useCallback(async (raw: string) => {
    if (busyRef.current) return;
    if (!navigator.onLine) {
      beep("error");
      toast.error(
        "You're offline, so this pass can't be verified. Do not release anyone until you're back online.",
      );
      return;
    }
    const hash = extractPassHash(raw);
    busyRef.current = true;
    setInvalid(false);
    setLooking(true);
    try {
      const found =
        hash && orgRef.current ? await lookupPass(hash, orgRef.current) : PASS_REJECTION.unknown;
      if (typeof found === "string") {
        beep("error");
        setInvalid(found);
        setTimeout(() => {
          setInvalid(false);
          busyRef.current = false;
        }, 2200);
        return;
      }
      beep("scan");
      setResult(found);
    } catch {
      toast.error("We couldn't check this pass. Please check your connection and try again.");
      busyRef.current = false;
    } finally {
      setLooking(false);
    }
  }, []);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s?.isScanning) {
      try {
        await s.stop();
        s.clear();
      } catch {
        // already stopped
      }
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner as unknown as typeof scannerRef.current;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: (w: number, h: number) => ({
            width: Math.min(w, h) * 0.72,
            height: Math.min(w, h) * 0.72,
          }),
        },
        (text) => void handleCode(text),
        () => {},
      );
      setCameraOn(true);
    } catch {
      setCameraError(
        "The camera isn't available. Allow camera access in your browser, or enter the code by hand.",
      );
      setCameraOn(false);
    }
  }, [handleCode]);

  useEffect(() => {
    void startCamera();
    return () => {
      void stopCamera();
    };
  }, [startCamera, stopCamera]);

  function reset() {
    setResult(null);
    setDone(null);
    setCode("");
    busyRef.current = false;
  }

  async function act(action: "check_in" | "check_out") {
    if (!result) return;
    setSaving(action);
    try {
      const log = await record({ data: { guardianId: result.guardian.id, action } });
      beep("success");
      setDone({
        action,
        name: result.member.full_name,
        time: format(new Date(log.timestamp), "h:mm a"),
      });
      queryClient.invalidateQueries({ queryKey: ["gate-logs"] });
      setTimeout(reset, 2600);
    } catch (e) {
      beep("error");
      toast.error(e instanceof Error ? e.message : "This wasn't recorded. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  const suggested: "check_in" | "check_out" =
    result?.lastAction?.action_type === "check_in" ? "check_out" : "check_in";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {!online && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl bg-destructive p-4 text-destructive-foreground"
        >
          <WifiOff className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">No internet connection</p>
            <p className="text-sm opacity-90">
              Passes can't be verified while offline. Hold all releases and contact the office.
              Scanning resumes automatically when you reconnect.
            </p>
          </div>
        </div>
      )}
      {/* Camera viewport */}
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl bg-ink ring-1 ring-border",
          result && "hidden",
        )}
      >
        <div
          id="qr-reader"
          className="aspect-square w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover"
        />
        {!cameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-muted">
            <CameraOff className="size-10" />
            <p className="text-sm">{cameraError ?? "Starting camera…"}</p>
            {cameraError && (
              <Button variant="signal" onClick={() => void startCamera()}>
                <Camera /> Try again
              </Button>
            )}
          </div>
        )}
        {cameraOn && !looking && !invalid && (
          <div className="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-signal/80">
            <div className="animate-scan-line absolute inset-x-4 top-3 h-0.5 rounded-full bg-signal shadow-[0_0_16px_var(--signal)]" />
          </div>
        )}
        {looking && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70">
            <Loader2 className="size-10 animate-spin text-signal" />
          </div>
        )}
        {invalid && (
          <div className="animate-gate-pop absolute inset-0 flex flex-col items-center justify-center bg-destructive/90 p-6 text-center text-destructive-foreground">
            <ShieldAlert className="size-16" />
            <p className="mt-3 font-display text-2xl font-bold">Not authorized</p>
            <p className="text-sm opacity-90">{invalid} Do not release.</p>
          </div>
        )}
      </div>

      {!result && (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            Hold the QR pass inside the frame
          </p>
          {manual ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleCode(code);
              }}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste the pass code or link"
                autoFocus
              />
              <Button type="submit" variant="signal">
                Look up
              </Button>
            </form>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setManual(true)}>
              <Keyboard /> Enter code by hand
            </Button>
          )}
        </div>
      )}

      {result && (
        <div className="relative space-y-4">
          {done && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl bg-background/95 text-center">
              <div className="relative">
                <span
                  className={cn(
                    "animate-gate-ring absolute inset-0 rounded-full",
                    done.action === "check_in" ? "bg-checkin" : "bg-checkout",
                  )}
                />
                <CheckCircle2
                  className={cn(
                    "animate-gate-pop relative size-24",
                    done.action === "check_in" ? "text-checkin" : "text-checkout",
                  )}
                />
              </div>
              <p className="mt-4 font-display text-3xl font-bold">
                {done.action === "check_in" ? terms.checkIn : terms.checkOut} recorded
              </p>
              <p className="text-muted-foreground">
                {done.name} · {done.time}
              </p>
            </div>
          )}

          <div className="rounded-3xl bg-card p-5 ring-1 ring-border">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-checkin/20 px-3 py-1 text-xs font-semibold text-checkin">
                <CheckCircle2 className="size-3.5" /> Pass recognised
              </span>
              <Button variant="ghost" size="icon" onClick={reset} aria-label="Cancel">
                <X />
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <Avatar url={result.guardian.photoUrl} name={result.guardian.name} size="lg" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {terms.guardian}
                </p>
                <p className="truncate font-display text-3xl font-bold leading-tight">
                  {result.guardian.name}
                </p>
                <p className="text-muted-foreground">{result.guardian.relationship}</p>
              </div>
            </div>
            <p className="mt-3 rounded-xl bg-signal/15 px-3 py-2 text-sm text-foreground">
              Check that the person in front of you matches this photo.
            </p>

            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-muted p-3">
              <Avatar url={result.member.photoUrl} name={result.member.full_name} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{terms.member}</p>
                <p className="truncate font-semibold">{result.member.full_name}</p>
                {result.member.identifier_code && (
                  <p className="text-sm text-muted-foreground">{result.member.identifier_code}</p>
                )}
              </div>
              {result.lastAction && (
                <span className="text-right text-xs text-muted-foreground">
                  Last:{" "}
                  {result.lastAction.action_type === "check_in"
                    ? terms.checkInHint
                    : terms.checkOutHint}
                  <br />
                  {format(new Date(result.lastAction.timestamp), "h:mm a")}
                </span>
              )}
            </div>

            <p className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">
              All authorised {terms.guardians.toLowerCase()}
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {result.guardians.map((g) => (
                <div
                  key={g.id}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl p-2 text-center",
                    g.id === result.guardian.id ? "bg-signal/20 ring-1 ring-signal" : "bg-muted",
                  )}
                >
                  <Avatar url={g.photoUrl} name={g.name} size="sm" />
                  <p className="w-full truncate text-[11px] font-medium">{g.name}</p>
                  <p className="w-full truncate text-[10px] text-muted-foreground">
                    {g.relationship}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="checkin"
              size="xl"
              className={cn("flex-col gap-0", suggested !== "check_in" && "opacity-70")}
              disabled={!!saving || !!done || !online}
              onClick={() => act("check_in")}
            >
              {saving === "check_in" ? (
                <Loader2 className="!size-7 animate-spin" />
              ) : (
                <ArrowDownRight className="!size-7" />
              )}
              {terms.checkIn}
              <span className="text-xs font-normal opacity-90">{terms.checkInHint}</span>
            </Button>
            <Button
              variant="checkout"
              size="xl"
              className={cn("flex-col gap-0", suggested !== "check_out" && "opacity-70")}
              disabled={!!saving || !!done || !online}
              onClick={() => act("check_out")}
            >
              {saving === "check_out" ? (
                <Loader2 className="!size-7 animate-spin" />
              ) : (
                <ArrowUpRight className="!size-7" />
              )}
              {terms.checkOut}
              <span className="text-xs font-normal opacity-90">{terms.checkOutHint}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({
  url,
  name,
  size = "md",
}: {
  url: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "lg"
      ? "size-24 rounded-3xl"
      : size === "sm"
        ? "size-12 rounded-xl"
        : "size-14 rounded-2xl";
  return (
    <div className={cn("shrink-0 overflow-hidden bg-secondary ring-2 ring-border", cls)}>
      {url ? (
        <img src={url} alt={name} className="size-full object-cover" />
      ) : (
        <User className="m-auto mt-[22%] size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}
