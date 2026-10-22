import "server-only";
import { isCancelledShowing } from "@/lib/sales/analytics";
import type { SalesDataset } from "@/lib/sales/data";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { effectiveStage, resolveDuplicate } from "./rules";
import type { Agent, LeadRecord, LeadView } from "./types";

export type LeadsDataset = {
  agents: Agent[];
  /** Every lead, including test / duplicate (views filter them out). */
  leads: LeadView[];
  byId: Map<number, LeadView>;
  /** AppFolio guest card → surviving lead (duplicates resolved). */
  byCard: Map<number, LeadView>;
  /** AppFolio rental application → surviving lead. */
  byApp: Map<number, LeadView>;
  goLiveAt: string | null;
  testMode: boolean;
};

type Setting = { key: string; value: unknown };

/**
 * Leads with owner names and their AppFolio activity resolved. Pass the Sales
 * dataset to fill tour_booked / application_status (managed properties only);
 * without it those stay empty. Returns null until migrations 0008–0011 are run.
 */
export async function loadLeadsDataset(sales: SalesDataset | null, now = new Date()): Promise<LeadsDataset | null> {
  const supabase = await createSupabaseServerClient();

  const probe = await supabase.from("leads").select("id", { head: true, count: "exact" });
  if (probe.error) {
    console.warn("[leads] not available:", probe.error.message);
    return null;
  }

  const [agentsRes, settingsRes, records, cardLinks, appLinks, qualifying] = await Promise.all([
    supabase.from("agents").select("id, name, email, appfolio_name, active, a_turns, b_turns, last_assigned_at").order("name"),
    supabase.from("app_settings").select("key, value"),
    fetchAll<LeadRecord>("leads", (a, b) => supabase.from("leads").select("*").order("id").range(a, b)),
    fetchAll<{ guest_card_id: number; lead_id: number }>("lead_guest_cards", (a, b) =>
      supabase.from("lead_guest_cards").select("guest_card_id, lead_id").order("guest_card_id").range(a, b),
    ),
    fetchAll<{ rental_application_id: number; guest_card_id: number }>("application_guest_cards", (a, b) =>
      supabase.from("application_guest_cards").select("rental_application_id, guest_card_id").order("rental_application_id").range(a, b),
    ).catch((err: Error) => {
      // View added in 0011; without it only application links are missing.
      console.warn("[leads]", err.message);
      return [];
    }),
    fetchAll<{ id: number; lead_id: number; at: string }>("lead_events", (a, b) =>
      supabase.from("lead_events").select("id, lead_id, at").in("type", ["form", "application"]).order("id").range(a, b),
    ),
  ]);
  if (agentsRes.error) throw new Error(`agents: ${agentsRes.error.message}`);
  if (settingsRes.error) throw new Error(`app_settings: ${settingsRes.error.message}`);

  const agents = (agentsRes.data ?? []) as Agent[];
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const settings = new Map(((settingsRes.data ?? []) as Setting[]).map((s) => [s.key, s.value]));

  const recordById = new Map(records.map((r) => [r.id, r]));
  const rootOf = (leadId: number): number => {
    const r = recordById.get(leadId);
    return r ? resolveDuplicate(r, recordById).id : leadId;
  };

  const cardRoot = new Map(cardLinks.map((l) => [l.guest_card_id, rootOf(l.lead_id)]));
  const appRoot = new Map<number, number>();
  for (const l of appLinks) {
    const root = cardRoot.get(l.guest_card_id);
    if (root !== undefined) appRoot.set(l.rental_application_id, root);
  }

  const qualifiedAt = new Map<number, string>();
  for (const e of qualifying) {
    const root = rootOf(e.lead_id);
    const prev = qualifiedAt.get(root);
    if (!prev || e.at < prev) qualifiedAt.set(root, e.at);
  }

  const toured = new Set<number>();
  const latestApp = new Map<number, { status: string | null; received: string }>();
  if (sales) {
    for (const s of sales.showings) {
      const root = s.guest_card_id === null ? undefined : cardRoot.get(s.guest_card_id);
      if (root !== undefined && !isCancelledShowing(s)) toured.add(root);
    }
    for (const a of sales.applications) {
      const root = appRoot.get(a.rental_application_id);
      if (root === undefined) continue;
      const received = a.received ?? "";
      const prev = latestApp.get(root);
      if (!prev || received > prev.received) latestApp.set(root, { status: a.status, received });
    }
  }

  const leads: LeadView[] = records.map((r) => ({
    ...r,
    owner_name: r.owner_agent_id === null ? null : (agentName.get(r.owner_agent_id) ?? null),
    qualified_at: qualifiedAt.get(r.id) ?? null,
    tour_booked: toured.has(r.id),
    application_status: latestApp.get(r.id)?.status ?? null,
    stage_now: effectiveStage(r, now),
  }));
  const byId = new Map(leads.map((l) => [l.id, l]));
  const pick = (m: Map<number, number>) => {
    const out = new Map<number, LeadView>();
    for (const [k, id] of m) {
      const lead = byId.get(id);
      if (lead) out.set(k, lead);
    }
    return out;
  };

  const goLive = settings.get("leads_go_live_at");
  return {
    agents,
    leads,
    byId,
    byCard: pick(cardRoot),
    byApp: pick(appRoot),
    goLiveAt: typeof goLive === "string" ? goLive : null,
    testMode: settings.get("notifications_test_mode") === true,
  };
}
