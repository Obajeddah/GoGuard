/** Pure content for the parent email sent after a gate scan. */
import type { GateRecipient } from "./notification-recipients";
import { telHref } from "./ride-email";
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

export function gateEmail(input: {
  action: "check_in" | "check_out";
  memberName: string;
  guardianName: string;
  orgName: string;
  emergencyPhone: string | null | undefined;
  siteUrl: string;
  recipient: GateRecipient;
  /** Direct link to the child's live status in the parent app. */
  parentAppLink?: string | undefined;
}): { subject: string; text: string; html: string } {
  const child = input.memberName.trim() || "your child";
  const guardian = input.guardianName.trim() || "a guardian";
  const arrived = input.action === "check_in";
  const subject = `${child} ${arrived ? "arrived at" : "left"} ${input.orgName}`;
  const action = arrived ? "arrived at school" : "left school";
  const when = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" });

  const lines = [
    `Hello ${input.recipient.name.trim() || "there"},`,
    "",
    `${child} ${action} at ${input.orgName}. The pass was scanned by ${guardian}.`,
    "",
    `Time: ${when}`,
  ];
  if (input.emergencyPhone?.trim())
    lines.push("", `School emergency line: ${input.emergencyPhone}`);
  lines.push("", `Open GoGuard: ${input.siteUrl.replace(/\/$/, "")}/dashboard`);
  const text = lines.join("\n");

  const rows: [string, string][] = [
    ["Student", child],
    ["Action", arrived ? "Arrived at school" : "Left school"],
    ["Time", when],
    ["Scanned by", guardian],
  ];
  const phone = input.emergencyPhone?.trim();
  const phoneRow = phone
    ? `<p style="margin:0 0 14px;font:400 14px/21px ${EMAIL.font};color:${EMAIL.text};">Something unexpected? Call the school on <a href="${escapeHtml(
        telHref(phone),
      )}" style="color:${EMAIL.ink};font-weight:700;text-decoration:none;">${escapeHtml(
        phone,
      )}</a>.</p>`
    : "";

  const html = emailLayout({
    orgName: input.orgName,
    label: arrived ? "Arrival" : "Pick-up",
    preheader: `${child} ${action} at ${input.orgName}.`,
    heading: arrived ? `${child} arrived safely` : `${child} has been picked up`,
    intro: `The pass was scanned by ${guardian}.`,
    body: `${emailDetails(rows)}
${phoneRow}
${
  input.parentAppLink
    ? `${emailButton("See live status", input.parentAppLink)}${emailNote(
        "Gate, bus and guardian updates for your child in one place.",
      )}`
    : ""
}
${emailParagraph(
  "You are receiving this because you are registered as a parent or guardian for this child.",
)}`,
    footerNote: emailFooter(input.orgName),
    siteUrl: input.siteUrl,
  });

  return { subject, text, html };
}
