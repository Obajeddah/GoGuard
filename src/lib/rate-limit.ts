/**
 * Sliding-window rate limiting for the anonymous public surfaces (parent
 * registration, pass lookup, guard onboarding).
 *
 * The algorithm lives here with an injected clock so it is deterministic and
 * unit-testable; the storage lives in `rate-limit.server.ts`. Deliberately no
 * backend-specific store: the same rules can later be backed by a shared table
 * or Redis without touching the call sites.
 */

export interface RateLimitRule {
  /** Requests allowed per key inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitDecision {
  ok: boolean;
  /** Requests still available in the current window (0 when blocked). */
  remaining: number;
  /** Milliseconds until a slot frees up; 0 when the request is allowed. */
  retryAfterMs: number;
  /** The rule's limit, echoed for headers/logs. */
  limit: number;
}

export type Clock = () => number;

/** Bounds memory: keys are evicted oldest-first once a limiter is full. */
export const MAX_KEYS_PER_LIMITER = 10_000;

const ALLOWED = (limit: number, remaining: number): RateLimitDecision => ({
  ok: true,
  remaining,
  retryAfterMs: 0,
  limit,
});

function blocked(limit: number, retryAfterMs: number): RateLimitDecision {
  return { ok: false, remaining: 0, retryAfterMs, limit };
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly clock: Clock;

  constructor(rule: RateLimitRule, clock: Clock = Date.now, maxKeys = MAX_KEYS_PER_LIMITER) {
    if (!Number.isFinite(rule.limit) || rule.limit < 1) throw new Error("rate limit must be >= 1");
    if (!Number.isFinite(rule.windowMs) || rule.windowMs < 1)
      throw new Error("window must be >= 1ms");
    this.limit = Math.floor(rule.limit);
    this.windowMs = Math.floor(rule.windowMs);
    this.maxKeys = Math.max(1, Math.floor(maxKeys));
    this.clock = clock;
  }

  /** Timestamps newer than the window, oldest first. */
  private fresh(timestamps: number[], now: number): number[] {
    const cutoff = now - this.windowMs;
    let start = 0;
    while (start < timestamps.length && timestamps[start]! <= cutoff) start++;
    return start === 0 ? timestamps : timestamps.slice(start);
  }

  private evictIfFull(nextKey: string) {
    if (this.hits.size < this.maxKeys || this.hits.has(nextKey)) return;
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, stamps] of this.hits) {
      const last = stamps[stamps.length - 1] ?? 0;
      if (last < oldestAt) {
        oldestAt = last;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.hits.delete(oldestKey);
  }

  /** Records a request and returns the decision. */
  take(key: string): RateLimitDecision {
    const now = this.clock();
    const stamps = this.fresh(this.hits.get(key) ?? [], now);

    if (stamps.length >= this.limit) {
      this.hits.set(key, stamps);
      const oldest = stamps[stamps.length - this.limit]!;
      return blocked(this.limit, Math.max(1, oldest + this.windowMs - now));
    }

    stamps.push(now);
    this.evictIfFull(key);
    this.hits.set(key, stamps);
    return ALLOWED(this.limit, this.limit - stamps.length);
  }

  /** Reports the decision without recording a request. */
  peek(key: string): RateLimitDecision {
    const now = this.clock();
    const stamps = this.fresh(this.hits.get(key) ?? [], now);
    if (stamps.length < this.limit) return ALLOWED(this.limit, this.limit - stamps.length);
    const oldest = stamps[stamps.length - this.limit]!;
    return blocked(this.limit, Math.max(1, oldest + this.windowMs - now));
  }

  /** Drops expired keys; safe to call on a timer. */
  prune(): void {
    const now = this.clock();
    for (const [key, stamps] of this.hits) {
      if (this.fresh(stamps, now).length === 0) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

export class RateLimiterRegistry {
  private readonly limiters = new Map<string, SlidingWindowLimiter>();

  constructor(
    rules: Record<string, RateLimitRule>,
    clock: Clock = Date.now,
    maxKeys = MAX_KEYS_PER_LIMITER,
  ) {
    for (const [bucket, rule] of Object.entries(rules)) {
      this.limiters.set(bucket, new SlidingWindowLimiter(rule, clock, maxKeys));
    }
  }

  /** Unknown buckets are allowed, so a missing rule can never block traffic. */
  take(bucket: string, key: string): RateLimitDecision {
    const limiter = this.limiters.get(bucket);
    return limiter
      ? limiter.take(key)
      : { ok: true, remaining: Infinity, retryAfterMs: 0, limit: Infinity };
  }

  peek(bucket: string, key: string): RateLimitDecision {
    const limiter = this.limiters.get(bucket);
    return limiter
      ? limiter.peek(key)
      : { ok: true, remaining: Infinity, retryAfterMs: 0, limit: Infinity };
  }

  prune(): void {
    for (const limiter of this.limiters.values()) limiter.prune();
  }

  has(bucket: string): boolean {
    return this.limiters.has(bucket);
  }
}

/**
 * True when an error is the 429 our limiter throws, so a route-level `catch`
 * can rethrow it instead of turning it into a misleading "not found".
 */
export function isRateLimitResponse(error: unknown): boolean {
  if (error instanceof Response) return error.status === 429;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 429;
}

/**
 * Best-effort client identity from proxy headers.
 *
 * On Netlify `x-nf-client-connection-ip` is set by the platform and cannot be
 * spoofed by the client; `cf-connecting-ip` and `x-real-ip` are trusted next.
 * `x-forwarded-for` is last because the leftmost entry is client-supplied when
 * the app is not behind a proxy that overwrites it.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const direct = ["x-nf-client-connection-ip", "cf-connecting-ip", "x-real-ip"];
  for (const name of direct) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first ? first : null;
}
