import { PhoneCall } from "lucide-react";

import { cn } from "@/lib/utils";

/** "Something unexpected? Call the school" block: mirrors the button in gate emails. */
export function EmergencyLine({
  phone,
  orgName,
  className,
}: {
  phone: string;
  orgName: string;
  className?: string | undefined;
}) {
  return (
    <a
      href={`tel:${phone.replace(/[^+0-9]/g, "")}`}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition hover:border-checkout",
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-checkout text-checkout-foreground">
        <PhoneCall className="size-5" />
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-medium">Something not right? Call {orgName}</span>
        <span className="block text-muted-foreground">Emergency line · {phone}</span>
      </span>
    </a>
  );
}
