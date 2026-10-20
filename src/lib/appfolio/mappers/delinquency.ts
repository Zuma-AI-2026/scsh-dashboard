import { laDate, laParts } from "@/lib/season";
import type { ReportRow } from "../client";
import { bool, dateOnly, int, num, str } from "./helpers";

export type DelinquencyRow = {
  occupancy_id: number;
  unit_id: number | null;
  property_id: number;
  unit_name: string | null;
  tenant: string | null;
  tenant_status: string | null;
  amount_receivable: number | null;
  not_yet_due: number | null;
  bucket_0_30: number | null;
  bucket_31_60: number | null;
  bucket_61_90: number | null;
  bucket_90_plus: number | null;
  last_payment: string | null;
  payment_amount: number | null;
  nsf: number | null;
  late: number | null;
  rent: number | null;
  delinquent_rent: number | null;
  phone_numbers: string | null;
  primary_tenant_email: string | null;
  move_in: string | null;
  move_out: string | null;
  lease_to: string | null;
  tenant_agent: string | null;
  in_collections: boolean | null;
  oldest_invoice_on: string | null;
};

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

function money(row: ReportRow, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = num(row[k]);
    if (n !== null) return n;
  }
  return null;
}

export function mapDelinquency(row: ReportRow): DelinquencyRow | null {
  const occupancy_id = int(row.occupancy_id);
  const property_id = int(row.property_id);
  if (occupancy_id === null || property_id === null) return null;
  return {
    occupancy_id,
    unit_id: int(row.unit_id),
    property_id,
    unit_name: str(row.unit) ?? str(row.unit_name),
    tenant: str(row.name) ?? str(row.tenant),
    tenant_status: str(row.tenant_status) ?? str(row.status),
    amount_receivable: money(row, "amount_receivable"),
    not_yet_due: money(row, "not_yet_due"),
    bucket_0_30: money(row, "00_to30", "0_to30"),
    bucket_31_60: money(row, "30_to60"),
    bucket_61_90: money(row, "60_to90"),
    bucket_90_plus: money(row, "90_plus"),
    last_payment: dateOnly(row.last_payment),
    payment_amount: money(row, "payment_amount"),
    nsf: int(row.nsf),
    late: int(row.late),
    rent: money(row, "rent"),
    delinquent_rent: money(row, "delinquent_rent"),
    phone_numbers: str(row.phone_numbers),
    primary_tenant_email: str(row.primary_tenant_email),
    move_in: dateOnly(row.move_in),
    move_out: dateOnly(row.move_out),
    lease_to: dateOnly(row.lease_to),
    tenant_agent: str(row.tenant_agent),
    in_collections: bool(row.in_collections),
    oldest_invoice_on: null,
  };
}

/** Oldest unpaid invoice date per occupancy, from aged_receivables_detail. */
export function oldestInvoiceByOccupancy(rows: ReportRow[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const row of rows) {
    const occupancy_id = int(row.occupancy_id);
    const amount = money(row, "amount_receivable") ?? 0;
    const occurred = dateOnly(row.invoice_occurred_on);
    if (occupancy_id === null || amount <= 0 || !occurred) continue;
    const prev = out.get(occupancy_id);
    if (!prev || occurred < prev) out.set(occupancy_id, occurred);
  }
  return out;
}

export function leaseByOccupancy(rentRoll: ReportRow[]): Map<number, { lease_to: string | null; tenant_agent: string | null }> {
  const out = new Map<number, { lease_to: string | null; tenant_agent: string | null }>();
  for (const row of rentRoll) {
    const occupancy_id = int(row.occupancy_id);
    if (occupancy_id === null) continue;
    out.set(occupancy_id, { lease_to: dateOnly(row.lease_to), tenant_agent: str(row.tenant_agent) });
  }
  return out;
}

/** Oldest non-zero aging bucket; null when nothing is past due. */
export function agingBucketOf(row: Pick<DelinquencyRow, "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus">): AgingBucket | null {
  if ((row.bucket_90_plus ?? 0) > 0) return "90+";
  if ((row.bucket_61_90 ?? 0) > 0) return "61-90";
  if ((row.bucket_31_60 ?? 0) > 0) return "31-60";
  if ((row.bucket_0_30 ?? 0) > 0) return "0-30";
  return null;
}

/** Lower bound of the oldest non-zero AppFolio aging bucket. */
export function daysPastDueFromBucket(row: Pick<DelinquencyRow, "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus">): number | null {
  const bucket = agingBucketOf(row);
  if (bucket === "90+") return 90;
  if (bucket === "61-90") return 61;
  if (bucket === "31-60") return 31;
  if (bucket === "0-30") return 0;
  return null;
}

function daysBetweenLa(fromYmd: string, now: Date): number | null {
  const m = fromYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const start = laDate(Number(m[1]), Number(m[2]), Number(m[3]));
  const p = laParts(now);
  const today = laDate(p.year, p.month, p.day);
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
}

/**
 * Days past due: oldest unpaid invoice in aged_receivables_detail, else the
 * lower bound of the delinquency report's oldest non-zero aging bucket.
 */
export function daysPastDue(
  row: Pick<DelinquencyRow, "oldest_invoice_on" | "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus">,
  now = new Date(),
): number | null {
  if (row.oldest_invoice_on) {
    const fromInvoice = daysBetweenLa(row.oldest_invoice_on, now);
    if (fromInvoice !== null) return fromInvoice;
  }
  return daysPastDueFromBucket(row);
}
