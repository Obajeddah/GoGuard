/**
 * A QR pass is valid only for the exact guardian, child and school it was
 * issued to. The database issues a new code whenever the guardian's name,
 * photo or child changes, so older printed or shared codes stop working.
 */
export interface PassRecord {
  unique_qr_hash: string;
  member_id: string;
  org_id: string;
}

export type PassCheck =
  { ok: true } | { ok: false; reason: "unknown" | "other_school" | "other_child" };

export function checkPass(
  scannedHash: string | null,
  record: PassRecord | null,
  expected: { orgId: string; memberIds?: string[] },
): PassCheck {
  if (!scannedHash || !record || record.unique_qr_hash !== scannedHash)
    return { ok: false, reason: "unknown" };
  if (record.org_id !== expected.orgId) return { ok: false, reason: "other_school" };
  if (expected.memberIds && !expected.memberIds.includes(record.member_id))
    return { ok: false, reason: "other_child" };
  return { ok: true };
}

export const PASS_REJECTION: Record<Exclude<PassCheck, { ok: true }>["reason"], string> = {
  unknown: "This pass isn't registered, or it has been replaced by a newer one.",
  other_school: "This pass belongs to another school.",
  other_child: "This pass is for a different child.",
};
