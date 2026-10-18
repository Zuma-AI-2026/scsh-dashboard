import type { ReportRow } from "../client";
import { bool, dateOnly, int, num, str, timestamp } from "./helpers";

/**
 * rental_applications -> public.applications
 *
 * ALLOWLIST. This report contains sensitive applicant data (addresses, rent
 * history, employer, salary, pets, email, phone). Only the columns below are
 * kept and NO raw copy is stored.
 */
export type ApplicationRow = {
  rental_application_id: number;
  rental_application_group_id: number | null;
  inquiry_id: number | null;
  applicants: string | null;
  received: string | null;
  desired_move_in: string | null;
  lead_source: string | null;
  applicant_reported_source: string | null;
  status: string | null;
  application_status: string | null;
  screening: string | null;
  screened_on: string | null;
  approved_at: string | null;
  denied_at: string | null;
  canceled_at: string | null;
  decision_made_at: string | null;
  time_to_conversion: number | null;
  application_fee_paid: boolean | null;
  assigned_user: string | null;
  assigned_user_id: number | null;
  created_by: string | null;
  property_id: number | null;
  property_name: string | null;
  unit_id: number | null;
  unit_name: string | null;
  move_in_date: string | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  tenant_id: number | null;
};

export function mapApplication(row: ReportRow): ApplicationRow | null {
  const rental_application_id = int(row.rental_application_id);
  if (rental_application_id === null) return null;
  return {
    rental_application_id,
    rental_application_group_id: int(row.rental_application_group_id),
    inquiry_id: int(row.inquiry_id),
    applicants: str(row.applicants),
    received: timestamp(row.received),
    desired_move_in: dateOnly(row.desired_move_in),
    lead_source: str(row.lead_source),
    applicant_reported_source: str(row.applicant_reported_source),
    status: str(row.status),
    application_status: str(row.application_status),
    screening: str(row.screening),
    screened_on: dateOnly(row.screened_on),
    approved_at: timestamp(row.approved_at),
    denied_at: timestamp(row.denied_at),
    canceled_at: timestamp(row.canceled_at),
    decision_made_at: timestamp(row.decision_made_at),
    time_to_conversion: num(row.time_to_conversion),
    application_fee_paid: bool(row.application_fee_paid),
    assigned_user: str(row.assigned_user),
    assigned_user_id: int(row.assigned_user_id),
    created_by: str(row.created_by),
    property_id: int(row.property_id),
    property_name: str(row.property_name),
    unit_id: int(row.unit_id),
    unit_name: str(row.unit_name),
    move_in_date: dateOnly(row.move_in_date),
    lease_start_date: dateOnly(row.lease_start_date),
    lease_end_date: dateOnly(row.lease_end_date),
    tenant_id: int(row.tenant_id),
  };
}
