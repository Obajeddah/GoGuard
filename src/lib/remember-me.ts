// "Keep me signed in" on the Sign in page. Browser-only helpers plus pure rules (tested).

export const REMEMBER_DAYS = 90;
/** Used only when the browser blocks the "until the browser closes" marker. */
export const SESSION_FALLBACK_HOURS = 24;

const KEY = "gp_remember";
const COOKIE = "gp_alive";

export type RememberRecord = { mode: "remember" | "session"; until: number };

export function rememberRecord(remember: boolean, now: number): RememberRecord {
  return remember
    ? { mode: "remember", until: now + REMEMBER_DAYS * 86_400_000 }
    : { mode: "session", until: now + SESSION_FALLBACK_HOURS * 3_600_000 };
}

/**
 * Whether a saved sign-in must end now.
 * - Kept sign-ins end after 90 days.
 * - Others end when the browser was closed (marker gone), or after the fallback window
 *   if the browser can't keep the marker at all.
 */
export function shouldEndSession(
  record: RememberRecord | null,
  now: number,
  browser: { aliveMarker: boolean; markersSupported: boolean },
): boolean {
  if (!record) return false; // signed in before this option existed
  if (now >= record.until) return true;
  if (record.mode === "session" && browser.markersSupported && !browser.aliveMarker) return true;
  return false;
}

function hasAliveCookie() {
  return document.cookie.split("; ").some((c) => c === `${COOKIE}=1`);
}

function setAliveCookie() {
  // No expiry: the browser drops it when it is closed.
  document.cookie = `${COOKIE}=1; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function readRecord(): RememberRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as RememberRecord;
    return (r.mode === "remember" || r.mode === "session") && typeof r.until === "number"
      ? r
      : null;
  } catch {
    return null;
  }
}

/** Call right after a successful password sign-in. */
export function saveRememberChoice(remember: boolean) {
  const record = rememberRecord(remember, Date.now());
  setAliveCookie();
  const markersSupported = hasAliveCookie();
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, markersSupported }));
  } catch {
    /* storage unavailable: the sign-in simply follows the default session */
  }
}

/** Call on app start. Returns true when the stored sign-in should be ended. */
export function sessionShouldEnd(): boolean {
  const record = readRecord();
  if (!record) return false;
  const markersSupported =
    (record as RememberRecord & { markersSupported?: boolean }).markersSupported !== false;
  return shouldEndSession(record, Date.now(), { aliveMarker: hasAliveCookie(), markersSupported });
}

export function clearRememberChoice() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
