"use server";

import { revalidatePath } from "next/cache";
import { syncSales } from "@/lib/appfolio/sync";
import { requireUser } from "@/lib/auth/current-user";
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
