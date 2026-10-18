import type { ReportParams, ReportRow } from "../client";
import { mapApplication } from "./applications";
import { mapGuestCard } from "./guest-cards";
import { mapShowing } from "./showings";
import { mapUnit } from "./units";

export type CleanTable = "units" | "guest_cards" | "showings" | "applications";

export type SalesReportConfig = {
  /** AppFolio report name (snake_case). Also names the raw table: raw_<report>. */
  report: string;
  /** Request body params for the report (filters, date ranges…). */
  params: ReportParams;
  /** Clean table the mapped rows are written to. */
  table: CleanTable;
  /** Maps one raw row to one clean row; return null to skip the row. */
  map: (row: ReportRow) => Record<string, unknown> | null;
  /** If false, the sync skips this report (useful while names are unconfirmed). */
  enabled: boolean;
};

/**
 * THE list of reports the sales sync pulls every 15 minutes.
 *
 * TODO(after discovery): set `report` to the names that returned 200 in
 * `npm run discover`, fix `params`, and flip `enabled` to true.
 */
export const SALES_REPORTS: SalesReportConfig[] = [
  { report: "unit_vacancy_detail", params: {}, table: "units", map: mapUnit, enabled: false },
  { report: "guest_cards", params: {}, table: "guest_cards", map: mapGuestCard, enabled: false },
  { report: "showings", params: {}, table: "showings", map: mapShowing, enabled: false },
  { report: "applications", params: {}, table: "applications", map: mapApplication, enabled: false },
];
