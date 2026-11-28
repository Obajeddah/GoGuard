// Server-only: how a bus alert reaches the school. Email always; WhatsApp when
// a sender is connected. Shared by the bus app's own alerts and by the
// watchdog that notices a bus has gone quiet.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailConfigured, sendEmail } from "./email.server";
import { emailFooter, emailLayout } from "./email-template";
import { decryptOrgRow } from "./contact-crypto.server";

export async function whatsappAlert(text: string, to: string | null | undefined) {
  const url = process.env["WHATSAPP_ALERT_URL"];
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env["WHATSAPP_ALERT_TOKEN"]
          ? { Authorization: `Bearer ${process.env["WHATSAPP_ALERT_TOKEN"]}` }
          : {}),
      },
      body: JSON.stringify({ to: to ?? process.env["WHATSAPP_ALERT_TO"] ?? "", text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (error) {
    console.error("[bus] WhatsApp alert failed", error);
    return false;
  }
}

export interface FleetNoticeRow {
  id: string;
  org_id: string;
  bus_id: string | null;
  kind: string;
  message: string;
}

/**
 * Emails the school office about a bus alert and, when configured, sends the
 * same text to WhatsApp. Marks the notice done if anything got through.
 */
export async function deliverFleetNotice(
  notice: FleetNoticeRow,
): Promise<{ emailed: boolean; whatsapped: boolean }> {
  const [{ data: orgRow }, { data: bus }] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, name, admin_email, emergency_phone, emergency_phone_enc")
      .eq("id", notice.org_id)
      .maybeSingle(),
    notice.bus_id
      ? supabaseAdmin.from("buses").select("bus_number").eq("id", notice.bus_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!orgRow) return { emailed: false, whatsapped: false };
  const org = decryptOrgRow(orgRow);

  let emailed = false;
  if (emailConfigured()) {
    const siteUrl = process.env["URL"] ?? "https://goguard.ng";
    const emergency = notice.kind === "driver_emergency";
    try {
      await sendEmail({
        to: org.admin_email,
        subject: emergency
          ? `EMERGENCY: Bus ${bus?.bus_number ?? ""} (${org.name})`
          : `Bus ${bus?.bus_number ?? ""} alert: ${org.name}`,
        text: notice.message,
        html: emailLayout({
          orgName: org.name,
          label: emergency ? "Bus emergency" : "Bus alert",
          preheader: notice.message,
          heading: emergency ? "Emergency on the bus" : "Bus alert",
          intro: notice.message,
          body: "",
          footerNote: emailFooter(org.name),
          siteUrl,
        }),
      });
      emailed = true;
    } catch (error) {
      console.error("[bus] fleet alert email failed", error);
    }
  }

  const whatsapped = await whatsappAlert(
    `${org.name}: ${notice.message}`,
    org.emergency_phone ?? process.env["WHATSAPP_ALERT_TO"] ?? null,
  );

  if (emailed || whatsapped) {
    await supabaseAdmin
      .from("transport_notices")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", notice.id);
  }
  return { emailed, whatsapped };
}
