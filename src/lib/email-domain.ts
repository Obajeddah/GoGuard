import type { OrgType } from "./org-terms";

// Keep in sync with public.is_free_email_domain() in the database.
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "mail.ru",
  "inbox.com",
  "pm.me",
  "duck.com",
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
]);

export function emailDomain(email: string): string {
  return (email.trim().toLowerCase().split("@")[1] ?? "").trim();
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * Returns an error message when the email is not allowed for the given
 * organization type, or null when it is acceptable.
 * Schools must use an email on their own institution domain.
 */
export function orgEmailPolicyError(email: string, type: OrgType): string | null {
  const domain = emailDomain(email);
  if (!domain || !domain.includes(".")) return "Enter a valid email address.";
  if (type === "school" && isFreeEmailDomain(domain)) {
    return `Please use your school's official email address, such as admin@yourschool.edu.ng. Personal addresses (@${domain}) can't be used.`;
  }
  return null;
}
