import { lazy, Suspense, useMemo, useState } from "react";
import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Bus, Eye, Gauge, Loader2, MapPin, Plus, Search, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { accessOf, useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { billingState } from "@/lib/billing";
import type { Database } from "@/integrations/supabase/types";
import {
  busPupilGroups,
  busTrackPath,
  DIRECTION_LABEL,
  isStale,
  kmh,
  pupilStates,
  tripProgress,
  type TripDirection,
} from "@/lib/bus";
import { classGroups } from "@/lib/classes";
import { createBusLogin, setBusLoginPassword, setBusLoginActive } from "@/lib/staff.functions";
import { AppShell } from "@/components/app-shell";
import { Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MapBus } from "@/components/fleet-map";

const FleetMap = lazy(() => import("@/components/fleet-map"));

export const Route = createFileRoute("/_authenticated/fleet")({
  head: () => ({
    meta: [
      { title: "Fleet — GoGuard" },
      { name: "description", content: "School buses, crew and live bus tracking." },
      { property: "og:title", content: "Fleet — GoGuard" },
      { property: "og:description", content: "School buses, crew and live bus tracking." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <FleetPage />
    </AppShell>
  ),
});

type BusRow = Database["public"]["Tables"]["buses"]["Row"];
interface RiderRow {
  branch_id: string | null;
  id: string;
  full_name: string;
  identifier_code: string | null;
  bus_id: string | null;
  uses_bus: boolean;
  bus_track_token: string;
}

function useFleetData(orgId: string) {
  const { branchId } = useBranch();
  const { data: me } = useMe();
  const enabled = accessOf(me).transport;
  const buses = useQuery({
    queryKey: ["fleet", "buses", orgId, branchId],
    enabled,
    queryFn: async (): Promise<BusRow[]> => {
      const { data, error } = await inBranch(
        supabase.from("buses").select("*").eq("org_id", orgId).order("bus_number"),
        branchId,
      );
      if (error) throw error;
      return data ?? [];
    },
  });
  const riders = useQuery({
    queryKey: ["fleet", "riders", orgId, branchId],
    enabled,
    queryFn: async (): Promise<RiderRow[]> => {
      const { data, error } = await inBranch(
        supabase
          .from("members")
          .select("id, branch_id, full_name, identifier_code, bus_id, uses_bus, bus_track_token")
          .eq("org_id", orgId)
          .order("full_name"),
        branchId,
      );
      if (error) throw error;
      return data ?? [];
    },
  });
  return { buses, riders };
}

function showError(error: unknown) {
  toast.error(
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "Something went wrong. Please try again.",
  );
}

function MapsLink({ lat, lng }: { lat: number; lng: number }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in Google Maps
      </a>
    </Button>
  );
}

function Emergencies({ orgId }: { orgId: string }) {
  const { branchId } = useBranch();
  const client = useQueryClient();
  const alerts = useQuery({
    queryKey: ["fleet", "emergencies", orgId, branchId],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await inBranch(
        supabase
          .from("bus_emergencies")
          .select("id, bus_id, created_at, lat, lng, buses(bus_number)")
          .eq("org_id", orgId)
          .is("resolved_at", null)
          .order("created_at", { ascending: false }),
        branchId,
      );
      if (error) throw error;
      return data ?? [];
    },
  });
  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bus_emergencies")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Emergency resolved");
      client.invalidateQueries({ queryKey: ["fleet", "emergencies"] });
    },
    onError: showError,
  });
  if (alerts.isError)
    return (
      <p role="alert" className="text-destructive">
        Could not load bus emergencies.
      </p>
    );
  return (
    <div className="space-y-3">
      {alerts.data?.map((a) => (
        <section
          key={a.id}
          role="alert"
          className="rounded-2xl border border-destructive bg-card p-4"
        >
          <h2 className="font-bold text-destructive">
            Emergency · Bus {a.buses?.bus_number ?? a.bus_id}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {new Date(a.created_at).toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-2">
            {a.lat != null && a.lng != null && <MapsLink lat={a.lat} lng={a.lng} />}
            <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate(a.id)}>
              Mark resolved
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

function FleetPage() {
  const { data: me } = useMe();
  const org = me!.org!;
  const { riders } = useFleetData(org.id);
  const needsBus = busPupilGroups(riders.data ?? []).needsBus.length;
  const access = accessOf(me);
  if (!access.transport)
    return (
      <section className="mx-auto max-w-md rounded-3xl border bg-card p-8 text-center">
        <Bus className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-4">Fleet needs the School Standard or Multi-School Group plan.</p>
        <Button asChild className="mt-4">
          <Link to="/settings" hash="billing">
            Choose a plan
          </Link>
        </Button>
      </section>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Fleet</h1>
          <p className="text-muted-foreground">Buses, crew and every ride in progress.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/bus-app">
            <Bus /> Open bus app
          </Link>
        </Button>
      </div>
      <Emergencies orgId={org.id} />
      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="buses">Buses</TabsTrigger>
          <TabsTrigger value="pupils" className="gap-1.5">
            Bus pupils
            {needsBus > 0 && (
              <span className="rounded-full bg-signal px-1.5 text-xs font-semibold text-signal-foreground">
                {needsBus}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-5">
          <LiveTracking orgId={org.id} />
        </TabsContent>
        <TabsContent value="buses" className="mt-5">
          <Buses orgId={org.id} classes={org.classes ?? []} />
        </TabsContent>
        <TabsContent value="pupils" className="mt-5">
          <BusPupils orgId={org.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ Live tracking ------------------------------ */

function LiveTracking({ orgId }: { orgId: string }) {
  const { buses, riders } = useFleetData(orgId);
  const { branchId, multi, nameOf } = useBranch();
  const request = useMutation({
    mutationFn: async ({ id }: { id: string; number: string }) => {
      const { error } = await supabase.rpc("request_bus_location", { _trip_id: id });
      if (error) throw error;
    },
    onSuccess: (_, ride) => toast.success(`Asked Bus ${ride.number} for its location`),
    onError: showError,
  });
  const [focus, setFocus] = useState<string | null>(null);
  const live = useQuery({
    queryKey: ["fleet", "live", orgId, branchId],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data: trips, error } = await inBranch(
        supabase
          .from("bus_trips")
          .select(
            "id, bus_id, direction, current_lat, current_lng, current_speed, last_ping_at, started_at, branch_id, location_paused, location_requested_at",
          )
          .eq("org_id", orgId)
          .eq("status", "in_transit"),
        branchId,
      );
      if (error) throw error;
      const ids = (trips ?? []).map((t) => t.id);
      if (!ids.length) return { trips: [], logs: [], points: [] };
      const [{ data: logs }, { data: points }] = await Promise.all([
        supabase
          .from("pupil_bus_logs")
          .select("trip_id, member_id, status, timestamp")
          .in("trip_id", ids),
        supabase
          .from("bus_trip_points")
          .select("trip_id, lat, lng, recorded_at")
          .in("trip_id", ids)
          .order("recorded_at", { ascending: false })
          .limit(600),
      ]);
      return { trips: trips ?? [], logs: logs ?? [], points: points ?? [] };
    },
  });

  const rows = useMemo(() => {
    const now = Date.now();
    return (live.data?.trips ?? []).map((t) => {
      const bus = buses.data?.find((b) => b.id === t.bus_id);
      const manifest = (riders.data ?? []).filter((m) => m.bus_id === t.bus_id).map((m) => m.id);
      const progress = tripProgress(
        pupilStates(manifest, (live.data?.logs ?? []).filter((l) => l.trip_id === t.id) as never),
      );
      const trail = (live.data?.points ?? [])
        .filter((p) => p.trip_id === t.id)
        .reverse()
        .map((p) => [p.lat, p.lng] as [number, number]);
      return { trip: t, bus, progress, trail, stale: isStale(t.last_ping_at, now) };
    });
  }, [live.data, buses.data, riders.data]);

  const mapBuses: MapBus[] = rows
    .filter((r) => r.trip.current_lat != null && r.trip.current_lng != null)
    .map((r) => ({
      id: r.trip.id,
      label: `Bus ${r.bus?.bus_number ?? ""}`,
      lat: r.trip.current_lat!,
      lng: r.trip.current_lng!,
      stale: r.stale,
      trail: r.trail,
    }));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="relative h-[420px] overflow-hidden rounded-3xl border bg-muted lg:h-[560px]">
        <ClientOnly fallback={<MapFallback />}>
          <Suspense fallback={<MapFallback />}>
            <FleetMap buses={mapBuses} focusId={focus} />
          </Suspense>
        </ClientOnly>
        <div className="glass pointer-events-none absolute right-3 top-3 z-[1000] rounded-2xl px-4 py-2.5">
          <p className="text-xs text-muted-foreground">On the road</p>
          <p className="font-display text-2xl font-bold">{rows.length}</p>
        </div>
      </div>

      <div className="space-y-3">
        {live.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {!live.isLoading && rows.length === 0 && (
          <div className="rounded-3xl border border-dashed p-8 text-center">
            <Bus className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 font-medium">No rides in progress</p>
            <p className="text-sm text-muted-foreground">
              Buses appear here as soon as a driver taps Start ride.
            </p>
          </div>
        )}
        {rows.map((r) => (
          <section
            key={r.trip.id}
            className={cn(
              "w-full rounded-3xl border bg-card p-4 text-left transition hover:border-primary/40",
              focus === r.trip.id && "ring-2 ring-primary",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  className="font-display text-lg font-bold"
                  onClick={() => setFocus(r.trip.id)}
                >
                  Bus {r.bus?.bus_number}
                </button>
                {multi && !branchId && (
                  <p className="text-xs text-muted-foreground">{nameOf(r.bus?.branch_id)}</p>
                )}
                <p className="truncate text-sm text-muted-foreground">
                  {r.bus?.route_axis || r.bus?.plate_number} ·{" "}
                  {DIRECTION_LABEL[r.trip.direction as TripDirection]}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  r.stale ? "bg-muted text-muted-foreground" : "bg-checkin/15 text-checkin",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    r.stale ? "bg-muted-foreground" : "animate-pulse-dot bg-checkin",
                  )}
                />
                {r.stale ? "Signal lost" : "Live"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat icon={Gauge} label="km/h" value={kmh(r.trip.current_speed) ?? "—"} />
              <Stat icon={Users} label="Onboard" value={r.progress.onboard} />
              <Stat icon={MapPin} label="Waiting" value={r.progress.waiting} />
            </div>
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  {r.progress.dropped} of {r.progress.total} dropped off
                </span>
                <span className="font-medium text-foreground">{r.progress.percent}%</span>
              </div>
              <Progress value={r.progress.percent} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {r.trip.last_ping_at
                ? `Updated ${formatDistanceToNowStrict(new Date(r.trip.last_ping_at))} ago`
                : "Waiting for the first location"}
            </p>
            {r.trip.location_paused && (
              <p className="mt-3 inline-block rounded-full bg-muted px-3 py-1 text-xs">
                Location paused by driver
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={request.isPending}
                onClick={() => request.mutate({ id: r.trip.id, number: r.bus?.bus_number ?? "" })}
              >
                Request location
              </Button>
              {r.trip.current_lat != null && r.trip.current_lng != null && (
                <MapsLink lat={r.trip.current_lat} lng={r.trip.current_lng} />
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MapFallback() {
  return (
    <div className="flex size-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl bg-muted px-2 py-2.5">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <p className="mt-1 font-display text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/* ---------------------------------- Buses --------------------------------- */

function Buses({ orgId, classes }: { orgId: string; classes: string[] }) {
  const queryClient = useQueryClient();
  const { buses, riders } = useFleetData(orgId);
  const { data: me } = useMe();
  const { branchId, branches, multi } = useBranch();
  const defaultBranch = branchId ?? branches.find((b) => b.is_main)?.id ?? branches[0]?.id ?? "";
  const [chosenBranch, setChosenBranch] = useState<string | null>(null);
  const busBranch = me?.branchId ?? chosenBranch ?? defaultBranch;
  const maxBuses = billingState(me!.org!).maxBuses;
  const total = useQuery({
    queryKey: ["fleet", "count", orgId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("buses")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const atLimit = total.data == null || total.data >= maxBuses;
  const [form, setForm] = useState({ bus_number: "", plate_number: "", route_axis: "" });
  const [ridersFor, setRidersFor] = useState<BusRow | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      if (atLimit) throw new Error("Your bus limit has been reached.");
      if (!busBranch) throw new Error("Choose a branch.");
      const bus_number = form.bus_number.trim();
      const plate_number = form.plate_number.trim().toUpperCase();
      if (!bus_number || !plate_number) throw new Error("Enter the bus number and plate number.");
      const { error } = await supabase
        .from("buses")
        .insert({
          org_id: orgId,
          branch_id: busBranch,
          bus_number,
          plate_number,
          route_axis: form.route_axis.trim(),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bus added");
      setForm({ bus_number: "", plate_number: "", route_axis: "" });
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
    },
    onError: showError,
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("buses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bus removed");
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
    },
    onError: showError,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {buses.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {buses.data?.length === 0 && (
          <div className="rounded-3xl border border-dashed p-8 text-center text-muted-foreground">
            No buses yet.
          </div>
        )}
        {buses.data?.map((b) => (
          <BusCard
            key={b.id}
            bus={b}
            riderCount={(riders.data ?? []).filter((m) => m.bus_id === b.id).length}
            onRiders={() => setRidersFor(b)}
            onDelete={() => {
              if (confirm(`Remove Bus ${b.bus_number}? Its pupils will be unassigned.`))
                del.mutate(b.id);
            }}
          />
        ))}
      </div>

      <section className="h-fit rounded-3xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Plus className="size-5" /> Add bus
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {total.data ?? "…"} of {maxBuses} buses
        </p>
        {total.isError && <p className="text-sm text-destructive">Could not load the bus count.</p>}
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          {multi && me?.branchId === null && (
            <Field label="Branch">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={busBranch}
                onChange={(e) => setChosenBranch(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Bus number">
            <Input
              value={form.bus_number}
              onChange={(e) => setForm((f) => ({ ...f, bus_number: e.target.value }))}
              placeholder="e.g. 03"
              maxLength={20}
              required
            />
          </Field>
          <Field label="Plate number">
            <Input
              value={form.plate_number}
              onChange={(e) => setForm((f) => ({ ...f, plate_number: e.target.value }))}
              placeholder="e.g. LSD 482 KJ"
              maxLength={20}
              required
            />
          </Field>
          <Field label="Route">
            <Input
              value={form.route_axis}
              onChange={(e) => setForm((f) => ({ ...f, route_axis: e.target.value }))}
              placeholder="e.g. Lekki – Ajah"
              maxLength={80}
            />
          </Field>
          <Button
            type="submit"
            variant="signal"
            className="w-full"
            disabled={add.isPending || atLimit}
          >
            {add.isPending && <Loader2 className="animate-spin" />} Add bus
          </Button>
        </form>
      </section>

      {ridersFor && (
        <RidersDialog
          bus={ridersFor}
          riders={(riders.data ?? []).filter((r) => r.branch_id === ridersFor.branch_id)}
          classes={classes}
          onClose={() => setRidersFor(null)}
        />
      )}
    </div>
  );
}

function BusCard({
  bus,
  riderCount,
  onRiders,
  onDelete,
}: {
  bus: BusRow;
  riderCount: number;
  onRiders: () => void;
  onDelete: () => void;
}) {
  const client = useQueryClient();
  const { data: me } = useMe();
  const { branchId, multi, nameOf } = useBranch();
  const create = useServerFn(createBusLogin);
  const changePassword = useServerFn(setBusLoginPassword);
  const changeActive = useServerFn(setBusLoginActive);
  const [contacts, setContacts] = useState({
    driver_name: bus.driver_name ?? "",
    driver_phone: bus.driver_phone ?? "",
    attendant_name: bus.attendant_name ?? "",
    attendant_phone: bus.attendant_phone ?? "",
  });
  const domain = me?.org?.admin_email.split("@")[1] || "school.example";
  const [email, setEmail] = useState(
    `bus-${bus.bus_number.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@${domain}`,
  );
  const [password, setPassword] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["fleet"] });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("buses").update(contacts).eq("id", bus.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bus updated");
      refresh();
    },
    onError: showError,
  });
  const login = useMutation({
    mutationFn: async () => {
      if (bus.login_user_id) await changePassword({ data: { busId: bus.id, password } });
      else await create({ data: { busId: bus.id, email, password } });
    },
    onSuccess: () => {
      toast.success(bus.login_user_id ? "Password changed" : "Bus login created");
      setPassword("");
      setEditingPassword(false);
      refresh();
    },
    onError: showError,
  });
  const active = useMutation({
    mutationFn: () => changeActive({ data: { busId: bus.id, active: !bus.login_active } }),
    onSuccess: () => {
      toast.success("Bus updated");
      refresh();
    },
    onError: showError,
  });
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Bus {bus.bus_number}</h2>
          <p className="text-sm text-muted-foreground">
            {bus.plate_number}
            {bus.route_axis && ` · ${bus.route_axis}`}
          </p>
          {multi && !branchId && (
            <p className="text-sm text-muted-foreground">{nameOf(bus.branch_id)}</p>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove Bus ${bus.bus_number}`}
          onClick={onDelete}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(["driver_name", "driver_phone", "attendant_name", "attendant_phone"] as const).map(
            (key) => (
              <Field
                key={key}
                label={
                  {
                    driver_name: "Driver name",
                    driver_phone: "Driver phone",
                    attendant_name: "Attendant name",
                    attendant_phone: "Attendant phone",
                  }[key]
                }
              >
                <Input
                  type={key.endsWith("phone") ? "tel" : "text"}
                  value={contacts[key]}
                  onChange={(e) => setContacts((c) => ({ ...c, [key]: e.target.value }))}
                />
              </Field>
            ),
          )}
        </div>
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save details
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onRiders} className="ml-2">
          {riderCount} pupils <Users />
        </Button>
      </form>
      <div className="mt-5 space-y-3 border-t pt-4">
        <h3 className="font-bold">Bus login</h3>
        <p className="text-sm text-muted-foreground">
          Whichever phone signs in with this login is the bus tracker.
        </p>
        {bus.login_user_id && (
          <>
            <p className="break-all text-sm">
              {bus.login_email} ·{" "}
              <span className="rounded-full bg-muted px-2 py-1">
                {bus.login_active ? "Active" : "Off"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingPassword((v) => !v);
                  setPassword("");
                }}
              >
                Change password
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={active.isPending}
                onClick={() => {
                  if (
                    !bus.login_active ||
                    confirm("The bus phone will stop sharing location and can't sign in.")
                  )
                    active.mutate();
                }}
              >
                {bus.login_active ? "Turn off" : "Turn on"}
              </Button>
            </div>
          </>
        )}
        {(!bus.login_user_id || editingPassword) && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            {!bus.login_user_id && (
              <Field
                label="Email"
                hint="Used to sign in on the bus phone. It doesn't need to be a real inbox."
              >
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            )}
            <Field label="Password" hint="At least 8 characters.">
              <Input
                type="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button size="sm" type="submit" disabled={login.isPending}>
              {bus.login_user_id ? "Save password" : "Create login"}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function RidersDialog({
  bus,
  riders,
  classes,
  onClose,
}: {
  bus: BusRow;
  riders: RiderRow[];
  classes: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(
    () => new Set(riders.filter((r) => r.bus_id === bus.id).map((r) => r.id)),
  );
  const [q, setQ] = useState("");
  const filtered = riders.filter((r) => r.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = classGroups(filtered, classes);

  const save = useMutation({
    mutationFn: async () => {
      const before = new Set(riders.filter((r) => r.bus_id === bus.id).map((r) => r.id));
      const add = [...selected].filter((id) => !before.has(id));
      const remove = [...before].filter((id) => !selected.has(id));
      if (add.length) {
        const { error } = await supabase.from("members").update({ bus_id: bus.id }).in("id", add);
        if (error) throw error;
      }
      if (remove.length) {
        const { error } = await supabase.from("members").update({ bus_id: null }).in("id", remove);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`Pupils saved for Bus ${bus.bus_number}`);
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
      onClose();
    },
    onError: showError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pupils on Bus {bus.bus_number}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search students"
            className="pl-9"
          />
        </div>
        <div className="-mx-1 max-h-[50vh] space-y-4 overflow-y-auto px-1">
          {groups.map((g) => (
            <div key={g.label ?? "none"}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label ?? "No class"}
              </p>
              <div className="space-y-1">
                {g.members.map((r) => {
                  const elsewhere = r.bus_id && r.bus_id !== bus.id;
                  return (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted"
                    >
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (v === true) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                        className="size-5"
                      />
                      <span className="flex-1 text-sm">{r.full_name}</span>
                      {elsewhere && (
                        <span className="text-xs text-muted-foreground">On another bus</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No students found.</p>
          )}
        </div>
        <DialogFooter>
          <p className="mr-auto self-center text-sm text-muted-foreground">
            {selected.size} selected
          </p>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Bus pupils ------------------------------- */

function BusPupils({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const { buses, riders } = useFleetData(orgId);
  const { needsBus, byBus } = busPupilGroups(riders.data ?? []);
  const busLabel = (b: BusRow) =>
    `Bus ${b.bus_number}${b.driver_name ? ` · ${b.driver_name}` : ""}`;

  const move = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { bus_id?: string | null; uses_bus?: boolean };
    }) => {
      const { error } = await supabase.from("members").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fleet", "riders"] }),
    onError: showError,
  });

  const row = (r: RiderRow) => {
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate font-medium">{r.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.identifier_code ?? "No class"}
          </p>
        </div>
        <select
          aria-label={`Bus for ${r.full_name}`}
          className="h-10 min-w-0 flex-1 basis-56 rounded-md border border-input bg-background px-3 text-sm"
          value={r.bus_id ?? ""}
          disabled={move.isPending}
          onChange={(e) => move.mutate({ id: r.id, patch: { bus_id: e.target.value || null } })}
        >
          <option value="">Choose a bus…</option>
          {buses.data
            ?.filter((b) => b.branch_id === r.branch_id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {busLabel(b)}
              </option>
            ))}
        </select>
        <div className="flex gap-1">
          <Button
            asChild
            size="icon"
            variant="ghost"
            aria-label={`See what ${r.full_name}'s parent sees`}
          >
            <a href={busTrackPath(r.bus_track_token)} target="_blank" rel="noreferrer">
              <Eye />
            </a>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${r.full_name} doesn't take the bus`}
            disabled={move.isPending}
            onClick={() => {
              if (confirm(`Take ${r.full_name} off the school bus list?`))
                move.mutate({ id: r.id, patch: { bus_id: null, uses_bus: false } });
            }}
          >
            <X className="text-destructive" />
          </Button>
        </div>
      </li>
    );
  };

  if (riders.isLoading || buses.isLoading)
    return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <div className="max-w-3xl space-y-6">
      {!buses.data?.length && (
        <div className="rounded-2xl bg-signal/15 p-4 text-sm">
          Add a bus in the Buses tab first.
        </div>
      )}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
          Needs a bus{" "}
          <span className="rounded-full bg-signal px-2 text-sm text-signal-foreground">
            {needsBus.length}
          </span>
        </h2>
        {needsBus.length ? (
          <ul className="space-y-2">{needsBus.map(row)}</ul>
        ) : (
          <div className="rounded-3xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Every bus pupil has a bus.
          </div>
        )}
      </section>
      {buses.data?.map((b) => {
        const list = byBus.get(b.id) ?? [];
        return (
          <section key={b.id}>
            <h2 className="mb-2 font-display text-lg font-bold">
              {busLabel(b)}{" "}
              <span className="text-sm font-normal text-muted-foreground">· {list.length}</span>
            </h2>
            {list.length ? (
              <ul className="space-y-2">{list.map(row)}</ul>
            ) : (
              <p className="text-sm text-muted-foreground">No pupils on this bus yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
