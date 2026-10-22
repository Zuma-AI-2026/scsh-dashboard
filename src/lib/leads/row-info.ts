/**
 * Per-row details for the lead tables: Notified label, inquiry summary and
 * "needs attention" (business hours since assignment without a touch).
 * Pure; only relative .ts imports so `node --test` can load it (tests/row-info.test.mts).
 */
import { dayLabel, laDay } from "./activity.ts";
import { isListed } from "./analytics.ts";
import type { Agent, LeadEvent, LeadView, Notice } from "./types.ts";

const TZ = "America/Los_Angeles";
const wall = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// ---------------------------------------------------------------------------
// Notified
// ---------------------------------------------------------------------------
/** "Jennifer · 3:12 PM", "Jennifer · Oct 21, 3:12 PM", "→ savas@ (test)", or "not sent". */
export function notifiedLabel(n: Notice | null, agents: Pick<Agent, "name" | "email">[], now: Date): string {
  if (!n) return "not sent";
  const local = n.recipient.split("@")[0];
  if (n.test) return `→ ${local}@ (test)`;
  const agent = agents.find((a) => a.email.toLowerCase() === n.recipient.toLowerCase());
  const who = agent ? agent.name.split(" ")[0] : `${local}@`;
  const at = new Date(n.at);
  const day = laDay(n.at);
  const time = wall.format(at);
  return `${who} · ${day === laDay(now.toISOString()) ? time : `${dayLabel(day)}, ${time}`}`;
}

// ---------------------------------------------------------------------------
// Inquiry summary
// ---------------------------------------------------------------------------
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function formLine(p: Record<string, unknown>): string {
  const parts = [
    str(p.notes) && `“${str(p.notes)}”`,
    str(p.move_in) && `move-in ${str(p.move_in)}`,
    str(p.budget) && `budget ${str(p.budget)}`,
    str(p.group_size) && `${str(p.group_size)} people`,
    str(p.room_type),
    str(p.length_of_stay),
    str(p.property),
    (str(p.score) || str(p.tier)) && `score ${str(p.score) ?? "—"}${str(p.tier) ? ` (${str(p.tier)})` : ""}`,
  ].filter(Boolean);
  return `PQ form: ${parts.join(" · ") || "submitted"}`;
}

/**
 * Lines describing what the person asked, newest first: n8n's inquiry summary,
 * the PQ form answers, then AppFolio / n8n inquiries (source, property, day).
 */
export function inquirySummary(events: LeadEvent[]): string[] {
  const lines: string[] = [];
  for (const e of events) {
    const p = e.payload ?? {};
    if (e.type === "form") lines.push(formLine(p));
    else if (e.type === "inquiry") {
      if (str(p.summary)) lines.push(str(p.summary)!);
      else lines.push(`Inquiry via ${str(p.source) ?? "unknown source"}${str(p.property_name) ? ` for ${str(p.property_name)}` : ""} · ${dayLabel(laDay(e.at), true)}`);
    }
  }
  return [...new Set(lines)];
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------
export const ATTENTION_BUSINESS_HOURS = 24;
const OPEN = { hour: 9, minute: 0 };
const CLOSE = { hour: 17, minute: 30 };

/** The instant of an LA wall-clock time (handles PDT/PST). */
function laWall(day: string, hour: number, minute: number): number {
  const [y, m, d] = day.split("-").map(Number);
  const want = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  for (const offset of [7, 8]) {
    const t = Date.UTC(y, m - 1, d, hour + offset, minute);
    if (hourOf.format(new Date(t)) === want) return t;
  }
  return Date.UTC(y, m - 1, d, hour + 8, minute);
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Business hours (Mon–Fri 9:00–17:30 Los Angeles, no holidays) between two instants. */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let ms = 0;
  const last = laDay(end.toISOString());
  for (let day = laDay(start.toISOString()); day <= last; day = nextDay(day)) {
    const [y, m, d] = day.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const from = Math.max(start.getTime(), laWall(day, OPEN.hour, OPEN.minute));
    const to = Math.min(end.getTime(), laWall(day, CLOSE.hour, CLOSE.minute));
    if (to > from) ms += to - from;
  }
  return ms / 3_600_000;
}

/** AppFolio "last activity" types that are not someone working the lead. */
const SYSTEM_ACTIVITY = new Set([
  "guest card created",
  "interest created",
  "auto-response email sent",
  "showing auto followup email sent",
  "assigned user set",
  "assigned user changed",
  "assigned user removed",
  "guest card information updated",
  "refunded",
]);

/** Something happened on the lead after it was assigned to its current owner. */
export function touchedSinceAssignment(l: LeadView): boolean {
  if (!l.assigned_at) return true;
  const assigned = Date.parse(l.assigned_at);
  if (l.last_event_at && Date.parse(l.last_event_at) > assigned) return true;
  if (l.replied_at && Date.parse(l.replied_at) > assigned) return true;
  const type = (l.appfolio_last_activity_type ?? "").toLowerCase();
  if (l.appfolio_last_activity && type && !SYSTEM_ACTIVITY.has(type) && l.appfolio_last_activity.slice(0, 10) >= laDay(l.assigned_at)) return true;
  return false;
}

export type AttentionRow = LeadView & { business_hours: number; hours_overdue: number };

/**
 * Owned, open leads assigned under the rotation era (assigned at/after go-live,
 * or by rotation) with nothing since assignment for more than 24 business hours.
 * Most overdue first.
 */
export function needsAttention(leads: LeadView[], now: Date, goLiveAt: string | null): AttentionRow[] {
  const goLive = goLiveAt ? Date.parse(goLiveAt) : Infinity;
  const out: AttentionRow[] = [];
  for (const l of leads) {
    if (!isListed(l) || l.status !== "active" || l.owner_agent_id === null || !l.assigned_at) continue;
    if (l.stage === "leased" || l.stage === "not_interested") continue;
    if (!(l.assigned_via === "rotation" || Date.parse(l.assigned_at) >= goLive)) continue;
    if (touchedSinceAssignment(l)) continue;
    const business_hours = businessHoursBetween(new Date(l.assigned_at), now);
    if (business_hours <= ATTENTION_BUSINESS_HOURS) continue;
    out.push({ ...l, business_hours, hours_overdue: business_hours - ATTENTION_BUSINESS_HOURS });
  }
  return out.sort((a, b) => b.hours_overdue - a.hours_overdue || a.id - b.id);
}
