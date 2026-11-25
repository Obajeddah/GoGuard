import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function GateMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect x="2" y="2" width="28" height="28" rx="8" className="fill-signal" />
      <path
        d="M9 24V12a7 7 0 0 1 14 0v12"
        className="stroke-signal-foreground"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M13 24v-8M16 24v-9M19 24v-8"
        className="stroke-signal-foreground"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Brand({ className, to = "/" }: { className?: string; to?: "/" | "/dashboard" }) {
  return (
    <Link to={to} className={cn("inline-flex items-center gap-2", className)}>
      <GateMark />
      <span className="font-display text-xl font-bold tracking-tight">GoGuard</span>
    </Link>
  );
}
