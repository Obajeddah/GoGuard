import { SlidingWindowLimiter, RateLimiterRegistry, clientIpFromHeaders } from "@/lib/rate-limit";
import { bucketForRequest, guardRequest } from "@/lib/rate-limit.server";

function fakeClock(start = 0) {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("SlidingWindowLimiter", () => {
  it("allows exactly `limit` requests then reports how long to wait", () => {
    const { clock } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60_000 }, clock);

    expect(limiter.take("ip").ok).toBe(true);
    expect(limiter.take("ip").remaining).toBe(1);
    expect(limiter.take("ip").ok).toBe(true);

    const blocked = limiter.take("ip");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);
  });

  it("frees a slot once the window has passed", () => {
    const { clock, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1_000 }, clock);

    expect(limiter.take("ip").ok).toBe(true);
    expect(limiter.take("ip").ok).toBe(false);

    advance(1_001);
    expect(limiter.take("ip").ok).toBe(true);
  });

  it("counts down retryAfterMs as the window slides", () => {
    const { clock, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 10_000 }, clock);

    limiter.take("ip");
    advance(4_000);
    expect(limiter.take("ip").retryAfterMs).toBe(6_000);

    advance(6_000);
    expect(limiter.take("ip").ok).toBe(true);
  });

  it("keeps keys independent", () => {
    const { clock } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000 }, clock);

    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("b").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
  });

  it("peek never consumes a request", () => {
    const { clock } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 60_000 }, clock);

    expect(limiter.peek("ip").remaining).toBe(2);
    expect(limiter.peek("ip").remaining).toBe(2);
    limiter.take("ip");
    expect(limiter.peek("ip").remaining).toBe(1);
  });

  it("does not count a refused request as a hit", () => {
    const { clock, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1_000 }, clock);

    limiter.take("ip");
    limiter.take("ip");
    limiter.take("ip");
    advance(500);
    // Still only the original hit inside the window, so the key stays blocked.
    expect(limiter.peek("ip").remaining).toBe(0);
    advance(600);
    expect(limiter.take("ip").ok).toBe(true);
  });

  it("rejects nonsense rules", () => {
    expect(() => new SlidingWindowLimiter({ limit: 0, windowMs: 1_000 })).toThrow();
    expect(() => new SlidingWindowLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });

  it("bounds memory by evicting the least recently used key", () => {
    const { clock, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 60_000 }, clock, 2);

    limiter.take("old");
    advance(10);
    limiter.take("newer");
    advance(10);
    limiter.take("newest");

    expect(limiter.size).toBe(2);
    expect(limiter.peek("old").remaining).toBe(5);
    expect(limiter.peek("newest").remaining).toBe(4);
  });

  it("prunes expired keys", () => {
    const { clock, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 1_000 }, clock);

    limiter.take("a");
    limiter.take("b");
    expect(limiter.size).toBe(2);

    advance(2_000);
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe("RateLimiterRegistry", () => {
  it("keeps buckets separate", () => {
    const { clock } = fakeClock();
    const registry = new RateLimiterRegistry(
      { read: { limit: 1, windowMs: 60_000 }, write: { limit: 1, windowMs: 60_000 } },
      clock,
    );

    expect(registry.take("read", "ip").ok).toBe(true);
    expect(registry.take("write", "ip").ok).toBe(true);
    expect(registry.take("read", "ip").ok).toBe(false);
  });

  it("allows an unknown bucket instead of blocking traffic", () => {
    const registry = new RateLimiterRegistry({ read: { limit: 1, windowMs: 60_000 } });
    const decision = registry.take("typo", "ip");

    expect(decision.ok).toBe(true);
    expect(decision.remaining).toBe(Infinity);
    expect(registry.has("typo")).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the header the hosting platform sets", () => {
    const headers = new Headers({
      "x-nf-client-connection-ip": "203.0.113.9",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("falls back to the leftmost forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("returns null when the request carries no address", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "  " }))).toBeNull();
  });
});
