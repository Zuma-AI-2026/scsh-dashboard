import { ACTIVITY_DEFAULT_DAYS, byAgent, dayLabel, byChannel, funnel, FUNNEL_STEPS, HISTORY_START, weekly, type AgentActivity, type ChannelRow, type WeekRow } from "@/lib/leads/activity";
import { channelLabel, leadRange } from "@/lib/leads/analytics";
import type { LeadsDataset } from "@/lib/leads/data";
import { pct, type Params } from "@/lib/sales/analytics";
import { cn } from "@/lib/utils";
import { DataTable } from "./data-table";
import { FilterBar } from "./filter-bar";

const dim = "text-muted-foreground";

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</h3>
      {aside && <span className={cn("text-xs", dim)}>{aside}</span>}
    </div>
  );
}

const withPct = (n: number, of: number) => (
  <span>
    {n} <span className={cn("text-xs", dim)}>{pct(n, of)}</span>
  </span>
);

function WeeklyChart({ weeks }: { weeks: WeekRow[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.thisYear ?? 0, w.lastYear ?? 0]));
  const every = Math.ceil(weeks.length / 13);
  const bar = (value: number | null, tone: string, label: string) =>
    value === null ? (
      <div title={`${label}: no data (history starts ${dayLabel(HISTORY_START, true)})`} className="flex h-full flex-1 items-end justify-center rounded-sm border border-dashed border-border">
        <span className="mb-1 text-[9px] leading-none text-muted-foreground [writing-mode:vertical-rl]">no data</span>
      </div>
    ) : (
      <div title={`${label}: ${value}`} className="flex h-full flex-1 items-end">
        <div className={cn("w-full rounded-t-sm", tone)} style={{ height: `${Math.max((value / max) * 100, value ? 2 : 0)}%` }} />
      </div>
    );

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/70" /> This year</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted-foreground/40" /> Same weeks last year</span>
      </div>
      <div className="flex h-40 items-stretch gap-1.5">
        {weeks.map((w) => (
          <div key={w.week} className="flex min-w-0 flex-1 gap-px">
            {bar(w.thisYear, "bg-primary/70", `${dayLabel(w.from)} – ${dayLabel(w.to)}`)}
            {bar(w.lastYear, "bg-muted-foreground/40", `${dayLabel(w.lastYearFrom, true)} – ${dayLabel(w.lastYearTo, true)}`)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {weeks.map((w, i) => (
          <span key={w.week} className={cn("min-w-0 flex-1 truncate text-center text-[10px]", dim)}>
            {i % every === 0 ? dayLabel(w.week) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ActivityTab({ leads, params, now }: { leads: LeadsDataset | null; params: Params; now: Date }) {
  if (!leads) {
    return (
      <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Lead tracking isn&apos;t set up yet. Run migrations 0008 – 0013 in Supabase, then sync once.
      </p>
    );
  }

  const range = leadRange(params, now, ACTIVITY_DEFAULT_DAYS);
  const isDefaultRange = !params.from && !params.to;
  const counts = funnel(leads.leads, range);
  const channels = byChannel(leads.leads, range);
  const weeks = weekly(leads.leads, range);
  const agents = byAgent(leads.leads, leads.agents, range);

  const thisTotal = weeks.reduce((s, w) => s + (w.thisYear ?? 0), 0);
  const lastComplete = weeks.every((w) => w.lastYear !== null);
  const lastTotal = weeks.reduce((s, w) => s + (w.lastYear ?? 0), 0);
  const max = Math.max(counts.leads, 1);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          filters={[
            { kind: "date", name: "from", label: "From" },
            { kind: "date", name: "to", label: "To" },
          ]}
        />
        <span className={cn("text-xs", dim)}>
          Leads first seen {dayLabel(range.from, true)} – {dayLabel(range.to, true)}
          {isDefaultRange && ` (last ${ACTIVITY_DEFAULT_DAYS} days)`} · test and duplicate leads excluded
        </span>
      </div>

      <div>
        <Heading aside="each lead counted at the furthest step it reached">Funnel</Heading>
        <div className="space-y-1.5 rounded-md border bg-card p-3">
          {FUNNEL_STEPS.map((s, i) => {
            const value = counts[s.key];
            const prev = i === 0 ? null : counts[FUNNEL_STEPS[i - 1].key];
            return (
              <div key={s.key} className="grid grid-cols-[110px_1fr_190px] items-center gap-3 text-sm">
                <span>{s.label}</span>
                <div className="h-6 rounded-sm bg-muted">
                  <div className={cn("h-full rounded-sm", s.key === "lease" ? "bg-positive" : "bg-primary/60")} style={{ width: `${Math.max((value / max) * 100, value ? 1.5 : 0)}%` }} />
                </div>
                <span className="tabular text-right">
                  <span className="font-semibold">{value}</span>
                  {prev !== null && (
                    <span className={cn("ml-2 text-xs", dim)}>
                      {pct(value, prev)} of prev · {pct(value, counts.leads)} of leads
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Heading>Leads and conversion by channel</Heading>
        <DataTable<ChannelRow>
          columns={[
            { key: "channel", label: "Channel", render: (r) => <span className={cn("font-medium", r.channel === "other" && dim)}>{channelLabel(r.channel)}</span> },
            { key: "leads", label: "Leads", align: "right", render: (r) => withPct(r.leads, counts.leads) },
            { key: "contacted", label: "Contacted", align: "right", render: (r) => withPct(r.contacted, r.leads) },
            { key: "tour", label: "Tour booked", align: "right", render: (r) => withPct(r.tour, r.leads) },
            { key: "application", label: "Application", align: "right", render: (r) => withPct(r.application, r.leads) },
            { key: "lease", label: "Lease", align: "right", render: (r) => <span className={cn(r.lease > 0 && "text-positive")}>{withPct(r.lease, r.leads)}</span> },
          ]}
          rows={channels}
          rowKey={(r) => r.channel}
          params={{}}
          empty="No leads in this range."
        />
        <p className={cn("mt-1 text-xs", dim)}>Leads % = share of all leads; the other % are of that channel&apos;s leads.</p>
      </div>

      <div>
        <Heading
          aside={
            <>
              {thisTotal} leads vs {lastComplete ? `${lastTotal} last year (${lastTotal ? `${thisTotal >= lastTotal ? "+" : ""}${Math.round(((thisTotal - lastTotal) / lastTotal) * 100)}%` : "—"})` : `last year: no data before ${dayLabel(HISTORY_START, true)}`}
            </>
          }
        >
          Leads per week vs the same weeks last year
        </Heading>
        <WeeklyChart weeks={weeks} />
      </div>

      <div>
        <Heading aside="by current owner · leads first seen in range">By agent</Heading>
        <DataTable<AgentActivity>
          columns={[
            { key: "name", label: "Agent", render: (r) => <span className={cn("font-medium", (!r.active || r.agent_id === null) && dim)}>{r.name}{!r.active && " (inactive)"}</span> },
            { key: "a_leads", label: "A leads", align: "right", render: (r) => r.a_leads },
            { key: "b_leads", label: "B leads", align: "right", render: (r) => r.b_leads },
            { key: "converted", label: "B → A", align: "right", render: (r) => withPct(r.converted, r.b_leads) },
            { key: "tours", label: "Tours", align: "right", render: (r) => withPct(r.tours, r.a_leads + r.b_leads) },
            { key: "applications", label: "Applications", align: "right", render: (r) => withPct(r.applications, r.a_leads + r.b_leads) },
            { key: "leases", label: "Leases", align: "right", render: (r) => <span className={cn(r.leases > 0 && "text-positive")}>{withPct(r.leases, r.a_leads + r.b_leads)}</span> },
          ]}
          rows={[...agents.rows, agents.total]}
          rowKey={(r) => r.agent_id ?? r.name}
          params={{}}
          rowClassName={(r) => (r.name === "Total" && r.agent_id === null ? "border-t-2 font-semibold" : undefined)}
          empty="No leads in this range."
        />
        <p className={cn("mt-1 text-xs", dim)}>A leads arrived with a form or application; B leads started without one (B → A = later filled the form or applied, same owner, no A turn). Tours, applications and leases: % of the agent&apos;s leads.</p>
      </div>
    </section>
  );
}
