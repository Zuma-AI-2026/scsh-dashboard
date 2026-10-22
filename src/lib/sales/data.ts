import "server-only";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Application, GuestCard, GuestCardInterest, Showing, Unit } from "./types";

export type SalesDataset = {
  availableUnits: Unit[];
  leads: GuestCard[];
  leadInterests: GuestCardInterest[];
  showings: Showing[];
  applications: Application[];
};

/**
 * Loads everything the Sales section needs in one go. All reads go through
 * the managed_* views (is_managed = true enforced in SQL) with the user's
 * session, so RLS applies. The dataset is small (~119 units, a few thousand
 * guest cards), so filtering/sorting happens in memory. Paged because the
 * API caps a single response at 1,000 rows.
 */
export async function loadSalesDataset(): Promise<SalesDataset> {
  const supabase = await createSupabaseServerClient();

  const [availableUnits, leads, leadInterests, showings, applications] = await Promise.all([
    fetchAll<Unit>("available_units", (a, b) => supabase.from("available_units").select("*").order("property_name").order("unit_name").order("unit_id").range(a, b)),
    fetchAll<GuestCard>("managed_guest_cards", (a, b) =>
      supabase.from("managed_guest_cards").select("*").order("received", { ascending: false, nullsFirst: false }).order("guest_card_id").range(a, b),
    ),
    fetchAll<GuestCardInterest>("managed_guest_card_interests", (a, b) =>
      supabase
        .from("managed_guest_card_interests")
        .select("*")
        .order("received", { ascending: false, nullsFirst: false })
        .order("guest_card_id")
        .order("property_id")
        .order("row_index")
        .range(a, b),
    ),
    fetchAll<Showing>("managed_showings", (a, b) =>
      supabase.from("managed_showings").select("*").order("showing_time", { ascending: false, nullsFirst: false }).order("showing_id").range(a, b),
    ),
    fetchAll<Application>("managed_applications", (a, b) =>
      supabase.from("managed_applications").select("*").order("received", { ascending: false, nullsFirst: false }).order("rental_application_id").range(a, b),
    ),
  ]);

  return { availableUnits, leads, leadInterests, showings, applications };
}
