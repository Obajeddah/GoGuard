/**
 * School bus rules: where each pupil is during a ride, how far along the ride
 * is, when a guardian check is required, and how often the bus reports its
 * position. Pure functions only (tested in src/test/bus.test.ts).
 */
export type TripDirection = "to_school" | "to_home";
export type BusLogStatus = "boarded" | "dropped_off";
export type PupilState = "waiting" | "onboard" | "dropped";

export interface BusLogLike {
  member_id: string;
  status: BusLogStatus;
  timestamp: string;
}

export const DIRECTION_LABEL: Record<TripDirection, string> = {
  to_school: "Morning pick-up",
  to_home: "Afternoon drop-off",
};

/** Send a location point at most this often while a ride is on. */
export const POINT_INTERVAL_MS = 20_000;
/** A bus that hasn't reported for this long is shown as "signal lost". */
export const STALE_AFTER_MS = 3 * 60_000;

/** Each pupil's current state from the ride's logs (latest log wins). */
export function pupilStates(memberIds: string[], logs: BusLogLike[]): Map<string, PupilState> {
  const latest = new Map<string, BusLogLike>();
  for (const log of logs) {
    const prev = latest.get(log.member_id);
    if (!prev || new Date(log.timestamp).getTime() >= new Date(prev.timestamp).getTime()) latest.set(log.member_id, log);
  }
  const out = new Map<string, PupilState>();
  for (const id of memberIds) {
    const log = latest.get(id);
    out.set(id, !log ? "waiting" : log.status === "boarded" ? "onboard" : "dropped");
  }
  return out;
}

export interface TripProgress {
  total: number;
  waiting: number;
  onboard: number;
  dropped: number;
  /** Share of pupils already dropped off, 0–100. */
  percent: number;
}

export function tripProgress(states: Map<string, PupilState>): TripProgress {
  let waiting = 0;
  let onboard = 0;
  let dropped = 0;
  for (const s of states.values()) {
    if (s === "waiting") waiting++;
    else if (s === "onboard") onboard++;
    else dropped++;
  }
  const total = states.size;
  return { total, waiting, onboard, dropped, percent: total ? Math.round((dropped / total) * 100) : 0 };
}

/** The one-tap action for a pupil in this state, or null when they're done. */
export function nextAction(state: PupilState): BusLogStatus | null {
  if (state === "waiting") return "boarded";
  if (state === "onboard") return "dropped_off";
  return null;
}

/** Afternoon drop-offs must be handed to a registered guardian, checked by photo or pass. */
export function needsGuardianCheck(direction: TripDirection, action: BusLogStatus): boolean {
  return direction === "to_home" && action === "dropped_off";
}

/** Whether to send a location point now. Pupil changes always send one. */
export function shouldSendPoint(lastSentAt: number | null, now: number, reason: "tick" | "pupil"): boolean {
  if (reason === "pupil") return true;
  return lastSentAt === null || now - lastSentAt >= POINT_INTERVAL_MS;
}

/** Browser speed (metres per second) to km/h, rounded. */
export function kmh(speedMs: number | null | undefined): number | null {
  if (speedMs == null || Number.isNaN(speedMs) || speedMs < 0) return null;
  return Math.round(speedMs * 3.6);
}

export function isStale(lastPingAt: string | null, now: number): boolean {
  return !lastPingAt || now - new Date(lastPingAt).getTime() > STALE_AFTER_MS;
}

/**
 * What a bus parent's "Where is my child?" page may show: the bus's last-seen
 * area only while a ride is on and their own child is on board. Once the
 * child is off, the parent never follows the bus to other children's homes.
 */
export function parentSeesLocation(rideActive: boolean, childState: PupilState): boolean {
  return rideActive && childState === "onboard";
}

/**
 * Morning rides may drop everyone at school in one tap, but only before noon.
 * Afternoon drop-offs (and anything after noon) are always one by one.
 */
export function canDropAllAtSchool(direction: TripDirection, now: Date): boolean {
  return direction === "to_school" && now.getHours() < 12;
}

/** Round a coordinate to ~100 m so area names can be cached per square. */
export const placeKey = (n: number) => Math.round(n * 1000) / 1000;

/** A short area name ("Egbe, Ikotun") from a reverse-geocoded address. */
type Address = Partial<
  Record<"suburb" | "neighbourhood" | "quarter" | "hamlet" | "town" | "city_district" | "village" | "city" | "county", string>
>;

export function placeLabel(address: Address | null | undefined): string | null {
  if (!address) return null;
  const local = address.suburb ?? address.neighbourhood ?? address.quarter ?? address.hamlet;
  const wider = address.town ?? address.city_district ?? address.village ?? address.city ?? address.county;
  const parts = [local, wider].filter((p): p is string => !!p?.trim());
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.length ? unique.join(", ") : null;
}

/** "Last seen at Egbe, Ikotun · 3 minutes ago" */
export function lastSeenText(place: string | null, at: string | null, now: number): string {
  const ago = at ? agoText(new Date(at).getTime(), now) : null;
  const where = place ? `Last seen at ${place}` : "Last seen";
  return ago ? `${where} · ${ago}` : where;
}

function agoText(then: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

export interface BusPupilLike {
  id: string;
  uses_bus: boolean;
  bus_id: string | null;
}

/** Bus pupils split into those still waiting for the school to pick a bus, and those per bus. */
export function busPupilGroups<T extends BusPupilLike>(members: T[]): { needsBus: T[]; byBus: Map<string, T[]> } {
  const needsBus: T[] = [];
  const byBus = new Map<string, T[]>();
  for (const m of members) {
    if (m.bus_id) byBus.set(m.bus_id, [...(byBus.get(m.bus_id) ?? []), m]);
    else if (m.uses_bus) needsBus.push(m);
  }
  return { needsBus, byBus };
}

export const busTrackPath = (token: string) => `/bus/${token}`;
