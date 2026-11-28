// Server-only: the "your child is still at school" watch.
//
// Two warnings only, 30 minutes after closing, then an hour after closing.
// Nothing is sent unless the school's own record still shows the child inside
// (their last gate action today is a check-in), so a picked-up child never
// produces a false alarm. Each warning is recorded once per child per day, so
// refreshing a screen cannot send it twice.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { schoolDate } from "./attendance";
import { emailConfigured, sendEmail } from "./email.server";
import { emailFooter, emailLayout } from "./email-template";
import { gateRecipients } from "./notification-recipients";
import { redactValue } from "./redact";
import { decryptGuardianRow, decryptMemberRow, decryptOrgRow } from "./contact-crypto.server";

const CLOSE_DEFAULT = "15:00";
const MAX_CHILDREN = 40;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });

export interface PickupWatchResult {
  sent: number;
  stage: 1 | 2 | 0;
}

/** Runs the watch for one school, optionally for a few children (one family). */
export async function runPickupWatch(
  orgId: string,
  memberIds?: string[],
): Promise<PickupWatchResult> {
  const { data: rawOrg } = await supabaseAdmin
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  if (!rawOrg) return { sent: 0, stage: 0 };
  const org = decryptOrgRow(
    rawOrg as unknown as {
      id: string;
      name: string;
      emergency_phone: string | null;
      emergency_phone_enc?: string | null;
      school_closes_at?: string | null;
    },
  );

  const closesAt = (org.school_closes_at ?? CLOSE_DEFAULT).slice(0, 5);
  const today = schoolDate(new Date());
  const closing = new Date(`${today}T${closesAt}:00+01:00`).getTime();
  const now = Date.now();
  const firstAt = closing + 30 * 60_000;
  const secondAt = closing + 60 * 60_000;
  if (now < firstAt) return { sent: 0, stage: 0 };

  // If this is the first check of the day and it is already past the hour, the
  // one-hour warning is the accurate one; the half-hour text would be stale.
  const stage: 1 | 2 = now >= secondAt ? 2 : 1;
  const kind = stage === 2 ? "pickup_60" : "pickup_30";

  const startIso = `${today}T00:00:00+01:00`;
  let logQuery = supabaseAdmin
    .from("gate_logs")
    .select("member_id, action_type, timestamp")
    .eq("org_id", orgId)
    .gte("timestamp", startIso)
    .order("timestamp", { ascending: false })
    .limit(4000);
  if (memberIds?.length) logQuery = logQuery.in("member_id", memberIds);
  const { data: logs } = await logQuery;

  // Latest action per child: still inside only when it is a check-in.
  const inside = new Set<string>();
  const seen = new Set<string>();
  for (const log of logs ?? []) {
    if (seen.has(log.member_id)) continue;
    seen.add(log.member_id);
    if (log.action_type === "check_in") inside.add(log.member_id);
  }
  if (!inside.size) return { sent: 0, stage };

  // Children handed to a guardian by the bus are not at school any more.
  const { data: busLogs } = await supabaseAdmin
    .from("pupil_bus_logs")
    .select("member_id, status, timestamp")
    .eq("org_id", orgId)
    .gte("timestamp", startIso)
    .eq("status", "dropped_off");
  for (const log of busLogs ?? []) inside.delete(log.member_id);

  if (!inside.size) return { sent: 0, stage };
  const ids = [...inside].slice(0, MAX_CHILDREN);

  const [{ data: memberRows }, { data: doneToday }] = await Promise.all([
    supabaseAdmin
      .from("members")
      .select(
        "id, full_name, identifier_code, primary_email, primary_email_enc, parent_or_owner_name, parent_link_token",
      )
      .in("id", ids),
    supabaseAdmin
      .from("transport_notices")
      .select("member_id, kind")
      .eq("org_id", orgId)
      .in("kind", ["pickup_30", "pickup_60"])
      .gte("created_at", startIso),
  ]);
  const already = new Set((doneToday ?? []).map((n) => `${n.member_id}|${n.kind}`));
  if (!memberRows?.length) return { sent: 0, stage };
  const members = memberRows.map(decryptMemberRow);

  const { data: guardianRows } = await supabaseAdmin
    .from("guardians")
    .select("id, member_id, name, email, email_enc, receive_general_notifications")
    .in("member_id", members.map((m) => m.id));
  const guardians = (guardianRows ?? []).map(decryptGuardianRow);

  // One parent app link per family, used so the alert opens the right children.
  const linkTokens = [...new Set(members.map((m) => m.parent_link_token).filter(Boolean))] as string[];
  const { data: pwaRows } = linkTokens.length
    ? await supabaseAdmin
        .from("parent_pwa_tokens")
        .select("pwa_token, parent_link_token")
        .in("parent_link_token", linkTokens)
    : { data: [] as { pwa_token: string; parent_link_token: string }[] };
  const pwaByLink = new Map((pwaRows ?? []).map((r) => [r.parent_link_token, r.pwa_token]));

  const siteUrl = process.env["URL"] ?? "https://goguard.ng";
  const minutesLate = stage === 2 ? 60 : 30;
  let sent = 0;

  for (const member of members) {
    if (already.has(`${member.id}|${kind}`)) continue;

    const child = `${member.full_name}${member.identifier_code ? ` (${member.identifier_code})` : ""}`;
    const message =
      `${child} has not been picked up as of ${clock(now)}. That is ${minutesLate} minutes after school closed at ${clock(closing)}. ` +
      `Please contact ${org.name}${org.emergency_phone ? ` on ${org.emergency_phone}` : ""} if you need help.`;

    const { data: notice } = await supabaseAdmin
      .from("transport_notices")
      .insert({ org_id: org.id, member_id: member.id, kind, message })
      .select("id")
      .single();
    if (!notice) continue;

    const recipients = gateRecipients({
      parentEmail: member.primary_email,
      parentName: member.parent_or_owner_name,
      actingGuardianId: null,
      guardians: (guardians ?? [])
        .filter((g) => g.member_id === member.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          email: g.email,
          receive_general_notifications: g.receive_general_notifications,
        })),
    });

    if (emailConfigured() && recipients.length) {
      for (const recipient of recipients) {
        try {
          await sendEmail({
            to: recipient.email,
            subject: `${member.full_name} is still at ${org.name}`,
            text: `Hello ${recipient.name},\n\n${message}\n\nIf someone else collected your child, please tell the school so the records are corrected.`,
            html: emailLayout({
              orgName: org.name,
              label: "Pick-up overdue",
              preheader: message,
              heading:
                stage === 2 ? "Still at school an hour after closing" : "Not picked up yet",
              intro: `Hello ${recipient.name},`,
              body: `<p style="margin:0 0 14px;font:600 16px/24px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#15332c;">${message}</p>
<p style="margin:0 0 14px;font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f3733;">If someone else collected your child, please tell the school so the records are corrected.</p>`,
              footerNote: emailFooter(org.name),
              siteUrl,
            }),
          });
          sent++;
        } catch (error) {
          console.error("[pickup] reminder email failed", redactValue(error));
        }
      }
    }

    // A phone alert too, so a parent not watching email still sees it.
    try {
      if (member.parent_link_token) {
        const { sendPushToParent, eventPush } = await import("./push-notifications.server");
        await sendPushToParent(member.parent_link_token, {
          ...eventPush(org.name, member.full_name, "still_waiting"),
          icon: "/icons/icon-192x192.png",
          tag: `pickup-${kind}-${member.id}`,
          data: {
            type: "pickup",
            url: pwaByLink.get(member.parent_link_token ?? "")
              ? `/parent/app/${pwaByLink.get(member.parent_link_token ?? "")}`
              : "/parent/app/",
          },
        });
      }
    } catch {
      // push is optional
    }

    if (sent) {
      await supabaseAdmin
        .from("transport_notices")
        .update({ emailed_at: new Date().toISOString() })
        .eq("id", notice.id);
    }
  }

  return { sent, stage };
}
