/**
 * Validates what the browser sends and builds the exact reminder on the
 * server. The browser chooses ids and text only; charges and totals are
 * reloaded here. Pure (no I/O) so it is unit-tested.
 */
import { defaultSubject, selectCharges, totalCents, type OpenCharge, type SelectedCharge } from "./charges.ts";
import { renderReminderEmail } from "./email.ts";
import { unexpectedFigures } from "./figures.ts";
import { CUSTOM_TONE_MAX } from "./tones.ts";

export type ReminderAccess = "send" | "read" | "none";

/** admin + accounting send; partner sees Last contacted and history; everyone else nothing. */
export function reminderAccess(role: string): ReminderAccess {
  if (role === "admin" || role === "accounting") return "send";
  if (role === "partner") return "read";
  return "none";
}

export const MAX_MESSAGE = 5000;
export const MAX_SUBJECT = 200;
export const MAX_RECIPIENTS = 10;
export const MAX_SMS = 1000;

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export type Fail = { ok: false; status: 400 | 404 | 422; error: string };
type Ok<T> = { ok: true; value: T };

function fail(error: string, status: Fail["status"] = 400): Fail {
  return { ok: false, status, error };
}

function posInt(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Array or comma/semicolon list → lower-case addresses; null when any entry is invalid. */
export function parseEmailList(v: unknown): string[] | null {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : v == null ? [] : null;
  if (!parts) return null;
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== "string") return null;
    const e = p.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL.test(e)) return null;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

function text(v: unknown, max: number): string | null {
  if (v == null) return "";
  if (typeof v !== "string") return null;
  return v.length > max ? null : v.replace(/\r\n/g, "\n");
}

export type ReminderRequest = {
  occupancyId: number;
  chargeIds: number[];
  senderId: number;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  message: string;
  tone: string;
  confirmFigures: boolean;
  remember: boolean;
};

/**
 * Body for preview / send. Unknown keys (amounts, totals…) are ignored.
 * `needRecipients` = send (To required); preview works without.
 */
export function parseReminderRequest(body: unknown, needRecipients: boolean): Ok<ReminderRequest> | Fail {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Send a JSON object.");
  const b = body as Record<string, unknown>;
  const occupancyId = posInt(b.occupancyId);
  if (!occupancyId) return fail("occupancyId is required.");
  if (!Array.isArray(b.chargeIds)) return fail("chargeIds must be a list.");
  const chargeIds = b.chargeIds.map(posInt);
  if (chargeIds.some((n) => n === null)) return fail("chargeIds must be charge numbers.");
  if (chargeIds.length === 0) return fail("Select at least one charge.");
  const senderId = posInt(b.senderId);
  if (!senderId) return fail("Pick a sender.");
  const to = parseEmailList(b.to);
  const cc = parseEmailList(b.cc);
  if (!to) return fail("To has an invalid email address.");
  if (!cc) return fail("CC has an invalid email address.");
  if (needRecipients && to.length === 0) return fail("Add at least one recipient.");
  if (to.length + cc.length > MAX_RECIPIENTS) return fail(`At most ${MAX_RECIPIENTS} recipients.`);
  const replyToList = parseEmailList(b.replyTo);
  if (!replyToList || replyToList.length > 1) return fail("Reply-To must be one email address.");
  const subject = text(b.subject, MAX_SUBJECT);
  if (subject === null) return fail(`Subject: up to ${MAX_SUBJECT} characters.`);
  const message = text(b.message, MAX_MESSAGE);
  if (message === null) return fail(`Message: up to ${MAX_MESSAGE} characters.`);
  if (needRecipients && !message.trim()) return fail("Write a message first.");
  const tone = text(b.tone, CUSTOM_TONE_MAX + 20);
  if (tone === null) return fail("Tone is too long.");
  return {
    ok: true,
    value: {
      occupancyId,
      chargeIds: chargeIds as number[],
      senderId,
      to,
      cc,
      replyTo: replyToList[0] ?? null,
      subject: subject.trim(),
      message,
      tone: tone.trim(),
      confirmFigures: b.confirmFigures === true,
      remember: b.remember === true,
    },
  };
}

export type Sender = { id: number; email: string; display_name: string; reply_to: string | null; signature: string; active: boolean };

export type ReminderContext = {
  occupancyId: number;
  tenant: string | null;
  property: string | null;
  unit: string | null;
  openCharges: OpenCharge[];
  senders: Sender[];
  paymentNote: string;
  now: Date;
};

export type BuiltReminder = {
  sender: Sender;
  charges: SelectedCharge[];
  totalCents: number;
  subject: string;
  html: string;
  text: string;
  figures: string[];
};

/** Everything the server will put in the email. Fails on an unlisted sender, no valid charges, or unconfirmed figures. */
export function buildReminder(req: ReminderRequest, ctx: ReminderContext, opts: { enforceFigures: boolean }): Ok<BuiltReminder> | Fail {
  const sender = ctx.senders.find((s) => s.id === req.senderId && s.active);
  if (!sender) return fail("That sender mailbox is not on the admin list.", 422);
  const charges = selectCharges(ctx.openCharges, ctx.occupancyId, req.chargeIds, ctx.now);
  if (charges.length === 0) return fail("None of the selected charges are open for this tenant any more. Reopen the reminder.", 422);
  const total = totalCents(charges);
  const subject = req.subject || defaultSubject(ctx.property, ctx.unit, total);
  const figures = unexpectedFigures(`${subject}\n${req.message}`, { totalCents: total, charges });
  if (opts.enforceFigures && figures.length > 0 && !req.confirmFigures) {
    return fail(`The message mentions figures that aren't the total or a selected charge (${figures.join(", ")}). Tick "Send anyway — I checked the figures" to continue.`);
  }
  const { html, text } = renderReminderEmail({
    message: req.message,
    tenant: ctx.tenant,
    property: ctx.property,
    unit: ctx.unit,
    charges,
    paymentNote: ctx.paymentNote,
    signature: sender.signature,
  });
  return { ok: true, value: { sender, charges, totalCents: total, subject, html, text, figures } };
}

export type PolishRequest = {
  occupancyId: number;
  chargeIds: number[];
  senderId: number | null;
  draft: string;
  toneKey: string;
  customTone: string;
  mode: "email" | "sms";
};

export function parsePolishRequest(body: unknown): Ok<PolishRequest> | Fail {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Send a JSON object.");
  const b = body as Record<string, unknown>;
  const occupancyId = posInt(b.occupancyId);
  if (!occupancyId) return fail("occupancyId is required.");
  if (!Array.isArray(b.chargeIds) || b.chargeIds.length === 0) return fail("Select at least one charge.");
  const chargeIds = b.chargeIds.map(posInt);
  if (chargeIds.some((n) => n === null)) return fail("chargeIds must be charge numbers.");
  const draft = text(b.draft, MAX_MESSAGE);
  if (draft === null) return fail(`Message: up to ${MAX_MESSAGE} characters.`);
  const customTone = text(b.customTone, CUSTOM_TONE_MAX);
  if (customTone === null) return fail(`Custom tone: up to ${CUSTOM_TONE_MAX} characters.`);
  return {
    ok: true,
    value: {
      occupancyId,
      chargeIds: chargeIds as number[],
      senderId: posInt(b.senderId),
      draft,
      toneKey: typeof b.toneKey === "string" ? b.toneKey : "professional",
      customTone,
      mode: b.mode === "sms" ? "sms" : "email",
    },
  };
}

export type TextRequest = { occupancyId: number; chargeIds: number[]; phone: string; body: string; tone: string; confirmFigures: boolean };

export function parseTextRequest(body: unknown): Ok<TextRequest> | Fail {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Send a JSON object.");
  const b = body as Record<string, unknown>;
  const occupancyId = posInt(b.occupancyId);
  if (!occupancyId) return fail("occupancyId is required.");
  if (!Array.isArray(b.chargeIds) || b.chargeIds.length === 0) return fail("Select at least one charge.");
  const chargeIds = b.chargeIds.map(posInt);
  if (chargeIds.some((n) => n === null)) return fail("chargeIds must be charge numbers.");
  const phone = typeof b.phone === "string" ? b.phone.replace(/[^\d+]/g, "") : "";
  if (phone.replace(/\D/g, "").length < 10) return fail("Pick a phone number.");
  const sms = text(b.body, MAX_SMS);
  if (sms === null || !sms.trim()) return fail("Write the text first.");
  const tone = text(b.tone, CUSTOM_TONE_MAX + 20);
  return {
    ok: true,
    value: { occupancyId, chargeIds: chargeIds as number[], phone, body: sms.trim(), tone: (tone ?? "").trim(), confirmFigures: b.confirmFigures === true },
  };
}
