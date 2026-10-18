import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SyncState = {
  key: string;
  last_synced_at: string | null;
  last_status: "success" | "error" | "running" | null;
  detail: Record<string, unknown> | null;
};

/** Reads the latest sync status for a group (e.g. "sales"). Null if never synced. */
export async function getSyncState(key: string): Promise<SyncState | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sync_state")
    .select("key, last_synced_at, last_status, detail")
    .eq("key", key)
    .maybeSingle();
  return (data as SyncState | null) ?? null;
}
