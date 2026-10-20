"use server";

import { revalidatePath } from "next/cache";
import { isOwnerType, isMessageTone, triggerDaysIncreasingError, type DelinquencyStage } from "@/lib/accounting/ladder";
import { requireUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin role required.");
  return user;
}

async function loadStages() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delinquency_stages")
    .select("id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active")
    .order("sort_order");
  if (error) throw new Error(`Could not load stages: ${error.message}`);
  return (data ?? []) as DelinquencyStage[];
}

function revalidate() {
  revalidatePath("/admin/delinquency-ladder");
  revalidatePath("/accounting");
}

/** Save every stage from the ladder form. Trigger days must strictly increase by sort_order. */
export async function saveLadder(formData: FormData): Promise<void> {
  await requireAdmin();
  const ids = formData.getAll("id").map((v) => Number(v));
  const names = formData.getAll("name").map((v) => String(v).trim());
  const days = formData.getAll("trigger_day").map((v) => Number(v));
  const owners = formData.getAll("owner_type");
  const labels = formData.getAll("action_label").map((v) => String(v).trim());
  const tones = formData.getAll("message_tone");
  const actives = formData.getAll("is_active");
  const orders = formData.getAll("sort_order").map((v) => Number(v));

  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n))) throw new Error("Invalid stage list.");
  if ([names, days, owners, labels, tones, actives, orders].some((a) => a.length !== ids.length)) {
    throw new Error("Ladder form was incomplete. Reload and try again.");
  }

  const parsed: DelinquencyStage[] = ids.map((id, i) => {
    const name = names[i];
    const trigger_day = days[i];
    const owner_type = owners[i];
    const action_label = labels[i] || name;
    const toneRaw = tones[i];
    const is_active = String(actives[i]) === "true";
    const sort_order = orders[i];
    if (!name) throw new Error("Every stage needs a name.");
    if (!Number.isInteger(trigger_day) || trigger_day < 0) throw new Error(`Invalid day for ${name}.`);
    if (!isOwnerType(owner_type)) throw new Error(`Invalid owner type for ${name}.`);
    if (!Number.isInteger(sort_order)) throw new Error("Invalid ladder order.");
    const message_tone = toneRaw === "" || toneRaw === "none" ? null : isMessageTone(toneRaw) ? toneRaw : null;
    if (toneRaw && toneRaw !== "none" && toneRaw !== "" && !isMessageTone(toneRaw)) throw new Error(`Invalid tone for ${name}.`);
    return { id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active };
  });

  const increasing = triggerDaysIncreasingError(parsed);
  if (increasing) throw new Error(increasing);

  const supabase = await createSupabaseServerClient();
  for (const s of parsed) {
    const { error } = await supabase
      .from("delinquency_stages")
      .update({
        name: s.name,
        trigger_day: s.trigger_day,
        owner_type: s.owner_type,
        action_label: s.action_label,
        message_tone: s.message_tone,
        is_active: s.is_active,
        sort_order: s.sort_order,
      })
      .eq("id", s.id);
    if (error) throw new Error(`Could not save ${s.name}: ${error.message}`);
  }

  revalidate();
}

/** Swap sort_order with the adjacent stage. Rejected if trigger days would no longer increase. */
export async function moveStage(formData: FormData): Promise<void> {
  await requireAdmin();
  const [idRaw, dir] = String(formData.get("move") ?? "").split(":");
  const id = Number(idRaw);
  if (!Number.isInteger(id) || (dir !== "up" && dir !== "down")) throw new Error("Invalid move.");

  const stages = await loadStages();
  const i = stages.findIndex((s) => s.id === id);
  if (i < 0) throw new Error("Unknown stage.");
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= stages.length) return;

  const a = stages[i];
  const b = stages[j];
  // Swap both order and day so the ladder stays strictly increasing and the
  // stage (name/owner/tone) moves to the neighboring day slot.
  const swapped = stages.map((s) => {
    if (s.id === a.id) return { ...s, sort_order: b.sort_order, trigger_day: b.trigger_day };
    if (s.id === b.id) return { ...s, sort_order: a.sort_order, trigger_day: a.trigger_day };
    return s;
  });
  const increasing = triggerDaysIncreasingError(swapped);
  if (increasing) throw new Error(increasing);

  const supabase = await createSupabaseServerClient();
  const { error: e1 } = await supabase.from("delinquency_stages").update({ sort_order: b.sort_order, trigger_day: b.trigger_day }).eq("id", a.id);
  if (e1) throw new Error(`Could not reorder: ${e1.message}`);
  const { error: e2 } = await supabase.from("delinquency_stages").update({ sort_order: a.sort_order, trigger_day: a.trigger_day }).eq("id", b.id);
  if (e2) throw new Error(`Could not reorder: ${e2.message}`);

  revalidate();
}
