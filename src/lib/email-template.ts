/**
 * GoGuard email chrome. Every email leaves the app with the same gate-green
 * header, sandstone paper and amber action button, so a parent recognises
 * GoGuard before reading a word. Table-based markup and inline styles only:
 * that is what Gmail, Outlook and Apple Mail all render reliably.
 */

export const EMAIL = {
  page: "#f6f1e5",
  card: "#fffdf8",
  ink: "#15332c",
  inkSoft: "#20453c",
  signal: "#f2b13c",
  signalText: "#3a2a0c",
  text: "#1f3733",
  muted: "#6b7d77",
  border: "#e7dfcf",
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Paragraph of body copy. Escapes the text before wrapping it. */
export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 14px;font:400 15px/23px ${EMAIL.font};color:${EMAIL.text};">${escapeHtml(
    text,
  )}</p>`;
}

/**
 * The line at the bottom of every email. The school is the sender parents
 * recognise; GoGuard is the system it runs on.
 */
export function emailFooter(orgName: string | null | undefined): string {
  const school = orgName?.trim() || "the school";
  return `This email is sent from ${school}, powered by GoGuard.`;
}

/** Small caps label above a value, e.g. "Student" / "Ada Obi". */
export function emailDetails(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value]) => `<tr>
  <td style="padding:7px 0;font:600 11px/16px ${EMAIL.font};letter-spacing:.12em;text-transform:uppercase;color:${EMAIL.muted};width:42%;vertical-align:top;">${escapeHtml(
    label,
  )}</td>
  <td style="padding:7px 0;font:600 15px/20px ${EMAIL.font};color:${EMAIL.text};vertical-align:top;">${escapeHtml(
    value,
  )}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid ${EMAIL.border};border-bottom:1px solid ${EMAIL.border};">${cells}</table>`;
}

export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 6px;">
  <tr>
    <td style="border-radius:12px;background:${EMAIL.signal};">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font:700 15px/18px ${EMAIL.font};color:${EMAIL.signalText};text-decoration:none;border-radius:12px;">${escapeHtml(
        label,
      )}</a>
    </td>
  </tr>
</table>`;
}

/** Small print under the action. Escaped. */
export function emailNote(text: string): string {
  return `<p style="margin:14px 0 0;font:400 13px/20px ${EMAIL.font};color:${EMAIL.muted};text-align:center;">${escapeHtml(
    text,
  )}</p>`;
}

export function emailLayout(input: {
  /** School / estate / company the email is about. */
  orgName?: string | null | undefined;
  /** Gray inbox preview line. */
  preheader?: string | undefined;
  /** Small caps label in the header, e.g. "Pass issued". */
  label?: string | undefined;
  heading: string;
  intro?: string | undefined;
  /** Pre-built HTML body. */
  body: string;
  footerNote?: string | undefined;
  siteUrl: string;
}): string {
  const site = input.siteUrl.replace(/\/$/, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    input.preheader ?? input.heading,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.page};padding:26px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
        <tr>
          <td style="padding:0 2px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="${escapeHtml(
                    `${site}/icons/logo-60.png`,
                  )}" width="30" height="30" alt="GoGuard" style="display:inline-block;width:30px;height:30px;border:0;border-radius:9px;vertical-align:middle;">
                  <span style="display:inline-block;margin-left:9px;font:800 19px/30px ${EMAIL.font};letter-spacing:-0.2px;color:${EMAIL.ink};vertical-align:middle;">GoGuard</span>
                </td>
                <td align="right" style="font:700 10px/14px ${EMAIL.font};letter-spacing:.16em;text-transform:uppercase;color:${EMAIL.muted};vertical-align:middle;">${escapeHtml(
                  input.label ?? "Gate pass",
                )}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:20px;padding:26px 24px;">
            ${
              input.orgName?.trim()
                ? `<p style="margin:0 0 10px;font:700 10px/14px ${EMAIL.font};letter-spacing:.16em;text-transform:uppercase;color:${EMAIL.muted};">${escapeHtml(
                    input.orgName.trim(),
                  )}</p>`
                : ""
            }
            <h1 style="margin:0 0 12px;font:800 24px/31px ${EMAIL.font};letter-spacing:-0.3px;color:${EMAIL.ink};">${escapeHtml(
              input.heading,
            )}</h1>
            ${
              input.intro?.trim()
                ? `<p style="margin:0 0 18px;font:400 15px/23px ${EMAIL.font};color:${EMAIL.text};">${escapeHtml(
                    input.intro.trim(),
                  )}</p>`
                : ""
            }
            ${input.body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 10px 4px;text-align:center;font:400 12px/19px ${EMAIL.font};color:${EMAIL.muted};">
            ${
              input.footerNote?.trim()
                ? `<p style="margin:0 0 8px;">${escapeHtml(input.footerNote.trim())}</p>`
                : ""
            }
            <p style="margin:0;font:400 12px/19px ${EMAIL.font};color:${EMAIL.muted};">
              GoGuard: picture-verified gate safety<br>
              <a href="${escapeHtml(site)}" style="color:${EMAIL.muted};">${escapeHtml(
                site.replace(/^https?:\/\//, ""),
              )}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
