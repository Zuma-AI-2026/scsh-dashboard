import Link from "next/link";
import type { Kpi } from "@/lib/sales/analytics";
import { cn } from "@/lib/utils";

export function KpiStrip({ kpis, activeKey }: { kpis: Kpi[]; activeKey: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => {
        const active = k.key === activeKey;
        return (
          <Link
            key={k.key}
            href={k.href}
            className={cn(
              "group flex flex-col justify-between rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-primary/60",
              active && "border-primary",
            )}
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</span>
            <span
              className={cn(
                "tabular mt-1 text-2xl font-semibold leading-none",
                k.tone === "positive" && "text-positive",
                k.tone === "negative" && "text-negative",
              )}
            >
              {k.value}
            </span>
            <span className="mt-1 h-4 truncate text-[11px] text-muted-foreground">{k.sub ?? ""}</span>
          </Link>
        );
      })}
    </div>
  );
}
