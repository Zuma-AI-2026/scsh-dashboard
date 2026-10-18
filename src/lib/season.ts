/**
 * Leasing season math.
 *
 * SCSH leases for an August move-in. The active leasing window is
 * Nov 1 – Jul 31; Aug 1 – Oct 31 is move-in / turnover.
 *
 * `currentSeason(date)` returns the season a date belongs to, where
 * everything from Aug 1 onward counts toward the NEXT August's move-in
 * (so an early lead in September lands in the season that starts Nov 1).
 *
 * All dates are treated as America/Los_Angeles calendar dates.
 */

export type Season = {
  /** Calendar year of the August move-in this season leases for. */
  moveInYear: number;
  /** Counting window start (Aug 1 of previous year) — leads after move-in count toward next season. */
  countFrom: Date;
  /** Official leasing window. */
  leasingStart: Date; // Nov 1
  leasingEnd: Date; // Jul 31
  /** Where today falls. */
  phase: "pre" | "active" | "movein";
};

const TZ = "America/Los_Angeles";

function laParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Midnight (LA) on a given calendar date, as a UTC Date suitable for comparisons. */
export function laDate(year: number, month: number, day: number): Date {
  // Build the UTC instant for 00:00 LA. Offset is -7 or -8; compute by probing.
  const guess = new Date(Date.UTC(year, month - 1, day, 8, 0, 0)); // 08:00Z is midnight PST
  const p = laParts(guess);
  if (p.day === day) return guess;
  return new Date(Date.UTC(year, month - 1, day, 7, 0, 0)); // PDT
}

export function currentSeason(now: Date = new Date()): Season {
  const { year, month } = laParts(now);
  // Aug (8) or later → leasing for next year's August. Jan–Jul → this year's August.
  const moveInYear = month >= 8 ? year + 1 : year;
  const phase: Season["phase"] = month === 8 ? "movein" : month === 9 || month === 10 ? "pre" : "active";

  return {
    moveInYear,
    countFrom: laDate(moveInYear - 1, 8, 1),
    leasingStart: laDate(moveInYear - 1, 11, 1),
    leasingEnd: laDate(moveInYear, 8, 1), // exclusive: through Jul 31
    phase,
  };
}

export function formatSeasonLabel(season: Season): string {
  return `${season.moveInYear - 1}–${String(season.moveInYear).slice(2)}`;
}

/** Start of the current week (Monday 00:00 LA). */
export function startOfWeek(now: Date = new Date()): Date {
  const { year, month, day } = laParts(now);
  const midnight = laDate(year, month, day);
  const dow = new Date(midnight.getTime() + 12 * 3600_000).getUTCDay(); // 0 Sun … 6 Sat (noon avoids DST edge)
  const back = (dow + 6) % 7; // days since Monday
  return new Date(midnight.getTime() - back * 86_400_000);
}
