import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingState } from "./billing";
import { emailConfigured, sendEmail, type OutgoingEmail } from "./email.server";
import { emailLayout } from "./email-template";
import { gateEmail } from "./gate-email";
import {
  gateRecipients,
  busRideRecipients,
  type RecipientGuardian,
} from "./notification-recipients";
import { rideEmail, rideEmailHtml } from "./ride-email";
import { sendPushToParent, eventPush } from "./push-notifications.server";
import { redactValue } from "./redact";
import {
  decryptGuardianRow,
  decryptMemberRow,
  decryptOrgRow,
  emailIndex,
} from "./contact-crypto.server";

const BATCH_SIZE = 20;

type OrgRow = {
  id: string;
  name: string;
  admin_email: string;
  emergency_phone: string | null;
  plan: string;
  trial_ends_at: string;
  paid_until: string | null;
};
type MemberRow = {
  id: string;
  full_name: string;
  primary_email: string | null;
  primary_email_enc?: string | null;
  parent_or_owner_name: string | null;
  bus_track_token: string;
};
type GuardianRow = {
  id: string;
  member_id: string;
  name: string;
  email: string | null;
  email_enc?: string | null;
  receive_general_notifications: boolean;
};

async function loadOrgs(ids: string[]): Promise<Map<string, OrgRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
    .in("id", ids);
  return new Map(
    (data ?? []).map((o) => [o.id, decryptOrgRow(o) as OrgRow]),
  );
}

async function loadMembers(ids: string[]): Promise<Map<string, MemberRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from("members")
    .select("id, full_name, primary_email, primary_email_enc, parent_or_owner_name, bus_track_token")
    .in("id", ids);
  return new Map((data ?? []).map((m) => [m.id, decryptMemberRow(m) as MemberRow]));
}

async function loadGuardians(memberIds: string[]): Promise<Map<string, GuardianRow[]>> {
  if (!memberIds.length) return new Map();
  const { data } = await supabaseAdmin
    .from("guardians")
    .select("id, member_id, name, email, email_enc, receive_general_notifications")
    .in("member_id", memberIds);
  const out = new Map<string, GuardianRow[]>();
  for (const g of ((data ?? []) as GuardianRow[]).map(decryptGuardianRow)) {
    const list = out.get(g.member_id) ?? [];
    list.push(g);
    out.set(g.member_id, list);
  }
  return out;
}

async function deliveredTo(sourceTable: string, sourceId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("email_deliveries")
    .select("email")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId);
  return new Set((data ?? []).map((row) => row.email.toLowerCase()));
}

// The delivery log stores the blind index of an address, not the address.
async function recordDelivery(sourceTable: string, sourceId: string, emails: string[]) {
  const hashes = emails
    .map((email) => emailIndex(email))
    .filter((hash): hash is string => !!hash)
    .map((email) => ({ source_table: sourceTable, source_id: sourceId, email }));
  if (!hashes.length) return;
  await supabaseAdmin
    .from("email_deliveries")
    .upsert(hashes, { onConflict: "source_table,source_id,email" });
}

async function deliver(
  sourceTable: string,
  sourceId: string,
  messages: OutgoingEmail[],
  pending: Set<string>,
): Promise<boolean> {
  const sentNow: string[] = [];
  for (const message of messages) {
    const key = emailIndex(message.to);
    if (key && pending.has(key)) continue;
    try {
      await sendEmail(message);
      sentNow.push(message.to);
    } catch (error) {
      console.error(`[instant-email] ${sourceTable}/${sourceId} failed`, redactValue(error));
      return false;
    }
  }
  await recordDelivery(sourceTable, sourceId, sentNow);
  return true;
}

const asRecipients = (rows: GuardianRow[]): RecipientGuardian[] =>
  rows.map((g) => ({
    id: g.id,
    name: g.name,
    email: g.email,
    receive_general_notifications: g.receive_general_notifications,
  }));

/**
 * Process instant email queue - called frequently (every 30s via cron/edge function)
 * Sends emails immediately when gate/bus events happen instead of waiting for cron
 */
export const processInstantEmailQueue = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        siteUrl: z.string().url(),
        batchSize: z.number().int().positive().max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { siteUrl, batchSize = BATCH_SIZE } = data;

    if (!emailConfigured()) {
      return { sent: 0, skipped: 0, reason: "Email not configured" };
    }

    // Get pending instant emails
    const { data: queueItems, error: queueError } = await supabaseAdmin
      .from("instant_email_queue")
      .select("*")
      .is("processed_at", null)
      .lt("attempts", 3)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (queueError || !queueItems?.length) {
      return { sent: 0, skipped: 0 };
    }

    const orgIds = [...new Set(queueItems.map((q) => q.org_id))];
    const orgs = await loadOrgs(orgIds);

    const allowed = (orgId: string) => {
      const org = orgs.get(orgId);
      return !!org && billingState(org).canSendEmails;
    };

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of queueItems) {
      if (!allowed(item.org_id)) {
        skipped++;
        // Mark as processed to avoid retry loop for billing-blocked orgs
        await supabaseAdmin
          .from("instant_email_queue")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", item.id);
        continue;
      }

      const org = orgs.get(item.org_id)!;
      let messages: OutgoingEmail[] = [];
      let pending = new Set<string>();
      let success = false;
      let claimedNoticeId: string | null = null;

      try {
        if (item.source_table === "gate_logs") {
          const { data: log } = await supabaseAdmin
            .from("gate_logs")
            .select(
              "id, org_id, member_id, guardian_id, action_type, member_name, verified_guardian_name, timestamp",
            )
            .eq("id", item.source_id)
            .maybeSingle();

          if (!log) {
            await supabaseAdmin
              .from("instant_email_queue")
              .update({ processed_at: new Date().toISOString() })
              .eq("id", item.id);
            continue;
          }

          const member = (await loadMembers([log.member_id])).get(log.member_id);
          const guardians = (await loadGuardians([log.member_id])).get(log.member_id) ?? [];

          // Get parent app link for this child
          const { data: pwaTokenRow } = await supabaseAdmin
            .from("parent_pwa_tokens")
            .select("pwa_token")
            .eq("member_id", log.member_id)
            .maybeSingle();
          const parentAppLink: string | undefined = pwaTokenRow?.pwa_token
            ? `${siteUrl.replace(/\/$/, "")}/parent/${pwaTokenRow.pwa_token}`
            : undefined;

          pending = await deliveredTo("gate_logs", log.id);
          const recipients = gateRecipients({
            parentEmail: member?.primary_email,
            parentName: member?.parent_or_owner_name ?? null,
            actingGuardianId: log.guardian_id,
            guardians: asRecipients(guardians),
          });

          messages = recipients.map((recipient) => ({
            to: recipient.email,
            ...gateEmail({
              action: log.action_type === "check_in" ? "check_in" : "check_out",
              memberName: log.member_name || member?.full_name || "your child",
              guardianName: log.verified_guardian_name || "a guardian",
              orgName: org.name,
              emergencyPhone: org.emergency_phone,
              siteUrl,
              recipient,
              ...(parentAppLink ? { parentAppLink } : {}),
            }),
          }));
        } else if (item.source_table === "transport_notices") {
          const { data: notice } = await supabaseAdmin
            .from("transport_notices")
            .select("id, org_id, member_id, guardian_id, kind, message, created_at")
            .eq("id", item.source_id)
            .maybeSingle();

          if (!notice || !notice.member_id) {
            await supabaseAdmin
              .from("instant_email_queue")
              .update({ processed_at: new Date().toISOString() })
              .eq("id", item.id);
            continue;
          }

          const member = (await loadMembers([notice.member_id])).get(notice.member_id)!;
          const guardians = (await loadGuardians([notice.member_id])).get(notice.member_id) ?? [];

          // Get parent app link for this child
          const { data: pwaTokenRow } = await supabaseAdmin
            .from("parent_pwa_tokens")
            .select("pwa_token")
            .eq("member_id", notice.member_id)
            .maybeSingle();
          const parentAppLink: string | undefined = pwaTokenRow?.pwa_token
            ? `${siteUrl.replace(/\/$/, "")}/parent/${pwaTokenRow.pwa_token}`
            : undefined;

          // The bus device also mails a ride notice the moment it happens.
          // Claim the notice first: whoever claims it is the only sender, so a
          // drop-off is not emailed twice.
          const { claimNotice } = await import("./bus-email.server");
          if (!(await claimNotice(notice.id))) {
            await supabaseAdmin
              .from("instant_email_queue")
              .update({ processed_at: new Date().toISOString() })
              .eq("id", item.id);
            continue;
          }
          claimedNoticeId = notice.id;

          pending = await deliveredTo("transport_notices", notice.id);
          const recipients = busRideRecipients({
            parentEmail: member.primary_email,
            parentName: member.parent_or_owner_name ?? null,
            handoverGuardianId: notice.guardian_id,
            guardians: asRecipients(guardians),
          });

          const content = rideEmail({
            kind: notice.kind as "pupil_boarded" | "pupil_dropped_off",
            message: notice.message,
            childName: member.full_name,
            orgName: org.name,
            emergencyPhone: org.emergency_phone,
            trackToken: member.bus_track_token,
            siteUrl,
            ...(parentAppLink ? { parentAppLink } : {}),
          });

          messages = recipients.map((recipient) => ({
            to: recipient.email,
            subject: content.subject,
            text: [content.message, ...content.links.map((l) => `${l.label}: ${l.href}`)].join(
              "\n\n",
            ),
            html: rideEmailHtml(content, { orgName: org.name, siteUrl }),
          }));
        } else if (item.source_table === "bus_emergencies") {
          pending = await deliveredTo("bus_emergencies", item.source_id);
          messages = [
            {
              to: org.admin_email,
              subject: `Bus emergency: ${org.name}`,
              text: `An emergency was reported. Open GoGuard for details: ${siteUrl}/dashboard`,
              html: emailLayout({
                orgName: org.name,
                label: "Bus emergency",
                heading: "Bus emergency reported",
                intro: "An emergency was reported on one of your buses.",
                body: `<p style="margin:0;font:400 14px/21px Helvetica,Arial,sans-serif;">Open GoGuard for the details.</p>`,
                siteUrl,
              }),
            },
          ];
        }

        success = await deliver(item.source_table, item.source_id, messages, pending);

        if (success) {
          await supabaseAdmin
            .from(item.source_table as "gate_logs" | "transport_notices" | "bus_emergencies")
            .update({ emailed_at: new Date().toISOString() })
            .eq("id", item.source_id);
          await supabaseAdmin
            .from("instant_email_queue")
            .update({ processed_at: new Date().toISOString() })
            .eq("id", item.id);
          sent++;

          // Also send push notification if parent has PWA
          try {
            let memberId: string | null = null;
            if (item.source_table === "gate_logs") {
              const { data: log } = await supabaseAdmin
                .from("gate_logs")
                .select("member_id")
                .eq("id", item.source_id)
                .maybeSingle();
              memberId = log?.member_id ?? null;
            } else if (item.source_table === "transport_notices") {
              const { data: notice } = await supabaseAdmin
                .from("transport_notices")
                .select("member_id")
                .eq("id", item.source_id)
                .maybeSingle();
              memberId = notice?.member_id ?? null;
            }

            if (memberId) {
              const { data: pwaTokenRow } = await supabaseAdmin
                .from("parent_pwa_tokens")
                .select("pwa_token, parent_link_token")
                .eq("member_id", memberId)
                .maybeSingle();

              if (pwaTokenRow?.parent_link_token) {
                if (item.source_table === "gate_logs") {
                  const { data: log } = await supabaseAdmin
                    .from("gate_logs")
                    .select("member_name, action_type, timestamp")
                    .eq("id", item.source_id)
                    .maybeSingle();
                  if (log) {
                    await sendPushToParent(pwaTokenRow.parent_link_token, {
                      ...eventPush(
                        org.name,
                        log.member_name,
                        log.action_type === "check_in" ? "arrived" : "picked_up",
                      ),
                      icon: "/icons/icon-192x192.png",
                      badge: "/icons/icon-72x72.png",
                      tag: `gate-${log.action_type}-${log.timestamp}`,
                      data: {
                        type: "gate",
                        url: pwaTokenRow.pwa_token
                          ? `/parent/app/${pwaTokenRow.pwa_token}`
                          : "/parent",
                      },
                    });
                  }
                } else if (item.source_table === "transport_notices") {
                  const { data: notice } = await supabaseAdmin
                    .from("transport_notices")
                    .select("kind, message, guardian_id")
                    .eq("id", item.source_id)
                    .maybeSingle();
                  if (notice) {
                    const { data: child } = await supabaseAdmin
                      .from("members")
                      .select("full_name")
                      .eq("id", memberId)
                      .maybeSingle();
                    await sendPushToParent(pwaTokenRow.parent_link_token, {
                      ...eventPush(
                        org.name,
                        child?.full_name,
                        notice.kind === "pupil_boarded"
                          ? "boarded"
                          : notice.guardian_id
                            ? "dropped_home"
                            : "dropped_school",
                      ),
                      icon: "/icons/icon-192x192.png",
                      badge: "/icons/icon-72x72.png",
                      tag: `bus-${notice.kind}-${Date.now()}`,
                      data: {
                        type: "bus",
                        url: pwaTokenRow.pwa_token
                          ? `/parent/app/${pwaTokenRow.pwa_token}`
                          : "/parent",
                      },
                    });
                  }
                }
              }
            } // Close try block for push notifications
          } catch (pushErr) {
            console.warn("[instant-email] Push notification failed:", redactValue(pushErr));
            // Don't fail the whole process if push fails
          }
        } else {
          // Hand the notice back so a later run can try again.
          if (claimedNoticeId) {
            const { releaseNotice } = await import("./bus-email.server");
            await releaseNotice(claimedNoticeId);
          }
          // Increment attempts
          await supabaseAdmin
            .from("instant_email_queue")
            .update({ attempts: item.attempts + 1 })
            .eq("id", item.id);
          failed++;
        }
      } catch (err) {
        console.error("[instant-email] Processing failed for", item.id, redactValue(err));
        if (claimedNoticeId) {
          const { releaseNotice } = await import("./bus-email.server");
          await releaseNotice(claimedNoticeId);
        }
        await supabaseAdmin
          .from("instant_email_queue")
          .update({ attempts: item.attempts + 1 })
          .eq("id", item.id);
        failed++;
      }
    }

    return { sent, skipped, failed };
  });

/**
 * Send a single gate email immediately (for webhook/trigger use)
 */
export const sendInstantGateEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ logId: z.string().uuid(), siteUrl: z.string().url() }).parse(input),
  )
  .handler(async ({ data }) => sendGateEmailNow(data.logId, data.siteUrl));

/**
 * Sends the gate email for one recorded scan. Exported separately so a gate
 * scan can send its notice straight away instead of waiting for a cron runner
 * that this deployment does not have.
 */
export async function sendGateEmailNow(logId: string, siteUrl: string) {
  {
    const data = { logId, siteUrl };

    const { data: log } = await supabaseAdmin
      .from("gate_logs")
      .select(
        "id, org_id, member_id, guardian_id, action_type, member_name, verified_guardian_name, timestamp",
      )
      .eq("id", data.logId)
      .maybeSingle();

    if (!log) throw new Error("Gate log not found");

    const { data: orgRow } = await supabaseAdmin
      .from("organizations")
      .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
      .eq("id", log.org_id)
      .maybeSingle();
    const org = orgRow ? decryptOrgRow(orgRow) : null;

    if (!org) throw new Error("Organization not found");

    const member = (await loadMembers([log.member_id])).get(log.member_id);
    const guardians = (await loadGuardians([log.member_id])).get(log.member_id) ?? [];

    // The phone alert is sent first and on its own: a family with no address on
    // file, or a mail provider that is down, must not stop the parent app from
    // buzzing at the gate.
    try {
      const { data: pwa } = await supabaseAdmin
        .from("parent_pwa_tokens")
        .select("parent_link_token, pwa_token")
        .eq("member_id", log.member_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pwa?.parent_link_token) {
        const { sendPushToParent } = await import("./push-notifications.server");
        await sendPushToParent(pwa.parent_link_token, {
          ...eventPush(
            org.name,
            member?.full_name || log.member_name,
            log.action_type === "check_in" ? "arrived" : "picked_up",
          ),
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-72x72.png",
          tag: `gate-${log.action_type}-${log.id}`,
          data: {
            type: "gate",
            url: pwa.pwa_token ? `/parent/app/${pwa.pwa_token}` : "/parent/app",
          },
        });
      }
    } catch (pushError) {
      console.error("[gate] push failed", redactValue(pushError));
    }

    const recipients = gateRecipients({
      parentEmail: member?.primary_email,
      parentName: member?.parent_or_owner_name ?? null,
      actingGuardianId: log.guardian_id,
      guardians: asRecipients(guardians),
    });

    // Email is the paid channel and needs an address on file. When either is
    // missing the scan is still recorded and the parent was already alerted.
    if (!billingState(org as OrgRow).canSendEmails || !emailConfigured() || !recipients.length) {
      return { sent: 0 };
    }

    const pending = await deliveredTo("gate_logs", log.id);
    const messages = recipients.map((recipient) => ({
      to: recipient.email,
      ...gateEmail({
        action: log.action_type === "check_in" ? "check_in" : "check_out",
        memberName: log.member_name || member?.full_name || "your child",
        guardianName: log.verified_guardian_name || "a guardian",
        orgName: org.name,
        emergencyPhone: org.emergency_phone,
        siteUrl: data.siteUrl,
        recipient,
      }),
    }));

    let sent = 0;
    for (const message of messages) {
      // The delivery log holds blind indexes, so compare like with like.
      const key = emailIndex(message.to);
      if (key && pending.has(key)) continue;
      await sendEmail(message);
      sent++;
    }

    await recordDelivery(
      "gate_logs",
      log.id,
      messages.map((m) => m.to),
    );
    await supabaseAdmin
      .from("gate_logs")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", log.id);

    return { sent };
  }
}

/**
 * Send a single ride email immediately
 */
export const sendInstantRideEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ noticeId: z.string().uuid(), siteUrl: z.string().url() }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!emailConfigured()) throw new Error("Email not configured");

    const { data: notice } = await supabaseAdmin
      .from("transport_notices")
      .select("id, org_id, member_id, guardian_id, kind, message, created_at")
      .eq("id", data.noticeId)
      .maybeSingle();

    if (!notice || !notice.member_id) throw new Error("Notice not found");

    const { data: orgRow } = await supabaseAdmin
      .from("organizations")
      .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
      .eq("id", notice.org_id)
      .maybeSingle();
    const org = orgRow ? decryptOrgRow(orgRow) : null;

    if (!org || !billingState(org as OrgRow).canSendEmails) {
      throw new Error("Organization not eligible for emails");
    }

    const member = (await loadMembers([notice.member_id])).get(notice.member_id)!;
    const guardians = (await loadGuardians([notice.member_id])).get(notice.member_id) ?? [];

    const pending = await deliveredTo("transport_notices", notice.id);
    const recipients = busRideRecipients({
      parentEmail: member.primary_email,
      parentName: member.parent_or_owner_name ?? null,
      handoverGuardianId: notice.guardian_id,
      guardians: asRecipients(guardians),
    });

    const content = rideEmail({
      kind: notice.kind as "pupil_boarded" | "pupil_dropped_off",
      message: notice.message,
      childName: member.full_name,
      orgName: org.name,
      emergencyPhone: org.emergency_phone,
      trackToken: member.bus_track_token,
      siteUrl: data.siteUrl,
    });

    const messages = recipients.map((recipient) => ({
      to: recipient.email,
      subject: content.subject,
      text: [content.message, ...content.links.map((l) => `${l.label}: ${l.href}`)].join("\n\n"),
      html: rideEmailHtml(content, { orgName: org.name, siteUrl: data.siteUrl }),
    }));

    for (const message of messages) {
      // The delivery log holds blind indexes, so compare like with like.
      const key = emailIndex(message.to);
      if (key && pending.has(key)) continue;
      await sendEmail(message);
    }

    await recordDelivery(
      "transport_notices",
      notice.id,
      messages.map((m) => m.to),
    );
    await supabaseAdmin
      .from("transport_notices")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", notice.id);

    return { sent: messages.length };
  });
