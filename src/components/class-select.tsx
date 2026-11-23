import { cn } from "@/lib/utils";

/** Native select so it uses each phone's own picker. */
export function ClassSelect({
  classes,
  value,
  onChange,
  placeholder = "Choose a class",
  className,
  id,
}: {
  classes: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm",
        !value && "text-muted-foreground",
        className,
      )}
    >
      <option value="">{placeholder}</option>
      {classes.map((c) => (
        <option key={c} value={c} className="text-foreground">
          {c}
        </option>
      ))}
    </select>
  );
}
