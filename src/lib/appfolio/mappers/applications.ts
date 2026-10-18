import type { ReportRow } from "../client";
import { compositeKey, pick, str, timestamp } from "./helpers";

/**
 * raw application rows  ->  public.applications
 *
 * TODO(after discovery): confirm report name (`applications` /
 * `application_detail` / `rental_applications`) and column names.
 */
export type ApplicationRow = {
  id: string;
  applicant_name: string | null;
  email: string | null;
  phone: string | null;
  property_name: string | null;
  unit_name: string | null;
  status: string | null;
  submitted_at: string | null;
  status_changed_at: string | null;
  desired_move_in: string | null;
  agent: string | null;
  lease_signed_at: string | null;
  raw: ReportRow;
};

export function mapApplication(row: ReportRow): ApplicationRow | null {
  const explicitId = str(pick(row, "application_id", "Application Id", "id", "Id"));
  const applicant = str(pick(row, "applicant", "Applicant", "applicant_name", "Applicant Name", "name", "Name"));
  const submitted = timestamp(pick(row, "submitted_at", "Submitted At", "application_date", "Application Date", "submitted", "Submitted", "created_at", "Created At"));
  if (!explicitId && !applicant) return null;

  return {
    id: explicitId ?? compositeKey(applicant, submitted),
    applicant_name: applicant,
    email: str(pick(row, "email", "Email")),
    phone: str(pick(row, "phone", "Phone")),
    property_name: str(pick(row, "property_name", "Property Name", "property", "Property")),
    unit_name: str(pick(row, "unit_name", "Unit Name", "unit", "Unit")),
    status: str(pick(row, "status", "Status", "application_status", "Application Status")),
    submitted_at: submitted,
    status_changed_at: timestamp(pick(row, "status_changed_at", "Status Changed At", "status_date", "Status Date", "updated_at", "Updated At")),
    desired_move_in: timestamp(pick(row, "desired_move_in", "Desired Move-in", "move_in_date", "Move In Date", "Move-In Date")),
    agent: str(pick(row, "agent", "Agent", "leasing_agent", "Leasing Agent")),
    lease_signed_at: timestamp(pick(row, "lease_signed_at", "Lease Signed At", "lease_signed", "Lease Signed", "signed_date", "Signed Date")),
    raw: row,
  };
}
