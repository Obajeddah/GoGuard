import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planAmountKobo } from "@/lib/billing";

/** Starts a Paystack checkout (card, bank transfer, USSD) for the signed-in school admin. */
export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ plan: z.enum(["basic", "standard", "group"]) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string } | { error: string }> => {
    const { requireAdmin } = await import("@/lib/staff-guard.server");
    let orgId: string;
    try {
      const admin = await requireAdmin(context.supabase, context.userId, context.claims);
      if (admin.branchId) return { error: "Only headquarters can pay for the school's plan." };
      orgId = admin.orgId;
    } catch (e) {
      return {
        error:
          e instanceof Error ? e.message : "Only your school's administrator can make payments.",
      };
    }

    const { paystackKey, paystackRequest } = await import("@/lib/paystack.server");
    if (!paystackKey())
      return { error: "Online payment isn't switched on yet. Please try again soon." };

    const email = (context.claims as { email?: string }).email;
    if (!email) return { error: "Your account has no email address." };

    const reference = `gp_${crypto.randomUUID().replace(/-/g, "")}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count: branchCount } = await supabaseAdmin
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    const branches = branchCount ?? 1;
    if (data.plan !== "group" && branches > 1)
      return {
        error: "Your school has more than one branch, so it needs the Multi-Campus Group plan.",
      };
    const amount = planAmountKobo(data.plan, branches);
    const { error: insertError } = await supabaseAdmin
      .from("payments")
      .insert({
        org_id: orgId,
        plan: data.plan,
        amount_kobo: amount,
        reference,
        branch_count: branches,
      });
    if (insertError) {
      console.error("[checkout] insert", insertError.message);
      return { error: "Couldn't start the payment. Please try again." };
    }

    const origin = new URL(getRequest().url).origin;
    try {
      const tx = await paystackRequest<{ authorization_url: string }>("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email,
          amount,
          currency: "NGN",
          reference,
          callback_url: `${origin}/payment`,
          channels: ["card", "bank_transfer", "ussd", "bank"],
          metadata: { org_id: orgId, plan: data.plan },
        }),
      });
      return { url: tx.authorization_url };
    } catch {
      await supabaseAdmin.from("payments").update({ status: "failed" }).eq("reference", reference);
      return { error: "Paystack couldn't start the payment. Please try again." };
    }
  });

/** Called when Paystack sends the admin back; confirms the payment directly with Paystack. */
export const confirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ reference: z.string().regex(/^gp_[a-f0-9]{32}$/) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ status: "paid" | "pending" | "failed" }> => {
    // RLS: admins only see their own school's payments.
    const { data: row } = await context.supabase
      .from("payments")
      .select("status")
      .eq("reference", data.reference)
      .maybeSingle();
    if (!row) return { status: "failed" };
    if (row.status === "success") return { status: "paid" };

    const { paystackRequest, settlePayment } = await import("@/lib/paystack.server");
    try {
      const tx = await paystackRequest<{ status: string; amount: number; currency: string }>(
        `/transaction/verify/${encodeURIComponent(data.reference)}`,
      );
      if (tx.status === "success") {
        const result = await settlePayment(data.reference, {
          amountKobo: tx.amount,
          currency: tx.currency,
        });
        return { status: result === "settled" || result === "already" ? "paid" : "failed" };
      }
      return { status: tx.status === "failed" || tx.status === "abandoned" ? "failed" : "pending" };
    } catch {
      return { status: "pending" };
    }
  });
