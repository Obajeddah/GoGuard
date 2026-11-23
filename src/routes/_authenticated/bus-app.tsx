import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  Bus,
  Check,
  CloudOff,
  Loader2,
  LogOut,
  MapPinOff,
  Navigation,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Square,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { accessOf, useMe } from "@/hooks/use-me";
import { canOpenBusApp, sendsBusLocation } from "@/lib/access";
import {
  canDropAllAtSchool,
  DIRECTION_LABEL,
  needsGuardianCheck,
  nextAction,
  pupilStates,
  shouldSendPoint,
  tripProgress,
  type BusLogStatus,
  type PupilState,
  type TripDirection,
} from "@/lib/bus";
import { enqueue, loadQueue, newId, saveQueue, sendOrder, type QueueItem } from "@/lib/bus-offline";
import { checkPass, PASS_REJECTION } from "@/lib/pass-check";
import { beep, extractPassHash } from "@/lib/beep";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bus-app")({
  head: () => ({
    meta: [
      { title: "Bus app — GoGuard" },
      {
        name: "description",
        content: "Start a school bus ride, board and drop off pupils, and share the bus location.",
      },
      { property: "og:title", content: "Bus app — GoGuard" },
      {
        property: "og:description",
        content: "Start a school bus ride, board and drop off pupils, and share the bus location.",
      },
      { name: "theme-color", content: "#14251f" },
    ],
  }),
  component: BusAppPage,
});

interface BusInfo {
  id: string;
  bus_number: string;
  plate_number: string;
  route_axis: string;
  driver_name: string | null;
  attendant_name: string | null;
}

function BusAppPage() {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pickedBus, setPickedBus] = useState<string | null>(null);
  const access = accessOf(me);

  const buses = useQuery({
    queryKey: ["bus-app", "buses", me?.userId, me?.isAdmin],
    enabled: !!me?.org && canOpenBusApp(access),
    queryFn: async (): Promise<BusInfo[]> => {
      if (me!.isAdmin) {
        const { data } = await supabase
          .from("buses")
          .select("id, bus_number, plate_number, route_axis, driver_name, attendant_name")
          .order("bus_number");
        return data ?? [];
      }
      const { data } = await supabase
        .from("buses")
        .select("id, bus_number, plate_number, route_axis, driver_name, attendant_name")
        .eq("login_user_id", me!.userId)
        .eq("login_active", true);
      return data ?? [];
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const bus =
    buses.data?.find((b) => b.id === pickedBus) ??
    (buses.data?.length === 1 ? buses.data[0] : null);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="bg-aurora pointer-events-none fixed inset-0 opacity-40" aria-hidden />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        {isLoading || buses.isLoading ? (
          <Centered>
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          </Centered>
        ) : !me?.org || !canOpenBusApp(access) ? (
          <Centered>
            <Bus className="size-10 text-muted-foreground" />
            <p className="mt-3 text-lg font-semibold">The bus app isn't available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!access.transport
                ? "Your school's plan doesn't include the school bus. Please speak to the school office."
                : "This account isn't a bus login."}
            </p>
            <Button variant="outline" className="mt-6" onClick={signOut}>
              <LogOut /> Sign out
            </Button>
          </Centered>
        ) : !bus ? (
          buses.data && buses.data.length > 1 ? (
            <div className="space-y-3 py-6">
              <TopBar isAdmin={me.isAdmin} onSignOut={signOut} />
              <h1 className="pt-4 text-2xl font-bold">Choose a bus</h1>
              {buses.data.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setPickedBus(b.id)}
                  className="glass flex w-full items-center gap-4 rounded-3xl p-4 text-left"
                >
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <Bus />
                  </span>
                  <span>
                    <span className="block font-display text-lg font-bold">Bus {b.bus_number}</span>
                    <span className="text-sm text-muted-foreground">
                      {b.route_axis || b.plate_number}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Centered>
              <Bus className="size-10 text-muted-foreground" />
              <p className="mt-3 text-lg font-semibold">No bus assigned yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask the school office to assign you to a bus.
              </p>
              <Button variant="outline" className="mt-6" onClick={signOut}>
                <LogOut /> Sign out
              </Button>
            </Centered>
          )
        ) : (
          <BusConsole
            key={bus.id}
            bus={bus}
            orgId={me.org.id}
            userId={me.userId}
            isAdmin={me.isAdmin}
            canOperate={sendsBusLocation(access)}
            onSignOut={signOut}
            onSwitchBus={buses.data && buses.data.length > 1 ? () => setPickedBus(null) : undefined}
          />
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">{children}</div>
  );
}

function TopBar({
  isAdmin,
  onSignOut,
  right,
}: {
  isAdmin: boolean;
  onSignOut: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      {isAdmin ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/fleet">
            <ArrowLeft /> Fleet
          </Link>
        </Button>
      ) : (
        <span className="font-display text-sm font-bold tracking-tight text-muted-foreground">
          GoGuard Bus
        </span>
      )}
      <div className="flex items-center gap-1">
        {right}
        <Button variant="ghost" size="icon" onClick={onSignOut} aria-label="Sign out">
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

interface Guardian {
  id: string;
  name: string;
  relationship: string;
  photo_path: string | null;
  unique_qr_hash: string;
  member_id: string;
  org_id: string;
}
interface Pupil {
  id: string;
  full_name: string;
  identifier_code: string | null;
  photo_path: string | null;
  guardians: Guardian[];
}
interface LocalTrip {
  id: string;
  direction: TripDirection;
  started_at: string;
  location_paused?: boolean;
  location_requested_at?: string | null;
}

const tripKey = (busId: string) => `gp_bus_trip_${busId}`;

function BusConsole({
  bus,
  orgId,
  userId,
  isAdmin,
  canOperate,
  onSignOut,
  onSwitchBus,
}: {
  bus: BusInfo;
  orgId: string;
  userId: string;
  isAdmin: boolean;
  canOperate: boolean;
  onSignOut: () => void;
  onSwitchBus?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [localTrip, setLocalTrip] = useState<LocalTrip | null>(null);
  const [direction, setDirection] = useState<TripDirection>(() => "to_school");
  const [tab, setTab] = useState<"waiting" | "onboard">("waiting");
  const [handover, setHandover] = useState<Pupil | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const posRef = useRef<GeolocationPosition | null>(null);
  const lastPointRef = useRef<number | null>(null);

  // Restore queue + any ride started on this device
  useEffect(() => {
    const q = canOperate ? loadQueue() : [];
    queueRef.current = q;
    setQueue(q);
    try {
      const raw = localStorage.getItem(tripKey(bus.id));
      if (raw && canOperate) setLocalTrip(JSON.parse(raw) as LocalTrip);
    } catch {
      // ignore
    }
    setDirection(new Date().getHours() >= 12 ? "to_home" : "to_school");
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [bus.id, canOperate]);

  const persistQueue = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
    saveQueue(next);
  }, []);

  const push = useCallback(
    (item: QueueItem) => persistQueue(enqueue(queueRef.current, item)),
    [persistQueue],
  );

  const serverTrip = useQuery({
    queryKey: ["bus-app", "trip", bus.id],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bus_trips")
        .select("id, direction, started_at, location_paused, location_requested_at")
        .eq("bus_id", bus.id)
        .eq("status", "in_transit")
        .maybeSingle();
      if (error) throw error;
      return data as LocalTrip | null;
    },
  });

  const pendingEnd = queue.some(
    (q) => q.kind === "trip_end" && q.tripId === (localTrip?.id ?? serverTrip.data?.id),
  );
  const trip: LocalTrip | null = pendingEnd ? null : (serverTrip.data ?? localTrip ?? null);
  const pendingPause = queue.filter((q) => q.kind === "location_pause" && q.tripId === trip?.id).at(-1);
  const paused = pendingPause?.kind === "location_pause" ? pendingPause.paused : !!trip?.location_paused;

  const manifest = useQuery({
    queryKey: ["bus-app", "manifest", bus.id],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Pupil[]> => {
      const { data, error } = await supabase
        .from("members")
        .select(
          "id, full_name, identifier_code, photo_path, guardians(id, name, relationship, photo_path, unique_qr_hash, member_id, org_id)",
        )
        .eq("bus_id", bus.id)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Pupil[];
    },
  });

  const photos = useQuery({
    queryKey: ["bus-app", "photos", bus.id, manifest.dataUpdatedAt],
    enabled: !!manifest.data?.length,
    staleTime: 25 * 60_000,
    queryFn: async () => {
      const paths = (manifest.data ?? [])
        .flatMap((p) => [p.photo_path, ...p.guardians.map((g) => g.photo_path)])
        .filter((p): p is string => !!p);
      if (!paths.length) return {} as Record<string, string>;
      const { data } = await supabase.storage.from("photos").createSignedUrls(paths, 60 * 30);
      const out: Record<string, string> = {};
      for (const s of data ?? []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
      return out;
    },
  });
  const photo = (p: string | null) => (p ? (photos.data?.[p] ?? null) : null);

  const serverLogs = useQuery({
    queryKey: ["bus-app", "logs", trip?.id],
    enabled: !!trip,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pupil_bus_logs")
        .select("client_id, member_id, status, timestamp")
        .eq("trip_id", trip!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const logs = useMemo(() => {
    if (!trip) return [];
    const seen = new Set((serverLogs.data ?? []).map((l) => l.client_id));
    const local = queue
      .filter(
        (q): q is Extract<QueueItem, { kind: "log" }> =>
          q.kind === "log" && q.log.trip_id === trip.id,
      )
      .map((q) => q.log)
      .filter((l) => !seen.has(l.client_id));
    return [...(serverLogs.data ?? []), ...local].map((l) => ({
      member_id: l.member_id,
      status: l.status as BusLogStatus,
      timestamp: l.timestamp,
    }));
  }, [trip, serverLogs.data, queue]);

  const pupils = manifest.data ?? [];
  const states = useMemo(
    () =>
      pupilStates(
        pupils.map((p) => p.id),
        logs,
      ),
    [pupils, logs],
  );
  const progress = tripProgress(states);

  /* ------------------------------ syncing ------------------------------ */

  const flushingRef = useRef(false);
  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine || queueRef.current.length === 0) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      for (const item of sendOrder(queueRef.current)) {
        let error: { code?: string; message: string } | null = null;
        if (!canOperate && item.kind !== "trip_end") continue;
        if (item.kind === "location_pause") {
          ({ error } = await supabase.from("bus_trips").update({ location_paused: item.paused }).eq("id", item.tripId));
        } else if (item.kind === "emergency") {
          ({ error } = await supabase.from("bus_emergencies").upsert(item.emergency, { onConflict: "client_id", ignoreDuplicates: true }));
        } else if (item.kind === "trip_start") {
          ({ error } = await supabase
            .from("bus_trips")
            .upsert(
              { ...item.trip, status: "in_transit" },
              { onConflict: "id", ignoreDuplicates: true },
            ));
          if (error?.code === "23505") {
            toast.message(
              "A ride is already running on this bus. Switching to it.",
            );
            dropTrip(item.trip.id);
          }
        } else if (item.kind === "trip_end") {
          ({ error } = await supabase
            .from("bus_trips")
            .update({ status: "completed", ended_at: item.ended_at })
            .eq("id", item.tripId));
          if (!error) queryClient.setQueryData(["bus-app", "trip", bus.id], null);
        } else if (item.kind === "log") {
          ({ error } = await supabase
            .from("pupil_bus_logs")
            .upsert(item.log, { onConflict: "client_id", ignoreDuplicates: true }));
        } else {
          ({ error } = await supabase
            .from("bus_trip_points")
            .upsert(item.point, { onConflict: "client_id", ignoreDuplicates: true }));
        }
        if (error && (item.kind === "emergency" || item.kind === "location_pause")) break;
        if (error && !error.code) break; // network problem: keep everything for the next try
        if (error && item.kind === "log")
          toast.error(`A record couldn't be saved: ${error.message}`);
        persistQueue(queueRef.current.filter((q) => q.id !== item.id));
      }
    } finally {
      flushingRef.current = false;
      setSyncing(false);
      void serverLogs.refetch();
      void serverTrip.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistQueue, canOperate]);

  function dropTrip(id: string) {
    localStorage.removeItem(tripKey(bus.id));
    setLocalTrip((t) => (t?.id === id ? null : t));
    persistQueue(
      queueRef.current.filter(
        (q) =>
          !(q.kind === "trip_start" && q.trip.id === id) &&
          !(q.kind === "log" && q.log.trip_id === id) &&
          !(q.kind === "point" && q.point.trip_id === id),
      ),
    );
  }

  useEffect(() => {
    if (online) void flush();
    const t = setInterval(() => void flush(), 15_000);
    return () => clearInterval(t);
  }, [online, flush]);

  /* ------------------------------ location ----------------------------- */

  const sendPoint = useCallback(
    (reason: "tick" | "pupil" | "request", position?: GeolocationPosition) => {
      const pos = position ?? posRef.current;
      if (!canOperate || !trip || !pos || (paused && reason !== "request")) return;
      const now = Date.now();
      if (reason !== "request" && !shouldSendPoint(lastPointRef.current, now, reason)) return;
      lastPointRef.current = now;
      const id = newId();
      push({
        kind: "point",
        id,
        point: {
          client_id: id,
          org_id: orgId,
          trip_id: trip.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          recorded_at: new Date(pos.timestamp || now).toISOString(),
        },
      });
      void flush();
    },
    [trip, orgId, push, flush, canOperate, paused],
  );

  useEffect(() => {
    if (!canOperate || !trip || paused || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        posRef.current = pos;
        setGpsError(null);
        sendPoint("tick");
      },
      (err) =>
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Turn on location for this site."
            : "Looking for GPS signal…",
        ),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    const tick = setInterval(() => sendPoint("tick"), 5_000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(tick);
    };
  }, [trip, sendPoint, canOperate, paused]);

  const handledRequests = useRef(new Set<string>());
  useEffect(() => {
    const requested = serverTrip.data?.location_requested_at;
    if (!canOperate || !trip || !requested || !("geolocation" in navigator)) return;
    const key = `gp_bus_request_${userId}_${trip.id}`;
    if (handledRequests.current.has(requested)) return;
    try { if (localStorage.getItem(key) === requested) return; } catch { /* storage blocked */ }
    handledRequests.current.add(requested);
    try { localStorage.setItem(key, requested); } catch { /* storage blocked */ }
    if (Date.parse(requested) <= (lastPointRef.current ?? 0)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => sendPoint("request", pos),
      () => {},
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [serverTrip.data?.location_requested_at, trip, canOperate, userId, sendPoint]);

  async function raiseEmergency() {
    if (!canOperate) return false;
    const position = await quickPosition(8_000);
    const id = newId();
    push({ kind: "emergency", id, emergency: {
      client_id: id, org_id: orgId, bus_id: bus.id, trip_id: trip?.id ?? null,
      raised_by: userId, lat: position?.coords.latitude ?? null, lng: position?.coords.longitude ?? null,
    } });
    void flush();
    return true;
  }

  /* ------------------------------- actions ----------------------------- */

  function startRide() {
    if (!canOperate) return;
    const t: LocalTrip = { id: newId(), direction, started_at: new Date().toISOString() };
    localStorage.setItem(tripKey(bus.id), JSON.stringify(t));
    setLocalTrip(t);
    lastPointRef.current = null;
    push({
      kind: "trip_start",
      id: `start-${t.id}`,
      trip: {
        id: t.id,
        org_id: orgId,
        bus_id: bus.id,
        direction,
        started_by: userId,
        started_at: t.started_at,
      },
    });
    beep("success");
    setTab("waiting");
    setListOpen(false);
    toast.success("Ride started");
    void flush();
  }

  function endRide() {
    if (!trip) return;
    sendPoint("pupil");
    push({
      kind: "trip_end",
      id: `end-${trip.id}`,
      tripId: trip.id,
      ended_at: new Date().toISOString(),
    });
    localStorage.removeItem(tripKey(bus.id));
    setLocalTrip(null);
    setEnding(false);
    setListOpen(false);
    beep("success");
    toast.success("Ride ended");
    void flush();
  }

  function queueLog(tripId: string, pupil: Pupil, status: BusLogStatus, guardianId: string | null) {
    if (!canOperate) return;
    const pos = posRef.current;
    const id = newId();
    push({
      kind: "log",
      id,
      log: {
        client_id: id,
        org_id: orgId,
        trip_id: tripId,
        member_id: pupil.id,
        status,
        guardian_id: guardianId,
        recorded_by: userId,
        timestamp: new Date().toISOString(),
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
      },
    });
  }

  function record(pupil: Pupil, status: BusLogStatus, guardianId: string | null = null) {
    if (!trip || !canOperate) return;
    queueLog(trip.id, pupil, status, guardianId);
    beep("success");
    sendPoint("pupil");
    void flush();
  }

  /** Morning ride arrived at school: drop every pupil still on board in one go. */
  function dropAllAtSchool() {
    if (!canOperate || !trip || !canDropAllAtSchool(trip.direction, new Date())) return;
    const list = pupils.filter((p) => states.get(p.id) === "onboard");
    for (const p of list) queueLog(trip.id, p, "dropped_off", null);
    setConfirmAll(false);
    beep("success");
    sendPoint("pupil");
    toast.success(`${list.length} ${list.length === 1 ? "pupil" : "pupils"} dropped at school`);
    void flush();
  }

  function tap(pupil: Pupil) {
    if (!trip || !canOperate) return;
    const action = nextAction(states.get(pupil.id) ?? "waiting");
    if (!action) return;
    if (needsGuardianCheck(trip.direction, action)) {
      setHandover(pupil);
      return;
    }
    record(pupil, action);
  }

  /* -------------------------------- view ------------------------------- */

  const waiting = pupils.filter((p) => states.get(p.id) === "waiting");
  const onboard = pupils.filter((p) => states.get(p.id) === "onboard");
  const dropped = pupils.filter((p) => states.get(p.id) === "dropped");
  const pending = queue.length;

  return (
    <>
      <TopBar
        isAdmin={isAdmin}
        onSignOut={onSignOut}
        right={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              online ? "bg-checkin/15 text-checkin" : "bg-destructive/20 text-destructive",
            )}
          >
            {online ? (
              syncing ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-checkin" />
              )
            ) : (
              <CloudOff className="size-3" />
            )}
            {online ? (pending ? `Syncing ${pending}` : "Online") : `Offline · ${pending} saved`}
          </span>
        }
      />

      {isAdmin && <p className="mt-3 text-sm text-muted-foreground">Watching Bus {bus.bus_number}. Only the bus login shares location.</p>}
      {canOperate && <EmergencyButton onFire={raiseEmergency} />}
      {/* Bus header */}
      <header className="glass-strong mt-3 rounded-[2rem] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Bus</p>
            <p className="font-display text-5xl font-extrabold leading-none">{bus.bus_number}</p>
            <p className="mt-2 truncate text-sm text-muted-foreground">
              {bus.route_axis || "No route set"} ·{" "}
              <span className="font-mono">{bus.plate_number}</span>
            </p>
          </div>
          {onSwitchBus && !trip && (
            <Button variant="ghost" size="sm" onClick={onSwitchBus}>
              Switch
            </Button>
          )}
          {trip && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-checkin/15 px-3 py-1 text-xs font-semibold text-checkin">
              <span className="animate-pulse-dot size-2 rounded-full bg-checkin" /> On ride
            </span>
          )}
        </div>

        {trip ? (
          <>
            {canOperate && <Button variant="outline" size="sm" className="mt-3" aria-pressed={paused} onClick={() => {
              push({ kind: "location_pause", id: newId(), tripId: trip.id, paused: !paused });
              void flush();
            }}>{paused ? "Paused" : "Location on"}</Button>}
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  {DIRECTION_LABEL[trip.direction]} · since{" "}
                  {format(new Date(trip.started_at), "h:mm a")}
                </span>
                <span className="font-medium text-foreground">{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="Waiting" value={progress.waiting} />
                <Stat label="On board" value={progress.onboard} />
                <Stat label="Dropped" value={progress.dropped} />
              </div>
            </div>
            {!ending && (
              <Button
                variant="checkin"
                size="xl"
                className="mt-4 w-full text-base font-bold tracking-wide"
                onClick={() => {
                  setTab(
                    progress.onboard > 0 && (trip.direction === "to_home" || progress.waiting === 0)
                      ? "onboard"
                      : "waiting",
                  );
                  setListOpen(true);
                }}
              >
                <Users className="!size-5" /> {canOperate ? "ONBOARD PUPILS" : "VIEW PUPILS"}
              </Button>
            )}
            {ending ? (
              <div className="mt-4 rounded-2xl bg-destructive/15 p-4">
                <p className="font-semibold">
                  {progress.onboard > 0
                    ? `${progress.onboard} ${progress.onboard === 1 ? "pupil is" : "pupils are"} still on board. End the ride anyway?`
                    : "End this ride?"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setEnding(false)}>
                    Keep going
                  </Button>
                  <Button variant="destructive" onClick={endRide}>
                    End ride
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="lg"
                className="mt-2 w-full font-bold tracking-wide text-destructive"
                onClick={() => setEnding(true)}
              >
                <Square className="!size-5 fill-current" /> END RIDE
              </Button>
            )}
          </>
        ) : canOperate ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
              {(["to_school", "to_home"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    "rounded-xl py-2.5 text-sm font-medium transition",
                    direction === d
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
            <Button
              variant="checkin"
              size="xl"
              className="mt-3 w-full text-base font-bold tracking-wide"
              disabled={manifest.isLoading}
              onClick={startRide}
            >
              <Navigation className="!size-5" /> START RIDE
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {pupils.length} {pupils.length === 1 ? "pupil" : "pupils"} on this bus
            </p>
          </>
        ) : <p className="mt-4 text-sm text-muted-foreground">No ride running.</p>}
      </header>

      {trip && gpsError && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-signal/15 p-3 text-sm">
          <MapPinOff className="mt-0.5 size-4 shrink-0" /> {gpsError}
        </div>
      )}

      {/* Onboarding list: opened with the Onboard pupils button, never by Start ride */}
      {trip && listOpen && (
        <section
          className="dark fixed inset-0 z-40 overflow-y-auto bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] text-foreground"
          role="dialog"
          aria-modal
          aria-label="Onboard pupils"
        >
          <div className="mx-auto max-w-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setListOpen(false)}>
                <ArrowLeft /> Bus {bus.bus_number}
              </Button>
              <span className="text-sm text-muted-foreground">{progress.percent}% done</span>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
              <TabButton
                active={tab === "waiting"}
                onClick={() => setTab("waiting")}
                label="Waiting"
                count={waiting.length}
              />
              <TabButton
                active={tab === "onboard"}
                onClick={() => setTab("onboard")}
                label="Onboard"
                count={onboard.length}
              />
            </div>
            {canOperate && onboard.length > 0 && canDropAllAtSchool(trip.direction, new Date()) && (
              <div className="mt-3">
                {confirmAll ? (
                  <div className="rounded-2xl bg-checkout/15 p-4">
                    <p className="font-semibold">
                      Drop all {onboard.length} {onboard.length === 1 ? "pupil" : "pupils"} at school?
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => setConfirmAll(false)}>
                        Cancel
                      </Button>
                      <Button variant="checkout" onClick={dropAllAtSchool}>
                        Drop all
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="checkout"
                    size="lg"
                    className="w-full rounded-2xl font-bold tracking-wide"
                    onClick={() => setConfirmAll(true)}
                  >
                    <Check className="!size-5" /> DROP ALL AT SCHOOL · {onboard.length}
                  </Button>
                )}
              </div>
            )}
            <ul className="mt-3 space-y-2">
              {(tab === "waiting" ? waiting : onboard).map((p) => (
                <PupilRow
                  key={p.id}
                  pupil={p}
                  state={states.get(p.id) ?? "waiting"}
                  photoUrl={photo(p.photo_path)}
                  direction={trip.direction}
                  readOnly={!canOperate}
                  onTap={() => tap(p)}
                />
              ))}
              {(tab === "waiting" ? waiting : onboard).length === 0 && (
                <li className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {tab === "waiting" ? "Everyone has boarded." : "No one is on board."}
                </li>
              )}
            </ul>
            {tab === "waiting" && dropped.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dropped off · {dropped.length}
                </p>
                <ul className="space-y-1.5">
                  {dropped.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-2xl bg-card/60 px-3 py-2 text-sm text-muted-foreground"
                    >
                      <Check className="size-4 text-checkin" /> {p.full_name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {handover && trip && (
        <HandoverSheet
          pupil={handover}
          orgId={orgId}
          photo={photo}
          onClose={() => setHandover(null)}
          onConfirm={(guardianId) => {
            record(handover, "dropped_off", guardianId);
            setHandover(null);
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-muted/60 py-2">
      <p className="font-display text-2xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-2 text-xs",
          active ? "bg-primary text-primary-foreground" : "bg-background/40",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function PupilRow({
  pupil,
  state,
  photoUrl,
  direction,
  onTap,
  readOnly = false,
}: {
  pupil: Pupil;
  state: PupilState;
  photoUrl: string | null;
  direction: TripDirection;
  onTap: () => void;
  readOnly?: boolean;
}) {
  const action = readOnly ? null : nextAction(state);
  return (
    <li className="glass flex items-center gap-3 rounded-3xl p-3">
      <Face url={photoUrl} name={pupil.full_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{pupil.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {pupil.identifier_code ?? "No class"}
        </p>
      </div>
      {readOnly && <span className="text-xs text-muted-foreground">{state}</span>}
      {action && (
        <Button
          variant={action === "boarded" ? "checkin" : "checkout"}
          size="lg"
          className="min-w-28 rounded-2xl font-bold"
          onClick={onTap}
        >
          {action === "boarded"
            ? "Board"
            : needsGuardianCheck(direction, action)
              ? "Hand over"
              : "Drop off"}
        </Button>
      )}
    </li>
  );
}

function Face({
  url,
  name,
  size = "md",
}: {
  url: string | null;
  name: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden bg-secondary ring-2 ring-border",
        size === "lg" ? "size-20 rounded-3xl" : "size-12 rounded-2xl",
      )}
    >
      {url ? (
        <img src={url} alt={name} className="size-full object-cover" />
      ) : (
        <User className="m-auto mt-[22%] size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

/* --------------------------- Afternoon handover --------------------------- */

function HandoverSheet({
  pupil,
  orgId,
  photo,
  onClose,
  onConfirm,
}: {
  pupil: Pupil;
  orgId: string;
  photo: (p: string | null) => string | null;
  onClose: () => void;
  onConfirm: (guardianId: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
    isScanning: boolean;
  } | null>(null);

  const stop = useCallback(async () => {
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
    setScanning(false);
  }, []);

  useEffect(() => () => void stop(), [stop]);

  async function scan() {
    setRejected(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("handover-reader", { verbose: false });
      scannerRef.current = scanner as unknown as typeof scannerRef.current;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (w: number, h: number) => ({
            width: Math.min(w, h) * 0.7,
            height: Math.min(w, h) * 0.7,
          }),
        },
        (text) => {
          const hash = extractPassHash(text);
          const record = pupil.guardians.find((g) => g.unique_qr_hash === hash) ?? null;
          const result = checkPass(hash, record, { orgId, memberIds: [pupil.id] });
          void stop();
          if (result.ok && record) {
            beep("scan");
            setChosen(record.id);
          } else {
            beep("error");
            setRejected(PASS_REJECTION[result.ok ? "unknown" : result.reason]);
          }
        },
        () => {},
      );
    } catch {
      setScanning(false);
      toast.error("The camera isn't available. Check the guardian against the photos instead.");
    }
  }

  const guardian = pupil.guardians.find((g) => g.id === chosen);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-background/70 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="glass-strong mx-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hand over</p>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <Face url={photo(pupil.photo_path)} name={pupil.full_name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-2xl font-bold">{pupil.full_name}</p>
            <p className="text-sm text-muted-foreground">{pupil.identifier_code}</p>
          </div>
        </div>

        <p className="mt-5 text-sm font-medium">
          Who is collecting? Match their face to a photo, or scan their pass.
        </p>
        {pupil.guardians.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-destructive/15 p-3 text-sm">
            No guardians are registered for this pupil. Keep them on the bus and call the school.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {pupil.guardians.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setChosen(g.id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-3xl p-3 text-center transition",
                  chosen === g.id ? "bg-checkin/20 ring-2 ring-checkin" : "bg-muted",
                )}
              >
                <div className="aspect-square w-full overflow-hidden rounded-2xl bg-secondary">
                  {photo(g.photo_path) ? (
                    <img
                      src={photo(g.photo_path)!}
                      alt={g.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <User className="m-auto mt-[30%] size-1/3 text-muted-foreground" />
                  )}
                </div>
                <span className="w-full truncate text-sm font-semibold">{g.name}</span>
                <span className="-mt-1.5 w-full truncate text-xs text-muted-foreground">
                  {g.relationship}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={cn("mt-4 overflow-hidden rounded-3xl bg-ink", !scanning && "hidden")}>
          <div
            id="handover-reader"
            className="aspect-square w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover"
          />
        </div>
        {rejected && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-destructive/20 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {rejected} Do not hand over.
          </div>
        )}

        <div className="mt-4 grid gap-2">
          {pupil.guardians.length > 0 && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => (scanning ? void stop() : void scan())}
            >
              <QrCode /> {scanning ? "Stop scanning" : "Scan their pass"}
            </Button>
          )}
          <Button
            variant="checkout"
            size="xl"
            disabled={!guardian}
            onClick={() => guardian && onConfirm(guardian.id)}
            className="font-bold"
          >
            {guardian ? `Hand over to ${guardian.name}` : "Choose who is collecting"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function quickPosition(timeout: number): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), timeout);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve(pos); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

function EmergencyButton({ onFire }: { onFire: () => Promise<boolean> }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const [holding, setHolding] = useState(false);
  const [state, setState] = useState<"ready" | "sending" | "alerted">("ready");
  const [fill, setFill] = useState(0);
  useEffect(() => {
    if (!holding) { setFill(0); return; }
    const start = Date.now();
    const interval = setInterval(() => setFill(Math.min(100, (Date.now() - start) / 10)), 25);
    return () => clearInterval(interval);
  }, [holding]);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (reset.current) clearTimeout(reset.current);
  }, []);
  function begin() {
    if (busy.current || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(async () => {
      timer.current = null;
      setHolding(false);
      busy.current = true;
      setState("sending");
      try {
        if (await onFire()) setState("alerted");
      } finally {
        reset.current = setTimeout(() => { busy.current = false; setState("ready"); }, 4_000);
      }
    }, 1_000);
  }
  return (
    <Button variant="destructive" className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-4 z-[60] touch-none overflow-hidden"
      aria-label="Emergency — hold for one second" disabled={state !== "ready"}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); begin(); }}
      onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) begin(); } }}
      onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); cancel(); } }}>
      {holding && <span aria-hidden className="absolute inset-y-0 left-0 bg-destructive-foreground/25" style={{ width: `${fill}%` }} />}
      <ShieldAlert /> {state === "alerted" ? "School alerted" : state === "sending" ? "Alerting school…" : "Emergency"}
    </Button>
  );
}
