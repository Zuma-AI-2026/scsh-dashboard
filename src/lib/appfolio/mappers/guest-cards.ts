import type { ReportRow } from "../client";
import { compositeKey, pick, str, timestamp } from "./helpers";

/**
 * raw guest card rows  ->  public.guest_cards   (leads)
 *
 * TODO(after discovery): confirm report name (`guest_cards` / `guest_card`)
 * and replace candidate column names with the real ones.
 */
export type GuestCardRow = {
  id: string;
  created_at: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  property_name: string | null;
  unit_name: string | null;
  bedrooms_wanted: string | null;
  desired_move_in: string | null;
  source: string | null;
  agent: string | null;
  status: string | null;
  last_activity_at: string | null;
  notes: string | null;
  raw: ReportRow;
};

export function mapGuestCard(row: ReportRow): GuestCardRow | null {
  const explicitId = str(pick(row, "guest_card_id", "Guest Card Id", "id", "Id"));
  const name = str(pick(row, "name", "Name", "guest_name", "Guest Name", "prospect", "Prospect"));
  const email = str(pick(row, "email", "Email"));
  const phone = str(pick(row, "phone", "Phone", "phone_number", "Phone Number"));
  const created = timestamp(pick(row, "created_at", "Created At", "created", "Created", "date_created", "Date Created"));
  if (!explicitId && !name && !email) return null;

  return {
    id: explicitId ?? compositeKey(name, email ?? phone, created),
    created_at: created,
    name,
    email,
    phone,
    property_name: str(pick(row, "property_name", "Property Name", "property", "Property", "interested_property")),
    unit_name: str(pick(row, "unit_name", "Unit Name", "unit", "Unit", "interested_unit")),
    bedrooms_wanted: str(pick(row, "bedrooms", "Bedrooms", "desired_bedrooms")),
    desired_move_in: timestamp(pick(row, "desired_move_in", "Desired Move-in", "move_in_date", "Move In Date")),
    source: str(pick(row, "source", "Source", "lead_source", "Lead Source", "marketing_source", "Marketing Source")),
    agent: str(pick(row, "agent", "Agent", "leasing_agent", "Leasing Agent", "assigned_to", "Assigned To")),
    status: str(pick(row, "status", "Status", "stage", "Stage")),
    last_activity_at: timestamp(pick(row, "last_activity", "Last Activity", "last_activity_at", "updated_at", "Updated At", "last_contacted", "Last Contacted")),
    notes: str(pick(row, "notes", "Notes", "comments", "Comments")),
    raw: row,
  };
}
