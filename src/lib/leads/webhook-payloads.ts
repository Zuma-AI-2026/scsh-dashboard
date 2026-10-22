/**
 * Body validation for the n8n webhooks (/api/pq-submit, /api/leads/assign, /api/leads/notified).
 * Pure, no imports (tested by tests/webhook-payloads.test.mts). Unknown keys
 * are dropped; empty strings become null.
 */

export type PqSubmission = {
  submission_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  property: string | null;
  move_in: string | null;
  budget: string | null;
  room_type: string | null;
  group_size: number | null;
  length_of_stay: string | null;
  qualify_method: string | null;
  submitted_at: string | null;
  score: number | null;
  tier: string | null;
  /** Free text from the form (e.g. "anything else?"), up to 2,000 characters. */
  notes: string | null;
};

export type PqParseResult = { ok: true; value: PqSubmission } | { ok: false; error: string };

const TEXT_FIELDS = ["name", "email", "phone", "property", "move_in", "budget", "room_type", "length_of_stay", "qualify_method", "tier"] as const;
const MAX_TEXT = 500;
const MAX_LONG_TEXT = 2000;

class Invalid extends Error {}

function text(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") throw new Invalid(`${key} must be a string`);
  const t = v.trim();
  if (t.length > max) throw new Invalid(`${key} is longer than ${max} characters`);
  return t === "" ? null : t;
}

function number(body: Record<string, unknown>, key: string): number | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) throw new Invalid(`${key} must be a number`);
  return n;
}

function timestamp(body: Record<string, unknown>, key: string): string | null {
  const t = text(body, key);
  if (t === null) return null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Invalid(`${key} must be an ISO 8601 date-time, e.g. 2026-10-22T17:45:00Z`);
  return new Date(ms).toISOString();
}

export function parsePqSubmission(body: unknown): PqParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  try {
    const submission_id = text(b, "submission_id");
    if (submission_id === null) return { ok: false, error: "submission_id is required" };
    if (submission_id.length > 200) return { ok: false, error: "submission_id is longer than 200 characters" };

    const texts = Object.fromEntries(TEXT_FIELDS.map((k) => [k, text(b, k)])) as Record<(typeof TEXT_FIELDS)[number], string | null>;
    const group_size = number(b, "group_size");
    if (group_size !== null && (!Number.isInteger(group_size) || group_size < 1)) return { ok: false, error: "group_size must be a whole number ≥ 1" };

    return {
      ok: true,
      value: {
        submission_id,
        ...texts,
        group_size,
        submitted_at: timestamp(b, "submitted_at"),
        score: number(b, "score"),
        notes: text(b, "notes", MAX_LONG_TEXT),
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

export type LeadInquiry = { email: string | null; phone: string | null; name: string | null; source: string | null; summary: string | null };

export type LeadInquiryParseResult = { ok: true; value: LeadInquiry } | { ok: false; error: string };

/** /api/leads/assign. Email or phone is checked by the database (it logs the rejection). */
export function parseLeadInquiry(body: unknown): LeadInquiryParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  try {
    return {
      ok: true,
      value: { email: text(b, "email"), phone: text(b, "phone"), name: text(b, "name"), source: text(b, "source"), summary: text(b, "summary", MAX_LONG_TEXT) },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

export type LeadNotified = { lead_id: number; channel: string; recipient: string; test_redirect: boolean; sent_at: string | null };

export type LeadNotifiedParseResult = { ok: true; value: LeadNotified } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** /api/leads/notified — one notice n8n sent about a lead. */
export function parseLeadNotified(body: unknown): LeadNotifiedParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  try {
    const lead_id = number(b, "lead_id");
    if (lead_id === null || !Number.isInteger(lead_id) || lead_id < 1) return { ok: false, error: "lead_id must be a positive whole number" };
    const channel = (text(b, "channel") ?? "email").toLowerCase();
    if (!/^[a-z_]{1,20}$/.test(channel)) return { ok: false, error: "channel must be a word such as \"email\"" };
    const recipient = text(b, "recipient");
    if (recipient === null || !EMAIL.test(recipient)) return { ok: false, error: "recipient must be an email address" };
    const t = b.test_redirect;
    if (t !== undefined && t !== null && typeof t !== "boolean") return { ok: false, error: "test_redirect must be true or false" };
    return { ok: true, value: { lead_id, channel, recipient: recipient.toLowerCase(), test_redirect: t === true, sent_at: timestamp(b, "sent_at") } };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}
