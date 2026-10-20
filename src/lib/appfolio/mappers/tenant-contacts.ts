import type { ReportRow } from "../client";
import { bool, int, str } from "./helpers";

/** Allowlisted columns from tenant_directory, only for currently delinquent occupancies. */
export type TenantContactRow = {
  occupancy_id: number;
  tenant_id: number;
  tenant: string | null;
  phone_numbers: string | null;
  emails: string | null;
  primary_tenant: boolean | null;
};

export function mapTenantContact(row: ReportRow, delinquentOccupancies: Set<number>): TenantContactRow | null {
  const occupancy_id = int(row.occupancy_id);
  const tenant_id = int(row.tenant_id) ?? int(row.selected_tenant_id);
  if (occupancy_id === null || tenant_id === null) return null;
  if (!delinquentOccupancies.has(occupancy_id)) return null;
  return {
    occupancy_id,
    tenant_id,
    tenant: str(row.tenant),
    phone_numbers: str(row.phone_numbers),
    emails: str(row.emails),
    primary_tenant: bool(row.primary_tenant),
  };
}

export function occupancyIdsFromDelinquency(rows: ReportRow[]): Set<number> {
  const out = new Set<number>();
  for (const row of rows) {
    const id = int(row.occupancy_id);
    if (id !== null) out.add(id);
  }
  return out;
}
