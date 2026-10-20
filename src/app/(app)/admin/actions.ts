"use server";

import { revalidatePath } from "next/cache";
import { syncSales } from "@/lib/appfolio/sync";
import { normalizeEmail } from "@/lib/auth/allowed-domains";
import { requireUser } from "@/lib/auth/current-user";
import { isAppRole } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin role required.");
  return user;
}

/** "Sync now" — runs the same code as /api/cron/sync-sales. Result lands in sync_state.detail. */
export async function runSyncNow(): Promise<void> {
  await requireAdmin();
  await syncSales();
  revalidatePath("/", "layout");
}

/** Flip a property's is_managed flag and mark it reviewed. */
export async function setPropertyManaged(formData: FormData): Promise<void> {
  await requireAdmin();
  const propertyId = Number(formData.get("property_id"));
  const isManaged = formData.get("is_managed") === "true";
  if (!Number.isInteger(propertyId)) throw new Error("Invalid property id.");

  // Uses the user's session: the properties_admin_update RLS policy enforces admin.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("properties")
    .update({ is_managed: isManaged, managed_reviewed_at: new Date().toISOString() })
    .eq("property_id", propertyId);
  if (error) throw new Error(`Could not update property: ${error.message}`);

  revalidatePath("/", "layout");
}

/** Mark one property reviewed without changing is_managed. */
export async function confirmPropertyReviewed(formData: FormData): Promise<void> {
  await requireAdmin();
  const propertyId = Number(formData.get("property_id"));
  if (!Number.isInteger(propertyId)) throw new Error("Invalid property id.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("properties")
    .update({ managed_reviewed_at: new Date().toISOString() })
    .eq("property_id", propertyId);
  if (error) throw new Error(`Could not confirm property: ${error.message}`);

  revalidatePath("/", "layout");
}

/** Mark every still-pending property as reviewed, leaving is_managed as-is. */
export async function confirmAllPendingProperties(): Promise<void> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("properties")
    .update({ managed_reviewed_at: new Date().toISOString() })
    .is("managed_reviewed_at", null);
  if (error) throw new Error(`Could not confirm pending properties: ${error.message}`);

  revalidatePath("/", "layout");
}

/** Change an existing user's role. Admins cannot change their own role here. */
export async function setUserRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = formData.get("role");
  if (!email.includes("@")) throw new Error("Invalid email.");
  if (!isAppRole(role)) throw new Error("Invalid role.");
  if (email === admin.email) throw new Error("You cannot change your own role.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("app_users").update({ role }).eq("email", email);
  if (error) throw new Error(`Could not update role: ${error.message}`);

  revalidatePath("/admin/users");
}

/** Add an email that may sign in even if it isn't on a company domain. */
export async function addAllowedEmail(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = formData.get("role");
  if (!email.includes("@") || !email.includes(".")) throw new Error("Enter a full email address.");
  if (!isAppRole(role)) throw new Error("Invalid role.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("allowed_emails").upsert({ email, role, added_by: admin.email }, { onConflict: "email" });
  if (error) throw new Error(`Could not allowlist email: ${error.message}`);

  revalidatePath("/admin/users");
}

export async function removeAllowedEmail(formData: FormData): Promise<void> {
  await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email.includes("@")) throw new Error("Invalid email.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("allowed_emails").delete().eq("email", email);
  if (error) throw new Error(`Could not remove allowlisted email: ${error.message}`);

  revalidatePath("/admin/users");
}
