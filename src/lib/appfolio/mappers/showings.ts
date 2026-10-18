import type { ReportRow } from "../client";
import { compositeKey, pick, str, timestamp } from "./helpers";

/**
 * raw showing rows  ->  public.showings
 *
 * TODO(after discovery): confirm report name (`showings` / `showing_detail`)
 * and replace candidate column names with the real ones.
 */
export type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  guest_card_id: string | null;
  lead_name: string | null;
  property_name: string | null;
  unit_name: string | null;
  agent: string | null;
  status: string | null; // scheduled / completed / cancelled / no-show …
  outcome: string | null;
  notes: string | null;
  raw: ReportRow;
};

export function mapShowing(row: ReportRow): ShowingRow | null {
  const explicitId = str(pick(row, "showing_id", "Showing Id", "id", "Id"));
  const scheduled = timestamp(pick(row, "showing_date", "Showing Date", "scheduled_at", "Scheduled At", "date", "Date", "start_time", "Start Time"));
  const lead = str(pick(row, "guest_name", "Guest Name", "name", "Name", "prospect", "Prospect", "lead", "Lead"));
  const unit = str(pick(row, "unit_name", "Unit Name", "unit", "Unit"));
  if (!explicitId && !scheduled) return null;

  return {
    id: explicitId ?? compositeKey(lead, unit, scheduled),
    scheduled_at: scheduled,
    guest_card_id: str(pick(row, "guest_card_id", "Guest Card Id")),
    lead_name: lead,
    property_name: str(pick(row, "property_name", "Property Name", "property", "Property")),
    unit_name: unit,
    agent: str(pick(row, "agent", "Agent", "leasing_agent", "Leasing Agent", "shown_by", "Shown By")),
    status: str(pick(row, "status", "Status")),
    outcome: str(pick(row, "outcome", "Outcome", "result", "Result", "feedback", "Feedback")),
    notes: str(pick(row, "notes", "Notes", "comments", "Comments")),
    raw: row,
  };
}
