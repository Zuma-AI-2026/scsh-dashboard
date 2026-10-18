import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Application, GuestCard, Showing, Unit } from "./types";

export type SalesDataset = {
  availableUnits: Unit[];
  leads: GuestCard[];
  showings: Showing[];
  applications: Application[];
};

const MAX_ROWS = 5000;

/**
 * Loads everything the Sales section needs in one go. All reads go through
 * the managed_* views (is_managed = true enforced in SQL) with the user's
 * session, so RLS applies. The dataset is small (~119 units, a season of
 * leads), so filtering/sorting happens in memory.
 */
export async function loadSalesDataset(): Promise<SalesDataset> {
  const supabase = await createSupabaseServerClient();

  const [units, leads, showings, applications] = await Promise.all([
    supabase.from("available_units").select("*").order("property_name").order("unit_name").limit(MAX_ROWS),
    supabase.from("managed_guest_cards").select("*").order("received", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    supabase.from("managed_showings").select("*").order("showing_time", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    supabase.from("managed_applications").select("*").order("received", { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
  ]);

  for (const r of [units, leads, showings, applications]) {
    if (r.error) throw new Error(`Sales data: ${r.error.message}`);
  }

  return {
    availableUnits: (units.data ?? []) as Unit[],
    leads: (leads.data ?? []) as GuestCard[],
    showings: (showings.data ?? []) as Showing[],
    applications: (applications.data ?? []) as Application[],
  };
}
