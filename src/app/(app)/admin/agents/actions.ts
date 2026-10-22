"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { LEAD_STATUSES, normalizeEmail } from "@/lib/leads/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Every write below goes through the user's session: RLS (agents, app_settings)
// and the SQL functions (reassign_lead, set_lead_status, bulk_assign_leads)
// re-check the admin role and log who did it.

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin role required.");
  return user;
}

function refresh() {
  revalidatePath("/admin/agents");
  revalidatePath("/sales");
}

function id(value: FormDataEntryValue | null, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${what}.`);
  return n;
}

function reasonOf(formData: FormData): string {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("A reason is required.");
  return reason;
}

/** Add an agent, or update name / AppFolio name of an existing one (matched by email). */
export async function saveAgent(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const appfolioName = String(formData.get("appfolio_name") ?? "").trim() || null;
  if (!name) throw new Error("Name is required.");
  if (!email) throw new Error("Enter a valid email.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("agents").upsert({ name, email, appfolio_name: appfolioName }, { onConflict: "email" });
  if (error) throw new Error(`Could not save agent: ${error.message}`);
  refresh();
}

/** Deactivated agents get no new leads; leads they own keep their owner. */
export async function setAgentActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const agentId = id(formData.get("agent_id"), "agent");
  const active = formData.get("active") === "true";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("agents").update({ active }).eq("id", agentId);
  if (error) throw new Error(`Could not update agent: ${error.message}`);
  refresh();
}

/** Returned to n8n as test_mode on every webhook response. */
export async function setTestMode(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const on = formData.get("test_mode") === "true";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "notifications_test_mode", value: on, updated_by: admin.email }, { onConflict: "key" });
  if (error) throw new Error(`Could not change test mode: ${error.message}`);
  refresh();
}

/** Where n8n sends every notice while test mode is on (returned as test_recipient). */
export async function setTestRecipient(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(formData.get("test_recipient") ?? ""));
  if (!email) throw new Error("Enter a valid email.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "notifications_test_recipient", value: email, updated_by: admin.email }, { onConflict: "key" });
  if (error) throw new Error(`Could not save the test inbox: ${error.message}`);
  refresh();
}

/** Unassigned leads → one agent. No turn is consumed. */
export async function bulkAssignLeads(formData: FormData): Promise<void> {
  await requireAdmin();
  const agentId = id(formData.get("agent_id"), "agent");
  const leadIds = formData.getAll("lead_id").map((v) => id(v, "lead"));
  if (leadIds.length === 0) throw new Error("Select at least one lead.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("bulk_assign_leads", { p_lead_ids: leadIds, p_agent_id: agentId });
  if (error) throw new Error(`Could not assign leads: ${error.message}`);
  refresh();
}

export async function reassignLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = id(formData.get("lead_id"), "lead");
  const agentId = id(formData.get("agent_id"), "agent");
  const reason = reasonOf(formData);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reassign_lead", { p_lead_id: leadId, p_agent_id: agentId, p_reason: reason });
  if (error) throw new Error(`Could not reassign: ${error.message}`);
  refresh();
}

export async function setLeadStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = id(formData.get("lead_id"), "lead");
  const status = String(formData.get("status") ?? "");
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status.");
  const reason = reasonOf(formData);
  const dupRaw = String(formData.get("duplicate_of") ?? "").trim();
  const duplicateOf = status === "duplicate_of" ? id(dupRaw, "duplicate-of lead id") : null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_lead_status", { p_lead_id: leadId, p_status: status, p_reason: reason, p_duplicate_of: duplicateOf });
  if (error) throw new Error(`Could not change status: ${error.message}`);
  refresh();
}
