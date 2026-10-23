"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { parseEmailList } from "@/lib/collections/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin role required.");
  return user;
}

function oneEmail(v: FormDataEntryValue | null, field: string, required: boolean): string | null {
  const list = parseEmailList(typeof v === "string" ? v : "");
  if (!list || list.length > 1) throw new Error(`${field}: enter one valid email address.`);
  if (required && list.length === 0) throw new Error(`${field} is required.`);
  return list[0] ?? null;
}

function refresh() {
  revalidatePath("/admin/collections");
  revalidatePath("/accounting");
}

/** Add a mailbox, or update it when the email already exists. */
export async function saveSender(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = oneEmail(formData.get("email"), "Mailbox", true)!;
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 80);
  if (!displayName) throw new Error("Display name is required.");
  const replyTo = oneEmail(formData.get("reply_to"), "Reply-To", false);
  const signature = String(formData.get("signature") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1000);
  const active = formData.get("active") === "on";

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("collection_senders")
    .upsert({ email, display_name: displayName, reply_to: replyTo, signature, active, updated_by: admin.email, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) throw new Error(`Could not save the sender: ${error.message}`);
  refresh();
}

export async function setDefaultSender(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid sender.");
  const supabase = await createSupabaseServerClient();
  const { error: clearError } = await supabase.from("collection_senders").update({ is_default: false }).eq("is_default", true);
  if (clearError) throw new Error(`Could not change the default: ${clearError.message}`);
  const { error } = await supabase.from("collection_senders").update({ is_default: true, active: true, updated_by: admin.email, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`Could not change the default: ${error.message}`);
  refresh();
}

export async function savePaymentNote(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const note = String(formData.get("payment_note") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("collection_settings").update({ payment_note: note, updated_by: admin.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(`Could not save the payment note: ${error.message}`);
  refresh();
}
