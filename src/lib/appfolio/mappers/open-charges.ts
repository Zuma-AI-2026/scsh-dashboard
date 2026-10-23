import type { ReportRow } from "../client.ts";
import { dateOnly, int, num, str } from "./helpers.ts";

/** One open invoice line from aged_receivables_detail. */
export type OpenChargeRow = {
  txn_id: number;
  occupancy_id: number;
  description: string | null;
  occurred_on: string | null;
  amount: number;
};

/** "45000000 - Rent" → "Rent" when account_name is missing. */
function accountLabel(row: ReportRow): string | null {
  const name = str(row.account_name);
  if (name) return name;
  const account = str(row.account);
  return account ? account.replace(/^\d+\s*-\s*/, "") : null;
}

/** Open charges (amount_receivable > 0) for the given occupancies; first row wins per txn_id. */
export function mapOpenCharges(rows: ReportRow[], occupancies: Set<number>): OpenChargeRow[] {
  const out = new Map<number, OpenChargeRow>();
  for (const row of rows) {
    const txn_id = int(row.txn_id);
    const occupancy_id = int(row.occupancy_id);
    const amount = num(row.amount_receivable);
    if (txn_id === null || occupancy_id === null || amount === null || amount <= 0) continue;
    if (!occupancies.has(occupancy_id) || out.has(txn_id)) continue;
    out.set(txn_id, {
      txn_id,
      occupancy_id,
      description: accountLabel(row),
      occurred_on: dateOnly(row.invoice_occurred_on) ?? dateOnly(row.posting_date),
      amount: Math.round(amount * 100) / 100,
    });
  }
  return [...out.values()];
}
