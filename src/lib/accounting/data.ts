import "server-only";
import type { ReminderMessage } from "@/lib/collections/contact";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerType, type DelinquencyStage } from "./ladder";
import { OCCUPIED_STATUSES, type Delinquency, type DelinquencyAction, type TenantContact } from "./types";

export type AccountingDataset = {
  delinquencies: Delinquency[];
  actions: DelinquencyAction[];
  stages: DelinquencyStage[];
  contacts: TenantContact[];
  messages: ReminderMessage[];
  /** False until migration 0017 (payment reminders) is applied. */
  remindersReady: boolean;
  occupiedManaged: number;
};

const MAX_ROWS = 10_000;
const MESSAGE_COLUMNS = "id, created_at, sent_by, channel, occupancy_id, sender, to, cc, subject, total_cents, status";

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
  // Payment-reminder columns/tables arrive with migration 0017; until then the page works without them.
  const messagesQuery = supabase.from("collection_messages").select(MESSAGE_COLUMNS).order("created_at", { ascending: false }).limit(MAX_ROWS);
  const actionsQuery = (extra: string) =>
    supabase.from("delinquency_actions").select(`id, occupancy_id, action, note, acted_by, acted_at, stage_id${extra}`).order("acted_at", { ascending: false }).limit(MAX_ROWS);
  const contactsQuery = (extra: string) => supabase.from("tenant_contacts").select(`occupancy_id, tenant_id, tenant, phone_numbers, emails, primary_tenant${extra}`).limit(MAX_ROWS);

  const [delinquencies, stages, units, messages] = await Promise.all([
    supabase.from("managed_delinquencies").select("*").order("amount_receivable", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    supabase.from("delinquency_stages").select("id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active").order("sort_order"),
    supabase.from("managed_units").select("unit_id, occupancy_status").limit(MAX_ROWS),
    messagesQuery,
  ]);
  const remindersReady = !messages.error;
  const [actions, contacts] = await Promise.all([
    actionsQuery(remindersReady ? ", collection_message_id" : ""),
    contactsQuery(remindersReady ? ", tenant_type" : ""),
  ]);

  for (const r of [delinquencies, actions, stages, contacts, units]) {
    if (r.error) throw new Error(`Accounting data: ${r.error.message}`);
  }

  const occupiedManaged = (units.data ?? []).filter((u) => OCCUPIED_STATUSES.includes((u.occupancy_status ?? "").trim().toLowerCase())).length;

  return {
    delinquencies: (delinquencies.data ?? []) as Delinquency[],
    actions: (actions.data ?? []) as unknown as DelinquencyAction[],
    stages: asStages(stages.data ?? []),
    contacts: (contacts.data ?? []) as unknown as TenantContact[],
    messages: remindersReady ? ((messages.data ?? []) as unknown as ReminderMessage[]) : [],
    remindersReady,
    occupiedManaged,
  };
}
