import { currentSeason, currentWeek, daysSince, inRange, toInstant, type Season } from "@/lib/season";
import type { SalesDataset } from "./data";
import { CANCELLED_SHOWING_STATUSES, CLOSED_LEAD_STATUSES, STALE_LEAD_HOURS, type Application, type GuestCard, type Showing, type Unit } from "./types";

/** Pure functions over the loaded dataset. No I/O so they're easy to reason about and test. */

export type Range = { start: Date; end: Date };

export type Kpi = {
  key: string;
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone?: "positive" | "negative" | "neutral";
};

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function isCancelledShowing(s: Showing): boolean {
  return CANCELLED_SHOWING_STATUSES.includes(lower(s.status));
}
export function isCompletedShowing(s: Showing): boolean {
  return lower(s.status) === "completed";
}
export function isUpcomingShowing(s: Showing, now: Date): boolean {
  if (!s.showing_time || isCancelledShowing(s) || isCompletedShowing(s)) return false;
  const t = toInstant(s.showing_time);
  return t !== null && t >= now.getTime();
}
export function isLeaseSigned(a: Application): boolean {
  return lower(a.status) === "converted";
}
/** The moment the lease was effectively signed (for season bucketing). */
export function leaseSignedAt(a: Application): string | null {
  return a.approved_at ?? a.decision_made_at ?? a.received;
}
/** Stale = open status and no activity for 48h+. */
export function isStaleLead(g: GuestCard, now: Date): boolean {
  if (CLOSED_LEAD_STATUSES.includes(lower(g.status))) return false;
  const last = g.last_activity_date ?? g.received;
  if (!last) return true;
  const t = toInstant(last);
  if (t === null) return false;
  // last_activity_date is a date (no time): treat it as end-of-day so "older than 48h" isn't off by one.
  const endOfDay = /^\d{4}-\d{2}-\d{2}$/.test(last) ? t + 86_400_000 : t;
  return now.getTime() - endOfDay > STALE_LEAD_HOURS * 3600_000;
}
/** "Days in status": time since the last decision, otherwise since received. */
export function daysInStatus(a: Application, now: Date): number | null {
  return daysSince(a.decision_made_at ?? a.approved_at ?? a.denied_at ?? a.canceled_at ?? a.screened_on ?? a.received, now);
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function computeKpis(data: SalesDataset, now = new Date()): { season: Season; week: Range; kpis: Kpi[] } {
  const season = currentSeason(now);
  const week = currentWeek(now);
  const inSeason = (v: string | null) => inRange(v, season.start, season.end);
  const inWeek = (v: string | null) => inRange(v, week.start, week.end);

  const leadsWeek = data.leads.filter((g) => inWeek(g.received)).length;
  const leadsSeason = data.leads.filter((g) => inSeason(g.received)).length;
  const showingsWeek = data.showings.filter((s) => inWeek(s.showing_time) && !isCancelledShowing(s));
  const showingsCompletedWeek = showingsWeek.filter(isCompletedShowing).length;
  const appsSeason = data.applications.filter((a) => inSeason(a.received)).length;
  const leasesSeason = data.applications.filter((a) => isLeaseSigned(a) && inSeason(leaseSignedAt(a))).length;
  const dom = data.availableUnits.map((u) => u.days_vacant).filter((d): d is number => typeof d === "number");
  const avgDom = dom.length ? Math.round(dom.reduce((a, b) => a + b, 0) / dom.length) : null;
  const staleLeads = data.leads.filter((g) => isStaleLead(g, now)).length;

  const seasonSub = season.phase === "upcoming" ? `season ${season.label} · starts Nov 1` : `season ${season.label}`;

  const kpis: Kpi[] = [
    { key: "available", label: "Available units", value: String(data.availableUnits.length), href: "/sales?tab=units", tone: data.availableUnits.length ? "neutral" : "positive" },
    { key: "leads-week", label: "Leads this week", value: String(leadsWeek), sub: staleLeads ? `${staleLeads} stale` : undefined, href: "/sales?tab=leads&range=week", tone: staleLeads ? "negative" : "neutral" },
    { key: "leads-season", label: "Leads this season", value: String(leadsSeason), sub: seasonSub, href: "/sales?tab=leads&range=season" },
    { key: "showings-week", label: "Showings this week", value: `${showingsWeek.length} / ${showingsCompletedWeek}`, sub: "scheduled / completed", href: "/sales?tab=showings&range=week" },
    { key: "apps-season", label: "Applications in", value: String(appsSeason), sub: seasonSub, href: "/sales?tab=applications&range=season" },
    { key: "leases-season", label: "Leases signed", value: String(leasesSeason), sub: seasonSub, href: "/sales?tab=applications&range=season&status=Converted", tone: leasesSeason ? "positive" : "neutral" },
    { key: "dom", label: "Avg days on market", value: avgDom === null ? "—" : String(avgDom), sub: dom.length ? `${dom.length} units with data` : "no data", href: "/sales?tab=units&sort=days_vacant&dir=desc", tone: avgDom !== null && avgDom > 60 ? "negative" : "neutral" },
  ];

  return { season, week, kpis };
}

// ---------------------------------------------------------------------------
// Filters & sorting (driven by URL search params)
// ---------------------------------------------------------------------------

export type Params = Record<string, string | undefined>;

export function rangeFromParams(p: Params, season: Season, week: Range): Range | null {
  if (p.range === "week") return week;
  if (p.range === "season") return { start: season.start, end: season.end };
  const from = p.from ? toInstant(p.from) : null;
  const to = p.to ? toInstant(p.to) : null;
  if (from !== null || to !== null) {
    return { start: new Date(from ?? 0), end: new Date(to !== null ? to + 86_400_000 : 8.64e15) };
  }
  return null;
}

const eq = (a: string | null | undefined, b: string | undefined) => !b || lower(a) === lower(b);

export function filterUnits(units: Unit[], p: Params): Unit[] {
  return units.filter((u) => eq(u.property_name, p.property));
}

export function filterLeads(leads: GuestCard[], p: Params, range: Range | null, now: Date): GuestCard[] {
  return leads.filter(
    (g) =>
      eq(g.assigned_user, p.agent) &&
      eq(g.source, p.source) &&
      eq(g.status, p.status) &&
      eq(g.property_name, p.property) &&
      (!range || inRange(g.received, range.start, range.end)) &&
      (p.stale !== "1" || isStaleLead(g, now)),
  );
}

export function filterShowings(showings: Showing[], p: Params, range: Range | null): Showing[] {
  return showings.filter(
    (s) => eq(s.assigned_user, p.agent) && eq(s.status, p.status) && eq(s.property_name, p.property) && (!range || inRange(s.showing_time, range.start, range.end)),
  );
}

export function filterApplications(apps: Application[], p: Params, range: Range | null): Application[] {
  return apps.filter(
    (a) => eq(a.status, p.status) && eq(a.assigned_user, p.agent) && eq(a.property_name, p.property) && (!range || inRange(a.received, range.start, range.end)),
  );
}

export function sortRows<T extends Record<string, unknown>>(rows: T[], key: string | undefined, dir: string | undefined, fallback: keyof T & string): T[] {
  const k = key && rows.length && key in rows[0] ? key : fallback;
  const asc = dir !== "desc";
  return [...rows].sort((a, b) => {
    const va = a[k] as unknown;
    const vb = b[k] as unknown;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return asc ? cmp : -cmp;
  });
}

/** Distinct non-empty values for a filter dropdown. */
export function distinct<T>(rows: T[], pick: (r: T) => string | null | undefined): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type FunnelRow = { agent: string; leads: number; showings: number; applications: number; leases: number };

export function computePipeline(data: SalesDataset, season: Season): { total: FunnelRow; byAgent: FunnelRow[] } {
  const inSeason = (v: string | null) => inRange(v, season.start, season.end);
  const rows = new Map<string, FunnelRow>();
  const bump = (agent: string | null, field: keyof Omit<FunnelRow, "agent">) => {
    const name = agent?.trim() || "Unassigned";
    const r = rows.get(name) ?? { agent: name, leads: 0, showings: 0, applications: 0, leases: 0 };
    r[field] += 1;
    rows.set(name, r);
  };

  for (const g of data.leads) if (inSeason(g.received)) bump(g.assigned_user, "leads");
  for (const s of data.showings) if (inSeason(s.showing_time) && !isCancelledShowing(s)) bump(s.assigned_user, "showings");
  for (const a of data.applications) {
    if (inSeason(a.received)) bump(a.assigned_user, "applications");
    if (isLeaseSigned(a) && inSeason(leaseSignedAt(a))) bump(a.assigned_user, "leases");
  }

  const byAgent = [...rows.values()].sort((a, b) => b.leads - a.leads || a.agent.localeCompare(b.agent));
  const total = byAgent.reduce<FunnelRow>(
    (t, r) => ({ agent: "All", leads: t.leads + r.leads, showings: t.showings + r.showings, applications: t.applications + r.applications, leases: t.leases + r.leases }),
    { agent: "All", leads: 0, showings: 0, applications: 0, leases: 0 },
  );
  return { total, byAgent };
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}
