import type { ReportRow } from "../client";
import { compositeKey, dateOnly, int, num, pick, str } from "./helpers";

/**
 * raw unit rows  ->  public.units
 *
 * TODO(after discovery): confirm which report feeds this (likely
 * `unit_vacancy_detail` or `rent_roll` / `unit_directory`) and replace the
 * candidate column names below with the exact ones printed by
 * `npm run discover`. Each pick(...) lists the candidates tried in order.
 */
export type UnitRow = {
  id: string;
  property_name: string | null;
  property_address: string | null;
  unit_name: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  advertised_rent: number | null;
  market_rent: number | null;
  current_rent: number | null;
  status: string | null;
  available_on: string | null;
  vacant_since: string | null;
  days_vacant: number | null;
  tenant_name: string | null;
  lease_start: string | null;
  lease_end: string | null;
  raw: ReportRow;
};

export function mapUnit(row: ReportRow): UnitRow | null {
  const property = str(pick(row, "property_name", "Property Name", "property", "Property"));
  const unit = str(pick(row, "unit_name", "Unit Name", "unit", "Unit"));
  const explicitId = str(pick(row, "unit_id", "Unit Id", "id"));
  if (!explicitId && !unit) return null;

  return {
    id: explicitId ?? compositeKey(property, unit),
    property_name: property,
    property_address: str(pick(row, "property_address", "Property Address", "address", "Address")),
    unit_name: unit,
    bedrooms: num(pick(row, "bedrooms", "Bedrooms", "beds", "Beds", "bd")),
    bathrooms: num(pick(row, "bathrooms", "Bathrooms", "baths", "Baths", "ba")),
    sqft: int(pick(row, "sqft", "Sq Ft", "square_feet", "Square Feet")),
    advertised_rent: num(pick(row, "advertised_rent", "Advertised Rent", "marketing_rent", "Marketing Rent")),
    market_rent: num(pick(row, "market_rent", "Market Rent")),
    current_rent: num(pick(row, "rent", "Rent", "current_rent", "Current Rent")),
    status: str(pick(row, "status", "Status", "unit_status", "Unit Status", "occupancy", "Occupancy")),
    available_on: dateOnly(pick(row, "available_on", "Available On", "next_available_date", "Next Available Date", "available_date", "Available Date")),
    vacant_since: dateOnly(pick(row, "vacant_since", "Vacant Since", "move_out", "Move-out", "Move Out")),
    days_vacant: int(pick(row, "days_vacant", "Days Vacant", "days_on_market", "Days on Market")),
    tenant_name: str(pick(row, "tenant", "Tenant", "tenant_name", "Tenant Name")),
    lease_start: dateOnly(pick(row, "lease_from", "Lease From", "lease_start", "Lease Start")),
    lease_end: dateOnly(pick(row, "lease_to", "Lease To", "lease_end", "Lease End")),
    raw: row,
  };
}
