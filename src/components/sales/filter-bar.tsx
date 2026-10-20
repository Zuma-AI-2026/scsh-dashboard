"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type FilterOption = string | { value: string; label: string };

export type FilterDef =
  | { kind: "select"; name: string; label: string; options: FilterOption[]; allLabel?: string }
  | { kind: "date"; name: string; label: string }
  | { kind: "toggle"; name: string; label: string; value?: string };

/**
 * URL-driven filter controls. Changing a control rewrites the query string
 * (server re-renders the table). Keys listed in `keep` survive a reset.
 */
export function FilterBar({ filters, keep = ["tab"] }: { filters: FilterDef[]; keep?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value === "") next.delete(name);
    else next.set(name, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const resetHref = (() => {
    const next = new URLSearchParams();
    for (const k of keep) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })();

  const anyActive = filters.some((f) => sp.get(f.name));

  const control =
    "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <div className="flex flex-wrap items-end gap-2">
      {filters.map((f) => {
        const current = sp.get(f.name) ?? "";
        if (f.kind === "toggle") {
          const on = current === (f.value ?? "1");
          return (
            <button
              key={f.name}
              type="button"
              onClick={() => set(f.name, on ? "" : (f.value ?? "1"))}
              className={cn(control, "self-end", on ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={on}
            >
              {f.label}
            </button>
          );
        }
        return (
          <label key={f.name} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</span>
            {f.kind === "select" ? (
              <select value={current} onChange={(e) => set(f.name, e.target.value)} className={cn(control, "min-w-28 pr-6")}>
                <option value="">{f.allLabel ?? "All"}</option>
                {f.options.map((o) => {
                  const opt = typeof o === "string" ? { value: o, label: o } : o;
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input type="date" value={current} onChange={(e) => set(f.name, e.target.value)} className={cn(control, "[color-scheme:dark]")} />
            )}
          </label>
        );
      })}
      {anyActive && (
        <Link href={resetHref} className="h-7 self-end px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" scroll={false}>
          Clear
        </Link>
      )}
    </div>
  );
}
