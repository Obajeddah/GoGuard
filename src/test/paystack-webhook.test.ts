import { describe, expect, it } from "vitest";

import { parsePaystackEvent } from "@/lib/paystack-webhook";

const reference = `gp_${"a".repeat(32)}`;

describe("Paystack webhook body", () => {
  it("rejects malformed JSON and malformed charge payloads", () => {
    expect(parsePaystackEvent("not json").kind).toBe("bad");
    expect(
      parsePaystackEvent(JSON.stringify({ event: "charge.success", data: { reference } })).kind,
    ).toBe("bad");
  });
  it("acknowledges unrelated events without settling", () => {
    expect(parsePaystackEvent(JSON.stringify({ event: "ping", data: {} })).kind).toBe("ignore");
  });
  it("ignores unsuccessful charge statuses", () => {
    const raw = JSON.stringify({
      event: "charge.success",
      data: { reference, amount: 750000, currency: "NGN", status: "failed" },
    });
    expect(parsePaystackEvent(raw).kind).toBe("ignore");
  });
  it("returns the verified charge only for a successful payment", () => {
    const raw = JSON.stringify({
      event: "charge.success",
      data: { reference, amount: 750000, currency: "NGN", status: "success" },
    });
    expect(parsePaystackEvent(raw)).toEqual({
      kind: "charge",
      charge: { reference, amount: 750000, currency: "NGN", status: "success" },
    });
  });
});
