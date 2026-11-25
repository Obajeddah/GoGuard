import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { emailDomain, orgEmailPolicyError } from "./email-domain";
import { captchaConfigured, signupPlan } from "./signup-rules";

const schema = z.object({
  email: z.string().trim().email().max(255),
  type: z.literal("school"),
  plan: z.string().max(20).optional().default("basic"),
  captchaToken: z.string().max(4096).optional().default(""),
});

/** Public sign-up settings: the Cloudflare Turnstile site key (public), or null when captcha isn't set up. */
export const getSignupConfig = createServerFn({ method: "GET" }).handler(async () => ({
  turnstileSiteKey: captchaConfigured(
    process.env["TURNSTILE_SITE_KEY"],
    process.env["TURNSTILE_SECRET_KEY"],
  )
    ? process.env["TURNSTILE_SITE_KEY"]
    : null,
}));

async function captchaOk(token: string): Promise<boolean> {
  const secret = process.env["TURNSTILE_SECRET_KEY"];
  if (!captchaConfigured(process.env["TURNSTILE_SITE_KEY"], secret) || !secret) return false;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
    });
    const body = (await res.json()) as { success?: boolean; action?: string };
    return res.ok && body.success === true && body.action === "school-signup";
  } catch {
    return false;
  }
}

/**
 * Checks an organisation admin's sign-up before the account is created: the
 * captcha, the school-domain rule and that the domain can receive mail. On
 * success it issues a one-time sign-up ticket; the database sign-up trigger
 * refuses school sign-ups without a fresh ticket for that email, so the captcha
 * can't be skipped by calling sign-up directly.
 */
export const checkOrgEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) => schema.parse(input))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; ticket: string } | { ok: false; error: string; captcha?: boolean }> => {
      if (!(await captchaOk(data.captchaToken)))
        return { ok: false, error: "Please complete the security check.", captcha: true };

      const policyError = orgEmailPolicyError(data.email, data.type);
      if (policyError) return { ok: false, error: policyError };

      const domain = emailDomain(data.email);
      try {
        const res = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
          {
            headers: { accept: "application/dns-json" },
          },
        );
        if (res.ok) {
          const json = (await res.json()) as { Status?: number; Answer?: unknown[] };
          if (json.Status === 3 || !json.Answer || json.Answer.length === 0) {
            return {
              ok: false,
              error: `We couldn't find a mail server for @${domain}. Check the address or use your organization's official email.`,
            };
          }
        }
      } catch {
        // DNS lookup unavailable — fall back to the policy check only.
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: ticket, error } = await supabaseAdmin
        .from("signup_tickets")
        .insert({ email: data.email.toLowerCase(), plan: signupPlan(data.plan) })
        .select("id")
        .single();
      if (error || !ticket) return { ok: false, error: "Something went wrong. Please try again." };
      return { ok: true, ticket: ticket.id };
    },
  );
