import type { ReportRow } from "../client";
import { dateOnly, int, num, str } from "./helpers";

/** property_directory -> public.properties (AppFolio columns only; our flags are handled in sync). */
export type PropertyRow = {
  property_id: number;
  property_name: string | null;
  property_address: string | null;
  property_street: string | null;
  property_street2: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  units: number | null;
  owners: string | null;
  portfolio: string | null;
  management_fee_percent: number | null;
  visibility: string | null;
  property_created_on: string | null;
};

export function mapProperty(row: ReportRow): PropertyRow | null {
  const property_id = int(row.property_id);
  if (property_id === null) return null;
  return {
    property_id,
    property_name: str(row.property_name),
    property_address: str(row.property_address),
    property_street: str(row.property_street),
    property_street2: str(row.property_street2),
    property_city: str(row.property_city),
    property_state: str(row.property_state),
    property_zip: str(row.property_zip),
    units: int(row.units),
    owners: str(row.owners),
    portfolio: str(row.portfolio),
    management_fee_percent: num(row.management_fee_percent),
    visibility: str(row.visibility),
    property_created_on: dateOnly(row.property_created_on),
  };
}
