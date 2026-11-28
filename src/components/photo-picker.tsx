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
  const [hint, setHint] = useState<string | null>(null);
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
      {hint && (
        <span className="absolute -bottom-5 left-0 w-full text-center text-[10px] leading-tight text-destructive">
          {hint}
        </span>
      )}
      <input
        id={id}
        type="file"
        // No `capture` attribute: phones then offer the camera *and* the photo
        // library, so a saved picture can be picked instead of only a new shot.
        accept="image/jpeg,image/png,image/webp,image/*"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setHint(null);
          setBusy(true);
          try {
            onChange(await resizeImageToDataUrl(file));
          } catch (err) {
            const message = err instanceof Error ? err.message : "Could not use that photo";
            setHint(message);
            toast.error(message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
