import { cn } from "@/lib/utils";

const POSITIVE = ["converted", "approved", "completed", "confirmed", "current", "rent ready", "ready"];
const NEGATIVE = ["lost", "denied", "cancelled", "canceled", "no show", "no-show", "past due", "evict"];
const WARN = ["notice", "waitlisted", "pending", "scheduled", "vacant-unrented", "vacant unrented", "unrented"];

/** Compact status pill; color is inferred from common AppFolio status words. */
export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const v = value.toLowerCase();
  const tone = POSITIVE.some((p) => v.includes(p))
    ? "border-positive/40 bg-positive/10 text-positive"
    : NEGATIVE.some((p) => v.includes(p))
      ? "border-negative/40 bg-negative/10 text-negative"
      : WARN.some((p) => v.includes(p))
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-muted text-foreground/80";
  return <span className={cn("inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", tone, className)}>{value}</span>;
}
