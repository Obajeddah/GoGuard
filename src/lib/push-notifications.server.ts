import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingState } from "./billing";

/**
 * The keys are read at the moment a push is sent, never at build time.
 *
 * Deployments of this app are built on a machine that does not hold the server
 * secrets, so an `import.meta.env` lookup was baked in as an empty private key
 * and every notification was quietly thrown away. At runtime Netlify hands the
 * function its secrets in `process.env`.
 */
function vapidKeys(): { publicKey: string; privateKey: string } {
  const env = (typeof process !== "undefined" && process.env ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  return {
    publicKey:
      env["VAPID_PUBLIC_KEY"] ||
      env["VITE_VAPID_PUBLIC_KEY"] ||
      import.meta.env["VITE_VAPID_PUBLIC_KEY"] ||
      "",
    privateKey: env["VAPID_PRIVATE_KEY"] || import.meta.env["VAPID_PRIVATE_KEY"] || "",
  };
}

/**
 * The public key is taken from the private key, so the pair the phone
 * subscribed with and the pair the server signs with can never drift apart
 * (they are read from two different places in hosting settings).
 */
async function publicKeyFor(privateKey: string): Promise<string> {
  if (!privateKey) return "";
  try {
    const { createECDH } = await import("node:crypto");
    const raw = privateKey.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(raw, "base64"));
    return ecdh.getPublicKey().toString("base64url");
  } catch (err) {
    console.error("[push] could not derive the public key:", err);
    return "";
  }
}

/**
 * The key a phone must subscribe with. The page asks for this so it always
 * matches the server, even if the key was rotated after the site was built.
 */
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const { publicKey, privateKey } = vapidKeys();
  return { publicKey: (await publicKeyFor(privateKey)) || publicKey, supported: !!privateKey };
});

/**
 * `web-push` is a CommonJS module. Depending on how the server bundle is built
 * the import arrives as the module itself or wrapped in `default`, and reading
 * the wrong one made every send crash before it left the server.
 */
async function loadWebPush() {
  const mod = (await import("web-push")) as unknown as {
    default?: typeof import("web-push");
  } & typeof import("web-push");
  const webpush = mod.default ?? mod;
  if (typeof webpush?.sendNotification !== "function") {
    throw new Error("web-push is not available on the server");
  }
  return webpush;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    type?: string;
    memberId?: string;
    childName?: string;
    action?: string;
    kind?: string;
  };
}

/** "gone" means the phone threw the subscription away and it must be pruned. */
type PushResult = "sent" | "gone" | "failed";

async function sendWebPush(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<PushResult> {
  const { publicKey, privateKey } = vapidKeys();
  if (!privateKey) {
    console.error("[push] no VAPID private key on the server; alert not sent");
    return "failed";
  }
  const signingKey = (await publicKeyFor(privateKey)) || publicKey;
  if (!signingKey) {
    console.error("[push] no usable VAPID public key; alert not sent");
    return "failed";
  }

  try {
    const webpush = await loadWebPush();
    webpush.setVapidDetails("mailto:admin@goguard.ng", signingKey, privateKey);

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      console.warn("[push] this device's subscription has expired; removing it");
      return "gone";
    }
    if (status === 401 || status === 403) {
      // The phone subscribed with a different key than the server signs with;
      // dropping it lets the app register again with the right one.
      console.warn("[push] key mismatch with this device; asking it to re-register");
      return "gone";
    }
    console.error("[push] Send failed:", err);
    return "failed";
  }
}

/**
 * Subscribe a parent to push notifications
 */
export const subscribePush = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentLinkToken: z.string().uuid(),
        subscription: z.object({
          endpoint: z.string().url(),
          keys: z.object({
            p256dh: z.string(),
            auth: z.string(),
          }),
        }),
        userAgent: z.string().optional(),
        pwaToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parentLinkToken, subscription, userAgent } = data;

    // Verify parent_link_token exists
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, org_id")
      .eq("parent_link_token", parentLinkToken)
      .limit(1)
      .maybeSingle();

    if (memberError || !member) {
      throw new Error("Invalid parent link token");
    }

    // Check org billing
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("plan, trial_ends_at, paid_until")
      .eq("id", member.org_id)
      .maybeSingle();

    if (!org || !billingState(org as { plan: string; trial_ends_at: string; paid_until: string | null }).canSendEmails) {
      throw new Error("Organization not eligible for notifications");
    }

    const { data: existing } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    // Upsert subscription
    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        parent_link_token: parentLinkToken,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

    if (error) throw error;

    // No "alerts are on" notification here. The app re-registers this phone
    // every time it opens, so a confirmation push became a message on every
    // sign-in. A phone only ever hears about the child, never about itself.
    return { success: true, isNew: !existing };
  });

/**
 * Unsubscribe from push notifications
 */
export const unsubscribePush = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentLinkToken: z.string().uuid(),
        endpoint: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parentLinkToken, endpoint } = data;

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("parent_link_token", parentLinkToken)
      .eq("endpoint", endpoint);

    if (error) throw error;
    return { success: true };
  });

/**
 * Send push notification to all subscriptions for a parent_link_token
 */
export async function sendPushToParent(
  parentLinkToken: string,
  payload: PushPayload,
): Promise<number> {
  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("parent_link_token", parentLinkToken);

  if (error) {
    console.warn("[push] could not read this parent's devices:", error.message);
    return 0;
  }
  if (!subs?.length) {
    // No phone has turned alerts on for this parent yet. Logged because a
    // silent zero here looks exactly like a failed send from the outside.
    console.warn(`[push] no device registered for ${parentLinkToken}`);
    return 0;
  }

  let sent = 0;
  for (const sub of subs) {
    const result = await sendWebPush(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
    );
    if (result === "sent") {
      await supabaseAdmin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("endpoint", sub.endpoint);
      sent++;
    } else if (result === "gone") {
      await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    }
  }
  if (!sent) {
    console.warn(`[push] nothing delivered for ${parentLinkToken} (${subs.length} device(s))`);
  }
  return sent;
}

/**
 * The words a parent sees. The title is the school, because that is who the
 * message is really from; the body says only what happened to the child. No
 * app branding, no instructions, no extra notes.
 */
export type PushEvent =
  | "arrived"
  | "picked_up"
  | "boarded"
  | "dropped_school"
  | "dropped_home"
  | "still_waiting";

export function eventPush(
  orgName: string | null | undefined,
  childName: string | null | undefined,
  event: PushEvent,
): { title: string; body: string } {
  const who = childName?.trim() || "Your child";
  const body: Record<PushEvent, string> = {
    arrived: `${who} has arrived at school.`,
    picked_up: `${who} has been picked up.`,
    boarded: `${who} has boarded the school bus.`,
    dropped_school: `${who} has been dropped off at school.`,
    dropped_home: `${who} has been dropped off at home.`,
    still_waiting: `${who} has not been picked up yet.`,
  };
  return { title: orgName?.trim() || "School update", body: body[event] };
}

/**
 * Send push notification for gate event
 */
export const sendGatePush = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentLinkToken: z.string().uuid(),
        childName: z.string(),
        action: z.enum(["check_in", "check_out"]),
        orgName: z.string(),
        timestamp: z.string(),
        pwaToken: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parentLinkToken, childName, action, orgName, timestamp, pwaToken } = data;
    const sent = await sendPushToParent(parentLinkToken, {
      ...eventPush(orgName, childName, action === "check_in" ? "arrived" : "picked_up"),
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-72x72.png",
      tag: `gate-${action}-${timestamp}`,
      data: {
        type: "gate",
        url: pwaToken ? `/parent/app/${pwaToken}` : "/parent",
        childName,
        action,
      },
    });
    return { sent };
  });

/**
 * Send push notification for bus event
 */
export const sendBusPush = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentLinkToken: z.string().uuid(),
        childName: z.string(),
        kind: z.enum(["pupil_boarded", "pupil_dropped_off"]),
        busNumber: z.string().optional(),
        location: z.string().optional(),
        orgName: z.string().optional(),
        pwaToken: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parentLinkToken, childName, kind, busNumber, location, pwaToken, orgName } = data;
    void busNumber;
    void location;
    const sent = await sendPushToParent(parentLinkToken, {
      ...eventPush(orgName, childName, kind === "pupil_boarded" ? "boarded" : "dropped_school"),
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-72x72.png",
      tag: `bus-${kind}-${Date.now()}`,
      data: {
        type: "bus",
        url: pwaToken ? `/parent/app/${pwaToken}` : "/parent",
        childName,
        kind,
      },
    });
    return { sent };
  });