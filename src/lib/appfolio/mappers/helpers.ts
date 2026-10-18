import type { ReportRow } from "../client";

/**
 * Tiny coercion helpers used by every mapper. AppFolio returns most values
 * as strings ("1,250.00", "08/15/2026", "Yes"), so each clean column goes
 * through one of these.
 */

/** First non-empty value among several candidate column names. */
export function pick(row: ReportRow, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

export function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}

/** Parses "MM/DD/YYYY", "YYYY-MM-DD", or ISO strings into YYYY-MM-DD (date only). */
export function dateOnly(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Parses a date or date-time into an ISO timestamp (assumes LA time when no zone). */
export function timestamp(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // "MM/DD/YYYY hh:mm AM" or "MM/DD/YYYY"
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (us) {
    let hour = us[4] ? Number(us[4]) : 0;
    const minute = us[5] ? Number(us[5]) : 0;
    const second = us[6] ? Number(us[6]) : 0;
    const ampm = us[7]?.toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return laLocalToIso(Number(us[3]), Number(us[1]), Number(us[2]), hour, minute, second);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Convert an America/Los_Angeles wall-clock time to a UTC ISO string. */
function laLocalToIso(y: number, m: number, d: number, hh: number, mm: number, ss: number): string {
  // Try PST (-8) then PDT (-7); pick the one that round-trips to the same wall clock.
  for (const offset of [8, 7]) {
    const guess = new Date(Date.UTC(y, m - 1, d, hh + offset, mm, ss));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    if (get("day") === d && get("hour") % 24 === hh) return guess.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, hh + 8, mm, ss)).toISOString();
}

/** Stable key for rows that lack an explicit ID (hash of selected fields). */
export function compositeKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (p === null || p === undefined ? "" : String(p).trim().toLowerCase()))
    .join("|")
    .replace(/\s+/g, " ");
}
