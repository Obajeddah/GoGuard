import { useId, useState } from "react";
import { Camera, Loader2, User } from "lucide-react";
import { toast } from "sonner";

import { resizeImageToDataUrl } from "@/lib/image";
import { cn } from "@/lib/utils";

export function PhotoPicker({
  value,
  onChange,
  label = "Add photo",
  required,
  className,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  return (
    <label
      htmlFor={id}
      className={cn(
        "group relative flex size-24 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-input bg-muted text-muted-foreground transition hover:border-primary",
        value && "border-solid border-primary",
        className,
      )}
    >
      {value ? (
        <img src={value} alt="Selected" className="size-full object-cover" />
      ) : busy ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <>
          <User className="size-7" />
          <span className="mt-1 px-1 text-center text-[11px] font-medium leading-tight">
            {label}
            {required && " *"}
          </span>
        </>
      )}
      {value && (
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-ink/70 py-1 text-[10px] font-medium text-ink-foreground">
          <Camera className="size-3" /> Change
        </span>
      )}
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="user"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onChange(await resizeImageToDataUrl(file));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not use that photo");
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
