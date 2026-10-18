import type { ReportRow } from "../client";
import { dateOnly, int, num, str, timestamp } from "./helpers";

/** showings -> public.showings */
export type ShowingRow = {
  showing_id: number;
  guest_card_id: number | null;
  inquiry_id: number | null;
  guest_card_name: string | null;
  property_id: number | null;
  unit_id: number | null;
  showing_unit: string | null;
  created_at: string | null;
  created_by: string | null;
  showing_time: string | null;
  confirmation_time: string | null;
  assigned_user: string | null;
  assigned_user_id: number | null;
  description: string | null;
  status: string | null;
  type: string | null;
  source: string | null;
  inquiry_type: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  rental_application_id: number | null;
  rental_application_status: string | null;
  showing_to_application_time: number | null;
};

export function mapShowing(row: ReportRow): ShowingRow | null {
  const showing_id = int(row.showing_id);
  if (showing_id === null) return null;
  return {
    showing_id,
    guest_card_id: int(row.guest_card_id),
    inquiry_id: int(row.inquiry_id),
    guest_card_name: str(row.guest_card_name),
    property_id: int(row.property_id),
    unit_id: int(row.unit_id),
    showing_unit: str(row.showing_unit),
    created_at: timestamp(row.created_at),
    created_by: str(row.created_by),
    showing_time: timestamp(row.showing_time),
    confirmation_time: timestamp(row.confirmation_time),
    assigned_user: str(row.assigned_user),
    assigned_user_id: int(row.assigned_user_id),
    description: str(row.description),
    status: str(row.status),
    type: str(row.type),
    source: str(row.source),
    inquiry_type: str(row.inquiry_type),
    last_activity_date: dateOnly(row.last_activity_date),
    last_activity_type: str(row.last_activity_type),
    rental_application_id: int(row.rental_application_id),
    rental_application_status: str(row.rental_application_status),
    showing_to_application_time: num(row.showing_to_application_time),
  };
}
