import { QRCodeSVG } from "qrcode.react";
import { User } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One canonical form for a pass code. The database may hold an upper-case
 * code, but the camera scanner lower-cases what it reads, so every barcode we
 * draw must be lower-case or the same pass would fail to verify.
 */
export const normaliseHash = (hash: string) => hash.trim().toLowerCase();

export function passUrl(hash: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/pass/${hash}`;
}

export function PassCard({
  hash,
  guardianName,
  relationship,
  memberName,
  identifier,
  orgName,
  photoUrl,
  guardianLabel = "Guardian",
  className,
}: {
  hash: string;
  guardianName: string;
  relationship: string;
  memberName: string;
  identifier?: string | null | undefined;
  orgName: string;
  photoUrl?: string | null | undefined;
  guardianLabel?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-sm overflow-hidden rounded-3xl bg-card shadow-pass",
        className,
      )}
    >
      <div className="bg-gradient-ink px-6 pb-8 pt-6 text-ink-foreground">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-ink-muted">
          <span>GoGuard</span>
          <span>{guardianLabel} pass</span>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <div className="size-16 shrink-0 overflow-hidden rounded-2xl bg-ink-foreground/10 ring-2 ring-signal">
            {photoUrl ? (
              <img src={photoUrl} alt={guardianName} className="size-full object-cover" />
            ) : (
              <User className="m-auto mt-4 size-8 text-ink-muted" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-2xl font-bold leading-tight">{guardianName}</p>
            <p className="text-sm text-ink-muted">{relationship}</p>
          </div>
        </div>
      </div>
      <div className="ticket-perforation h-5 -mt-2.5 bg-card" />
      <div className="flex flex-col items-center px-6 pb-6 pt-2">
        <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
          <QRCodeSVG value={normaliseHash(hash)} size={208} level="M" marginSize={1} />
        </div>
        <p className="mt-4 text-center text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Authorised for
        </p>
        <p className="text-center font-display text-lg font-semibold">
          {memberName}
          {identifier ? (
            <span className="font-sans font-normal text-muted-foreground"> · {identifier}</span>
          ) : null}
        </p>
        <p className="mt-1 text-center text-sm text-muted-foreground">{orgName}</p>
        <p className="mt-4 font-mono text-[10px] text-muted-foreground">
          {normaliseHash(hash).slice(0, 8).toUpperCase()}…
          {normaliseHash(hash).slice(-4).toUpperCase()}
        </p>
      </div>
    </div>
  );
}
