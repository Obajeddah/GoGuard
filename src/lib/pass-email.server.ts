// Server-only: emails every guardian their own pass and the parent a copy.
import { emailConfigured, sendEmail } from "./email.server";
import { parentRegistrationEmail, passEmail } from "./pass-email";
import { termsFor, type OrgType } from "./org-terms";
import { redactValue } from "./redact";
import { decryptGuardianRow, decryptMemberRow } from "./contact-crypto.server";

export interface PassEmailResult {
  sent: number;
  failed: number;
  skipped: boolean;
  error?: string;
}

/**
 * Sends one personal pass email per guardian and a registration summary to the
 * parent who registered. Never throws: a registration must not fail because
 * the mail provider hiccuped, so failures are logged and counted instead.
 */
export async function sendPassEmailsForMember(input: {
  memberId: string;
  siteUrl: string;
  parentAppUrl?: string | null | undefined;
}): Promise<PassEmailResult> {
  if (!emailConfigured()) return { sent: 0, failed: 0, skipped: true };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: memberRow } = await supabaseAdmin
      .from("members")
      .select(
        "id, org_id, full_name, identifier_code, primary_email, primary_email_enc, parent_or_owner_name, guardians(id, name, relationship, email, email_enc, unique_qr_hash)",
      )
      .eq("id", input.memberId)
      .maybeSingle();
    if (!memberRow) return { sent: 0, failed: 0, skipped: true, error: "Member not found" };
    const member = decryptMemberRow(memberRow);

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("name, type")
      .eq("id", member.org_id)
      .maybeSingle();
    if (!org) return { sent: 0, failed: 0, skipped: true, error: "School not found" };

    const orgName = org.name;
    const terms = termsFor((org.type ?? "school") as OrgType);
    const guardians = (member.guardians ?? [])
      .map(decryptGuardianRow)
      .filter(
        (g): g is typeof g & { email: string; unique_qr_hash: string } =>
          Boolean(g.email?.trim()) && Boolean(g.unique_qr_hash),
      );

    let sent = 0;
    let failed = 0;

    for (const g of guardians) {
      try {
        await sendEmail({
          to: g.email.trim().toLowerCase(),
          ...passEmail({
            recipientName: g.name,
            relationship: g.relationship,
            memberName: member.full_name,
            identifier: member.identifier_code,
            orgName,
            guardianLabel: terms.guardian,
            hash: g.unique_qr_hash,
            siteUrl: input.siteUrl,
            parentAppUrl: input.parentAppUrl ?? null,
          }),
        });
        sent++;
      } catch (error) {
        failed++;
        console.error(`[pass-email] guardian pass failed for member ${member.id}`, redactValue(error));
      }
    }

    // The parent who registered also gets a copy of every pass, on their own
    // address, unless that address already received a guardian pass above.
    const parentEmail = member.primary_email?.trim().toLowerCase();
    const parentAlreadyCovered =
      !!parentEmail && guardians.some((g) => g.email.trim().toLowerCase() === parentEmail);
    if (parentEmail && !parentAlreadyCovered && guardians.length) {
      try {
        await sendEmail({
          to: parentEmail,
          ...parentRegistrationEmail({
            parentName: member.parent_or_owner_name,
            memberName: member.full_name,
            identifier: member.identifier_code,
            orgName,
            guardianLabel: terms.guardian,
            passes: guardians.map((g) => ({
              name: g.name,
              relationship: g.relationship,
              hash: g.unique_qr_hash,
            })),
            parentAppUrl: input.parentAppUrl ?? null,
            siteUrl: input.siteUrl,
          }),
        });
        sent++;
      } catch (error) {
        failed++;
        console.error(`[pass-email] parent copy failed for member ${member.id}`, redactValue(error));
      }
    }

    return { sent, failed, skipped: false };
  } catch (error) {
    console.error("[pass-email] could not send passes", redactValue(error));
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
