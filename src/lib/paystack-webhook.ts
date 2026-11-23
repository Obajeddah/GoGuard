import { z } from "zod";

// The outer envelope is loose so unrelated Paystack events can be acknowledged
// without treating them as malformed. Once we know it is a charge, its fields
// must be complete before we touch a payment row.
const envelopeSchema = z.object({
  event: z.string(),
  data: z.unknown(),
});

const chargeSchema = z.object({
  reference: z.string().regex(/^gp_[a-f0-9]{32}$/),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  status: z.string(),
});

export type ChargeSuccess = z.infer<typeof chargeSchema>;

export type ParsedWebhook =
  | { kind: "bad" }
  | { kind: "ignore" }
  | { kind: "charge"; charge: ChargeSuccess };

/** Parses a verified Paystack body without ever settling a payment. */
export function parsePaystackEvent(raw: string): ParsedWebhook {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "bad" };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { kind: "bad" };
  if (envelope.data.event !== "charge.success") return { kind: "ignore" };

  const charge = chargeSchema.safeParse(envelope.data.data);
  if (!charge.success) return { kind: "bad" };
  // Failed, abandoned or pending charges must never extend an entitlement.
  if (charge.data.status !== "success") return { kind: "ignore" };
  return { kind: "charge", charge: charge.data };
}
