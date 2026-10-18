import type { ReportRow } from "../client";
import { bool, dateOnly, int, num, str } from "./helpers";

/**
 * units = unit_directory (base) + unit_vacancy (match on unit_id)
 *                               + rent_roll   (match on unit_id, current occupancy)
 */
export type UnitRow = {
  unit_id: number;
  property_id: number | null;
  unit_name: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  advertised_rent: number | null;
  market_rent: number | null;
  rent_ready: boolean | null;
  rentable: boolean | null;
  visibility: string | null;
  posted_to_website: boolean | null;
  posted_to_internet: boolean | null;
  description: string | null;
  unit_tags: string | null;
  // unit_vacancy
  in_vacancy_report: boolean;
  unit_status: string | null;
  days_vacant: number | null;
  available_on: string | null;
  next_move_in: string | null;
  last_move_out: string | null;
  ready_for_showing_on: string | null;
  unit_turn_target_date: string | null;
  // rent_roll
  occupancy_status: string | null;
  current_rent: number | null;
  lease_from: string | null;
  lease_to: string | null;
  move_in: string | null;
  move_out: string | null;
  lease_expires_month: string | null;
  past_due: number | null;
  tenant: string | null;
  beds_in_row: number | null;
  beds_occupied: number | null;
};

export function mapUnitDirectory(row: ReportRow): UnitRow | null {
  const unit_id = int(row.unit_id);
  if (unit_id === null) return null;
  return {
    unit_id,
    property_id: int(row.property_id),
    unit_name: str(row.unit_name),
    bedrooms: num(row.bedrooms),
    bathrooms: num(row.bathrooms),
    sqft: int(row.sqft),
    advertised_rent: num(row.advertised_rent),
    market_rent: num(row.market_rent),
    rent_ready: bool(row.rent_ready),
    rentable: bool(row.rentable),
    visibility: str(row.visibility),
    posted_to_website: bool(row.posted_to_website),
    posted_to_internet: bool(row.posted_to_internet),
    description: str(row.description),
    unit_tags: str(row.unit_tags),
    in_vacancy_report: false,
    unit_status: null,
    days_vacant: null,
    available_on: null,
    next_move_in: null,
    last_move_out: null,
    ready_for_showing_on: null,
    unit_turn_target_date: null,
    occupancy_status: null,
    current_rent: null,
    lease_from: null,
    lease_to: null,
    move_in: null,
    move_out: null,
    lease_expires_month: null,
    past_due: null,
    tenant: null,
    beds_in_row: null,
    beds_occupied: null,
  };
}

export type UnitVacancyPatch = Pick<
  UnitRow,
  "in_vacancy_report" | "unit_status" | "days_vacant" | "available_on" | "next_move_in" | "last_move_out" | "ready_for_showing_on" | "unit_turn_target_date"
>;

export function mapUnitVacancy(row: ReportRow): { unit_id: number; patch: UnitVacancyPatch } | null {
  const unit_id = int(row.unit_id);
  if (unit_id === null) return null;
  return {
    unit_id,
    patch: {
      in_vacancy_report: true,
      unit_status: str(row.unit_status),
      days_vacant: int(row.days_vacant),
      available_on: dateOnly(row.available_on),
      next_move_in: dateOnly(row.next_move_in),
      last_move_out: dateOnly(row.last_move_out),
      ready_for_showing_on: dateOnly(row.ready_for_showing_on),
      unit_turn_target_date: dateOnly(row.unit_turn_target_date),
    },
  };
}

export type RentRollPatch = Pick<
  UnitRow,
  "occupancy_status" | "current_rent" | "lease_from" | "lease_to" | "move_in" | "move_out" | "lease_expires_month" | "past_due" | "tenant" | "beds_in_row" | "beds_occupied"
>;

export function mapRentRoll(row: ReportRow): { unit_id: number; patch: RentRollPatch } | null {
  const unit_id = int(row.unit_id);
  if (unit_id === null) return null;
  const tenant =
    str(row.tenant) ??
    [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ") ??
    null;
  return {
    unit_id,
    patch: {
      occupancy_status: str(row.status),
      current_rent: num(row.rent),
      lease_from: dateOnly(row.lease_from),
      lease_to: dateOnly(row.lease_to),
      move_in: dateOnly(row.move_in),
      move_out: dateOnly(row.move_out),
      lease_expires_month: str(row.lease_expires_month),
      past_due: num(row.past_due),
      tenant: tenant || null,
      beds_in_row: int(row.beds_in_row),
      beds_occupied: int(row.beds_occupied),
    },
  };
}

/**
 * Rent roll has one row per occupancy; a unit can have several (Current,
 * Notice, Future, Vacant…). Pick the one that describes the unit *now*.
 */
const STATUS_RANK: Record<string, number> = { current: 0, notice: 1, evict: 1, vacant: 2, future: 4 };

export function pickCurrentOccupancy(rows: RentRollPatch[]): RentRollPatch | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const ra = STATUS_RANK[(a.occupancy_status ?? "").toLowerCase()] ?? 3;
    const rb = STATUS_RANK[(b.occupancy_status ?? "").toLowerCase()] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.move_in ?? "").localeCompare(a.move_in ?? ""); // latest move-in first
  })[0];
}

/** Merge the three reports into one row per unit (units not in the directory are dropped). */
export function mergeUnits(directory: ReportRow[], vacancy: ReportRow[], rentRoll: ReportRow[]): UnitRow[] {
  const byId = new Map<number, UnitRow>();
  for (const row of directory) {
    const u = mapUnitDirectory(row);
    if (u) byId.set(u.unit_id, u);
  }
  for (const row of vacancy) {
    const v = mapUnitVacancy(row);
    const u = v && byId.get(v.unit_id);
    if (u) Object.assign(u, v.patch);
  }
  const rr = new Map<number, RentRollPatch[]>();
  for (const row of rentRoll) {
    const r = mapRentRoll(row);
    if (!r) continue;
    const list = rr.get(r.unit_id) ?? [];
    list.push(r.patch);
    rr.set(r.unit_id, list);
  }
  for (const [unit_id, patches] of rr) {
    const u = byId.get(unit_id);
    const current = pickCurrentOccupancy(patches);
    if (u && current) Object.assign(u, current);
  }
  return [...byId.values()];
}
