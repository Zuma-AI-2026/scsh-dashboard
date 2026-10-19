import type { ReportParams } from "./client";

/**
 * The seven AppFolio reports the sales sync pulls, in run order.
 * (Confirmed by discovery on 2026-10-18. tenant_directory exists but is
 * intentionally NOT synced in this phase.)
 *
 * IMPORTANT: the Reports API silently IGNORES unknown parameters (verified:
 * a bogus key returns 200 with unchanged rows). Parameter names below were
 * confirmed empirically against the live database — an invalid value for a
 * recognised name produces an error / empty result, an unknown name changes
 * nothing. Row counts with the right names vs. defaults (2025-08-01 → today):
 *   guest_cards          77 →  5,023   (received_on_from/to + guest_card_statuses)
 *   showings              5 →  1,578   (showing_date_from/to)
 *   rental_applications   4 →    571   (received_on_from/to)
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
  /** Names of the date-range params this report understands (omit if none). */
  dateParams?: { from: string; to: string };
  /**
   * Status filter. AppFolio defaults some reports to a subset (guest cards:
   * open only). "all" asks for the full history; override to narrow.
   */
  statusParam?: { name: string; values: string[] };
  /** Extra fixed params. */
  params?: ReportParams;
};

export const ALL_STATUSES = ["all"];

export const SALES_REPORTS: ReportSpec[] = [
  { name: "property_directory", storeRaw: true },
  { name: "unit_directory", storeRaw: true },
  { name: "unit_vacancy", storeRaw: true },
  { name: "rent_roll", storeRaw: true },
  {
    name: "guest_cards",
    storeRaw: false,
    dateParams: { from: "received_on_from", to: "received_on_to" },
    // Default is open cards only (Active/Waitlisted). "all" adds Inactive, Application Completed, Cold.
    statusParam: { name: "guest_card_statuses", values: ALL_STATUSES },
  },
  {
    name: "showings",
    storeRaw: true,
    dateParams: { from: "showing_date_from", to: "showing_date_to" },
    // Default already includes every status; sent explicitly so it stays that way.
    statusParam: { name: "statuses", values: ALL_STATUSES },
  },
  {
    name: "rental_applications",
    storeRaw: false,
    dateParams: { from: "received_on_from", to: "received_on_to" },
    statusParam: { name: "rental_application_statuses", values: ALL_STATUSES },
  },
];

/** Pause between reports — discovery hit HTTP 429 when calling back-to-back. */
export const PAUSE_BETWEEN_REPORTS_MS = 1500;

/**
 * Date range sent to every report that accepts one:
 *   from = Aug 1 of the previous calendar year, to = today (LA).
 */
export function salesDateRange(now = new Date()): { from: string; to: string } {
  const la = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
  const year = Number(la.slice(0, 4));
  return { from: `${year - 1}-08-01`, to: la };
}

export function paramsFor(spec: ReportSpec, now = new Date()): ReportParams {
  const out: ReportParams = { ...(spec.params ?? {}) };
  if (spec.dateParams) {
    const { from, to } = salesDateRange(now);
    out[spec.dateParams.from] = from;
    out[spec.dateParams.to] = to;
  }
  if (spec.statusParam) out[spec.statusParam.name] = spec.statusParam.values;
  return out;
}
