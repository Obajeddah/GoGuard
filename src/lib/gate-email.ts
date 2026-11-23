/** Pure content for the parent email sent after a gate scan. */
import type { GateRecipient } from "./notification-recipients";
import { telHref } from "./ride-email";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function gateEmail(input: {
  action: "check_in" | "check_out";
  memberName: string;
  guardianName: string;
  orgName: string;
  emergencyPhone: string | null | undefined;
  siteUrl: string;
  recipient: GateRecipient;
}): { subject: string; text: string; html: string } {
  const child = input.memberName.trim() || "your child";
  const guardian = input.guardianName.trim() || "a guardian";
  const arrived = input.action === "check_in";
  const subject = `${child} ${arrived ? "arrived at" : "left"} ${input.orgName}`;
  const action = arrived ? "arrived at school" : "left school";
  const lines = [
    `Hello ${input.recipient.name.trim() || "there"},`,
    "",
    `${child} ${action} at ${input.orgName}. The pass was scanned by ${guardian}.`,
    "",
    `Time: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`,
  ];
  if (input.emergencyPhone?.trim()) lines.push("", `School emergency line: ${input.emergencyPhone}`);
  lines.push("", `Open GoGuard: ${input.siteUrl.replace(/\/$/, "")}/dashboard`);
  const text = lines.join("\n");
  const html = lines
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : ""))
    .join("")
    .replace(/School emergency line: ([^<]+)/, (_, phone: string) => `School emergency line: <a href="${telHref(phone)}">${escapeHtml(phone)}</a>`);
  return { subject, text, html };
}
