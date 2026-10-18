import type { ReportParams } from "./client";

/**
 * The seven AppFolio reports the sales sync pulls, in run order.
 * (Confirmed by discovery on 2026-10-18. tenant_directory exists but is
 * intentionally NOT synced in this phase.)
 */
export type SalesReportName =
  | "property_directory"
  | "unit_directory"
  | "unit_vacancy"
  | "rent_roll"
  | "guest_cards"
  | "showings"
  | "rental_applications";

export type ReportSpec = {
  name: SalesReportName;
  /** Store a raw_<name> jsonb copy? False for reports with sensitive applicant data. */
  storeRaw: boolean;
  /** Does the report accept a date range? If so we send from/to explicitly. */
  dateRange: boolean;
  /** Extra fixed params. */
  params?: ReportParams;
};

export const SALES_REPORTS: ReportSpec[] = [
  { name: "property_directory", storeRaw: true, dateRange: false },
  { name: "unit_directory", storeRaw: true, dateRange: false },
  { name: "unit_vacancy", storeRaw: true, dateRange: false },
  { name: "rent_roll", storeRaw: true, dateRange: false },
  { name: "guest_cards", storeRaw: false, dateRange: true },
  { name: "showings", storeRaw: true, dateRange: true },
  { name: "rental_applications", storeRaw: false, dateRange: true },
];

/** Pause between reports — discovery hit HTTP 429 when calling back-to-back. */
export const PAUSE_BETWEEN_REPORTS_MS = 1500;

/**
 * Date range sent to every report that accepts one:
 *   from = Aug 1 of the previous calendar year, to = today (LA).
 * AppFolio's defaults are narrow (showings returned only 5 rows without it).
 */
export function salesDateRange(now = new Date()): { from_date: string; to_date: string } {
  const la = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
  const year = Number(la.slice(0, 4));
  return { from_date: `${year - 1}-08-01`, to_date: la };
}

export function paramsFor(spec: ReportSpec, now = new Date()): ReportParams {
  return { ...(spec.params ?? {}), ...(spec.dateRange ? salesDateRange(now) : {}) };
}
