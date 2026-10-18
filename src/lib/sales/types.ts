import type { ApplicationRow } from "@/lib/appfolio/mappers/applications";
import type { GuestCardRow } from "@/lib/appfolio/mappers/guest-cards";
import type { ShowingRow } from "@/lib/appfolio/mappers/showings";
import type { UnitRow } from "@/lib/appfolio/mappers/units";

/** Rows as returned by the managed_* / available_units views. */
export type Unit = UnitRow & { property_name: string | null; property_address: string | null };
export type GuestCard = GuestCardRow;
export type Showing = ShowingRow & { property_name: string | null };
export type Application = ApplicationRow;

export type SalesTab = "units" | "leads" | "showings" | "applications" | "pipeline";
export const SALES_TABS: { key: SalesTab; label: string }[] = [
  { key: "units", label: "Available units" },
  { key: "leads", label: "Leads" },
  { key: "showings", label: "Showings" },
  { key: "applications", label: "Applications" },
  { key: "pipeline", label: "Pipeline" },
];

/** Lead statuses that are terminal — never flagged stale. */
export const CLOSED_LEAD_STATUSES = ["converted", "lost", "waitlisted"];
/** Showing statuses that mean it didn't / won't happen. */
export const CANCELLED_SHOWING_STATUSES = ["cancelled", "canceled", "no show", "no-show"];
export const STALE_LEAD_HOURS = 48;
