// Server-only email provider adapter. Never import from a route or component file.

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailConfigured(): boolean {
  return Boolean(
    process.env["EMAIL_FROM"] &&
      (process.env["RESEND_API_KEY"] || process.env["EMAIL_API_URL"]),
  );
}

/**
 * Sends one email through Resend when configured, or through a generic JSON
 * webhook (EMAIL_API_URL + optional EMAIL_API_KEY) for self-hosting. Fails
 * closed when neither is configured so queued rows stay pending.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  const from = process.env["EMAIL_FROM"];
  const resendKey = process.env["RESEND_API_KEY"];
  const url = process.env["EMAIL_API_URL"];
  if (!from || (!resendKey && !url)) throw new Error("Email provider is not configured");

  const resend = Boolean(resendKey);
  const endpoint = resend ? "https://api.resend.com/emails" : url!;
  const apiKey = resend ? resendKey! : process.env["EMAIL_API_KEY"];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(
      resend
        ? { from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }
        : { from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html },
    ),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email provider rejected the message (${response.status}): ${detail.slice(0, 300)}`);
  }
}
