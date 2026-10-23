/** Charge selection and money math for reminders. Pure; safe on client and server. */

export type OpenCharge = {
  id: number;
  occupancy_id: number;
  description: string | null;
  occurred_on: string | null;
  amount_cents: number;
};

export type SelectedCharge = OpenCharge & { days_late: number | null };

export const toCents = (amount: number) => Math.round(amount * 100);

/** "$2,140.00" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Today's calendar date in Los Angeles as YYYY-MM-DD. */
export function laToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function ymdToUtc(ymd: string): number | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Whole LA calendar days from the charge date to today (0 = today, never negative). */
export function daysLate(occurredOn: string | null, now: Date): number | null {
  if (!occurredOn) return null;
  const from = ymdToUtc(occurredOn);
  const to = ymdToUtc(laToday(now));
  if (from === null || to === null) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * The charges a reminder may mention: only ids the browser selected that are
 * open charges of THIS occupancy. Amounts always come from `open`, never the browser.
 */
export function selectCharges(open: OpenCharge[], occupancyId: number, selectedIds: number[], now: Date): SelectedCharge[] {
  const wanted = new Set(selectedIds);
  return open
    .filter((c) => c.occupancy_id === occupancyId && wanted.has(c.id))
    .sort((a, b) => (a.occurred_on ?? "").localeCompare(b.occurred_on ?? "") || a.id - b.id)
    .map((c) => ({ ...c, days_late: daysLate(c.occurred_on, now) }));
}

export const totalCents = (charges: Pick<OpenCharge, "amount_cents">[]) => charges.reduce((n, c) => n + c.amount_cents, 0);

export function oldestDaysLate(charges: SelectedCharge[]): number | null {
  const days = charges.map((c) => c.days_late).filter((d): d is number => d !== null);
  return days.length ? Math.max(...days) : null;
}

/** "Balance due — 2642 Ellendale Place 101: $2,140.00" */
export function defaultSubject(property: string | null, unit: string | null, cents: number): string {
  const where = [property, unit].filter(Boolean).join(" ");
  return `Balance due${where ? ` — ${where}` : ""}: ${formatCents(cents)}`;
}
