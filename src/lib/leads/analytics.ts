/**
 * Sales → Rotation: filtering, header numbers and CSV. Pure; only relative
 * .ts imports so `node --test` can load it (tests/rotation.test.mts).
 */
import { laDate, laParts } from "../season.ts";
import { isCounted, type Rotation } from "./rules.ts";
import type { Agent, LeadView } from "./types.ts";

export const ROTATION_DEFAULT_DAYS = 30;

export type LeadRange = { from: string; to: string; start: Date; end: Date };

type Params = Record<string, string | undefined>;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar-day arithmetic on YYYY-MM-DD (no time zone involved). */
function addDays(day: string, n: number): string {
  const [, y, m, d] = day.match(YMD)!;
  const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function laMidnight(day: string): Date {
  const [, y, m, d] = day.match(YMD)!;
  return laDate(Number(y), Number(m), Number(d));
}

/** ?from / ?to as LA calendar days (inclusive); default = the last 30 days. */
export function leadRange(p: Params, now: Date): LeadRange {
  const today = laParts(now);
  const to = p.to && YMD.test(p.to) ? p.to : ymd(today.year, today.month, today.day);
  const from = p.from && YMD.test(p.from) ? p.from : addDays(to, -(ROTATION_DEFAULT_DAYS - 1));
  return { from, to, start: laMidnight(from), end: laMidnight(addDays(to, 1)) };
}

const within = (iso: string | null, r: LeadRange) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= r.start.getTime() && t < r.end.getTime();
};

/** test / duplicate leads leave every list and count. */
export const isListed = (l: LeadView) => isCounted(l.status);

/** A list: when the lead qualified (form/application); B list: first seen. */
export function rotationDate(l: LeadView, rotation: Rotation): string {
  return rotation === "A" ? (l.qualified_at ?? l.first_seen_at) : l.first_seen_at;
}

const CHANNEL_LABEL: Record<string, string> = {
  website_form: "Website form",
  inbox_zillow: "Inbox · Zillow",
  inbox_offcampus_universe: "Inbox · Offcampus-Universe",
  inbox_och101: "Inbox · OCH 101",
  inbox_apartments: "Inbox · Apartments.com",
  inbox_email: "Inbox · Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  social: "Social",
  referral: "Referral",
  other: "Other",
};

const FEED_LABEL: Record<string, string> = {
  appfolio_website: "AppFolio website",
  rent_com: "Rent.com",
  apartments_com: "Apartments.com",
  realtor_com: "Realtor.com",
  apartment_list: "Apartment List",
  apartment_advisor: "Apartment Advisor",
  everyapartment: "EveryApartment",
};

/** "feed_zillow" → "Feed · Zillow". */
export function channelLabel(channel: string): string {
  if (CHANNEL_LABEL[channel]) return CHANNEL_LABEL[channel];
  if (channel.startsWith("feed_")) {
    const site = channel.slice(5);
    return `Feed · ${FEED_LABEL[site] ?? site.charAt(0).toUpperCase() + site.slice(1).replace(/_/g, " ")}`;
  }
  return channel;
}

export type RotationRow = LeadView & { date: string };

export function filterRotation(leads: LeadView[], rotation: Rotation, p: Params, range: LeadRange): RotationRow[] {
  const q = (p.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return leads
    .filter((l) => isListed(l) && l.rotation === rotation)
    .map((l) => ({ ...l, date: rotationDate(l, rotation) }))
    .filter((l) => within(l.date, range))
    .filter((l) => {
      if (p.agent === "none" && l.owner_agent_id !== null) return false;
      if (p.agent && p.agent !== "none" && String(l.owner_agent_id) !== p.agent) return false;
      if (p.mismatch === "1" && !l.owner_mismatch) return false;
      if (p.channel && l.channel !== p.channel) return false;
      if (!q) return true;
      return (
        (l.name ?? "").toLowerCase().includes(q) ||
        (l.email_norm ?? "").includes(q) ||
        (qDigits.length >= 3 && (l.phone_norm ?? "").includes(qDigits))
      );
    });
}

export type AgentTurns = { agent_id: number; name: string; active: boolean; turns: number };

/** Turns of `rotation` consumed in range, per agent (active agents always listed). */
export function turnsInRange(leads: LeadView[], agents: Agent[], rotation: Rotation, range: LeadRange): AgentTurns[] {
  const counts = new Map<number, number>();
  for (const l of leads) {
    if (l.turn_agent_id === null || l.turn_rotation !== rotation || !isListed(l) || !within(l.turn_at, range)) continue;
    counts.set(l.turn_agent_id, (counts.get(l.turn_agent_id) ?? 0) + 1);
  }
  return agents
    .filter((a) => a.active || counts.has(a.id))
    .map((a) => ({ agent_id: a.id, name: a.name, active: a.active, turns: counts.get(a.id) ?? 0 }));
}

export type Conversion = { agent_id: number | null; name: string; b_leads: number; converted: number };

/**
 * B → A conversion among leads that started on the B list and were first seen
 * in range, by current owner. A B lead that converted is now on the A list
 * with converted_from_b, so both lists are counted.
 */
export function conversionByOwner(leads: LeadView[], agents: Agent[], range: LeadRange): { rows: Conversion[]; total: Conversion } {
  const rows = new Map<number | null, Conversion>();
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const total: Conversion = { agent_id: null, name: "All", b_leads: 0, converted: 0 };
  for (const l of leads) {
    const startedB = l.rotation === "B" || l.converted_from_b;
    if (!startedB || !isListed(l) || !within(l.first_seen_at, range)) continue;
    const key = l.owner_agent_id;
    const row = rows.get(key) ?? { agent_id: key, name: key === null ? "Unassigned" : (name.get(key) ?? `Agent ${key}`), b_leads: 0, converted: 0 };
    row.b_leads += 1;
    total.b_leads += 1;
    if (l.converted_from_b) {
      row.converted += 1;
      total.converted += 1;
    }
    rows.set(key, row);
  }
  return { rows: [...rows.values()].sort((a, b) => b.b_leads - a.b_leads || a.name.localeCompare(b.name)), total };
}

export function formatPhone(digits: string | null): string | null {
  if (!digits) return null;
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : `+${digits}`;
}

type Cell = string | number | boolean | null | undefined;

/** RFC 4180 CSV. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function rotationCsv(rows: RotationRow[], rotation: Rotation): string {
  const application = (r: RotationRow) => r.application_status ?? (r.has_application ? "yes" : "");
  if (rotation === "A") {
    return toCsv(
      ["date", "name", "phone", "email", "property", "score", "tier", "owner", "channel", "source", "stage", "converted_from_b", "tour_booked", "application", "owner_mismatch", "appfolio_user"],
      rows.map((r) => [r.date, r.name, formatPhone(r.phone_norm), r.email_norm, r.property_name, r.pq_score, r.pq_tier, r.owner_name ?? "Unassigned", r.channel, r.source_first, r.stage_now, r.converted_from_b, r.tour_booked, application(r), r.owner_mismatch, r.appfolio_assigned_user]),
    );
  }
  return toCsv(
    ["date", "name", "phone", "email", "owner", "channel", "source", "property", "stage", "last_activity", "tour_booked", "application", "owner_mismatch", "appfolio_user"],
    rows.map((r) => [r.date, r.name, formatPhone(r.phone_norm), r.email_norm, r.owner_name ?? "Unassigned", r.channel, r.source_first, r.property_name, r.stage_now, r.last_event_at, r.tour_booked, application(r), r.owner_mismatch, r.appfolio_assigned_user]),
  );
}
