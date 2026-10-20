import type { ReportRow } from "../client";
import { dateOnly, int, num, str, timestamp } from "./helpers";

/**
 * guest_cards report -> public.guest_cards (one row per person)
 *                  and  public.guest_card_interests (every AppFolio row)
 *
 * ALLOWLIST. Sensitive columns (monthly_income, credit_score, pet_preference,
 * notes) are never kept. No raw_ copy is stored.
 *
 * Person rollup:
 *   received / source / property / unit  = earliest interest (by received)
 *   status / assigned_user / last_activity = most recent interest (by received)
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

export type GuestCardInterestRow = {
  guest_card_id: number;
  property_id: number;
  received: string;
  row_index: number;
  unit_id: number | null;
  source: string | null;
  assigned_user: string | null;
  assigned_user_id: number | null;
  status: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
};

/** Sentinel values so the composite PK is never nullable. */
export const MISSING_PROPERTY_ID = 0;
export const MISSING_RECEIVED = "1970-01-01T00:00:00.000Z";

type MappedRow = GuestCardRow;

export function mapGuestCard(row: ReportRow): MappedRow | null {
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

function byReceivedAsc(a: MappedRow, b: MappedRow): number {
  return (a.received ?? MISSING_RECEIVED).localeCompare(b.received ?? MISSING_RECEIVED);
}

function rollupPerson(group: MappedRow[]): GuestCardRow {
  const earliest = [...group].sort(byReceivedAsc)[0]!;
  const latest = [...group].sort(byReceivedAsc)[group.length - 1]!;
  return {
    ...latest,
    received: earliest.received,
    source: earliest.source,
    property_id: earliest.property_id,
    property_name: earliest.property_name,
    unit_id: earliest.unit_id,
    unit: earliest.unit,
    status: latest.status,
    assigned_user: latest.assigned_user,
    assigned_user_id: latest.assigned_user_id,
    last_activity_date: latest.last_activity_date,
    last_activity_type: latest.last_activity_type,
  };
}

export function mapGuestCards(rows: ReportRow[]): { people: GuestCardRow[]; interests: GuestCardInterestRow[] } {
  const mapped: MappedRow[] = [];
  for (const row of rows) {
    const m = mapGuestCard(row);
    if (m) mapped.push(m);
  }

  const peopleById = new Map<number, MappedRow[]>();
  for (const m of mapped) {
    const list = peopleById.get(m.guest_card_id) ?? [];
    list.push(m);
    peopleById.set(m.guest_card_id, list);
  }
  const people = [...peopleById.values()].map(rollupPerson);

  const keyCount = new Map<string, number>();
  const interests: GuestCardInterestRow[] = [];
  for (const m of mapped) {
    const property_id = m.property_id ?? MISSING_PROPERTY_ID;
    const received = m.received ?? MISSING_RECEIVED;
    const key = `${m.guest_card_id}|${property_id}|${received}`;
    const row_index = keyCount.get(key) ?? 0;
    keyCount.set(key, row_index + 1);
    interests.push({
      guest_card_id: m.guest_card_id,
      property_id,
      received,
      row_index,
      unit_id: m.unit_id,
      source: m.source,
      assigned_user: m.assigned_user,
      assigned_user_id: m.assigned_user_id,
      status: m.status,
      last_activity_date: m.last_activity_date,
      last_activity_type: m.last_activity_type,
    });
  }

  return { people, interests };
}
