/**
 * Sales → Lead Activity. Pure; only relative .ts imports so `node --test`
 * can load it (tests/activity.test.mts).
 *
 * Cohort = leads first seen in the range (test / duplicate excluded). Each
 * lead is placed at the furthest funnel step it reached, so the funnel is
 * cumulative: a lead with an application also counts as contacted and toured.
 */
import { laParts } from "../season.ts";
import { addDays, isListed, type LeadRange } from "./analytics.ts";
import type { Agent, LeadView } from "./types.ts";

export const ACTIVITY_DEFAULT_DAYS = 90;
/** First day of guest-card history in the dashboard. Earlier weeks show "no data", not zero. */
export const HISTORY_START = "2025-08-01";

export const FUNNEL_STEPS = [
  { key: "leads", label: "Leads" },
  { key: "contacted", label: "Contacted" },
  { key: "tour", label: "Tour booked" },
  { key: "application", label: "Application" },
  { key: "lease", label: "Lease" },
] as const;
export type FunnelKey = (typeof FUNNEL_STEPS)[number]["key"];
export type FunnelCounts = Record<FunnelKey, number>;

/**
 * Furthest step reached: 0 lead, 1 contacted, 2 tour booked, 3 application, 4 lease.
 * Contacted = AppFolio's last activity was a call/text/email (stage "contacted")
 * or the lead got further (form, tour, application).
 */
export function funnelLevel(l: LeadView): number {
  if (l.stage === "leased" || (l.application_status ?? "").toLowerCase() === "converted") return 4;
  if (l.has_application || l.stage === "application") return 3;
  if (l.tour_booked || l.stage === "tour") return 2;
  if (l.stage === "contacted" || l.stage === "form_filled") return 1;
  return 0;
}

function emptyCounts(): FunnelCounts {
  return { leads: 0, contacted: 0, tour: 0, application: 0, lease: 0 };
}

function add(c: FunnelCounts, l: LeadView) {
  const level = funnelLevel(l);
  c.leads += 1;
  if (level >= 1) c.contacted += 1;
  if (level >= 2) c.tour += 1;
  if (level >= 3) c.application += 1;
  if (level >= 4) c.lease += 1;
}

/** LA calendar day (YYYY-MM-DD) of a timestamp. */
export function laDay(iso: string): string {
  const p = laParts(new Date(iso));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

type Dated = LeadView & { day: string };

function cohort(leads: LeadView[], from: string, to: string): Dated[] {
  const out: Dated[] = [];
  for (const l of leads) {
    if (!isListed(l)) continue;
    const day = laDay(l.first_seen_at);
    if (day >= from && day <= to) out.push({ ...l, day });
  }
  return out;
}

export function funnel(leads: LeadView[], range: LeadRange): FunnelCounts {
  const c = emptyCounts();
  for (const l of cohort(leads, range.from, range.to)) add(c, l);
  return c;
}

export type ChannelRow = FunnelCounts & { channel: string };

export function byChannel(leads: LeadView[], range: LeadRange): ChannelRow[] {
  const rows = new Map<string, ChannelRow>();
  for (const l of cohort(leads, range.from, range.to)) {
    const row = rows.get(l.channel) ?? { channel: l.channel, ...emptyCounts() };
    add(row, l);
    rows.set(l.channel, row);
  }
  return [...rows.values()].sort((a, b) => b.leads - a.leads || a.channel.localeCompare(b.channel));
}

export type WeekRow = {
  /** Monday of the week (LA). */
  week: string;
  /** Part of the week inside the range. */
  from: string;
  to: string;
  /** null = before HISTORY_START ("no data"). */
  thisYear: number | null;
  lastYear: number | null;
  lastYearFrom: string;
  lastYearTo: string;
};

function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Leads per Monday-start week of the range vs the same days 52 weeks earlier
 * (364 days, so weekdays line up). Partial first/last weeks are clipped to the
 * range on both sides. A window that starts before HISTORY_START is "no data".
 */
export function weekly(leads: LeadView[], range: LeadRange): WeekRow[] {
  const days = new Map<string, number>();
  for (const l of leads) {
    if (!isListed(l)) continue;
    const day = laDay(l.first_seen_at);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const count = (from: string, to: string) => {
    if (from < HISTORY_START) return null;
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) n += days.get(d) ?? 0;
    return n;
  };

  const rows: WeekRow[] = [];
  let week = addDays(range.from, -((weekday(range.from) + 6) % 7));
  while (week <= range.to) {
    const from = week < range.from ? range.from : week;
    const end = addDays(week, 6);
    const to = end > range.to ? range.to : end;
    const lastYearFrom = addDays(from, -364);
    const lastYearTo = addDays(to, -364);
    rows.push({ week, from, to, thisYear: count(from, to), lastYear: count(lastYearFrom, lastYearTo), lastYearFrom, lastYearTo });
    week = addDays(week, 7);
  }
  return rows;
}

export type AgentActivity = {
  agent_id: number | null;
  name: string;
  active: boolean;
  a_leads: number;
  b_leads: number;
  converted: number;
  tours: number;
  applications: number;
  leases: number;
};

/**
 * Per current owner, for leads first seen in range. A leads = arrived as A
 * (form or application); B leads = started on B, including those that later
 * converted; B → A = converted_from_b. Tours / applications / leases use the
 * same funnel levels as the funnel.
 */
export function byAgent(leads: LeadView[], agents: Agent[], range: LeadRange): { rows: AgentActivity[]; total: AgentActivity } {
  const blank = (agent_id: number | null, name: string, active: boolean): AgentActivity => ({
    agent_id, name, active, a_leads: 0, b_leads: 0, converted: 0, tours: 0, applications: 0, leases: 0,
  });
  const rows = new Map<number | null, AgentActivity>(agents.filter((a) => a.active).map((a) => [a.id, blank(a.id, a.name, true)]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const total = blank(null, "Total", true);

  for (const l of cohort(leads, range.from, range.to)) {
    const key = l.owner_agent_id;
    let row = rows.get(key);
    if (!row) {
      const a = key === null ? undefined : agentById.get(key);
      row = blank(key, key === null ? "Unassigned" : (a?.name ?? `Agent ${key}`), key === null ? true : (a?.active ?? false));
      rows.set(key, row);
    }
    const level = funnelLevel(l);
    for (const r of [row, total]) {
      if (l.rotation === "B" || l.converted_from_b) r.b_leads += 1;
      else r.a_leads += 1;
      if (l.converted_from_b) r.converted += 1;
      if (level >= 2) r.tours += 1;
      if (level >= 3) r.applications += 1;
      if (level >= 4) r.leases += 1;
    }
  }
  const sorted = [...rows.values()].sort(
    (a, b) => Number(a.agent_id === null) - Number(b.agent_id === null) || b.a_leads + b.b_leads - (a.a_leads + a.b_leads) || a.name.localeCompare(b.name),
  );
  return { rows: sorted, total };
}
