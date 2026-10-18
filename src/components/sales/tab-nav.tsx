import Link from "next/link";
import { SALES_TABS, type SalesTab } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

export function TabNav({ active, counts }: { active: SalesTab; counts: Partial<Record<SalesTab, number>> }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b" role="tablist">
      {SALES_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/sales?tab=${t.key}`}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "relative -mb-px flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
              isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className={cn("tabular rounded-sm px-1 text-[11px]", isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                {counts[t.key]}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
