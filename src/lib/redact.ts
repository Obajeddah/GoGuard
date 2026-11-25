/**
 * Redaction for anything on its way into a log.
 *
 * School records are children's data, so a stack trace or Supabase error that
 * quotes a guardian's email is a compliance incident, not a debugging detail.
 * Every rule here is deliberately narrow and bounded, so it cannot backtrack
 * catastrophically on a long stack trace.
 */

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

/** Local part is reduced to its first character; the domain is kept for triage. */
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/** Bearer tokens and API keys pasted into auth headers. */
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/** Supabase JWTs (anon and service role share this shape). */
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;

/** Supabase's newer publishable/secret keys. */
const SUPABASE_KEY = /\bsb_(publishable|secret)_[A-Za-z0-9_-]{8,}/g;

/** Paystack (and Stripe-shaped) secret keys. */
const PAYMENT_KEY = /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g;

/** Connection strings with an inline password. */
const CONNECTION_STRING = /\b(postgres(?:ql)?:\/\/[^:\s/@]*:)[^@\s/]+@/g;

/** QR pass codes, invite codes and other long hex identifiers. */
const LONG_HEX = /\b[a-f0-9]{32,}\b/gi;

/** Grouped card numbers. */
const CARD = /\b(?:\d{4}[ -]){3}\d{4}\b/g;

/** Nigerian mobile numbers, the only phone format this app collects. */
const NG_PHONE = /(?:\+?234|0)[\s-]?[789]\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;

/** Any other international number with a country code and 10+ digits. */
const INTL_PHONE = /\+\d{10,15}\b/g;

/** Token-bearing query parameters, which appear in URLs inside error messages. */
const QUERY_SECRET =
  /([?&](?:token|code|hash|key|api_?key|secret|access_token|password)=)[^&\s"'<>]+/gi;

export function redactText(input: string): string {
  if (!input) return input;
  let out = input;
  out = out.replace(BEARER, `$1${REDACTED}`);
  out = out.replace(JWT, `[jwt]`);
  out = out.replace(SUPABASE_KEY, `sb_$1_${REDACTED}`);
  out = out.replace(PAYMENT_KEY, `$1_$2_${REDACTED}`);
  out = out.replace(CONNECTION_STRING, `$1${REDACTED}@`);
  out = out.replace(LONG_HEX, `[hash]`);
  out = out.replace(EMAIL, `$1***@$2`);
  out = out.replace(CARD, `[card]`);
  out = out.replace(NG_PHONE, `[phone]`);
  out = out.replace(INTL_PHONE, `[phone]`);
  out = out.replace(QUERY_SECRET, `$1${REDACTED}`);
  return out;
}

/**
 * Deep-redacts the string fields of a value (used for structured log payloads).
 * Returns a copy: the caller's object is never mutated. Depth-limited and
 * cycle-safe, because log arguments can be anything.
 */
export function redactValue<T>(value: T): T {
  return walk(value, 0, new WeakSet()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));

  if (value instanceof Error) {
    return redactText(value.message);
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = walk(entry, depth + 1, seen);
  }
  return out;
}
