import Link from "next/link";
import { Download } from "lucide-react";
import { OwnerCell, StageBadge } from "@/components/leads/badges";
import { channelLabel, conversionByOwner, filterRotation, formatPhone, isListed, leadRange, ROTATION_DEFAULT_DAYS, turnsInRange, type RotationRow } from "@/lib/leads/analytics";
import type { LeadsDataset } from "@/lib/leads/data";
import type { Rotation } from "@/lib/leads/rules";
import { formatDate, formatDateTime } from "@/lib/format";
import { pct, sortRows, type Params } from "@/lib/sales/analytics";
import { hrefWith } from "@/lib/url";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "./data-table";
import { FilterBar } from "./filter-bar";
import { StatusBadge } from "./status-badge";

const dim = "text-muted-foreground";
const text = (v: string | null | undefined) => (v ? v : <span className={dim}>—</span>);
const yes = (v: boolean) => (v ? <span className="text-positive">Yes</span> : <span className={dim}>—</span>);

export function rotationOf(params: Params): Rotation {
  return params.rot === "B" ? "B" : "A";
}

function HeaderCard({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div className={cn("min-w-32 rounded-md border bg-card px-3 py-2", muted && "opacity-60")}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold leading-none">{value}</div>
      <div className="mt-1 h-4 truncate text-[11px] text-muted-foreground">{sub ?? ""}</div>
    </div>
  );
}

export function RotationTab({ leads, params, now }: { leads: LeadsDataset | null; params: Params; now: Date }) {
  if (!leads) {
    return (
      <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Lead rotation isn&apos;t set up yet. Run migrations 0008 – 0012 in Supabase, then sync once.
      </p>
    );
  }

  const rotation = rotationOf(params);
  const range = leadRange(params, now);
  const isDefaultRange = !params.from && !params.to;
  const rowsA = filterRotation(leads.leads, "A", params, range);
  const rowsB = filterRotation(leads.leads, "B", params, range);
  const rows = sortRows(rotation === "A" ? rowsA : rowsB, params.sort, params.dir ?? "desc", "date");
  const turns = turnsInRange(leads.leads, leads.agents, rotation, range);
  const conversion = rotation === "B" ? conversionByOwner(leads.leads, leads.agents, range) : null;

  const agentOptions = [...leads.agents.map((a) => ({ value: String(a.id), label: a.active ? a.name : `${a.name} (inactive)` })), { value: "none", label: "Unassigned" }];
  const exportHref = hrefWith("/sales/rotation/export", { ...params, tab: undefined, sort: undefined, dir: undefined }, { rot: rotation });

  const dateCol: Column<RotationRow> = {
    key: "date",
    label: rotation === "A" ? "Qualified" : "First seen",
    sortable: true,
    render: (r) => formatDateTime(r.date),
  };
  const nameCol: Column<RotationRow> = {
    key: "name",
    label: "Name",
    sortable: true,
    render: (r) => <span className="font-medium">{text(r.name ?? r.email_norm)}</span>,
  };
  const ownerCol: Column<RotationRow> = { key: "owner_name", label: "Owner", sortable: true, render: (r) => <OwnerCell lead={r} /> };
  const channelCol: Column<RotationRow> = {
    key: "channel",
    label: "Channel",
    sortable: true,
    render: (r) => (
      <span title={r.source_first ?? "No source"} className={r.channel === "other" ? dim : undefined}>
        {channelLabel(r.channel)}
      </span>
    ),
  };
  const propertyCol: Column<RotationRow> = { key: "property_name", label: "Property", sortable: true, render: (r) => text(r.property_name) };
  const stageCol: Column<RotationRow> = { key: "stage_now", label: "Stage", sortable: true, render: (r) => <StageBadge stage={r.stage_now} /> };
  const flagCols: Column<RotationRow>[] = [
    { key: "tour_booked", label: "Tour", sortable: true, render: (r) => yes(r.tour_booked) },
    { key: "application_status", label: "Application", sortable: true, render: (r) => (r.application_status ? <StatusBadge value={r.application_status} /> : r.has_application ? "Yes" : text(null)) },
  ];

  const columns: Column<RotationRow>[] =
    rotation === "A"
      ? [
          dateCol,
          nameCol,
          { key: "phone_norm", label: "Phone", render: (r) => text(formatPhone(r.phone_norm)) },
          propertyCol,
          {
            key: "pq_score",
            label: "Score / tier",
            sortable: true,
            align: "right",
            render: (r) => (r.pq_score === null && !r.pq_tier ? text(null) : <span>{r.pq_score ?? "—"}{r.pq_tier && <span className={cn("ml-1", dim)}>· {r.pq_tier}</span>}</span>),
          },
          ownerCol,
          channelCol,
          stageCol,
          { key: "converted_from_b", label: "From B", sortable: true, render: (r) => (r.converted_from_b ? <span className="text-primary">Converted</span> : <span className={dim}>—</span>) },
          ...flagCols,
        ]
      : [
          dateCol,
          nameCol,
          ownerCol,
          channelCol,
          propertyCol,
          stageCol,
          ...flagCols,
          { key: "last_event_at", label: "Last activity", sortable: true, render: (r) => formatDate(r.last_event_at) },
        ];
  const channelOptions = [...new Set(leads.leads.filter(isListed).map((l) => l.channel))]
    .sort((a, b) => channelLabel(a).localeCompare(channelLabel(b)))
    .map((c) => ({ value: c, label: channelLabel(c) }));

  const tabLink = (rot: Rotation, label: string, count: number) => {
    const active = rot === rotation;
    return (
      <Link
        href={hrefWith("/sales", { ...params, sort: undefined, dir: undefined }, { rot })}
        scroll={false}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
          active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span className={cn("tabular rounded-sm px-1 text-[11px]", active ? "bg-primary/15 text-primary" : "bg-muted")}>{count}</span>
      </Link>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabLink("A", "Rotation A · form or application", rowsA.length)}
        {tabLink("B", "Rotation B · no form", rowsB.length)}
        <span className={cn("ml-auto text-xs", dim)}>
          {formatDate(range.start.toISOString())} – {formatDate(new Date(range.end.getTime() - 1).toISOString())}
          {isDefaultRange && ` (last ${ROTATION_DEFAULT_DAYS} days)`}
          {leads.goLiveAt && ` · rotation since ${formatDate(leads.goLiveAt)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {turns.map((t) => (
          <HeaderCard key={t.agent_id} label={`${t.name} · ${rotation} turns`} value={String(t.turns)} sub={t.active ? "in range" : "inactive"} muted={!t.active} />
        ))}
        {conversion && (
          <>
            <HeaderCard label="B → A conversion" value={pct(conversion.total.converted, conversion.total.b_leads)} sub={`${conversion.total.converted} of ${conversion.total.b_leads} B leads`} />
            {conversion.rows.map((c) => (
              <HeaderCard key={c.agent_id ?? "none"} label={`${c.name} · B → A`} value={pct(c.converted, c.b_leads)} sub={`${c.converted} of ${c.b_leads}`} />
            ))}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          keep={["tab", "rot"]}
          filters={[
            { kind: "date", name: "from", label: "From" },
            { kind: "date", name: "to", label: "To" },
            { kind: "search", name: "q", label: "Search", placeholder: "Name, email or phone" },
            { kind: "select", name: "agent", label: "Owner", options: agentOptions },
            { kind: "select", name: "channel", label: "Channel", options: channelOptions },
            { kind: "toggle", name: "mismatch", label: "Owner ≠ AppFolio" },
          ]}
        />
        <div className="flex items-center gap-3">
          <span className={cn("text-xs", dim)}>{rows.length} leads</span>
          <a href={exportHref} className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
            <Download className="size-3.5" /> CSV
          </a>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        defaultSort={{ key: "date", dir: "desc" }}
        rowClassName={(r) => (r.owner_mismatch ? "bg-warning/5" : undefined)}
        empty={rotation === "A" ? "No form or application leads in this range." : "No no-form leads in this range."}
      />
    </section>
  );
}
