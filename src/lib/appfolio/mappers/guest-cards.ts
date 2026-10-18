import type { ReportRow } from "../client";
import { dateOnly, int, num, str, timestamp } from "./helpers";

/**
 * guest_cards -> public.guest_cards
 *
 * ALLOWLIST. This report contains sensitive applicant data; only the columns
 * below are kept and NO raw copy is stored. Deliberately dropped:
 * monthly_income, credit_score, pet_preference, notes.
 */
export type GuestCardRow = {
  guest_card_id: number;
  guest_card_uuid: string | null;
  inquiry_id: number | null;
  name: string | null;
  email_address: string | null;
  phone_number: string | null;
  received: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  status: string | null;
  move_in_preference: string | null;
  max_rent: number | null;
  bed_bath_preference: string | null;
  lead_type: string | null;
  source: string | null;
  property_id: number | null;
  property_name: string | null;
  unit_id: number | null;
  unit: string | null;
  assigned_user: string | null;
  assigned_user_id: number | null;
  tenant_id: number | null;
};

export function mapGuestCard(row: ReportRow): GuestCardRow | null {
  const guest_card_id = int(row.guest_card_id);
  if (guest_card_id === null) return null;
  return {
    guest_card_id,
    guest_card_uuid: str(row.guest_card_uuid),
    inquiry_id: int(row.inquiry_id),
    name: str(row.name),
    email_address: str(row.email_address),
    phone_number: str(row.phone_number),
    received: timestamp(row.received),
    last_activity_date: dateOnly(row.last_activity_date),
    last_activity_type: str(row.last_activity_type),
    status: str(row.status),
    move_in_preference: str(row.move_in_preference),
    max_rent: num(row.max_rent),
    bed_bath_preference: str(row.bed_bath_preference),
    lead_type: str(row.lead_type),
    source: str(row.source),
    property_id: int(row.property_id),
    property_name: str(row.property_name),
    unit_id: int(row.unit_id),
    unit: str(row.unit),
    assigned_user: str(row.assigned_user),
    assigned_user_id: int(row.assigned_user_id),
    tenant_id: int(row.tenant_id),
  };
}
