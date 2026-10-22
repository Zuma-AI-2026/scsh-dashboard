/**
 * Lead identity, rotation and stage rules. Pure functions, no imports, so
 * `node --test` can load this file directly (see tests/leads.test.mts).
 *
 * The database is authoritative for assignment: `assign_lead_by_rotation`
 * in supabase/migrations/0008 runs the same pick under an advisory lock.
 * `pickRotationAgent` below is the readable spec of that SQL and is what the
 * unit tests pin down; keep the two in step.
 */

export type Rotation = "A" | "B";

export const LEAD_STATUSES = ["active", "test", "duplicate_of", "not_interested", "leased"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Forward order for B leads; not_interested / expired are terminal side exits. */
export const LEAD_STAGES = ["new", "contacted", "form_filled", "tour", "application", "leased", "not_interested", "expired"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const ROTATION_WINDOW_DAYS = 14;
export const EXPIRY_DAYS = 7;
const DAY_MS = 86_400_000;

/** Statuses that leave every count and give the consumed turn back. */
export const UNCOUNTED_STATUSES: readonly LeadStatus[] = ["test", "duplicate_of"];

export function isCounted(status: LeadStatus): boolean {
  return !UNCOUNTED_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Digits only. A leading US country code is dropped from 11-digit numbers so
 * "+1 (310) 625-2945" and "(310) 625-2945" are the same person. Anything
 * shorter than 7 or longer than 15 digits is not a usable phone.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export type IdentityKey = { guest_card_id: number | null; email_norm: string | null; phone_norm: string | null };

export type IdentityResult = { ok: true; key: IdentityKey } | { ok: false; reason: "no_email_or_phone" };

export function identityOf(input: { guest_card_id?: number | null; email?: string | null; phone?: string | null }): IdentityResult {
  const email_norm = normalizeEmail(input.email);
  const phone_norm = normalizePhone(input.phone);
  if (!email_norm && !phone_norm) return { ok: false, reason: "no_email_or_phone" };
  return { ok: true, key: { guest_card_id: input.guest_card_id ?? null, email_norm, phone_norm } };
}

export type LeadIdentity = {
  id: number;
  guest_card_id: number | null;
  email_norm: string | null;
  phone_norm: string | null;
  status: LeadStatus;
  duplicate_of_lead_id: number | null;
  first_seen_at: string;
};

/** Follow duplicate_of pointers to the surviving lead (cycle-safe). */
export function resolveDuplicate(lead: LeadIdentity, byId: Map<number, LeadIdentity>): LeadIdentity {
  let current = lead;
  const seen = new Set<number>();
  while (current.status === "duplicate_of" && current.duplicate_of_lead_id !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const next = byId.get(current.duplicate_of_lead_id);
    if (!next) break;
    current = next;
  }
  return current;
}

function oldestFirst(a: LeadIdentity, b: LeadIdentity): number {
  return a.first_seen_at.localeCompare(b.first_seen_at) || a.id - b.id;
}

/**
 * Identity match: guest_card_id first, else email_norm, else phone_norm.
 * Within a tier the oldest lead wins; a duplicate resolves to its target.
 */
export function matchLead(leads: LeadIdentity[], key: IdentityKey): LeadIdentity | null {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const tiers: ((l: LeadIdentity) => boolean)[] = [
    (l) => key.guest_card_id !== null && l.guest_card_id === key.guest_card_id,
    (l) => key.email_norm !== null && l.email_norm === key.email_norm,
    (l) => key.phone_norm !== null && l.phone_norm === key.phone_norm,
  ];
  for (const test of tiers) {
    const hits = leads.filter(test).map((l) => resolveDuplicate(l, byId));
    if (hits.length === 0) continue;
    const live = hits.filter((l) => l.status !== "duplicate_of");
    return [...(live.length ? live : hits)].sort(oldestFirst)[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** A = arrived with a form or an application; B = everything else. */
export function rotationFor(lead: { has_form: boolean; has_application: boolean }): Rotation {
  return lead.has_form || lead.has_application ? "A" : "B";
}

export type RotationAgent = { id: number; active: boolean; last_assigned_at: string | null };

/** A consumed turn, as recorded on the lead (turn_agent_id / turn_rotation / turn_at + lead status). */
export type Turn = { agent_id: number; rotation: Rotation; at: string; status: LeadStatus };

export function turnsInWindow(turns: Turn[], agentId: number, rotation: Rotation, now: Date): number {
  const end = now.getTime();
  const start = end - ROTATION_WINDOW_DAYS * DAY_MS;
  return turns.filter((t) => {
    if (t.agent_id !== agentId || t.rotation !== rotation || !isCounted(t.status)) return false;
    const at = Date.parse(t.at);
    return at > start && at <= end;
  }).length;
}

/**
 * Active agent with the fewest counted turns of `rotation` in the last 14
 * days; tie → older last_assigned_at (never assigned counts as oldest);
 * then lowest id. Null when nobody is active.
 */
export function pickRotationAgent(agents: RotationAgent[], turns: Turn[], rotation: Rotation, now: Date): number | null {
  const ranked = agents
    .filter((a) => a.active)
    .map((a) => ({ a, n: turnsInWindow(turns, a.id, rotation, now), last: a.last_assigned_at === null ? -Infinity : Date.parse(a.last_assigned_at) }))
    .sort((x, y) => x.n - y.n || x.last - y.last || x.a.id - y.a.id);
  return ranked[0]?.a.id ?? null;
}

export type NamedAgent = { id: number; name: string; appfolio_name: string | null; active: boolean };

const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The active agent AppFolio's assigned_user refers to, if any. */
export function agentForAppfolioUser(agents: NamedAgent[], assignedUser: string | null | undefined): NamedAgent | null {
  if (!assignedUser) return null;
  return agents.find((a) => a.active && (sameName(a.appfolio_name, assignedUser) || sameName(a.name, assignedUser))) ?? null;
}

export type InitialOwner = { via: "appfolio"; agent_id: number } | { via: "unassigned" } | { via: "rotation" };

/**
 * Owner of a brand-new lead (mirrors SQL `assign_new_lead`):
 *  - first seen after go-live → rotation, whatever AppFolio says;
 *  - before go-live, AppFolio's assigned user is an active agent → they own it, no turn;
 *  - otherwise nobody owns it, no turn (admin bulk-assigns).
 */
export function initialOwner(agents: NamedAgent[], assignedUser: string | null | undefined, firstSeenAt: string, goLiveAt: string): InitialOwner {
  if (Date.parse(firstSeenAt) >= Date.parse(goLiveAt)) return { via: "rotation" };
  const hit = agentForAppfolioUser(agents, assignedUser);
  return hit ? { via: "appfolio", agent_id: hit.id } : { via: "unassigned" };
}

/** Mirrors the leads_set_owner_mismatch trigger. Inactive agents still count as a name match. */
export function ownerMismatch(owner: Omit<NamedAgent, "active"> | null, appfolioAssignedUser: string | null | undefined): boolean {
  if (!owner || !appfolioAssignedUser) return false;
  return !(sameName(owner.appfolio_name, appfolioAssignedUser) || sameName(owner.name, appfolioAssignedUser));
}

export type EngagementLead = { rotation: Rotation; converted_from_b: boolean; has_form: boolean; has_application: boolean };

/**
 * Applying a form or application to an EXISTING lead. Owner never changes.
 * A B lead moves to the A list with converted_from_b and consumes no A turn.
 */
export function applyEngagement(lead: EngagementLead, kind: "form" | "application"): EngagementLead & { converted_now: boolean } {
  const converted_now = lead.rotation === "B";
  return {
    rotation: "A",
    converted_from_b: lead.converted_from_b || converted_now,
    has_form: lead.has_form || kind === "form",
    has_application: lead.has_application || kind === "application",
    converted_now,
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

const FORWARD: LeadStage[] = ["new", "contacted", "form_filled", "tour", "application", "leased"];
const TERMINAL: LeadStage[] = ["leased", "not_interested", "expired"];

/** Move forward only; terminal stages stay put. */
export function advanceStage(current: LeadStage, to: LeadStage): LeadStage {
  if (TERMINAL.includes(current)) return current;
  if (!FORWARD.includes(to)) return to;
  return FORWARD.indexOf(to) > FORWARD.indexOf(current) ? to : current;
}

/** AppFolio application status Converted means a signed lease. */
export function stageForApplication(current: LeadStage, applicationStatus: string | null | undefined): LeadStage {
  const converted = (applicationStatus ?? "").trim().toLowerCase() === "converted";
  return converted ? (current === "leased" ? current : "leased") : advanceStage(current, "application");
}

/** B leads with no event for 7 days read as expired (non-terminal stages only). */
export function effectiveStage(lead: { rotation: Rotation; stage: LeadStage; last_event_at: string | null; first_seen_at: string }, now: Date): LeadStage {
  if (lead.rotation !== "B" || TERMINAL.includes(lead.stage)) return lead.stage;
  const last = Date.parse(lead.last_event_at ?? lead.first_seen_at);
  return now.getTime() - last > EXPIRY_DAYS * DAY_MS ? "expired" : lead.stage;
}
