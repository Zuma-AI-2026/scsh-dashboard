"use server";

import { revalidatePath } from "next/cache";
import { withDerived } from "@/lib/accounting/analytics";
import { loadAccountingDataset } from "@/lib/accounting/data";
import { requireUser } from "@/lib/auth/current-user";
import { canWriteFollowUp } from "@/lib/auth/roles";
import { isFollowUpAction } from "@/lib/accounting/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BACKFILL_NOTE = "Backfilled at go-live";

/**
 * Admin only: log each selected row's current stage as done. Stages are
 * recomputed server-side; rows whose current stage is already logged are skipped.
 */
export async function bulkMarkCurrentStageDone(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin role required.");

  const selected = new Set(
    formData
      .getAll("occupancy_id")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  if (selected.size === 0) throw new Error("Select at least one row.");

  const rows = withDerived(await loadAccountingDataset()).filter((r) => selected.has(r.occupancy_id) && r.next_action_due);
  if (rows.length === 0) {
    revalidatePath("/accounting");
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("delinquency_actions").insert(
    rows.map((r) => ({
      occupancy_id: r.occupancy_id,
      action: r.next_action_due!.action_label,
      note: BACKFILL_NOTE,
      acted_by: user.email,
      stage_id: r.next_action_due!.id,
    })),
  );
  if (error) throw new Error(`Could not backfill: ${error.message}`);

  revalidatePath("/accounting");
}

export async function addDelinquencyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canWriteFollowUp(user.role)) throw new Error("Accounting role required to log follow-up.");

  const occupancyId = Number(formData.get("occupancy_id"));
  const action = formData.get("action");
  const noteRaw = formData.get("note");
  const stageRaw = formData.get("stage_id");
  if (!Number.isInteger(occupancyId) || occupancyId <= 0) throw new Error("Invalid occupancy.");
  if (!isFollowUpAction(action)) throw new Error("Pick a follow-up action.");
  const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 2000) : null;

  let stageId: number | null = null;
  if (typeof stageRaw === "string" && stageRaw !== "") {
    const n = Number(stageRaw);
    if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid stage.");
    stageId = n;
  }

  const supabase = await createSupabaseServerClient();
  if (stageId !== null) {
    const { data: stage, error: stageError } = await supabase.from("delinquency_stages").select("id").eq("id", stageId).maybeSingle();
    if (stageError) throw new Error(`Could not check stage: ${stageError.message}`);
    if (!stage) throw new Error("Unknown stage.");
  }

  const { error } = await supabase.from("delinquency_actions").insert({
    occupancy_id: occupancyId,
    action,
    note,
    acted_by: user.email,
    stage_id: stageId,
  });
  if (error) throw new Error(`Could not save follow-up: ${error.message}`);

  revalidatePath("/accounting");
}
