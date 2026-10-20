import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OCCUPIED_STATUSES, type Delinquency, type DelinquencyAction } from "./types";

export type AccountingDataset = {
  delinquencies: Delinquency[];
  actions: DelinquencyAction[];
  occupiedManaged: number;
};

const MAX_ROWS = 10_000;

/**
 * Loads Accounting (delinquency) through managed_delinquencies (is_managed
 * enforced in SQL) plus the follow-up log. Occupied-managed count comes from
 * managed_units with Current/Notice/Evict status.
 */
export async function loadAccountingDataset(): Promise<AccountingDataset> {
  const supabase = await createSupabaseServerClient();

  const [delinquencies, actions, units] = await Promise.all([
    supabase.from("managed_delinquencies").select("*").order("amount_receivable", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    supabase.from("delinquency_actions").select("id, occupancy_id, action, note, acted_by, acted_at").order("acted_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("managed_units").select("unit_id, occupancy_status").limit(MAX_ROWS),
  ]);

  for (const r of [delinquencies, actions, units]) {
    if (r.error) throw new Error(`Accounting data: ${r.error.message}`);
  }

  const occupiedManaged = (units.data ?? []).filter((u) => OCCUPIED_STATUSES.includes((u.occupancy_status ?? "").trim().toLowerCase())).length;

  return {
    delinquencies: (delinquencies.data ?? []) as Delinquency[],
    actions: (actions.data ?? []) as DelinquencyAction[],
    occupiedManaged,
  };
}
