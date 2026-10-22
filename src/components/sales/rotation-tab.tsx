import Link from "next/link";
import { Download } from "lucide-react";
import { OwnerCell, RotationBadge, StageBadge } from "@/components/leads/badges";
import { LeadRowActions } from "@/components/leads/lead-row-actions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { channelLabel, conversionByOwner, filterRotation, formatPhone, isListed, leadRange, ROTATION_DEFAULT_DAYS, turnsInRange, type RotationRow } from "@/lib/leads/analytics";
import { loadLeadIntakeEvents, type LeadsDataset } from "@/lib/leads/data";
import { ATTENTION_BUSINESS_HOURS, inquirySummary, needsAttention, notifiedLabel, type AttentionRow } from "@/lib/leads/row-info";
import type { LeadView } from "@/lib/leads/types";
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
/** Inquiry summaries are fetched only for this many rows (the top of the sorted table). */
const SUMMARY_ROWS = 500;

type View = "A" | "B" | "attention";

export function rotationView(params: Params): View {
  return params.rot === "B" ? "B" : params.rot === "attention" ? "attention" : "A";
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

function Summary({ lines }: { lines: string[] | undefined }) {
  if (!lines?.length) return <span className={dim}>—</span>;
  return (
    <details className="max-w-64" title={lines.join("\n")}>
      <summary className="cursor-pointer truncate text-xs marker:text-muted-foreground">{lines[0]}</summary>
      <ul className="mt-1 space-y-1 text-xs whitespace-normal">
        {lines.map((l, i) => (
          <li key={i} className={i ? dim : undefined}>
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

export async function RotationTab({ leads, params, now, user }: { leads: LeadsDataset | null; params: Params; now: Date; user: CurrentUser }) {
  if (!leads) {
    return (
      <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Lead rotation isn&apos;t set up yet. Run migrations 0008 – 0016 in Supabase, then sync once.
      </p>
    );
  }

  const view = rotationView(params);
  const range = leadRange(params, now);
  const isDefaultRange = !params.from && !params.to;
  const rowsA = filterRotation(leads.leads, "A", params, range);
  const rowsB = filterRotation(leads.leads, "B", params, range);
  const q = (params.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const attention = needsAttention(leads.leads, now, leads.goLiveAt).filter(
    (l) =>
      (!params.agent || String(l.owner_agent_id) === params.agent) &&
      (!params.channel || l.channel === params.channel) &&
      (!q || (l.name ?? "").toLowerCase().includes(q) || (l.email_norm ?? "").includes(q) || (qDigits.length >= 3 && (l.phone_norm ?? "").includes(qDigits))),
  );

  const isAdmin = user.role === "admin";
  const me = leads.agents.find((a) => a.email.toLowerCase() === user.email.toLowerCase()) ?? null;
  const canAct = (l: LeadView) => isAdmin || (user.role === "sales" && me !== null && l.owner_agent_id === me.id);
  const activeAgents = leads.agents.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));

  const sorted = view === "attention" ? attention : sortRows(view === "A" ? rowsA : rowsB, params.sort, params.dir ?? "desc", "date");
  const intake = await loadLeadIntakeEvents(sorted.slice(0, SUMMARY_ROWS).map((r) => r.id));
  const summaries = new Map([...intake].map(([id, events]) => [id, inquirySummary(events)]));

  // Header: turns and B → A per agent for the view range.
  const turnsA = new Map(turnsInRange(leads.leads, leads.agents, "A", range).map((t) => [t.agent_id, t]));
  const turnsB = new Map(turnsInRange(leads.leads, leads.agents, "B", range).map((t) => [t.agent_id, t.turns]));
  const conversion = conversionByOwner(leads.leads, leads.agents, range);
  const convByAgent = new Map(conversion.rows.map((c) => [c.agent_id, c]));
  const headerAgents = leads.agents.filter((a) => a.active || turnsA.has(a.id) || turnsB.has(a.id));

  const agentOptions = [...leads.agents.map((a) => ({ value: String(a.id), label: a.active ? a.name : `${a.name} (inactive)` })), { value: "none", label: "Unassigned" }];
  const channelOptions = [...new Set(leads.leads.filter(isListed).map((l) => l.channel))]
    .sort((a, b) => channelLabel(a).localeCompare(channelLabel(b)))
    .map((c) => ({ value: c, label: channelLabel(c) }));
  const exportHref = hrefWith("/sales/rotation/export", { ...params, tab: undefined, sort: undefined, dir: undefined }, { rot: view === "B" ? "B" : "A" });

  // Shared columns (work for both RotationRow and AttentionRow).
  type Row = LeadView;
  const nameCol: Column<Row> = { key: "name", label: "Name", sortable: true, render: (r) => <span className="font-medium">{text(r.name ?? r.email_norm)}</span> };
  const phoneCol: Column<Row> = {
    key: "phone_norm",
    label: "Phone",
    render: (r) => (r.phone_norm ? <span className="whitespace-nowrap">{formatPhone(r.phone_norm)}</span> : <span className={cn("text-xs italic", dim)}>no phone</span>),
  };
  const ownerCol: Column<Row> = { key: "owner_name", label: "Owner", sortable: true, render: (r) => <OwnerCell lead={r} /> };
  const channelCol: Column<Row> = {
    key: "channel",
    label: "Channel",
    sortable: true,
    render: (r) => <span className={r.channel === "other" ? dim : undefined}>{channelLabel(r.channel)}</span>,
  };
  const sourceCol: Column<Row> = { key: "source_first", label: "Source", sortable: true, render: (r) => <span className="text-xs">{text(r.source_first)}</span> };
  const propertyCol: Column<Row> = { key: "property_name", label: "Property", sortable: true, render: (r) => text(r.property_name) };
  const stageCol: Column<Row> = { key: "stage_now", label: "Stage", sortable: true, render: (r) => <StageBadge stage={r.stage_now} /> };
  const flagCols: Column<Row>[] = [
    { key: "tour_booked", label: "Tour", sortable: true, render: (r) => yes(r.tour_booked) },
    { key: "application_status", label: "Application", sortable: true, render: (r) => (r.application_status ? <StatusBadge value={r.application_status} /> : r.has_application ? "Yes" : text(null)) },
  ];
  const notifiedCol: Column<Row> = {
    key: "notified",
    label: "Notified",
    render: (r) => {
      const label = notifiedLabel(r.notified, leads.agents, now);
      return <span className={cn("text-xs whitespace-nowrap", !r.notified ? dim : r.notified.test ? "text-warning" : undefined)}>{label}</span>;
    },
  };
  const summaryCol: Column<Row> = { key: "summary", label: "Inquiry", render: (r) => <Summary lines={summaries.get(r.id)} /> };
  const actionsCol: Column<Row> = {
    key: "actions",
    label: "",
    render: (r) => (canAct(r) ? <LeadRowActions leadId={r.id} ownerId={r.owner_agent_id} agents={activeAgents} /> : null),
  };
  const dateCol: Column<RotationRow> = { key: "date", label: view === "A" ? "Qualified" : "First seen", sortable: true, render: (r) => formatDateTime(r.date) };

  const columnsA: Column<RotationRow>[] = [
    dateCol,
    nameCol,
    phoneCol,
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
    notifiedCol,
    summaryCol,
    actionsCol,
  ];
  const columnsB: Column<RotationRow>[] = [
    dateCol,
    nameCol,
    phoneCol,
    sourceCol,
    channelCol,
    ownerCol,
    propertyCol,
    stageCol,
    ...flagCols,
    { key: "last_event_at", label: "Last activity", sortable: true, render: (r) => formatDate(r.last_event_at) },
    notifiedCol,
    summaryCol,
    actionsCol,
  ];
  const columnsAttention: Column<AttentionRow>[] = [
    {
      key: "hours_overdue",
      label: "Overdue",
      align: "right",
      render: (r) => <span className="tabular font-semibold text-negative">{Math.round(r.hours_overdue)} h</span>,
    },
    { key: "assigned_at", label: "Assigned", render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.assigned_at)}</span> },
    { key: "rotation", label: "Rot.", render: (r) => <RotationBadge rotation={r.rotation} converted={r.converted_from_b} /> },
    nameCol,
    phoneCol,
    ownerCol,
    channelCol,
    notifiedCol,
    {
      key: "appfolio_last_activity",
      label: "AppFolio activity",
      render: (r) => (r.appfolio_last_activity ? <span className="text-xs">{formatDate(`${r.appfolio_last_activity.slice(0, 10)}T12:00:00Z`)} · {r.appfolio_last_activity_type}</span> : text(null)),
    },
    summaryCol,
    actionsCol,
  ];

  const tabLink = (v: View, label: string, count: number, warn = false) => {
    const active = v === view;
    return (
      <Link
        href={hrefWith("/sales", { ...params, sort: undefined, dir: undefined }, { rot: v })}
        scroll={false}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
          active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span className={cn("tabular rounded-sm px-1 text-[11px]", warn && count > 0 ? "bg-negative/15 text-negative" : active ? "bg-primary/15 text-primary" : "bg-muted")}>{count}</span>
      </Link>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabLink("A", "Rotation A · form or application", rowsA.length)}
        {tabLink("B", "Rotation B · no form", rowsB.length)}
        {tabLink("attention", "Needs attention", attention.length, true)}
        <span className={cn("ml-auto text-xs", dim)}>
          {formatDate(range.start.toISOString())} – {formatDate(new Date(range.end.getTime() - 1).toISOString())}
          {isDefaultRange && ` (last ${ROTATION_DEFAULT_DAYS} days)`}
          {leads.goLiveAt && ` · rotation since ${formatDate(leads.goLiveAt)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {headerAgents.map((a) => {
          const c = convByAgent.get(a.id);
          return (
            <HeaderCard
              key={a.id}
              label={a.name}
              value={`A ${turnsA.get(a.id)?.turns ?? 0} · B ${turnsB.get(a.id) ?? 0}`}
              sub={`turns in range · B → A ${c?.converted ?? 0}${c?.b_leads ? ` of ${c.b_leads} (${pct(c.converted, c.b_leads)})` : ""}`}
              muted={!a.active}
            />
          );
        })}
        <HeaderCard
          label="B → A, all"
          value={pct(conversion.total.converted, conversion.total.b_leads)}
          sub={`${conversion.total.converted} of ${conversion.total.b_leads} B leads first seen in range`}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          keep={["tab", "rot"]}
          filters={[
            ...(view === "attention"
              ? []
              : [
                  { kind: "date" as const, name: "from", label: "From" },
                  { kind: "date" as const, name: "to", label: "To" },
                ]),
            { kind: "search", name: "q", label: "Search", placeholder: "Name, email or phone" },
            { kind: "select", name: "agent", label: "Owner", options: agentOptions },
            { kind: "select", name: "channel", label: "Channel", options: channelOptions },
            ...(view === "attention" ? [] : [{ kind: "toggle" as const, name: "mismatch", label: "Owner ≠ AppFolio" }]),
          ]}
        />
        <div className="flex items-center gap-3">
          <span className={cn("text-xs", dim)}>{sorted.length} leads</span>
          {view !== "attention" && (
            <a href={exportHref} className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
              <Download className="size-3.5" /> CSV
            </a>
          )}
        </div>
      </div>

      {view === "attention" ? (
        <>
          <p className={cn("text-xs", dim)}>
            Owned, open leads with nothing since they were assigned for more than {ATTENTION_BUSINESS_HOURS} business hours (Mon–Fri 9:00–17:30 Los Angeles). &ldquo;Something&rdquo; = a new inquiry, form,
            tour, application or reply, or agent activity in AppFolio (call, text, email, note…) on or after the assignment day. Only leads assigned since rotation went live; ignores the date range.
          </p>
          <DataTable columns={columnsAttention} rows={attention} rowKey={(r) => r.id} params={{}} empty="Nobody is waiting." />
        </>
      ) : (
        <DataTable
          columns={view === "A" ? columnsA : columnsB}
          rows={sorted as RotationRow[]}
          rowKey={(r) => r.id}
          params={params}
          defaultSort={{ key: "date", dir: "desc" }}
          rowClassName={(r) => (r.owner_mismatch ? "bg-warning/5" : undefined)}
          empty={view === "A" ? "No form or application leads in this range." : "No no-form leads in this range."}
        />
      )}
      {sorted.length > SUMMARY_ROWS && <p className={cn("text-xs", dim)}>Inquiry text is loaded for the first {SUMMARY_ROWS} rows; narrow the range or filters to see it for the rest.</p>}
    </section>
  );
}
