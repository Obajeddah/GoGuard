/**
 * Request-boundary glue for the limiter in `rate-limit.ts`.
 *
 * This runs from the global request middleware in `src/start.ts`, so it sees
 * every document request and every server-function RPC. That matters: a guard
 * placed inside a server-function handler is skipped when the function is
 * stubbed for the client bundle, which is how an earlier attempt silently did
 * nothing.
 *
 * Deliberately free of `@tanstack/react-start/server`: a static import of a
 * server-only module here would be pulled into the client graph through the
 * routes that import `registration.functions.ts`, and Vite's import protection
 * would refuse to build. Taking the `Request` as an argument keeps this module
 * portable and unit-testable.
 *
 * Storage is process memory: on Netlify Functions each warm instance keeps its
 * own counters, so the limits below are per instance, not global. That still
 * stops single-source enumeration (the realistic abuse: scripted token/hash
 * guessing), and the seam is one object, swap the registry for a shared table
 * when the volume justifies it. Fail-open everywhere: a limiter fault or a
 * missing client IP must never take a parent-facing page down.
 */
import {
  RateLimiterRegistry,
  clientIpFromHeaders,
  type RateLimitDecision,
  type RateLimitRule,
} from "./rate-limit";

/**
 * Per-IP budgets for what an anonymous visitor can reach. Page budgets are
 * modest so a parent retrying a slow page is never punished; the write budget
 * is tight because each registration POST costs several database writes plus
 * storage uploads.
 */
export const ANONYMOUS_RULES = {
  "pass-lookup": { limit: 40, windowMs: 60_000 },
  "register-read": { limit: 30, windowMs: 60_000 },
  "bus-track": { limit: 40, windowMs: 60_000 },
  /** Anonymous server-function reads (pass, bus, link lookups). */
  "server-fn-read": { limit: 120, windowMs: 60_000 },
  /** Anonymous server-function writes (registration, checkout, invites). */
  "server-fn-write": { limit: 20, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export type LimitBucket = keyof typeof ANONYMOUS_RULES;

const registry = new RateLimiterRegistry(ANONYMOUS_RULES);

const PAGE_BUCKETS: ReadonlyArray<readonly [prefix: string, bucket: LimitBucket]> = [
  ["/pass/", "pass-lookup"],
  ["/register/", "register-read"],
  ["/bus/", "bus-track"],
];

const SERVER_FN_PREFIX = "/_serverFn/";

const ALLOWED: RateLimitDecision = {
  ok: true,
  remaining: Infinity,
  retryAfterMs: 0,
  limit: Infinity,
};

let warnedMissingIp = false;
let warnedFailure = false;

/**
 * Which budget a request belongs to, or null when it is not anonymous traffic.
 *
 * Signed-in RPCs carry a bearer token and are already identified and bounded by
 * RLS, so they skip the shared per-IP cap. Static assets never match.
 */
export function bucketForRequest(request: Request): LimitBucket | null {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }

  for (const [prefix, bucket] of PAGE_BUCKETS) {
    if (pathname.startsWith(prefix)) return bucket;
  }

  if (!pathname.startsWith(SERVER_FN_PREFIX)) return null;
  if (request.headers.has("authorization")) return null;

  const method = request.method.toUpperCase();
  return method === "GET" || method === "HEAD" ? "server-fn-read" : "server-fn-write";
}

/** Records the request against its budget. Never throws. */
export function checkRequestLimit(request: Request): RateLimitDecision {
  const bucket = bucketForRequest(request);
  if (!bucket) return ALLOWED;

  const ip = clientIpFromHeaders(request.headers);
  if (!ip) {
    if (!warnedMissingIp) {
      warnedMissingIp = true;
      console.warn("[rate-limit] no client IP header; anonymous limits are not applied");
    }
    return ALLOWED;
  }

  try {
    return registry.take(bucket, ip);
  } catch (error) {
    if (!warnedFailure) {
      warnedFailure = true;
      console.warn("[rate-limit] store failed, allowing request", error);
    }
    return ALLOWED;
  }
}

export const RATE_LIMIT_MESSAGE =
  "Too many attempts from this connection. Please wait a minute and try again.";

export type RateLimitFormat = "json" | "html";

/** 429 with `Retry-After`, shaped for the caller: JSON for RPCs, a page for navigation. */
export function rateLimitResponse(
  retryAfterMs: number,
  format: RateLimitFormat = "json",
  message = RATE_LIMIT_MESSAGE,
): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const headers: Record<string, string> = {
    "retry-after": String(seconds),
    "cache-control": "no-store",
  };

  if (format === "html") {
    headers["content-type"] = "text/html; charset=utf-8";
    return new Response(rateLimitPage(seconds, message), { status: 429, headers });
  }

  headers["content-type"] = "application/json; charset=utf-8";
  return new Response(JSON.stringify({ error: message }), { status: 429, headers });
}

/**
 * Returns the 429 to send, or null when the request may continue.
 */
export function guardRequest(request: Request, format: RateLimitFormat = "json"): Response | null {
  const decision = checkRequestLimit(request);
  if (decision.ok) return null;
  console.warn(`[rate-limit] blocked ${request.method} ${new URL(request.url).pathname}`);
  return rateLimitResponse(decision.retryAfterMs, format);
}

/** Minimal branded page: a parent refreshing a slow pass should not see raw JSON. */
function rateLimitPage(seconds: number, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Too many attempts · GoGuard</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: oklch(0.968 0.014 82); color: oklch(0.22 0.035 165);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 26rem; background: oklch(0.99 0.006 85); border-radius: 28px;
    border: 1px solid oklch(0.87 0.02 80); padding: 32px;
    box-shadow: 0 18px 40px -24px oklch(0.22 0.035 165 / 0.35);
  }
  .badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 14px;
    background: oklch(0.82 0.15 78); color: oklch(0.24 0.05 60);
    font-weight: 700; font-size: 20px;
  }
  h1 { font-size: 1.35rem; margin: 18px 0 8px; letter-spacing: -0.01em; }
  p { margin: 0 0 8px; color: oklch(0.47 0.03 160); }
  a {
    display: inline-block; margin-top: 18px; padding: 10px 18px; border-radius: 999px;
    background: oklch(0.34 0.07 162); color: oklch(0.97 0.014 85);
    text-decoration: none; font-weight: 600; font-size: 14px;
  }
</style>
</head>
<body>
  <main class="card">
    <span class="badge" aria-hidden="true">!</span>
    <h1>Too many attempts</h1>
    <p>${message}</p>
    <p>You can try again in about ${seconds} second${seconds === 1 ? "" : "s"}.</p>
    <a href="">Try again</a>
  </main>
</body>
</html>`;
}
