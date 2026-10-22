import type { Season } from "@/lib/season";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import {
  computePipeline,
  daysInStatus,
  distinct,
  filterApplications,
  filterLeads,
  filterShowings,
  filterUnits,
  isStaleLead,
  isUpcomingShowing,
  managedPropertiesFor,
  pct,
  rangeFromParams,
  sortRows,
  type FunnelRow,
  type Params,
  type Range,
} from "@/lib/sales/analytics";
import { OwnerCell, RotationBadge } from "@/components/leads/badges";
import type { LeadsDataset } from "@/lib/leads/data";
import type { LeadView } from "@/lib/leads/types";
import type { SalesDataset } from "@/lib/sales/data";
import type { Application, GuestCard, Showing, Unit } from "@/lib/sales/types";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "./data-table";
import { FilterBar } from "./filter-bar";
import { StatusBadge } from "./status-badge";

type TabProps = { data: SalesDataset; leads: LeadsDataset | null; params: Params; season: Season; week: Range; now: Date };

const dim = "text-muted-foreground";
const text = (v: string | null | undefined) => (v ? v : <span className={dim}>—</span>);

/** Dashboard owner + rotation of the lead behind an AppFolio row (empty until leads are set up). */
function leadColumns<T>(leads: LeadsDataset | null, find: (leads: LeadsDataset, row: T) => LeadView | undefined): Column<T>[] {
  if (!leads) return [];
  return [
    {
      key: "lead_owner",
      label: "Owner",
      render: (row) => {
        const lead = find(leads, row);
        return lead ? <OwnerCell lead={lead} /> : text(null);
      },
    },
    {
      key: "lead_rotation",
      label: "Rot.",
      render: (row) => {
        const lead = find(leads, row);
        return lead ? <RotationBadge rotation={lead.rotation} converted={lead.converted_from_b} /> : text(null);
      },
    },
  ];
}
const numCell = (v: number | null | undefined) => (v === null || v === undefined ? <span className={dim}>—</span> : v);

function RangeNote({ params, season, week }: { params: Params; season: Season; week: Range }) {
  if (params.range === "week") return <span className={cn("text-xs", dim)}>This week ({formatDate(week.start.toISOString())} – {formatDate(new Date(week.end.getTime() - 1).toISOString())})</span>;
  if (params.range === "season") return <span className={cn("text-xs", dim)}>Season {season.label} ({formatDate(season.start.toISOString())} – {formatDate(new Date(season.end.getTime() - 1).toISOString())})</span>;
  return null;
}

// ---------------------------------------------------------------------------
// 1. Available units
// ---------------------------------------------------------------------------
export function UnitsTab({ data, params }: TabProps) {
  const rows = sortRows(filterUnits(data.availableUnits, params), params.sort, params.dir, "property_name");
  const bedsBaths = (u: Unit) => (u.bedrooms === null && u.bathrooms === null ? "—" : `${u.bedrooms ?? "?"} / ${u.bathrooms ?? "?"}`);

  const columns: Column<Unit>[] = [
    { key: "property_name", label: "Property", sortable: true, render: (u) => <span className="font-medium">{text(u.property_name)}</span> },
    { key: "unit_name", label: "Unit", sortable: true, render: (u) => text(u.unit_name) },
    { key: "bedrooms", label: "Bd / Ba", sortable: true, align: "right", render: bedsBaths },
    { key: "advertised_rent", label: "Advertised", sortable: true, align: "right", render: (u) => formatMoney(u.advertised_rent ?? u.market_rent) },
    { key: "days_vacant", label: "Days vacant", sortable: true, align: "right", render: (u) => <span className={cn((u.days_vacant ?? 0) > 60 && "text-negative")}>{numCell(u.days_vacant)}</span> },
    { key: "available_on", label: "Available", sortable: true, render: (u) => formatDate(u.available_on ?? u.next_move_in) },
    { key: "unit_status", label: "Status", sortable: true, render: (u) => <StatusBadge value={u.unit_status ?? u.occupancy_status ?? (u.in_vacancy_report ? "Vacant" : null)} /> },
    { key: "occupancy_status", label: "Occupancy", sortable: true, render: (u) => text(u.occupancy_status) },
    { key: "rent_ready", label: "Rent ready", sortable: true, render: (u) => (u.rent_ready === null ? text(null) : u.rent_ready ? <span className="text-positive">Yes</span> : <span className={dim}>No</span>) },
    { key: "move_out", label: "Move-out", sortable: true, render: (u) => formatDate(u.move_out ?? u.last_move_out) },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar filters={[{ kind: "select", name: "property", label: "Property", options: distinct(data.availableUnits, (u) => u.property_name) }]} />
        <span className={cn("text-xs", dim)}>{rows.length} units</span>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(u) => u.unit_id} params={params} defaultSort={{ key: "property_name", dir: "asc" }} empty="No available units — every managed unit is occupied." />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Leads (guest cards)
// ---------------------------------------------------------------------------
export function LeadsTab({ data, leads, params, season, week, now }: TabProps) {
  const range = rangeFromParams(params, season, week);
  const rows = sortRows(filterLeads(data.leads, data.leadInterests, params, range, now), params.sort, params.dir ?? "desc", "received");
  const stale = rows.filter((g) => isStaleLead(g, now)).length;

  const columns: Column<GuestCard>[] = [
    {
      key: "name",
      label: "Lead",
      sortable: true,
      render: (g) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{text(g.name)}</span>
          {isStaleLead(g, now) && <span className="rounded-sm bg-negative/15 px-1 text-[10px] font-medium uppercase text-negative">stale</span>}
        </div>
      ),
    },
    {
      key: "property_name",
      label: "Interest",
      sortable: true,
      render: (g) => {
        const names = managedPropertiesFor(g.guest_card_id, data.leadInterests);
        if (names.length === 0) return text(g.property_name);
        return (
          <span>
            {names[0]}
            {names.length > 1 && <span className={dim}> · +{names.length - 1} more</span>}
          </span>
        );
      },
    },
    { key: "source", label: "Source", sortable: true, render: (g) => text(g.source) },
    ...leadColumns<GuestCard>(leads, (l, g) => l.byCard.get(g.guest_card_id)),
    { key: "assigned_user", label: "AppFolio agent", sortable: true, render: (g) => text(g.assigned_user) },
    { key: "status", label: "Status", sortable: true, render: (g) => <StatusBadge value={g.status} /> },
    { key: "received", label: "Created", sortable: true, render: (g) => formatDateTime(g.received) },
    { key: "last_activity_date", label: "Last activity", sortable: true, render: (g) => <span>{formatDate(g.last_activity_date)}{g.last_activity_type && <span className={cn("ml-1", dim)}>· {g.last_activity_type}</span>}</span> },
    { key: "move_in_preference", label: "Move-in pref", sortable: true, render: (g) => text(g.move_in_preference) },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          filters={[
            { kind: "select", name: "agent", label: "Agent", options: distinct(data.leads, (g) => g.assigned_user) },
            { kind: "select", name: "source", label: "Source", options: distinct(data.leads, (g) => g.source) },
            { kind: "select", name: "status", label: "Status", options: distinct(data.leads, (g) => g.status) },
            { kind: "select", name: "property", label: "Property", options: distinct(data.leadInterests, (i) => i.property_name) },
            { kind: "date", name: "from", label: "From" },
            { kind: "date", name: "to", label: "To" },
            { kind: "toggle", name: "stale", label: "Stale only" },
          ]}
        />
        <div className="flex items-center gap-3">
          <RangeNote params={params} season={season} week={week} />
          <span className={cn("text-xs", dim)}>
            {rows.length} leads{stale ? <span className="text-negative"> · {stale} stale (no activity 48h+)</span> : null}
          </span>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(g) => g.guest_card_id} params={params} defaultSort={{ key: "received", dir: "desc" }} rowClassName={(g) => (isStaleLead(g, now) ? "bg-negative/5" : undefined)} empty="No leads match." />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Showings
// ---------------------------------------------------------------------------
export function ShowingsTab({ data, leads, params, season, week }: TabProps) {
  const range = rangeFromParams(params, season, week);
  const filtered = filterShowings(data.showings, params, range);
  const upcoming = sortRows(filtered.filter(isUpcomingShowing), "showing_time", "asc", "showing_time");
  const past = sortRows(filtered.filter((s) => !isUpcomingShowing(s)), params.sort, params.dir ?? "desc", "showing_time");

  const columns: Column<Showing>[] = [
    { key: "showing_time", label: "When", sortable: true, render: (s) => formatDateTime(s.showing_time) },
    { key: "guest_card_name", label: "Lead", sortable: true, render: (s) => <span className="font-medium">{text(s.guest_card_name)}</span> },
    { key: "property_name", label: "Unit", sortable: true, render: (s) => <span>{text(s.property_name)}{s.showing_unit && <span className={dim}> · {s.showing_unit}</span>}</span> },
    ...leadColumns<Showing>(leads, (l, s) => (s.guest_card_id === null ? undefined : l.byCard.get(s.guest_card_id))),
    { key: "assigned_user", label: "AppFolio agent", sortable: true, render: (s) => text(s.assigned_user) },
    { key: "type", label: "Type", sortable: true, render: (s) => text(s.type) },
    { key: "status", label: "Outcome", sortable: true, render: (s) => <StatusBadge value={s.status} /> },
    { key: "rental_application_status", label: "Application", sortable: true, render: (s) => (s.rental_application_status ? <StatusBadge value={s.rental_application_status} /> : text(null)) },
    { key: "source", label: "Source", sortable: true, render: (s) => text(s.source) },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          filters={[
            { kind: "select", name: "agent", label: "Agent", options: distinct(data.showings, (s) => s.assigned_user) },
            { kind: "select", name: "status", label: "Outcome", options: distinct(data.showings, (s) => s.status) },
            { kind: "select", name: "property", label: "Property", options: distinct(data.showings, (s) => s.property_name) },
          ]}
        />
        <RangeNote params={params} season={season} week={week} />
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Upcoming (Scheduled) · {upcoming.length}</h3>
        <DataTable columns={columns} rows={upcoming} rowKey={(s) => s.showing_id} params={params} empty="No upcoming showings." />
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Past · {past.length}</h3>
        <DataTable columns={columns} rows={past} rowKey={(s) => s.showing_id} params={params} defaultSort={{ key: "showing_time", dir: "desc" }} empty="No past showings in range." />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Applications
// ---------------------------------------------------------------------------
export function ApplicationsTab({ data, leads, params, season, week, now }: TabProps) {
  const range = rangeFromParams(params, season, week);
  const rows = sortRows(filterApplications(data.applications, params, range), params.sort, params.dir ?? "desc", "received");

  const columns: Column<Application>[] = [
    { key: "applicants", label: "Applicant(s)", sortable: true, render: (a) => <span className="font-medium">{text(a.applicants)}</span> },
    { key: "property_name", label: "Unit", sortable: true, render: (a) => <span>{text(a.property_name)}{a.unit_name && <span className={dim}> · {a.unit_name}</span>}</span> },
    { key: "status", label: "Status", sortable: true, render: (a) => <StatusBadge value={a.status} /> },
    { key: "application_status", label: "Decision", sortable: true, render: (a) => (a.application_status ? <StatusBadge value={a.application_status} /> : text(null)) },
    { key: "screening", label: "Screening", sortable: true, render: (a) => text(a.screening) },
    { key: "received", label: "Submitted", sortable: true, render: (a) => formatDateTime(a.received) },
    { key: "days_in_status", label: "Days in status", align: "right", render: (a) => numCell(daysInStatus(a, now)) },
    { key: "desired_move_in", label: "Desired move-in", sortable: true, render: (a) => formatDate(a.desired_move_in) },
    { key: "lease_start_date", label: "Lease", sortable: true, render: (a) => (a.lease_start_date ? `${formatDate(a.lease_start_date)} → ${formatDate(a.lease_end_date)}` : text(null)) },
    ...leadColumns<Application>(leads, (l, a) => l.byApp.get(a.rental_application_id)),
    { key: "assigned_user", label: "AppFolio agent", sortable: true, render: (a) => text(a.assigned_user) },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          filters={[
            { kind: "select", name: "status", label: "Status", options: distinct(data.applications, (a) => a.status) },
            { kind: "select", name: "agent", label: "Agent", options: distinct(data.applications, (a) => a.assigned_user) },
            { kind: "select", name: "property", label: "Property", options: distinct(data.applications, (a) => a.property_name) },
          ]}
        />
        <div className="flex items-center gap-3">
          <RangeNote params={params} season={season} week={week} />
          <span className={cn("text-xs", dim)}>{rows.length} applications</span>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(a) => a.rental_application_id} params={params} defaultSort={{ key: "received", dir: "desc" }} empty="No applications match." />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Pipeline
// ---------------------------------------------------------------------------
export function PipelineTab({ data, season }: TabProps) {
  const { total, byAgent } = computePipeline(data, season);
  const stages: { key: keyof Omit<FunnelRow, "agent">; label: string }[] = [
    { key: "leads", label: "Leads" },
    { key: "showings", label: "Showings" },
    { key: "applications", label: "Applications" },
    { key: "leases", label: "Leases signed" },
  ];
  const max = Math.max(total.leads, 1);

  return (
    <section className="space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Season {season.label} funnel</h3>
          <span className={cn("text-xs", dim)}>
            {formatDate(season.start.toISOString())} – {formatDate(new Date(season.end.getTime() - 1).toISOString())}
          </span>
        </div>
        <div className="space-y-1.5 rounded-md border bg-card p-3">
          {stages.map((s, i) => {
            const value = total[s.key];
            const prev = i === 0 ? null : total[stages[i - 1].key];
            return (
              <div key={s.key} className="grid grid-cols-[120px_1fr_120px] items-center gap-3 text-sm">
                <span>{s.label}</span>
                <div className="h-6 rounded-sm bg-muted">
                  <div className={cn("h-full rounded-sm", s.key === "leases" ? "bg-positive" : "bg-primary/60")} style={{ width: `${Math.max((value / max) * 100, value ? 1.5 : 0)}%` }} />
                </div>
                <span className="tabular text-right">
                  <span className="font-semibold">{value}</span>
                  {prev !== null && <span className={cn("ml-2 text-xs", dim)}>{pct(value, prev)} of prev</span>}
                </span>
              </div>
            );
          })}
          <div className={cn("pt-1 text-xs", dim)}>Lead → lease conversion: <span className="text-foreground">{pct(total.leases, total.leads)}</span></div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">By agent</h3>
        <DataTable<FunnelRow>
          columns={[
            { key: "agent", label: "Agent", render: (r) => <span className="font-medium">{r.agent}</span> },
            { key: "leads", label: "Leads", align: "right", render: (r) => r.leads },
            { key: "showings", label: "Showings", align: "right", render: (r) => <span>{r.showings} <span className={cn("text-xs", dim)}>{pct(r.showings, r.leads)}</span></span> },
            { key: "applications", label: "Applications", align: "right", render: (r) => <span>{r.applications} <span className={cn("text-xs", dim)}>{pct(r.applications, r.showings)}</span></span> },
            { key: "leases", label: "Leases", align: "right", render: (r) => <span className={cn(r.leases && "text-positive")}>{r.leases} <span className={cn("text-xs", dim)}>{pct(r.leases, r.leads)}</span></span> },
          ]}
          rows={byAgent}
          rowKey={(r) => r.agent}
          params={{}}
          empty="No activity this season."
        />
      </div>
    </section>
  );
}
