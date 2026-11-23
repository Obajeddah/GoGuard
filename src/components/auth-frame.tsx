import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

/** Labelled form field; wrapping in <label> ties the text to the input for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium leading-none">{label}</span>
        {children}
      </label>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid-lines min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md">
        <Brand />
        <div className="mt-8 rounded-3xl border bg-card p-6 shadow-soft sm:p-8">{children}</div>
      </div>
    </div>
  );
}
