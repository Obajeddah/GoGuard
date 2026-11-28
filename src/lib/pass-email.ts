/**
 * Pass emails. Every guardian gets their own email with their own QR barcode,
 * never one email addressed to several people, and the parent who registered
 * gets a confirmation with a copy of each pass. Pure functions so the wording
 * and markup can be tested without a mail provider.
 */
import {
  EMAIL,
  emailButton,
  emailDetails,
  emailFooter,
  emailLayout,
  emailNote,
  emailParagraph,
  escapeHtml,
} from "./email-template";

export interface PassEmailInput {
  recipientName: string;
  relationship: string;
  memberName: string;
  identifier?: string | null | undefined;
  orgName: string;
  guardianLabel?: string | undefined;
  hash: string;
  siteUrl: string;
  /** One link for every child this guardian is registered with. */
  parentAppUrl?: string | null | undefined;
}

const passLink = (siteUrl: string, hash: string) =>
  `${siteUrl.replace(/\/$/, "")}/pass/${hash}`;

/** The barcode itself, served as a PNG from our own domain so Gmail shows it. */
export function qrImageUrl(siteUrl: string, hash: string) {
  return `${siteUrl.replace(/\/$/, "")}/api/qr/${hash}.png`;
}

function qrBlock(siteUrl: string, hash: string, caption: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:2px auto 0;">
  <tr>
    <td align="center" style="background:#ffffff;border:1px solid ${EMAIL.border};border-radius:18px;padding:12px;">
      <img src="${escapeHtml(qrImageUrl(siteUrl, hash))}" width="212" height="212" alt="${escapeHtml(
        caption,
      )}" style="display:block;width:212px;height:212px;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>
</table>
<p style="margin:10px 0 4px;text-align:center;font:700 10px/14px ${EMAIL.font};letter-spacing:.16em;text-transform:uppercase;color:${EMAIL.muted};">Show this at the gate</p>
<p style="margin:0 0 16px;text-align:center;font:400 12px/18px ${EMAIL.font};color:${EMAIL.muted};">Scan code ${escapeHtml(
    `${hash.slice(0, 8).toUpperCase()}…${hash.slice(-4).toUpperCase()}`,
  )}</p>`;
}

export function passEmail(input: PassEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const guardianLabel = input.guardianLabel?.trim() || "Guardian";
  const name = input.recipientName.trim() || "there";
  const child = input.memberName.trim() || "your child";
  const relationship = input.relationship.trim();
  const where = input.identifier?.trim()
    ? `${child} (${input.identifier.trim()})`
    : child;

  const subject = `Your GoGuard pass for ${child}`;

  const text = [
    `Hello ${name},`,
    "",
    `You are registered${relationship ? ` as ${relationship.toLowerCase()}` : ""} to drop off and pick up ${where} at ${input.orgName}.`,
    "",
    "Your personal gate pass is attached below as a QR code, and it is always available here:",
    passLink(input.siteUrl, input.hash),
    "",
    `Show the code to the guard at every arrival and pick-up. This pass is personal. Anyone holding it can pass the gate as you, so please do not forward this email.`,
    "",
    ...(input.parentAppUrl
      ? [
          "The GoGuard parent app shows every child you are registered with, their gate status and bus updates:",
          input.parentAppUrl,
          "",
        ]
      : []),
    `GoGuard: picture-verified gate safety for ${input.orgName}.`,
  ].join("\n");

  const html = emailLayout({
    orgName: input.orgName,
    label: `${guardianLabel} pass`,
    preheader: `Your GoGuard pass for ${child} is ready.`,
    heading: "Your gate pass is ready",
    intro: `Hello ${name}, you are registered${
      relationship ? ` as ${relationship.toLowerCase()}` : ""
    } to drop off and pick up ${where} at ${input.orgName}.`,
    body: `${qrBlock(input.siteUrl, input.hash, `QR pass for ${name}`)}
${emailButton("Open my pass", passLink(input.siteUrl, input.hash))}
${emailDetails([
  [guardianLabel, input.recipientName.trim() || "Not given"],
  ["Authorised for", where],
  ["School", input.orgName],
])}
${emailParagraph(
  "Save this email or add the pass page to your home screen, so it is always to hand at the gate.",
)}
${emailNote("This pass is personal. Anyone holding it can pass the gate as you, so please do not forward this email.")}
${
  input.parentAppUrl
    ? `${emailButton("Open the parent app", input.parentAppUrl)}${emailNote(
        "See every child you are registered with, their gate status and bus updates.",
      )}`
    : ""
}`,
    footerNote: emailFooter(input.orgName),
    siteUrl: input.siteUrl,
  });

  return { subject, text, html };
}

export interface RegistrationPassSummary {
  name: string;
  relationship: string;
  hash: string;
}

export function parentRegistrationEmail(input: {
  parentName?: string | null | undefined;
  memberName: string;
  identifier?: string | null | undefined;
  orgName: string;
  guardianLabel?: string | undefined;
  passes: RegistrationPassSummary[];
  parentAppUrl?: string | null | undefined;
  siteUrl: string;
}): { subject: string; text: string; html: string } {
  const guardianLabel = input.guardianLabel?.trim() || "Guardian";
  const name = input.parentName?.trim() || "there";
  const child = input.memberName.trim() || "your child";
  const where = input.identifier?.trim()
    ? `${child} (${input.identifier.trim()})`
    : child;

  const subject = `${child} is registered at ${input.orgName}`;

  const text = [
    `Hello ${name},`,
    "",
    `${where} is now registered at ${input.orgName}. Each ${guardianLabel.toLowerCase()} below has been emailed their own personal QR pass, and the school can see their face photo at the gate.`,
    "",
    ...input.passes.flatMap((p) => [
      `${p.name} (${p.relationship}): ${passLink(input.siteUrl, p.hash)}`,
      "",
    ]),
    "Keep this email for your records. The parent app shows your child's gate status any time.",
    ...(input.parentAppUrl ? ["", `Parent app: ${input.parentAppUrl}`] : []),
    "",
    `GoGuard: picture-verified gate safety for ${input.orgName}.`,
  ].join("\n");

  const rows = input.passes
    .map(
      (p) => `<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${EMAIL.border};font:600 14px/19px ${EMAIL.font};color:${EMAIL.text};">${escapeHtml(
    p.name,
  )}<br><span style="font:400 12px/16px ${EMAIL.font};color:${EMAIL.muted};">${escapeHtml(
    p.relationship,
  )}</span></td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid ${EMAIL.border};">
    <a href="${escapeHtml(passLink(input.siteUrl, p.hash))}" style="font:700 13px/18px ${EMAIL.font};color:${EMAIL.ink};text-decoration:underline;">View pass</a>
  </td>
</tr>`,
    )
    .join("");

  const html = emailLayout({
    orgName: input.orgName,
    label: "Registration complete",
    preheader: `${where} is registered at ${input.orgName}.`,
    heading: "Registration complete",
    intro: `Hello ${name}, ${where} is now registered at ${input.orgName}. Each ${guardianLabel.toLowerCase()} has been emailed their own personal QR pass.`,
    body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid ${EMAIL.border};">${rows}</table>
${emailParagraph(
  "At the gate the guard sees the photo on the pass and on file, so only the people you registered can collect your child.",
)}
${
  input.parentAppUrl
    ? `${emailButton("Open the parent app", input.parentAppUrl)}${emailNote(
        "See your child's gate status and bus updates any time.",
      )}`
    : ""
}`,
    footerNote: emailFooter(input.orgName),
    siteUrl: input.siteUrl,
  });

  return { subject, text, html };
}
