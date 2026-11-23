import { format } from "date-fns";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { OrgTerms } from "@/lib/org-terms";
import { cn } from "@/lib/utils";

export interface GateLogRow {
  id: string;
  action_type: "check_in" | "check_out";
  timestamp: string;
  member_name: string | null;
  verified_guardian_name: string | null;
  guard_name: string | null;
}

export function LogRow({ log, terms }: { log: GateLogRow; terms: OrgTerms }) {
  const isIn = log.action_type === "check_in";
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          isIn ? "bg-checkin/15 text-checkin" : "bg-checkout/15 text-checkout",
        )}
      >
        {isIn ? <ArrowDownRight className="size-5" /> : <ArrowUpRight className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {log.member_name}{" "}
          <span className="font-normal text-muted-foreground">
            · {isIn ? terms.checkInHint : terms.checkOutHint}
          </span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {log.verified_guardian_name ?? "Unknown"}
          {log.guard_name ? ` · verified by ${log.guard_name}` : ""}
        </p>
      </div>
      <time className="shrink-0 font-mono text-xs text-muted-foreground">{format(new Date(log.timestamp), "h:mm a")}</time>
    </li>
  );
}
