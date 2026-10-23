import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SelectedCharge } from "./charges";
import { loadReminderSetup, SetupError, type ReminderSetup } from "./data";
import { reminderAccess, type ReminderAccess } from "./request";

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Signed-in user with at least `level`; otherwise the 401/403 response to return. */
export async function reminderUser(level: Exclude<ReminderAccess, "none">): Promise<{ user: CurrentUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Sign in again.", 401) };
  const access = reminderAccess(user.role);
  if (access === "none" || (level === "send" && access !== "send")) {
    return { response: jsonError(level === "send" ? "Only admin and accounting can send payment reminders." : "No access to payment reminders.", 403) };
  }
  return { user };
}

export async function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export async function setupOrResponse(occupancyId: number): Promise<{ setup: ReminderSetup } | { response: NextResponse }> {
  try {
    return { setup: await loadReminderSetup(occupancyId) };
  } catch (e) {
    if (e instanceof SetupError) return { response: jsonError(e.message, e.status) };
    throw e;
  }
}

export type ReminderLog = {
  channel: "email" | "text";
  status: "drafted" | "sent" | "failed" | "text_opened";
  sender: string | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string | null;
  body: string;
  tone: string;
  charges: SelectedCharge[];
  totalCents: number;
  error?: string;
};

/**
 * One reminder → one collection_messages row, and (unless it failed) one
 * delinquency_actions row for the current stage so the Overdue badge clears.
 */
export async function recordReminder(user: CurrentUser, setup: ReminderSetup, log: ReminderLog): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("collection_messages")
    .insert({
      sent_by: user.email,
      channel: log.channel,
      occupancy_id: setup.occupancyId,
      tenant: setup.tenant,
      property: setup.property,
      unit: setup.unit,
      sender: log.sender,
      to: log.to,
      cc: log.cc,
      reply_to: log.replyTo,
      subject: log.subject,
      body: log.body,
      tone: log.tone || null,
      charges: log.charges.map((c) => ({ id: c.id, description: c.description, amount: c.amount_cents / 100 })),
      total_cents: log.totalCents,
      status: log.status,
      error: log.error ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not log the reminder: ${error.message}`);
  const id = data.id as number;

  if (log.status !== "failed") {
    const firstLine = log.body.split("\n").find((l) => l.trim())?.trim() ?? null;
    const { error: actionError } = await supabase.from("delinquency_actions").insert({
      occupancy_id: setup.occupancyId,
      action: log.channel === "email" ? "Emailed" : "Texted",
      note: (log.subject || firstLine)?.slice(0, 300) ?? null,
      acted_by: user.email,
      stage_id: setup.stage?.id ?? null,
      collection_message_id: id,
    });
    if (actionError) throw new Error(`Reminder logged, but the follow-up entry failed: ${actionError.message}`);
  }
  return id;
}

export async function rememberRecipients(user: CurrentUser, occupancyId: number, to: string[], cc: string[]): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("collection_recipients")
    .upsert({ occupancy_id: occupancyId, to_emails: to, cc_emails: cc, updated_by: user.email, updated_at: new Date().toISOString() }, { onConflict: "occupancy_id" });
  if (error) console.error("[reminders] could not remember recipients:", error.message);
}
