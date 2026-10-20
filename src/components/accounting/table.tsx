import { FollowUpCell, LastActionCell } from "@/components/accounting/follow-up";
import { DataTable, type Column } from "@/components/sales/data-table";
import type { DelinquencyView } from "@/lib/accounting/analytics";
import { OWNER_TYPE_LABEL, type DelinquencyStage } from "@/lib/accounting/ladder";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DelinquencyTable({
  rows,
  params,
  canWrite,
  showContacts,
  stages,
}: {
  rows: DelinquencyView[];
  params: Record<string, string | undefined>;
  canWrite: boolean;
  showContacts: boolean;
  stages: DelinquencyStage[];
}) {
  const columns: Column<DelinquencyView>[] = [
    { key: "property_name", label: "Property", sortable: true, render: (r) => r.property_name ?? "—" },
    { key: "unit_name", label: "Unit", sortable: true, render: (r) => r.unit_name ?? "—" },
    {
      key: "tenant",
      label: "Tenant",
      sortable: true,
      className: "whitespace-normal",
      render: (r) => (
        <div>
          <div>{r.tenant ?? "—"}</div>
          {showContacts && (r.contact?.phone_numbers || r.contact?.emails) && (
            <div className="text-[11px] text-muted-foreground">
              {r.contact.phone_numbers}
              {r.contact.phone_numbers && r.contact.emails ? " · " : ""}
              {r.contact.emails}
            </div>
          )}
        </div>
      ),
    },
    { key: "amount_receivable", label: "Balance", sortable: true, align: "right", render: (r) => formatMoney(r.amount_receivable) },
    { key: "aging_bucket", label: "Aging", sortable: true, render: (r) => r.aging_bucket ?? "—" },
    { key: "days_past_due", label: "Days past due", sortable: true, align: "right", render: (r) => (r.days_past_due === null ? "—" : String(r.days_past_due)) },
    { key: "current_stage", label: "Stage", sortable: false, render: (r) => r.current_stage?.name ?? "—" },
    {
      key: "latest_action",
      label: "Last action",
      sortable: false,
      className: "whitespace-normal",
      render: (r) => (
        <LastActionCell
          occupancyId={r.occupancy_id}
          latest={r.latest_action}
          stageName={r.latest_action?.stage_id != null ? (stages.find((s) => s.id === r.latest_action!.stage_id)?.name ?? null) : null}
          params={params}
        />
      ),
    },
    {
      key: "next_action_due",
      label: "Next action",
      sortable: false,
      className: "whitespace-normal",
      render: (r) =>
        r.next_action_due ? (
          <div className="flex flex-wrap items-center gap-1">
            <span>
              {r.next_action_due.action_label}
              <span className="ml-1 text-muted-foreground">· {OWNER_TYPE_LABEL[r.next_action_due.owner_type]}</span>
            </span>
            {r.action_overdue && (
              <span className="inline-flex h-5 items-center rounded-sm border border-negative/40 bg-negative/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-negative">
                Overdue
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "last_payment",
      label: "Last payment",
      sortable: true,
      render: (r) => (r.last_payment ? `${formatDate(r.last_payment)}${r.payment_amount != null ? ` · ${formatMoney(r.payment_amount)}` : ""}` : "—"),
    },
    { key: "nsf", label: "NSF", sortable: true, align: "right", render: (r) => (r.nsf == null ? "—" : String(r.nsf)) },
    { key: "lease_to", label: "Lease end", sortable: true, render: (r) => formatDate(r.lease_to) },
  ];

  if (canWrite) {
    columns.push({
      key: "follow_up",
      label: "Follow-up",
      sortable: false,
      className: "whitespace-normal",
      render: (r) => <FollowUpCell occupancyId={r.occupancy_id} canWrite={canWrite} stages={stages} nextDueId={r.next_action_due?.id ?? null} />,
    });
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.occupancy_id}
      params={params}
      pathname="/accounting"
      empty="No delinquent occupancies on managed properties."
      rowClassName={(r) => cn(params.history === String(r.occupancy_id) && "bg-primary/5", r.action_overdue && params.history !== String(r.occupancy_id) && "bg-negative/5")}
    />
  );
}
