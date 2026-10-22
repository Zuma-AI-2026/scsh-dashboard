"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Row actions on Sales → Rotation / My leads. The SQL functions decide who may
 * act (require_lead_actor: admin, or the lead's owner with the sales role);
 * this layer only turns their errors into a message next to the row.
 */
export type RowActionState = { ok: boolean; message: string } | null;

const ROW_STATUSES = ["test", "duplicate_of", "not_interested", "leased"] as const;

function positiveId(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function allowed(): Promise<string | null> {
  const user = await requireUser();
  return user.role === "admin" || user.role === "sales" ? null : "Only admins and sales agents can change leads.";
}

function done(message: string): RowActionState {
  revalidatePath("/sales");
  revalidatePath("/admin/agents");
  return { ok: true, message };
}

function clean(message: string): string {
  return message.replace(/^.*?exception:\s*/i, "");
}

export async function setLeadStatusAction(_prev: RowActionState, formData: FormData): Promise<RowActionState> {
  const denied = await allowed();
  if (denied) return { ok: false, message: denied };
  const leadId = positiveId(formData.get("lead_id"));
  const status = String(formData.get("status") ?? "");
  if (!leadId) return { ok: false, message: "Missing lead." };
  if (!(ROW_STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Pick a status." };
  const duplicateOf = status === "duplicate_of" ? positiveId(formData.get("duplicate_of")) : null;
  if (status === "duplicate_of" && !duplicateOf) return { ok: false, message: "Enter the lead # it duplicates." };
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_lead_status", { p_lead_id: leadId, p_status: status, p_reason: reason, p_duplicate_of: duplicateOf });
  if (error) return { ok: false, message: clean(error.message) };
  return done("Status saved.");
}

export async function reassignLeadAction(_prev: RowActionState, formData: FormData): Promise<RowActionState> {
  const denied = await allowed();
  if (denied) return { ok: false, message: denied };
  const leadId = positiveId(formData.get("lead_id"));
  const agentId = positiveId(formData.get("agent_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!leadId || !agentId) return { ok: false, message: "Pick an agent." };
  if (!reason) return { ok: false, message: "A reason is required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reassign_lead", { p_lead_id: leadId, p_agent_id: agentId, p_reason: reason });
  if (error) return { ok: false, message: clean(error.message) };
  return done("Reassigned.");
}
