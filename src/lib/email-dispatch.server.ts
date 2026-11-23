// Server-only drain for the notification outboxes. Called by the authenticated
// cron route; billing is re-checked on every run so lapsed schools stop sending.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingState } from "./billing";
import { emailConfigured, sendEmail, type OutgoingEmail } from "./email.server";
import { gateEmail } from "./gate-email";
import { busRideRecipients, gateRecipients, type RecipientGuardian } from "./notification-recipients";
import { rideEmail } from "./ride-email";

const BATCH = 20;
const now = () => new Date().toISOString();

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
  primary_email: string;
  parent_or_owner_name: string | null;
  bus_track_token: string;
};
type GuardianRow = {
  id: string;
  member_id: string;
  name: string;
  email: string;
  receive_general_notifications: boolean;
};

async function loadOrgs(ids: string[]): Promise<Map<string, OrgRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("id, name, admin_email, emergency_phone, plan, trial_ends_at, paid_until")
    .in("id", ids);
  return new Map((data ?? []).map((o) => [o.id, o as OrgRow]));
}

async function loadMembers(ids: string[]): Promise<Map<string, MemberRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from("members")
    .select("id, full_name, primary_email, parent_or_owner_name, bus_track_token")
    .in("id", ids);
  return new Map((data ?? []).map((m) => [m.id, m as MemberRow]));
}

async function loadGuardians(memberIds: string[]): Promise<Map<string, GuardianRow[]>> {
  if (!memberIds.length) return new Map();
  const { data } = await supabaseAdmin
    .from("guardians")
    .select("id, member_id, name, email, receive_general_notifications")
    .in("member_id", memberIds);
  const out = new Map<string, GuardianRow[]>();
  for (const g of (data ?? []) as GuardianRow[]) {
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

async function recordDelivery(sourceTable: string, sourceId: string, emails: string[]) {
  if (!emails.length) return;
  await supabaseAdmin.from("email_deliveries").upsert(
    emails.map((email) => ({ source_table: sourceTable, source_id: sourceId, email: email.toLowerCase() })),
    { onConflict: "source_table,source_id,email" },
  );
}

async function deliver(
  sourceTable: string,
  sourceId: string,
  messages: OutgoingEmail[],
  pending: Set<string>,
): Promise<boolean> {
  const sentNow: string[] = [];
  for (const message of messages) {
    if (pending.has(message.to.toLowerCase())) continue;
    try {
      await sendEmail(message);
      sentNow.push(message.to);
    } catch (error) {
      console.error(`[email] ${sourceTable}/${sourceId} -> ${message.to}`, error);
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

export async function sendPendingEmails(siteUrl: string): Promise<{ sent: number; skipped: number }> {
  if (!emailConfigured()) return { sent: 0, skipped: 0 };

  const { data: logs } = await supabaseAdmin
    .from("gate_logs")
    .select("id, org_id, member_id, guardian_id, action_type, member_name, verified_guardian_name, timestamp")
    .is("emailed_at", null)
    .order("timestamp", { ascending: true })
    .limit(BATCH);
  const { data: notices } = await supabaseAdmin
    .from("transport_notices")
    .select("id, org_id, member_id, guardian_id, kind, message, created_at")
    .is("emailed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  const { data: emergencies } = await supabaseAdmin
    .from("bus_emergencies")
    .select("id, org_id, bus_id, created_at")
    .is("emailed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  const gateLogs = logs ?? [];
  const rideNotices = (notices ?? []).filter((n) => n.member_id && (n.kind === "pupil_boarded" || n.kind === "pupil_dropped_off"));
  const adminNotices = (notices ?? []).filter((n) => !n.member_id || !rideNotices.includes(n));
  const alerts = emergencies ?? [];

  const orgs = await loadOrgs([
    ...new Set([...gateLogs, ...(notices ?? []), ...alerts].map((row) => row.org_id)),
  ]);
  const members = await loadMembers([
    ...new Set([...gateLogs.map((l) => l.member_id), ...rideNotices.map((n) => n.member_id!)]),
  ]);
  const guardians = await loadGuardians([
    ...new Set([...gateLogs.map((l) => l.member_id), ...rideNotices.map((n) => n.member_id!)]),
  ]);

  let sent = 0;
  let skipped = 0;
  const allowed = (orgId: string) => {
    const org = orgs.get(orgId);
    return !!org && billingState(org).canSendEmails;
  };

  for (const log of gateLogs) {
    if (!allowed(log.org_id)) {
      skipped++;
      continue;
    }
    const org = orgs.get(log.org_id)!;
    const member = members.get(log.member_id);
    const list = guardians.get(log.member_id) ?? [];
    const recipients = gateRecipients({
      parentEmail: member?.primary_email,
      parentName: member?.parent_or_owner_name ?? null,
      actingGuardianId: log.guardian_id,
      guardians: asRecipients(list),
    });
    const pending = await deliveredTo("gate_logs", log.id);
    const messages = recipients.map((recipient) => ({
      to: recipient.email,
      ...gateEmail({
        action: log.action_type === "check_in" ? "check_in" : "check_out",
        memberName: log.member_name || member?.full_name || "your child",
        guardianName: log.verified_guardian_name || "a guardian",
        orgName: org.name,
        emergencyPhone: org.emergency_phone,
        siteUrl,
        recipient,
      }),
    }));
    if (!(await deliver("gate_logs", log.id, messages, pending))) continue;
    await supabaseAdmin.from("gate_logs").update({ emailed_at: now() }).eq("id", log.id);
    sent++;
  }

  for (const notice of rideNotices) {
    if (!allowed(notice.org_id)) {
      skipped++;
      continue;
    }
    const org = orgs.get(notice.org_id)!;
    const member = members.get(notice.member_id!)!;
    const list = guardians.get(notice.member_id!) ?? [];
    const recipients = busRideRecipients({
      parentEmail: member.primary_email,
      parentName: member.parent_or_owner_name ?? null,
      handoverGuardianId: notice.guardian_id,
      guardians: asRecipients(list),
    });
    const content = rideEmail({
      kind: notice.kind as "pupil_boarded" | "pupil_dropped_off",
      message: notice.message,
      childName: member.full_name,
      orgName: org.name,
      emergencyPhone: org.emergency_phone,
      trackToken: member.bus_track_token,
      siteUrl,
    });
    const pending = await deliveredTo("transport_notices", notice.id);
    const messages = recipients.map((recipient) => ({
      to: recipient.email,
      subject: content.subject,
      text: [content.message, ...content.links.map((l) => `${l.label}: ${l.href}`)].join("\n\n"),
      html: [content.message, ...content.links.map((l) => `<p><a href="${l.href}">${l.label}</a></p>`)].join(""),
    }));
    if (!(await deliver("transport_notices", notice.id, messages, pending))) continue;
    await supabaseAdmin.from("transport_notices").update({ emailed_at: now() }).eq("id", notice.id);
    sent++;
  }

  for (const notice of adminNotices) {
    if (!allowed(notice.org_id)) {
      skipped++;
      continue;
    }
    const org = orgs.get(notice.org_id)!;
    const pending = await deliveredTo("transport_notices", notice.id);
    const messages = [
      {
        to: org.admin_email,
        subject: `GoGuard fleet notice — ${org.name}`,
        text: notice.message,
        html: `<p>${notice.message}</p>`,
      },
    ];
    if (!(await deliver("transport_notices", notice.id, messages, pending))) continue;
    await supabaseAdmin.from("transport_notices").update({ emailed_at: now() }).eq("id", notice.id);
    sent++;
  }

  for (const alert of alerts) {
    if (!allowed(alert.org_id)) {
      skipped++;
      continue;
    }
    const org = orgs.get(alert.org_id)!;
    const pending = await deliveredTo("bus_emergencies", alert.id);
    const messages = [
      {
        to: org.admin_email,
        subject: `Bus emergency — ${org.name}`,
        text: `An emergency was reported on bus ${alert.bus_id}. Open GoGuard for details.`,
        html: `<p>An emergency was reported on bus ${alert.bus_id}. Open GoGuard for details.</p>`,
      },
    ];
    if (!(await deliver("bus_emergencies", alert.id, messages, pending))) continue;
    await supabaseAdmin.from("bus_emergencies").update({ emailed_at: now() }).eq("id", alert.id);
    sent++;
  }

  return { sent, skipped };
}
