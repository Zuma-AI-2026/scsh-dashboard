/**
 * Leasing season math.
 *
 * A season runs Nov 1 – Jul 31 and leases for the following August move-in.
 * "Current season" = the season we are in, or (Aug–Oct) the next one starting.
 * All calendar math is in America/Los_Angeles.
 */

export type Season = {
  /** Calendar year of the August move-in this season leases for. */
  moveInYear: number;
  /** Nov 1 00:00 LA. */
  start: Date;
  /** Aug 1 00:00 LA — exclusive upper bound (i.e. through Jul 31). */
  end: Date;
  /** "upcoming" during Aug–Oct, otherwise "active". */
  phase: "upcoming" | "active";
  /** e.g. "2026–27" */
  label: string;
};

const TZ = "America/Los_Angeles";

export function laParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Midnight (LA) on a calendar date, as an absolute instant. */
export function laDate(year: number, month: number, day: number): Date {
  // 07:00Z is 00:00 PDT (same day) or 23:00 PST (previous day), so it decides the offset;
  // 08:00Z would be 01:00 PDT — still the same day — and can't tell them apart.
  const pdt = new Date(Date.UTC(year, month - 1, day, 7, 0, 0));
  return laParts(pdt).day === day ? pdt : new Date(Date.UTC(year, month - 1, day, 8, 0, 0)); // PST
}

export function currentSeason(now: Date = new Date()): Season {
  const { year, month } = laParts(now);
  // Nov–Dec: season started this year → move-in next year.
  // Jan–Jul: season started last year → move-in this year.
  // Aug–Oct: between seasons → the next one (starts Nov 1 this year, move-in next year).
  const moveInYear = month >= 8 ? year + 1 : year;
  const phase: Season["phase"] = month >= 8 && month <= 10 ? "upcoming" : "active";
  return {
    moveInYear,
    start: laDate(moveInYear - 1, 11, 1),
    end: laDate(moveInYear, 8, 1),
    phase,
    label: `${moveInYear - 1}–${String(moveInYear).slice(2)}`,
  };
}

/** Monday 00:00 LA of the week containing `now`, and the following Monday (exclusive). */
export function currentWeek(now: Date = new Date()): { start: Date; end: Date } {
  const { year, month, day } = laParts(now);
  const midnight = laDate(year, month, day);
  const dow = new Date(midnight.getTime() + 12 * 3600_000).getUTCDay(); // noon avoids DST edges
  const back = (dow + 6) % 7; // days since Monday
  const start = new Date(midnight.getTime() - back * 86_400_000);
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/** Is an ISO timestamp / YYYY-MM-DD within [start, end)? Dates are taken as LA midnight. */
export function inRange(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const t = toInstant(value);
  return t !== null && t >= start.getTime() && t < end.getTime();
}

export function toInstant(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return laDate(Number(m[1]), Number(m[2]), Number(m[3])).getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Whole days between a date/timestamp and now (positive = in the past). */
export function daysSince(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const t = toInstant(value);
  if (t === null) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}
