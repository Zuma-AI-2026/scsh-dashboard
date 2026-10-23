/**
 * Figure check for reminder text: the only money allowed is the total or a
 * selected charge amount (whole-dollar rounding OK), and the only charge /
 * invoice numbers allowed are selected charge ids. Pure.
 */
import { formatCents } from "./charges.ts";

export type FigureFacts = { totalCents: number; charges: { id: number; amount_cents: number }[] };

const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|usd)\b/gi;
const REFERENCE = /\b(?:invoice|inv|charge|transaction|txn|ref|reference)\s*(?:#|no\.?|number)?\s*:?\s*(\d{3,})\b|#\s?(\d{3,})\b/gi;

function centsOf(snippet: string): { cents: number; hasCents: boolean } | null {
  const m = snippet.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const hasCents = m[0].includes(".");
  const cents = Math.round(Number(m[0]) * 100);
  return Number.isFinite(cents) ? { cents, hasCents } : null;
}

function allowedMoney(cents: number, hasCents: boolean, allowed: number[]): boolean {
  return allowed.some((a) => a === cents || (!hasCents && Math.round(a / 100) * 100 === cents));
}

/** Unexpected figures in `text`, each once: amounts first, then charge/invoice numbers. */
export function unexpectedFigures(text: string, facts: FigureFacts): string[] {
  const allowedCents = [facts.totalCents, ...facts.charges.map((c) => c.amount_cents)];
  const allowedIds = new Set(facts.charges.map((c) => String(c.id)));
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (!out.includes(t)) out.push(t);
  };

  for (const m of text.matchAll(MONEY)) {
    const v = centsOf(m[0]);
    if (!v || !allowedMoney(v.cents, v.hasCents, allowedCents)) add(m[0]);
  }
  for (const m of text.matchAll(REFERENCE)) {
    const id = m[1] ?? m[2];
    if (id && !allowedIds.has(id)) add(m[0]);
  }
  return out;
}

export function figuresWarning(found: string[], totalCents: number): string | null {
  if (found.length === 0) return null;
  return `Check these figures: ${found.join(", ")}. The only amount the reminder should state is the total ${formatCents(totalCents)} (or a selected charge).`;
}
