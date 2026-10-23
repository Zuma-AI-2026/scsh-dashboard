import type { Metadata } from "next";
import { BulkMarkDoneBar } from "@/components/accounting/bulk-mark-done";
import { HistoryPanel } from "@/components/accounting/follow-up";
import { DelinquencyTable } from "@/components/accounting/table";
import { NoAccess } from "@/components/app-shell/section-page";
import { FilterBar } from "@/components/sales/filter-bar";
import { KpiStrip } from "@/components/sales/kpi-strip";
import { activeKpi, computeKpis, distinct, filterRows, historyFor, sortDelinquencies, withDerived } from "@/lib/accounting/analytics";
import { loadAccountingDataset } from "@/lib/accounting/data";
import { requireSection } from "@/lib/auth/current-user";
import { canSeeTenantContacts, canWriteFollowUp, sectionByKey } from "@/lib/auth/roles";
import { STALE_CONTACT_DAYS } from "@/lib/collections/contact";
import { reminderAccess } from "@/lib/collections/request";
import { hrefWith, flattenParams } from "@/lib/url";

export const metadata: Metadata = { title: "Accounting" };

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  const section = sectionByKey("accounting");
  const { user, allowed } = await requireSection(section);
  if (!allowed) return <NoAccess section={section} user={user} />;

  const params = flattenParams(await searchParams);
  const data = await loadAccountingDataset();
  const derived = withDerived(data);
  const kpis = computeKpis(derived, data.occupiedManaged, data.stages);
  const now = new Date();
  const filtered = sortDelinquencies(filterRows(derived, params, now), params);
  const canWrite = canWriteFollowUp(user.role);
  const showContacts = canSeeTenantContacts(user.role);
  const isAdmin = user.role === "admin";

  const historyId = params.history ? Number(params.history) : NaN;
  const historyRow = Number.isInteger(historyId) ? derived.find((r) => r.occupancy_id === historyId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Accounting</h1>
        <span className="text-xs text-muted-foreground">
          Delinquency on managed properties · AppFolio is read-only
          {canWrite ? " · you can log follow-up" : " · follow-up is read-only"}
        </span>
      </div>

      <KpiStrip kpis={kpis.money} activeKey={activeKpi(params)} />
      <KpiStrip kpis={kpis.ladder} activeKey={activeKpi(params)} />

      <FilterBar
        keep={[]}
        filters={[
          { kind: "select", name: "property", label: "Property", options: distinct(derived, (r) => r.property_name) },
          { kind: "select", name: "bucket", label: "Aging", options: ["0-30", "31-60", "61-90", "90+"] },
          {
            kind: "select",
            name: "stage",
            label: "Stage",
            options: data.stages
              .filter((s) => s.is_active)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((s) => ({ value: String(s.id), label: s.name })),
          },
          { kind: "select", name: "agent", label: "Agent", options: distinct(derived, (r) => r.agent) },
          { kind: "select", name: "owner", label: "Owner", options: distinct(derived, (r) => r.owners) },
          { kind: "toggle", name: "overdue", label: "Actions overdue", value: "1" },
          { kind: "toggle", name: "stale", label: `Not contacted in ${STALE_CONTACT_DAYS}+ days`, value: "1" },
        ]}
      />

      {historyRow && (
        <HistoryPanel
          tenant={historyRow.tenant}
          property={historyRow.property_name}
          unit={historyRow.unit_name}
          actions={historyFor(data.actions, historyRow.occupancy_id)}
          reminders={data.messages.filter((m) => m.occupancy_id === historyRow.occupancy_id)}
          stages={data.stages}
          closeHref={hrefWith("/accounting", params, { history: undefined })}
        />
      )}

      {isAdmin && <BulkMarkDoneBar eligible={filtered.filter((r) => r.next_action_due).length} />}

      {!data.remindersReady && reminderAccess(user.role) === "send" && (
        <p className="text-xs text-muted-foreground">Payment reminders appear once migration 0017 is applied.</p>
      )}

      <DelinquencyTable
        rows={filtered}
        params={params}
        canWrite={canWrite}
        showContacts={showContacts}
        stages={data.stages}
        bulkSelect={isAdmin}
        canRemind={data.remindersReady && reminderAccess(user.role) === "send"}
        now={now}
      />
    </div>
  );
}
