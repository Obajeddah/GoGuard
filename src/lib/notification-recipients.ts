export interface RecipientGuardian {
  id: string;
  name: string;
  email: string;
  receive_general_notifications: boolean;
}

export type RecipientReason = "parent" | "acting_guardian" | "general_opt_in";

export interface GateRecipient {
  email: string;
  name: string;
  reason: RecipientReason;
}

/**
 * Who gets an email when a guardian's QR pass is scanned at the gate:
 * - the parent/owner who registered always gets every (general) notification,
 * - the guardian whose pass was scanned always gets a notice of their own action,
 * - other guardians only when they opted in to general notifications.
 * Addresses are de-duplicated (case-insensitive), parent first.
 */
export function gateRecipients(input: {
  parentEmail: string | null | undefined;
  parentName?: string | null;
  actingGuardianId: string | null | undefined;
  guardians: RecipientGuardian[];
}): GateRecipient[] {
  const out: GateRecipient[] = [];
  const seen = new Set<string>();
  const add = (email: string | null | undefined, name: string, reason: RecipientReason) => {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ email: normalized, name, reason });
  };

  add(input.parentEmail, input.parentName?.trim() || "Parent", "parent");

  const acting = input.guardians.find((g) => g.id === input.actingGuardianId);
  if (acting) add(acting.email, acting.name, "acting_guardian");

  for (const g of input.guardians) {
    if (g.id === input.actingGuardianId) continue;
    if (g.receive_general_notifications) add(g.email, g.name, "general_opt_in");
  }
  return out;
}

/**
 * Who gets a bus ride email (pupil boarded / dropped off). Same rule as the gate:
 * the registering parent always; the guardian the pupil was handed to on an
 * afternoon drop-off; other guardians only if they opted in. Starting a ride
 * never emails anyone.
 */
export function busRideRecipients(input: {
  parentEmail: string | null | undefined;
  parentName?: string | null;
  handoverGuardianId: string | null | undefined;
  guardians: RecipientGuardian[];
}): GateRecipient[] {
  return gateRecipients({ ...input, actingGuardianId: input.handoverGuardianId ?? null });
}
