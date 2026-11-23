// Server-only Paystack helpers. Never import from route or component files.

const API = "https://api.paystack.co";

export function paystackKey(): string | null {
  return process.env["PAYSTACK_SECRET_KEY"] || null;
}

export async function paystackRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = paystackKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !body.status || !body.data) {
    console.error("[paystack]", path, res.status, body.message);
    throw new Error(body.message || `Paystack request failed (${res.status})`);
  }
  return body.data;
}

/** Hex HMAC-SHA512 of the raw body, as Paystack sends in `x-paystack-signature`. */
export async function paystackSignature(rawBody: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-512" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawBody));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Marks a pending payment as paid and extends the school's subscription.
 * Safe to call more than once for the same reference (webhook + return page).
 */
export async function settlePayment(
  reference: string,
  paid: { amountKobo: number; currency: string },
): Promise<"settled" | "already" | "unknown" | "mismatch"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("settle_paystack_payment", {
    _reference: reference, _amount_kobo: paid.amountKobo, _currency: paid.currency,
  });
  if (error) throw new Error("Payment access could not be updated. Please retry verification.");
  if (data === "settled" || data === "already" || data === "unknown" || data === "mismatch") return data;
  throw new Error("Unexpected payment verification result");
}
