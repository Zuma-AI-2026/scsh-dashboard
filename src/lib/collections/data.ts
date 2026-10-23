import "server-only";
import { currentStageOf, isOwnerType, type DelinquencyStage } from "@/lib/accounting/ladder";
import { daysPastDue } from "@/lib/appfolio/mappers/delinquency";
import type { DelinquencyRow } from "@/lib/appfolio/mappers/delinquency";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCents, type OpenCharge } from "./charges";
import { contactChips, type ContactChip } from "./contacts";
import { lastContactByOccupancy, type LastContact, type LoggedAction, type ReminderMessage } from "./contact";
import type { Sender } from "./request";

export const MESSAGE_COLUMNS = "id, created_at, sent_by, channel, occupancy_id, sender, to, cc, subject, total_cents, status";

export type ReminderSetup = {
  occupancyId: number;
  tenant: string | null;
  property: string | null;
  unit: string | null;
  stage: Pick<DelinquencyStage, "id" | "name" | "owner_type" | "message_tone"> | null;
  daysPastDue: number | null;
  openCharges: OpenCharge[];
  emailChips: ContactChip[];
  phoneChips: ContactChip[];
  remembered: { to: string[]; cc: string[] } | null;
  senders: Sender[];
  defaultSenderId: number | null;
  paymentNote: string;
  history: ReminderMessage[];
  lastContact: LastContact | null;
};

export class SetupError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function missingTable(message: string): boolean {
  return /does not exist|schema cache|Could not find the table/i.test(message);
}

/** Everything the composer and the send route need for one occupancy, loaded with the user's session (RLS applies). */
export async function loadReminderSetup(occupancyId: number, now = new Date()): Promise<ReminderSetup> {
  const supabase = await createSupabaseServerClient();
  const [row, stages, actions, charges, contacts, remembered, senders, settings, history] = await Promise.all([
    supabase.from("managed_delinquencies").select("*").eq("occupancy_id", occupancyId).maybeSingle(),
    supabase.from("delinquency_stages").select("id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active").order("sort_order"),
    supabase.from("delinquency_actions").select("occupancy_id, action, acted_by, acted_at, collection_message_id").eq("occupancy_id", occupancyId),
    supabase.from("open_charges").select("txn_id, occupancy_id, description, occurred_on, amount").eq("occupancy_id", occupancyId),
    supabase.from("tenant_contacts").select("tenant, emails, phone_numbers, tenant_type, primary_tenant").eq("occupancy_id", occupancyId),
    supabase.from("collection_recipients").select("to_emails, cc_emails").eq("occupancy_id", occupancyId).maybeSingle(),
    supabase.from("collection_senders").select("id, email, display_name, reply_to, signature, active, is_default").eq("active", true).order("id"),
    supabase.from("collection_settings").select("payment_note").eq("id", 1).maybeSingle(),
    supabase.from("collection_messages").select(MESSAGE_COLUMNS).eq("occupancy_id", occupancyId).order("created_at", { ascending: false }).limit(50),
  ]);

  for (const r of [row, stages, actions, charges, contacts, remembered, senders, settings, history]) {
    if (r.error) {
      if (missingTable(r.error.message)) throw new SetupError("Payment reminders need migration 0017. Ask an admin to run it.", 503);
      throw new SetupError(`Could not load the reminder: ${r.error.message}`);
    }
  }
  if (!row.data) throw new SetupError("This occupancy is not on the delinquency list any more.", 404);

  const d = row.data as DelinquencyRow & { property_name: string | null };
  const days = daysPastDue(d, now);
  const ladder = ((stages.data ?? []) as DelinquencyStage[]).filter((s) => isOwnerType(s.owner_type));
  const stage = currentStageOf(ladder, days);
  const chips = contactChips(contacts.data ?? []);
  const msgs = (history.data ?? []) as ReminderMessage[];
  const senderRows = (senders.data ?? []) as (Sender & { is_default: boolean })[];

  return {
    occupancyId,
    tenant: d.tenant,
    property: d.property_name,
    unit: d.unit_name,
    stage: stage ? { id: stage.id, name: stage.name, owner_type: stage.owner_type, message_tone: stage.message_tone } : null,
    daysPastDue: days,
    openCharges: (charges.data ?? []).map((c) => ({
      id: Number(c.txn_id),
      occupancy_id: c.occupancy_id as number,
      description: c.description as string | null,
      occurred_on: c.occurred_on as string | null,
      amount_cents: toCents(Number(c.amount)),
    })),
    emailChips: chips.emails,
    phoneChips: chips.phones,
    remembered: remembered.data ? { to: remembered.data.to_emails ?? [], cc: remembered.data.cc_emails ?? [] } : null,
    senders: senderRows.map((s) => ({ id: s.id, email: s.email, display_name: s.display_name, reply_to: s.reply_to, signature: s.signature, active: s.active })),
    defaultSenderId: senderRows.find((s) => s.is_default)?.id ?? senderRows[0]?.id ?? null,
    paymentNote: (settings.data?.payment_note as string | undefined) ?? "",
    history: msgs,
    lastContact: lastContactByOccupancy(msgs, (actions.data ?? []) as LoggedAction[]).get(occupancyId) ?? null,
  };
}
