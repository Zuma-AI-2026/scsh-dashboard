import type { Metadata } from "next";
import { NoAccess } from "@/components/app-shell/section-page";
import { requireSection } from "@/lib/auth/current-user";
import { sectionByKey } from "@/lib/auth/roles";
import { currentSeason, formatSeasonLabel } from "@/lib/season";

export const metadata: Metadata = { title: "Sales" };

/**
 * /sales — Phase 1 Sales (leasing) section.
 *
 * Screens (KPI strip, Available units, Leads, Showings, Applications,
 * Pipeline) are intentionally NOT built yet: they depend on the AppFolio
 * report discovery output and confirmed column mappings.
 */
export default async function SalesPage() {
  const section = sectionByKey("sales");
  const { user, allowed } = await requireSection(section);
  if (!allowed) return <NoAccess section={section} user={user} />;

  const season = currentSeason();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Sales</h1>
        <span className="text-xs text-muted-foreground">
          Leasing season {formatSeasonLabel(season)} · {season.phase === "pre" ? "pre-season" : season.phase === "active" ? "active" : "move-in"}
        </span>
      </div>

      <div className="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Waiting on AppFolio report discovery. Run <span className="font-mono text-foreground">npm run discover</span>,
        confirm the column mappings, and the KPI strip, units, leads, showings, applications and pipeline tabs will
        be built here.
      </div>
    </div>
  );
}
