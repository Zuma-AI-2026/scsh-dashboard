import type { ApplicationRow } from "@/lib/appfolio/mappers/applications";
import type { GuestCardInterestRow, GuestCardRow } from "@/lib/appfolio/mappers/guest-cards";
import type { ShowingRow } from "@/lib/appfolio/mappers/showings";
import type { UnitRow } from "@/lib/appfolio/mappers/units";

/** Rows as returned by the managed_* / available_units views. */
export type Unit = UnitRow & { property_name: string | null; property_address: string | null };
export type GuestCard = GuestCardRow;
export type GuestCardInterest = GuestCardInterestRow & { property_name: string | null };
export type Showing = ShowingRow & { property_name: string | null };
export type Application = ApplicationRow;

export type SalesTab = "units" | "leads" | "showings" | "applications" | "pipeline" | "rotation";
export const SALES_TABS: { key: SalesTab; label: string }[] = [
  { key: "units", label: "Available units" },
  { key: "leads", label: "Leads" },
  { key: "showings", label: "Showings" },
  { key: "applications", label: "Applications" },
  { key: "pipeline", label: "Pipeline" },
  { key: "rotation", label: "Rotation" },
];

/*
 * Status vocabularies as they actually appear in this AppFolio database
 * (verified 2026-10-18). All comparisons are case-insensitive.
 */
/** Guest card statuses that are closed — never flagged stale. */
export const CLOSED_LEAD_STATUSES = ["inactive", "application completed", "cold", "waitlisted"];
/** The only guest card status that can be stale. */
export const OPEN_LEAD_STATUS = "active";
export const STALE_LEAD_HOURS = 48;

/** Showing statuses that count as a completed showing. */
export const COMPLETED_SHOWING_STATUSES = ["completed", "completed (unconfirmed)"];
/** Showing statuses that mean it didn't / won't happen. */
export const CANCELLED_SHOWING_STATUSES = ["canceled", "prospect canceled", "no show"];
/** Showing status for an upcoming showing. */
export const UPCOMING_SHOWING_STATUS = "scheduled";

/** Application status that means a lease was signed. */
export const LEASE_SIGNED_STATUS = "converted";
