import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const eventSchema = z.object({
  event: z.string(),
  data: z
    .object({
      reference: z.string().max(100),
      amount: z.number().int(),
      currency: z.string().max(5),
      status: z.string().optional(),
    })
    .passthrough(),
});

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

        let parsed;
        try {
          parsed = eventSchema.safeParse(JSON.parse(raw));
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!parsed.success) return new Response("ok");

        if (parsed.data.event === "charge.success") {
          const { reference, amount, currency } = parsed.data.data;
          await settlePayment(reference, { amountKobo: amount, currency });
        }
        return new Response("ok");
      },
    },
  },
});
