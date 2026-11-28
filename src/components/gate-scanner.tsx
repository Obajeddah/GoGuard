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
  ImageUp,
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
  /** True while the child is still in school today, from the gate or the bus. */
  inSchool: boolean;
  /** When the child arrived, so the guard sees why check in is off. */
  checkedInAt: string | null;
}

async function lookupPass(hash: string, orgId: string): Promise<ScanResult | string> {
  const fields = "id, name, relationship, photo_path, member_id, org_id, unique_qr_hash";
  let { data: g } = await supabase
    .from("guardians")
    .select(fields)
    .eq("unique_qr_hash", hash)
    .maybeSingle();
  // Older printed codes may be upper-case; try that spelling before rejecting.
  if (!g && hash !== hash.toUpperCase()) {
    const retry = await supabase
      .from("guardians")
      .select(fields)
      .eq("unique_qr_hash", hash.toUpperCase())
      .maybeSingle();
    g = retry.data;
  }
  const check = checkPass(hash, g, { orgId });
  if (!check.ok || !g) return PASS_REJECTION[check.ok ? "unknown" : check.reason];
  const today = startOfDay(new Date()).toISOString();
  const [{ data: member }, { data: all }, { data: last }, { data: lastBus }] = await Promise.all([
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
      .gte("timestamp", today)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The bus drops children at school too, so a child who arrived by bus is
    // already in school even before any gate scan.
    supabase
      .from("pupil_bus_logs")
      .select("status, timestamp, trip:bus_trips(direction)")
      .eq("member_id", g.member_id)
      .gte("timestamp", today)
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

  const gateMs = last?.timestamp ? new Date(last.timestamp).getTime() : 0;
  const busTrip = (lastBus as { trip?: { direction: string | null } | { direction: string | null }[] | null } | null)
    ?.trip;
  const busDirection = Array.isArray(busTrip) ? (busTrip[0]?.direction ?? null) : (busTrip?.direction ?? null);
  const busMs = lastBus?.timestamp ? new Date(lastBus.timestamp).getTime() : 0;
  let inSchool = false;
  let checkedInAt: string | null = null;
  if (lastBus && busMs >= gateMs) {
    if (lastBus.status === "dropped_off" && busDirection !== "to_home") {
      inSchool = true;
      checkedInAt = lastBus.timestamp;
    }
  } else if (last?.action_type === "check_in") {
    inSchool = true;
    checkedInAt = last.timestamp;
  }

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
    inSchool,
    checkedInAt,
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

  /**
   * Read a pass from a photo or screenshot. Guards often have the parent's
   * WhatsApp image or a screenshot on their own phone, and a smudged print
   * photographs better than it scans live.
   */
  const scanPhoto = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      setInvalid(false);
      setLooking(true);
      type PhotoReader = {
        scanFile: (f: File, showImage?: boolean) => Promise<string>;
        clear: () => void;
      };
      let reader: PhotoReader | null = null;
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        reader = new Html5Qrcode("qr-photo-reader") as unknown as PhotoReader;
        const text = await reader.scanFile(file, false);
        await handleCode(text);
      } catch {
        beep("error");
        setInvalid(
          "No barcode found in that picture. Move closer, keep it flat and use a brighter photo.",
        );
        setTimeout(() => setInvalid(false), 2600);
      } finally {
        const done = reader;
        try {
          done?.clear();
        } catch {
          // nothing to clean up
        }
        setLooking(false);
      }
    },
    [handleCode],
  );

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
      const scanner = new Html5Qrcode("qr-reader", {
        verbose: false,
        // Android and iPhone browsers have a fast built-in barcode reader.
        useBarCodeDetectorIfSupported: true,
      });
      scannerRef.current = scanner as unknown as typeof scannerRef.current;
      await scanner.start(
        // Ask for the biggest, sharpest picture the phone can give. The old
        // small preview is what made a slightly blurred code impossible to
        // read and held parents up at the gate.
        {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as MediaTrackConstraints,
        {
          // Read more frames a second and use the phone's own barcode reader
          // where it has one, so a code is picked up almost instantly.
          fps: 20,
          qrbox: (w: number, h: number) => {
            const edge = Math.max(220, Math.floor(Math.min(w, h) * 0.8));
            return { width: edge, height: edge };
          },
          aspectRatio: 1,
          disableFlip: true,
        },
        (text) => void handleCode(text),
        () => {},
      );
      setCameraOn(true);
      // Phone cameras often start with a soft fixed focus. Continuous autofocus
      // is the difference between a blurry live picture and a sharp one.
      const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
      const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (track) {
        try {
          const caps = track.getCapabilities?.() as { focusMode?: string[] } | undefined;
          if (caps?.focusMode?.includes("continuous")) {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
            });
          }
        } catch {
          // A phone that refuses the focus hint still scans normally.
        }
      }
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
    // Already in school: a second check in would move the child's arrival time
    // and tell the parent something that did not happen.
    if (action === "check_in" && result.inSchool) return;
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
        {/* Hidden host the photo reader uses; it never shows a picture. */}
        <div id="qr-photo-reader" className="hidden" aria-hidden />
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
          {manual && (
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
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={looking}
              onClick={() => document.getElementById("qr-photo-input")?.click()}
            >
              <ImageUp /> Use a photo
            </Button>
            <Button variant="outline" onClick={() => setManual((m) => !m)}>
              <Keyboard /> {manual ? "Hide code box" : "Enter code"}
            </Button>
          </div>
          <input
            id="qr-photo-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void scanPhoto(file);
            }}
          />
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

          {result.inSchool && (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {result.member.full_name} is already in school
                {result.checkedInAt ? ` since ${format(new Date(result.checkedInAt), "h:mm a")}` : ""}.
              </span>{" "}
              Check in is switched off so the record stays accurate. Only check out is available.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="checkin"
              size="xl"
              className={cn("flex-col gap-0", suggested !== "check_in" && "opacity-70")}
              disabled={!!saving || !!done || !online || result.inSchool}
              onClick={() => act("check_in")}
            >
              {saving === "check_in" ? (
                <Loader2 className="!size-7 animate-spin" />
              ) : (
                <ArrowDownRight className="!size-7" />
              )}
              {terms.checkIn}
              <span className="text-xs font-normal opacity-90">
                {result.inSchool ? "Already in school" : terms.checkInHint}
              </span>
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
