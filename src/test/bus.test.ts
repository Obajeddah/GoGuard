import { describe, expect, it } from "vitest";

import {
  kmh,
  needsGuardianCheck,
  nextAction,
  pupilStates,
  shouldSendPoint,
  tripProgress,
} from "@/lib/bus";
import { enqueue, sendOrder, type QueueItem } from "@/lib/bus-offline";
import { checkPass } from "@/lib/pass-check";

const t = (m: number) => new Date(Date.UTC(2026, 10, 2, 7, m)).toISOString();

describe("Bus manifest", () => {
  it("puts pupils with no log in Waiting, boarded in Onboard, dropped in Dropped", () => {
    const states = pupilStates(
      ["a", "b", "c"],
      [
        { member_id: "b", status: "boarded", timestamp: t(1) },
        { member_id: "c", status: "boarded", timestamp: t(1) },
        { member_id: "c", status: "dropped_off", timestamp: t(9) },
      ],
    );
    expect(states.get("a")).toBe("waiting");
    expect(states.get("b")).toBe("onboard");
    expect(states.get("c")).toBe("dropped");
  });
  it("uses the latest log even when logs arrive out of order (offline sync)", () => {
    const states = pupilStates(
      ["a"],
      [
        { member_id: "a", status: "dropped_off", timestamp: t(9) },
        { member_id: "a", status: "boarded", timestamp: t(1) },
      ],
    );
    expect(states.get("a")).toBe("dropped");
  });
  it("counts route completion as the share of pupils dropped off", () => {
    const states = pupilStates(
      ["a", "b", "c", "d"],
      [
        { member_id: "a", status: "dropped_off", timestamp: t(2) },
        { member_id: "b", status: "boarded", timestamp: t(2) },
      ],
    );
    expect(tripProgress(states)).toEqual({
      total: 4,
      waiting: 2,
      onboard: 1,
      dropped: 1,
      percent: 25,
    });
  });
  it("offers Board, then Drop off, then nothing", () => {
    expect(nextAction("waiting")).toBe("boarded");
    expect(nextAction("onboard")).toBe("dropped_off");
    expect(nextAction("dropped")).toBeNull();
  });
  it("requires a guardian check only for afternoon drop-offs", () => {
    expect(needsGuardianCheck("to_home", "dropped_off")).toBe(true);
    expect(needsGuardianCheck("to_home", "boarded")).toBe(false);
    expect(needsGuardianCheck("to_school", "dropped_off")).toBe(false);
  });
});

describe("Bus location", () => {
  it("sends a point every 20 seconds, and always on a pupil change", () => {
    expect(shouldSendPoint(null, 0, "tick")).toBe(true);
    expect(shouldSendPoint(0, 19_000, "tick")).toBe(false);
    expect(shouldSendPoint(0, 20_000, "tick")).toBe(true);
    expect(shouldSendPoint(0, 1_000, "pupil")).toBe(true);
  });
  it("converts metres per second to km/h", () => {
    expect(kmh(10)).toBe(36);
    expect(kmh(null)).toBeNull();
  });
});

describe("Offline queue", () => {
  it("keeps emergencies when trimming points and sends them before ride end", () => {
    const emergency: QueueItem = {
      kind: "emergency",
      id: "help",
      emergency: {
        client_id: "help",
        org_id: "o",
        bus_id: "b",
        trip_id: "t",
        raised_by: "u",
        lat: null,
        lng: null,
      },
    };
    const end: QueueItem = { kind: "trip_end", id: "end", tripId: "t", ended_at: t(5) };
    const queue = enqueue(enqueue([end], emergency, 0), emergency, 0);
    expect(queue).toHaveLength(2);
    expect(sendOrder(queue).map((item) => item.kind)).toEqual(["emergency", "trip_end"]);
  });
  const point = (id: string): QueueItem => ({
    kind: "point",
    id,
    point: {
      client_id: id,
      org_id: "o",
      trip_id: "t",
      lat: 0,
      lng: 0,
      speed: null,
      heading: null,
      recorded_at: t(0),
    },
  });
  it("never stores the same item twice", () => {
    const q = enqueue(enqueue([], point("1")), point("1"));
    expect(q).toHaveLength(1);
  });
  it("keeps only the newest location points when full", () => {
    let q: QueueItem[] = [];
    for (const id of ["1", "2", "3"]) q = enqueue(q, point(id), 2);
    expect(q.map((x) => x.id)).toEqual(["2", "3"]);
  });
  it("sends the ride start first and the ride end last", () => {
    const end: QueueItem = { kind: "trip_end", id: "e", tripId: "t", ended_at: t(5) };
    const start: QueueItem = {
      kind: "trip_start",
      id: "s",
      trip: {
        id: "t",
        org_id: "o",
        bus_id: "b",
        direction: "to_school",
        started_by: "u",
        started_at: t(0),
      },
    };
    expect(sendOrder([end, point("p"), start]).map((x) => x.kind)).toEqual([
      "trip_start",
      "point",
      "trip_end",
    ]);
  });
});

describe("Strict QR passes", () => {
  const record = { unique_qr_hash: "h1", member_id: "child-1", org_id: "school-1" };
  it("accepts a pass only for its own school and child", () => {
    expect(checkPass("h1", record, { orgId: "school-1", memberIds: ["child-1"] })).toEqual({
      ok: true,
    });
  });
  it("rejects a pass from another school", () => {
    expect(checkPass("h1", record, { orgId: "school-2" })).toEqual({
      ok: false,
      reason: "other_school",
    });
  });
  it("rejects a valid pass shown for a different child", () => {
    expect(checkPass("h1", record, { orgId: "school-1", memberIds: ["child-2"] })).toEqual({
      ok: false,
      reason: "other_child",
    });
  });
  it("rejects an old code that no longer matches the record", () => {
    expect(checkPass("old", record, { orgId: "school-1" })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(checkPass("h1", null, { orgId: "school-1" })).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("Bus parents", () => {
  it("see where the bus was last seen only while their own child is on board during a ride", async () => {
    const { parentSeesLocation } = await import("@/lib/bus");
    expect(parentSeesLocation(true, "onboard")).toBe(true);
    expect(parentSeesLocation(true, "waiting")).toBe(false);
    expect(parentSeesLocation(true, "dropped")).toBe(false);
    expect(parentSeesLocation(false, "onboard")).toBe(false);
  });
  it("see a place name and time, not a map: 'Last seen at Egbe, Ikotun · 3 minutes ago'", async () => {
    const { lastSeenText, placeLabel } = await import("@/lib/bus");
    const place = placeLabel({ suburb: "Egbe", town: "Ikotun", county: "Alimosho" });
    expect(place).toBe("Egbe, Ikotun");
    const now = Date.UTC(2026, 10, 2, 7, 10);
    expect(lastSeenText(place, new Date(now - 3 * 60_000).toISOString(), now)).toBe(
      "Last seen at Egbe, Ikotun · 3 minutes ago",
    );
    expect(lastSeenText(null, new Date(now - 30_000).toISOString(), now)).toBe(
      "Last seen · just now",
    );
  });
  it("get 'Not expecting this?' (calls the school) and 'Where is my child?' in every ride email", async () => {
    const { rideEmail } = await import("@/lib/ride-email");
    const base = {
      childName: "Bolu",
      orgName: "Greenfield",
      emergencyPhone: "+234 801 234 5678",
      trackToken: "abc",
      siteUrl: "https://gp.app/",
    };
    const boarded = rideEmail({
      ...base,
      kind: "pupil_boarded",
      message: "Bolu boarded Bus 03 at 7:02 AM.",
    });
    expect(boarded.links).toEqual([
      { label: "Not expecting this pick-up? Call the school", href: "tel:+2348012345678" },
      { label: "Where is my child?", href: "https://gp.app/bus/abc" },
    ]);
    const dropped = rideEmail({
      ...base,
      kind: "pupil_dropped_off",
      message: "Bolu arrived at school.",
    });
    expect(dropped.links.map((l) => l.label)).toEqual([
      "Not expecting this drop-off? Call the school",
      "Where is my child?",
    ]);
  });
});

describe("Drop all at school", () => {
  it("is allowed on a morning pick-up before noon only", async () => {
    const { canDropAllAtSchool } = await import("@/lib/bus");
    expect(canDropAllAtSchool("to_school", new Date(2026, 10, 2, 7, 45))).toBe(true);
    expect(canDropAllAtSchool("to_school", new Date(2026, 10, 2, 11, 59))).toBe(true);
    expect(canDropAllAtSchool("to_school", new Date(2026, 10, 2, 12, 0))).toBe(false);
  });
  it("is never allowed on an afternoon drop-off: each pupil is dropped one by one", async () => {
    const { canDropAllAtSchool } = await import("@/lib/bus");
    expect(canDropAllAtSchool("to_home", new Date(2026, 10, 2, 9, 0))).toBe(false);
    expect(canDropAllAtSchool("to_home", new Date(2026, 10, 2, 15, 0))).toBe(false);
  });
  it("puts pupils whose parent ticked the bus into 'needs a bus' until the school assigns one", async () => {
    const { busPupilGroups } = await import("@/lib/bus");
    const g = busPupilGroups([
      { id: "a", uses_bus: true, bus_id: null },
      { id: "b", uses_bus: true, bus_id: "bus1" },
      { id: "c", uses_bus: false, bus_id: null },
    ]);
    expect(g.needsBus.map((m) => m.id)).toEqual(["a"]);
    expect(g.byBus.get("bus1")?.map((m) => m.id)).toEqual(["b"]);
  });
  it("emails the parent and opted-in guardians when a pupil boards, plus the collecting guardian on drop-off", async () => {
    const { busRideRecipients } = await import("@/lib/notification-recipients");
    const guardians = [
      { id: "g1", name: "Aunt", email: "aunt@x.com", receive_general_notifications: false },
      { id: "g2", name: "Uncle", email: "uncle@x.com", receive_general_notifications: true },
    ];
    const boarded = busRideRecipients({
      parentEmail: "mum@x.com",
      handoverGuardianId: null,
      guardians,
    });
    expect(boarded.map((r) => r.email)).toEqual(["mum@x.com", "uncle@x.com"]);
    const dropped = busRideRecipients({
      parentEmail: "mum@x.com",
      handoverGuardianId: "g1",
      guardians,
    });
    expect(dropped.map((r) => r.email)).toEqual(["mum@x.com", "aunt@x.com", "uncle@x.com"]);
  });
});
