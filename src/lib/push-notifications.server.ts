import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingState } from "./billing";

const VAPID_PUBLIC_KEY = import.meta.env["VITE_VAPID_PUBLIC_KEY"] || "";
const VAPID_PRIVATE_KEY = import.meta.env["VAPID_PRIVATE_KEY"] || "";

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

async function sendWebPush(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PRIVATE_KEY) {
    console.warn("[push] VAPID_PRIVATE_KEY not configured");
    return false;
  }

  try {
    const webpush = await import("web-push");
    webpush.default.setVapidDetails(
      "mailto:admin@goguard.ng",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );

    await webpush.default.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    console.error("[push] Send failed:", err);
    return false;
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

    // Send welcome notification
    await sendWebPush(
      subscription,
      {
        title: "GoGuard Notifications Enabled",
        body: "You'll receive instant alerts for gate scans and bus updates.",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        tag: "welcome",
        data: { type: "welcome" },
      },
    );

    return { success: true };
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

  if (error || !subs?.length) return 0;

  let sent = 0;
  for (const sub of subs) {
    const success = await sendWebPush(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
    );
    if (success) {
      await supabaseAdmin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("endpoint", sub.endpoint);
      sent++;
    }
  }
  return sent;
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
    const actionText = action === "check_in" ? "arrived at" : "left";
    const sent = await sendPushToParent(parentLinkToken, {
      title: `${childName} ${actionText} ${orgName}`,
      body: `Scanned at ${new Date(timestamp).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
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
        pwaToken: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { parentLinkToken, childName, kind, busNumber, location, pwaToken } = data;
    const actionText = kind === "pupil_boarded" ? "boarded" : "was dropped off from";
    const sent = await sendPushToParent(parentLinkToken, {
      title: `${childName} ${actionText} the bus`,
      body: busNumber ? `Bus ${busNumber}${location ? ` at ${location}` : ""}` : location || "Bus update",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
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