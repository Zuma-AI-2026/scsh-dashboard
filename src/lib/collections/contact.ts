/** "Last contacted", the 24-hour repeat warning and texting quiet hours. Pure. */

export type ReminderMessage = {
  id: number;
  created_at: string;
  sent_by: string;
  channel: "email" | "text";
  occupancy_id: number;
  sender: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  total_cents: number;
  status: "drafted" | "sent" | "failed" | "text_opened";
};

export type LoggedAction = {
  occupancy_id: number;
  action: string;
  acted_by: string;
  acted_at: string;
  collection_message_id?: number | null;
};

export type LastContact = { at: string; by: string; to: string; channel: string };

/** Follow-up log entries that mean someone reached out to the tenant. */
export const CONTACT_ACTIONS = new Set(["Called", "Texted", "Emailed", "Payment plan", "Notice served"]);

/** Drafts (not yet sent) and failures are history only; they never count as contacting the tenant. */
export function countsAsContact(status: ReminderMessage["status"]): boolean {
  return status === "sent" || status === "text_opened";
}

export const REPEAT_WARNING_HOURS = 24;
export const STALE_CONTACT_DAYS = 7;

const STATUS_NOTE: Record<ReminderMessage["status"], string> = { drafted: "Outlook draft", sent: "sent", failed: "failed", text_opened: "text opened" };

function recipients(m: ReminderMessage): string {
  const all = [...m.to, ...m.cc];
  return all.length ? all.join(", ") : "—";
}

/** Latest contact per occupancy from sent emails / opened texts and contact-type follow-up entries. */
export function lastContactByOccupancy(messages: ReminderMessage[], actions: LoggedAction[]): Map<number, LastContact> {
  const out = new Map<number, LastContact>();
  const offer = (occ: number, c: LastContact) => {
    const prev = out.get(occ);
    if (!prev || c.at > prev.at) out.set(occ, c);
  };
  for (const m of messages) {
    if (!countsAsContact(m.status)) continue;
    offer(m.occupancy_id, {
      at: m.created_at,
      by: m.sent_by,
      to: recipients(m),
      channel: `${m.channel === "email" ? "Email" : "Text"} (${STATUS_NOTE[m.status]}${m.sender && m.channel === "email" ? ` from ${m.sender}` : ""})`,
    });
  }
  for (const a of actions) {
    if (a.collection_message_id != null || !CONTACT_ACTIONS.has(a.action)) continue;
    offer(a.occupancy_id, { at: a.acted_at, by: a.acted_by, to: "tenant", channel: `${a.action} (logged)` });
  }
  return out;
}

export function contactTooltip(c: LastContact): string {
  return `${c.channel} · by ${c.by} · to ${c.to}`;
}

/** True when the occupancy was contacted less than 24 hours before `now`. */
export function contactedRecently(lastAt: string | null | undefined, now: Date, hours = REPEAT_WARNING_HOURS): boolean {
  if (!lastAt) return false;
  const t = new Date(lastAt).getTime();
  return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t < hours * 3_600_000;
}

/** Not contacted at all, or the last contact is at least `days` old. */
export function notContactedFor(lastAt: string | null | undefined, now: Date, days = STALE_CONTACT_DAYS): boolean {
  if (!lastAt) return true;
  return now.getTime() - new Date(lastAt).getTime() >= days * 86_400_000;
}

/** 9:00 PM – 8:00 AM in Los Angeles: don't text tenants now. */
export function isTextingQuietHours(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 21 || hour < 8;
}
