// Server-only: turn a recorded bus notice into parent emails and a push.
// Kept apart from the server functions so the same work can be re-run later for
// anything that failed (the bus device, a parent refresh, or any app screen).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingState } from "./billing";
import { emailConfigured, sendEmail } from "./email.server";
import { busRideRecipients } from "./notification-recipients";
import { rideEmail, rideEmailHtml } from "./ride-email";
import { redactValue } from "./redact";
import {
  decryptGuardianRow,
  decryptMemberRow,
  decryptOrgRow,
  emailIndex,
} from "./contact-crypto.server";

/**
 * Take a notice so only one sender can mail it. A bus event can arrive from
 * several places at once (the bus device, a dashboard refresh, the parent app),
 * and without this the same parent got the same email two or three times.
 * Returns false when another sender already has it.
 */
export async function claimNotice(id: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("transport_notices")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", id)
    .is("emailed_at", null)
    .select("id");
  return !!data?.length;
}

/** Give a claim back so a later refresh tries again after a mail failure. */
export async function releaseNotice(id: string): Promise<void> {
  await supabaseAdmin.from("transport_notices").update({ emailed_at: null }).eq("id", id);
}

/**
 * Addresses that already received this notice. The delivery log keeps the blind
 * index of an address, never the address, so a data dump cannot be read as a
 * contact list; comparing two of them still works.
 */
async function alreadyEmailed(noticeId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("email_deliveries")
    .select("email")
    .eq("source_table", "transport_notices")
    .eq("source_id", noticeId);
  return new Set((data ?? []).map((row) => row.email.toLowerCase()));
}

async function recordEmailed(noticeId: string, emails: string[]): Promise<void> {
  if (!emails.length) return;
  await supabaseAdmin.from("email_deliveries").upsert(
    emails
      .map((email) => emailIndex(email))
      .filter((hash): hash is string => !!hash)
      .map((hash) => ({
        source_table: "transport_notices",
        source_id: noticeId,
        email: hash,
      })),
    { onConflict: "source_table,source_id,email" },
  );
}

export interface RideNoticeRow {
  id: string;
  org_id: string;
  member_id: string | null;
  guardian_id: string | null;
  kind: string;
  message: string;
}

/**
 * Sends one stored ride notice to its parents and marks it sent. Returns how
 * many emails went out. Never throws: a mail problem leaves the notice
 * unmarked so the next refresh tries again.
 */
export async function deliverRideNotice(notice: RideNoticeRow): Promise<number> {
  if (!notice.member_id) return 0;
  if (notice.kind !== "pupil_boarded" && notice.kind !== "pupil_dropped_off") return 0;

  const [{ data: orgRow }, { data: memberRow }] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, name, admin_email, emergency_phone, emergency_phone_enc, plan, trial_ends_at, paid_until")
      .eq("id", notice.org_id)
      .maybeSingle(),
    supabaseAdmin
      .from("members")
      .select(
        "id, full_name, primary_email, primary_email_enc, parent_or_owner_name, bus_track_token, parent_link_token",
      )
      .eq("id", notice.member_id)
      .maybeSingle(),
  ]);
  if (!orgRow || !memberRow) return 0;
  const org = decryptOrgRow(orgRow);
  const member = decryptMemberRow(memberRow);
  if (!billingState(org).canSendEmails) return 0;

  // One sender at a time, and never the same address twice for this notice.
  if (!(await claimNotice(notice.id))) return 0;

  // The phone alert goes out before anything about email is checked: a family
  // with no address on file still needs to hear that their child boarded.
  try {
    if (member.parent_link_token) {
      const { sendPushToParent, eventPush } = await import("./push-notifications.server");
      await sendPushToParent(member.parent_link_token, {
        // The school's name, then what happened: nothing else on the lock screen.
        ...eventPush(
          org.name,
          member.full_name,
          notice.kind === "pupil_boarded"
            ? "boarded"
            : notice.guardian_id
              ? "dropped_home"
              : "dropped_school",
        ),
        icon: "/icons/icon-192x192.png",
        tag: `bus-${notice.kind}-${notice.id}`,
        data: { type: "bus", url: "/parent/app" },
      });
    }
  } catch (error) {
    console.error("[bus] ride push failed", redactValue(error));
  }

  if (!emailConfigured()) return 0;

  const { data: guardianRows } = await supabaseAdmin
    .from("guardians")
    .select("id, name, email, email_enc, receive_general_notifications")
    .eq("member_id", member.id);

  const recipients = busRideRecipients({
    parentEmail: member.primary_email,
    parentName: member.parent_or_owner_name ?? null,
    handoverGuardianId: notice.guardian_id,
    guardians: (guardianRows ?? []).map(decryptGuardianRow).map((g) => ({
      id: g.id,
      name: g.name,
      email: g.email,
      receive_general_notifications: g.receive_general_notifications,
    })),
  });
  if (!recipients.length) {
    // Nobody has an address on file: the claim above stops the retry loop, so
    // this notice is not tried again on every refresh. It stays in the feed.
    return 0;
  }

  const siteUrl = process.env["URL"] ?? "https://goguard.ng";
  const content = rideEmail({
    kind: notice.kind,
    message: notice.message,
    childName: member.full_name,
    orgName: org.name,
    emergencyPhone: org.emergency_phone,
    trackToken: member.bus_track_token,
    siteUrl,
  });

  const already = await alreadyEmailed(notice.id);

  let sent = 0;
  let attempted = 0;
  const delivered: string[] = [];
  for (const recipient of recipients) {
    const recipientIndex = emailIndex(recipient.email);
    if (recipientIndex && already.has(recipientIndex)) continue;
    attempted++;
    try {
      await sendEmail({
        to: recipient.email,
        subject: content.subject,
        text: [content.message, ...content.links.map((l) => `${l.label}: ${l.href}`)].join("\n\n"),
        html: rideEmailHtml(content, { orgName: org.name, siteUrl }),
      });
      delivered.push(recipient.email);
      sent++;
    } catch (error) {
      console.error("[bus] ride email failed", redactValue(error));
    }
  }
  await recordEmailed(notice.id, delivered);

  // Nothing got through: undo the claim so a later refresh retries it.
  // (If every address was already served, the claim stands: nothing to retry.)
  if (!sent && attempted) await releaseNotice(notice.id);
  return sent;
}
