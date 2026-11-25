/**
 * Offline queue for the bus app. Every write (ride start/end, pupil
 * board/drop, location point) is stored in the browser first with its own id,
 * then sent when there's a connection. Ids make re-sending safe.
 */
import type { BusLogStatus, TripDirection } from "@/lib/bus";

export type QueueItem =
  | {
      kind: "trip_start";
      id: string;
      trip: {
        id: string;
        org_id: string;
        bus_id: string;
        direction: TripDirection;
        started_by: string;
        started_at: string;
      };
    }
  | { kind: "location_pause"; id: string; tripId: string; paused: boolean }
  | {
      kind: "emergency";
      id: string;
      emergency: {
        client_id: string;
        org_id: string;
        bus_id: string;
        trip_id: string | null;
        raised_by: string;
        lat: number | null;
        lng: number | null;
      };
    }
  | { kind: "trip_end"; id: string; tripId: string; ended_at: string }
  | {
      kind: "log";
      id: string;
      log: {
        client_id: string;
        org_id: string;
        trip_id: string;
        member_id: string;
        status: BusLogStatus;
        guardian_id: string | null;
        recorded_by: string;
        timestamp: string;
        lat: number | null;
        lng: number | null;
      };
    }
  | {
      kind: "point";
      id: string;
      point: {
        client_id: string;
        org_id: string;
        trip_id: string;
        lat: number;
        lng: number;
        speed: number | null;
        heading: number | null;
        recorded_at: string;
      };
    };

/** Add an item, ignoring one with the same id; keeps at most `max` location points. */
export function enqueue(queue: QueueItem[], item: QueueItem, max = 500): QueueItem[] {
  if (queue.some((q) => q.id === item.id)) return queue;
  const next = [...queue, item];
  const points = next.filter((q) => q.kind === "point");
  if (points.length <= max) return next;
  const drop = new Set(points.slice(0, points.length - max).map((p) => p.id));
  return next.filter((q) => !drop.has(q.id));
}

/** Items in the order they must be sent: ride starts first, ride ends last. */
export function sendOrder(queue: QueueItem[]): QueueItem[] {
  const rank = {
    trip_start: 0,
    emergency: 1,
    location_pause: 1,
    log: 1,
    point: 1,
    trip_end: 2,
  } as const;
  return [...queue].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const KEY = "gp_bus_queue_v1";

export function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // storage full or blocked; items stay in memory for this session
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
