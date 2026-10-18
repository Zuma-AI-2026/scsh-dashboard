import type { Metadata } from "next";
import { NoAccess } from "@/components/app-shell/section-page";
import { KpiStrip } from "@/components/sales/kpi-strip";
import { TabNav } from "@/components/sales/tab-nav";
import { ApplicationsTab, LeadsTab, PipelineTab, ShowingsTab, UnitsTab } from "@/components/sales/tabs";
import { requireSection } from "@/lib/auth/current-user";
import { sectionByKey } from "@/lib/auth/roles";
import { computeKpis } from "@/lib/sales/analytics";
import { loadSalesDataset } from "@/lib/sales/data";
import { SALES_TABS, type SalesTab } from "@/lib/sales/types";
import { flattenParams } from "@/lib/url";

export const metadata: Metadata = { title: "Sales" };

/** Map the KPI the user clicked (encoded in the URL) back to a highlighted card. */
function activeKpi(tab: SalesTab, p: Record<string, string | undefined>): string | null {
  if (tab === "units") return p.sort === "days_vacant" ? "dom" : "available";
  if (tab === "leads") return p.range === "week" ? "leads-week" : p.range === "season" ? "leads-season" : null;
  if (tab === "showings") return p.range === "week" ? "showings-week" : null;
  if (tab === "applications") return p.range === "season" ? (p.status === "Converted" ? "leases-season" : "apps-season") : null;
  return null;
}

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const section = sectionByKey("sales");
  const { user, allowed } = await requireSection(section);
  if (!allowed) return <NoAccess section={section} user={user} />;

  const params = flattenParams(await searchParams);
  const tab: SalesTab = SALES_TABS.some((t) => t.key === params.tab) ? (params.tab as SalesTab) : "units";
  const now = new Date();

  const data = await loadSalesDataset();
  const { season, week, kpis } = computeKpis(data, now);

  const counts = {
    units: data.availableUnits.length,
    leads: data.leads.length,
    showings: data.showings.length,
    applications: data.applications.length,
  };
  const tabProps = { data, params, season, week, now };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Sales</h1>
        <span className="text-xs text-muted-foreground">
          Leasing season {season.label} · {season.phase === "upcoming" ? "starts Nov 1" : "Nov 1 – Jul 31"} · Aug {season.moveInYear} move-in
        </span>
      </div>

      <KpiStrip kpis={kpis} activeKey={activeKpi(tab, params)} />

      <TabNav active={tab} counts={counts} />

      {tab === "units" && <UnitsTab {...tabProps} />}
      {tab === "leads" && <LeadsTab {...tabProps} />}
      {tab === "showings" && <ShowingsTab {...tabProps} />}
      {tab === "applications" && <ApplicationsTab {...tabProps} />}
      {tab === "pipeline" && <PipelineTab {...tabProps} />}
    </div>
  );
}
