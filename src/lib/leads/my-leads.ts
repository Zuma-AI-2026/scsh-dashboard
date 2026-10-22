/**
 * Sales → My leads. Pure; only relative .ts imports so `node --test` can load
 * it (tests/my-leads.test.mts).
 *
 * Open leads of one owner, each in exactly one group (first that applies):
 *   Application — has an application that isn't canceled / denied
 *   Tour booked — a non-cancelled showing
 *   Active      — rotation A, or the prospect replied (leads.replied_at)
 *   Nurturing   — B with no reply yet; stalest first
 * Not open: test / duplicate / not interested / leased, a Converted
 * application, and (unless asked) cards AppFolio has marked Inactive or Cold.
 */
import { laDay } from "./activity.ts";
import { isListed } from "./analytics.ts";
import type { LeadView } from "./types.ts";

export const MY_LEAD_GROUPS = [
  { key: "nurturing", label: "Nurturing", hint: "B, no reply yet — stalest first" },
  { key: "active", label: "Active", hint: "A, or the prospect replied" },
  { key: "tour", label: "Tour booked", hint: "" },
  { key: "application", label: "Application", hint: "" },
] as const;
export type MyLeadGroup = (typeof MY_LEAD_GROUPS)[number]["key"];

export type MyLead = LeadView & { group: MyLeadGroup; last_activity: string; days_idle: number };

const CLOSED_APPLICATION = new Set(["canceled", "cancelled", "denied"]);
const CLOSED_IN_APPFOLIO = new Set(["inactive", "cold"]);

export function isOpen(l: LeadView, includeInactive = false): boolean {
  if (!isListed(l) || l.status !== "active") return false;
  if (l.stage === "leased" || l.stage === "not_interested") return false;
  if ((l.application_status ?? "").toLowerCase() === "converted") return false;
  if (!includeInactive && CLOSED_IN_APPFOLIO.has((l.appfolio_status ?? "").toLowerCase())) return false;
  return true;
}

export function groupOf(l: LeadView): MyLeadGroup {
  if (l.has_application && !CLOSED_APPLICATION.has((l.application_status ?? "").toLowerCase())) return "application";
  if (l.tour_booked) return "tour";
  if (l.rotation === "A" || l.replied_at) return "active";
  return "nurturing";
}

/** Latest LA calendar day anything happened: prospect events, AppFolio activity (incl. our outreach), reply, first seen. */
export function lastActivityDay(l: LeadView): string {
  const days = [laDay(l.first_seen_at)];
  if (l.last_event_at) days.push(laDay(l.last_event_at));
  if (l.replied_at) days.push(laDay(l.replied_at));
  if (l.appfolio_last_activity) days.push(l.appfolio_last_activity.slice(0, 10));
  return days.sort().at(-1)!;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `owners` = whose leads (one agent, or every agent for the admin view). */
export function myLeads(leads: LeadView[], owners: Set<number>, now: Date, includeInactive = false): Record<MyLeadGroup, MyLead[]> {
  const today = laDay(now.toISOString());
  const out: Record<MyLeadGroup, MyLead[]> = { nurturing: [], active: [], tour: [], application: [] };
  for (const l of leads) {
    if (l.owner_agent_id === null || !owners.has(l.owner_agent_id) || !isOpen(l, includeInactive)) continue;
    const last_activity = lastActivityDay(l);
    const group = groupOf(l);
    out[group].push({ ...l, group, last_activity, days_idle: Math.max(0, daysBetween(last_activity, today)) });
  }
  out.nurturing.sort((a, b) => a.last_activity.localeCompare(b.last_activity) || a.id - b.id);
  for (const g of ["active", "tour", "application"] as const) {
    out[g].sort((a, b) => b.last_activity.localeCompare(a.last_activity) || b.id - a.id);
  }
  return out;
}
