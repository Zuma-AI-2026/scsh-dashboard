import { FollowUpCell } from "@/components/accounting/follow-up";
import { DataTable, type Column } from "@/components/sales/data-table";
import type { DelinquencyView } from "@/lib/accounting/analytics";
import { formatDate, formatMoney } from "@/lib/format";

export function DelinquencyTable({
  rows,
  params,
  canWrite,
}: {
  rows: DelinquencyView[];
  params: Record<string, string | undefined>;
  canWrite: boolean;
}) {
  const columns: Column<DelinquencyView>[] = [
    { key: "property_name", label: "Property", sortable: true, render: (r) => r.property_name ?? "—" },
    { key: "unit_name", label: "Unit", sortable: true, render: (r) => r.unit_name ?? "—" },
    { key: "tenant", label: "Tenant", sortable: true, render: (r) => r.tenant ?? "—" },
    { key: "amount_receivable", label: "Balance", sortable: true, align: "right", render: (r) => formatMoney(r.amount_receivable) },
    { key: "aging_bucket", label: "Aging", sortable: true, render: (r) => r.aging_bucket ?? "—" },
    { key: "days_past_due", label: "Days past due", sortable: true, align: "right", render: (r) => (r.days_past_due === null ? "—" : String(r.days_past_due)) },
    {
      key: "last_payment",
      label: "Last payment",
      sortable: true,
      render: (r) => (r.last_payment ? `${formatDate(r.last_payment)}${r.payment_amount != null ? ` · ${formatMoney(r.payment_amount)}` : ""}` : "—"),
    },
    { key: "nsf", label: "NSF", sortable: true, align: "right", render: (r) => (r.nsf == null ? "—" : String(r.nsf)) },
    { key: "lease_to", label: "Lease end", sortable: true, render: (r) => formatDate(r.lease_to) },
    {
      key: "latest_action",
      label: "Follow-up",
      sortable: false,
      className: "whitespace-normal",
      render: (r) => <FollowUpCell occupancyId={r.occupancy_id} latest={r.latest_action} canWrite={canWrite} params={params} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.occupancy_id}
      params={params}
      defaultSort={{ key: "amount_receivable", dir: "desc" }}
      pathname="/accounting"
      empty="No delinquent occupancies on managed properties."
      rowClassName={(r) => (params.history === String(r.occupancy_id) ? "bg-primary/5" : undefined)}
    />
  );
}
