import { createFileRoute } from "@tanstack/react-router";

import { parsePaystackEvent } from "@/lib/paystack-webhook";

export const Route = createFileRoute("/api/public/paystack-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { paystackKey, paystackSignature, safeEqual, settlePayment } = await import("@/lib/paystack.server");
        const key = paystackKey();
        if (!key) return new Response("Not configured", { status: 503 });

        const raw = await request.text();
        const given = request.headers.get("x-paystack-signature") ?? "";
        const expected = await paystackSignature(raw, key);
        if (!safeEqual(given, expected)) return new Response("Invalid signature", { status: 401 });

        const parsed = parsePaystackEvent(raw);
        if (parsed.kind === "bad") return new Response("Bad request", { status: 400 });
        if (parsed.kind === "ignore") return new Response("ok");

        try {
          const result = await settlePayment(parsed.charge.reference, {
            amountKobo: parsed.charge.amount,
            currency: parsed.charge.currency,
          });
          if (result === "mismatch") console.error("[paystack] webhook amount/currency mismatch", parsed.charge.reference);
          return new Response("ok");
        } catch (error) {
          console.error("[paystack] webhook settlement failed", error);
          return new Response("Try again", { status: 500 });
        }
      },
    },
  },
});
