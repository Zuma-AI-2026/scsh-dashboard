import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerType, type DelinquencyStage } from "./ladder";
import { OCCUPIED_STATUSES, type Delinquency, type DelinquencyAction, type TenantContact } from "./types";

export type AccountingDataset = {
  delinquencies: Delinquency[];
  actions: DelinquencyAction[];
  stages: DelinquencyStage[];
  contacts: TenantContact[];
  occupiedManaged: number;
};

const MAX_ROWS = 10_000;

function asStages(rows: unknown[]): DelinquencyStage[] {
  const out: DelinquencyStage[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "number" || typeof r.sort_order !== "number" || typeof r.name !== "string" || typeof r.trigger_day !== "number") continue;
    if (!isOwnerType(r.owner_type) || typeof r.action_label !== "string" || typeof r.is_active !== "boolean") continue;
    const tone = r.message_tone;
    out.push({
      id: r.id,
      sort_order: r.sort_order,
      name: r.name,
      trigger_day: r.trigger_day,
      owner_type: r.owner_type,
      action_label: r.action_label,
      message_tone: tone === "friendly" || tone === "firm" || tone === "final" ? tone : null,
      is_active: r.is_active,
    });
  }
  return out;
}

/**
 * Loads Accounting through managed_delinquencies (is_managed in SQL), the
 * follow-up log, the admin ladder, and tenant_contacts (empty for partner via RLS).
 */
export async function loadAccountingDataset(): Promise<AccountingDataset> {
  const supabase = await createSupabaseServerClient();

  const [delinquencies, actions, stages, contacts, units] = await Promise.all([
    supabase.from("managed_delinquencies").select("*").order("amount_receivable", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    supabase.from("delinquency_actions").select("id, occupancy_id, action, note, acted_by, acted_at, stage_id").order("acted_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("delinquency_stages").select("id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active").order("sort_order"),
    supabase.from("tenant_contacts").select("occupancy_id, tenant_id, tenant, phone_numbers, emails, primary_tenant").limit(MAX_ROWS),
    supabase.from("managed_units").select("unit_id, occupancy_status").limit(MAX_ROWS),
  ]);

  for (const r of [delinquencies, actions, stages, contacts, units]) {
    if (r.error) throw new Error(`Accounting data: ${r.error.message}`);
  }

  const occupiedManaged = (units.data ?? []).filter((u) => OCCUPIED_STATUSES.includes((u.occupancy_status ?? "").trim().toLowerCase())).length;

  return {
    delinquencies: (delinquencies.data ?? []) as Delinquency[],
    actions: (actions.data ?? []) as DelinquencyAction[],
    stages: asStages(stages.data ?? []),
    contacts: (contacts.data ?? []) as TenantContact[],
    occupiedManaged,
  };
}
