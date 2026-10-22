import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppfolioError, type ReportRow } from "./client";
import { mapApplication } from "./mappers/applications";
import { leaseByOccupancy, mapDelinquency, oldestInvoiceByOccupancy, type DelinquencyRow } from "./mappers/delinquency";
import { mapGuestCards } from "./mappers/guest-cards";
import { mapTenantContact, occupancyIdsFromDelinquency } from "./mappers/tenant-contacts";
import { mapProperty } from "./mappers/properties";
import { mapShowing } from "./mappers/showings";
import { mergeUnits } from "./mappers/units";
import { PAUSE_BETWEEN_REPORTS_MS, paramsFor, salesDateRange, SYNCED_REPORTS, type ReportSpec, type SyncedReportName } from "./reports";
import { runReport } from "./runReport";

export type ReportOutcome = {
  report: SyncedReportName;
  status: "success" | "error";
  rows: number;
  pages: number;
  durationMs: number;
  /** Exactly what was sent in the request body (AppFolio ignores unknown keys silently). */
  params: Record<string, unknown>;
  rawStored: boolean;
  error?: string;
};

export type TableOutcome = {
  table: "properties" | "units" | "guest_cards" | "guest_card_interests" | "showings" | "applications" | "delinquencies" | "tenant_contacts" | "leads";
  status: "success" | "error" | "skipped";
  written: number;
  note?: string;
  error?: string;
};

export type SalesSyncResult = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "error";
  dateRange: { from: string; to: string };
  reports: ReportOutcome[];
  tables: TableOutcome[];
};

const UPSERT_BATCH = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pull(spec: ReportSpec, syncedAt: string, admin: SupabaseClient): Promise<{ rows: ReportRow[]; outcome: ReportOutcome }> {
  const t0 = Date.now();
  const params = paramsFor(spec);
  const base = { report: spec.name, params, rawStored: false } as const;

  try {
    const { rows, pages } = await runReport(spec.name, params);

    let rawStored = false;
    if (spec.storeRaw) {
      const { error } = await admin.rpc("replace_raw_rows", { p_report: spec.name, p_rows: rows, p_synced_at: syncedAt });
      if (error) throw new Error(`replace_raw_rows(${spec.name}): ${error.message}`);
      rawStored = true;
    }

    return { rows, outcome: { ...base, status: "success", rows: rows.length, pages, durationMs: Date.now() - t0, rawStored } };
  } catch (err) {
    const error = err instanceof AppfolioError ? `HTTP ${err.status}: ${err.body.slice(0, 300)}` : err instanceof Error ? err.message : String(err);
    console.error(`[sync] ${spec.name} failed:`, error);
    return { rows: [], outcome: { ...base, status: "error", rows: 0, pages: 0, durationMs: Date.now() - t0, error } };
  }
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

async function upsertAll(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

/** Full-replace semantics: upsert everything seen this run, then prune older rows. */
async function replaceTable(admin: SupabaseClient, table: TableOutcome["table"], pk: string, rows: Record<string, unknown>[], syncedAt: string): Promise<TableOutcome> {
  try {
    const stamped = rows.map((r) => ({ ...r, synced_at: syncedAt }));
    await upsertAll(admin, table, stamped, pk);
    const { error } = await admin.from(table).delete().lt("synced_at", syncedAt);
    if (error) throw new Error(`prune ${table}: ${error.message}`);
    return { table, status: "success", written: rows.length };
  } catch (err) {
    return { table, status: "error", written: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * properties: never pruned, and our own flags are preserved.
 *  - very first sync (table empty): every property is_managed = true
 *  - later syncs: NEW properties default to is_managed = false, managed_reviewed_at = null
 *  - existing rows: only AppFolio columns are refreshed
 */
async function writeProperties(admin: SupabaseClient, rows: ReportRow[], syncedAt: string): Promise<TableOutcome> {
  try {
    const mapped = rows.map(mapProperty).filter((p): p is NonNullable<typeof p> => p !== null);
    const { data: existingRows, error } = await admin.from("properties").select("property_id");
    if (error) throw new Error(`read properties: ${error.message}`);
    const existing = new Set((existingRows ?? []).map((r) => r.property_id as number));
    const firstSync = existing.size === 0;

    const toUpdate = mapped.filter((p) => existing.has(p.property_id)).map((p) => ({ ...p, synced_at: syncedAt }));
    const toInsert = mapped
      .filter((p) => !existing.has(p.property_id))
      .map((p) => ({ ...p, synced_at: syncedAt, is_managed: firstSync, managed_reviewed_at: null, first_seen_at: syncedAt }));

    await upsertAll(admin, "properties", toUpdate, "property_id");
    if (toInsert.length) {
      const { error: insErr } = await admin.from("properties").insert(toInsert);
      if (insErr) throw new Error(`insert properties: ${insErr.message}`);
    }
    return {
      table: "properties",
      status: "success",
      written: mapped.length,
      note: firstSync
        ? `first sync: ${toInsert.length} properties marked is_managed=true (review them in /admin/properties)`
        : `${toUpdate.length} refreshed, ${toInsert.length} new (is_managed=false, pending review)`,
    };
  } catch (err) {
    return { table: "properties", status: "error", written: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function syncSales(): Promise<SalesSyncResult> {
  const admin = createSupabaseAdminClient();
  const started = new Date();
  const startedAt = started.toISOString();

  await admin.from("sync_state").upsert({ key: "sales", last_status: "running" }, { onConflict: "key" });

  // 1. Pull reports sequentially with a pause (rate limits).
  const pulled = new Map<SyncedReportName, ReportRow[]>();
  const reports: ReportOutcome[] = [];
  for (const [i, spec] of SYNCED_REPORTS.entries()) {
    if (i > 0) await sleep(PAUSE_BETWEEN_REPORTS_MS);
    const { rows, outcome } = await pull(spec, startedAt, admin);
    reports.push(outcome);
    if (outcome.status === "success") pulled.set(spec.name, rows);
  }
  const ok = (name: SyncedReportName) => pulled.has(name);

  // 2. Write clean tables. Each depends on its source report(s) having succeeded.
  const tables: TableOutcome[] = [];

  tables.push(
    ok("property_directory")
      ? await writeProperties(admin, pulled.get("property_directory")!, startedAt)
      : { table: "properties", status: "skipped", written: 0, note: "property_directory failed" },
  );

  if (ok("unit_directory") && ok("unit_vacancy") && ok("rent_roll")) {
    const units = mergeUnits(pulled.get("unit_directory")!, pulled.get("unit_vacancy")!, pulled.get("rent_roll")!);
    tables.push(await replaceTable(admin, "units", "unit_id", units, startedAt));
  } else {
    tables.push({ table: "units", status: "skipped", written: 0, note: "needs unit_directory + unit_vacancy + rent_roll" });
  }

  if (ok("guest_cards")) {
    tables.push(...(await writeGuestCards(admin, pulled.get("guest_cards")!, startedAt)));
  } else {
    tables.push({ table: "guest_cards", status: "skipped", written: 0, note: "guest_cards failed" });
    tables.push({ table: "guest_card_interests", status: "skipped", written: 0, note: "guest_cards failed" });
  }
  tables.push(
    ok("showings")
      ? await replaceTable(admin, "showings", "showing_id", mapAll(pulled.get("showings")!, mapShowing), startedAt)
      : { table: "showings", status: "skipped", written: 0, note: "showings failed" },
  );
  tables.push(
    ok("rental_applications")
      ? await replaceTable(admin, "applications", "rental_application_id", mapAll(pulled.get("rental_applications")!, mapApplication), startedAt)
      : { table: "applications", status: "skipped", written: 0, note: "rental_applications failed" },
  );

  if (ok("delinquency")) {
    tables.push(await writeDelinquencies(admin, pulled.get("delinquency")!, pulled.get("rent_roll") ?? [], pulled.get("aged_receivables_detail") ?? [], startedAt));
  } else {
    tables.push({ table: "delinquencies", status: "skipped", written: 0, note: "delinquency failed" });
  }

  if (ok("delinquency") && ok("tenant_directory")) {
    tables.push(await writeTenantContacts(admin, pulled.get("tenant_directory")!, pulled.get("delinquency")!, startedAt));
  } else {
    tables.push({
      table: "tenant_contacts",
      status: "skipped",
      written: 0,
      note: !ok("delinquency") ? "delinquency failed" : "tenant_directory failed",
    });
  }

  // Leads are derived from the tables above; a failed guest_cards pull would
  // look like "no new inquiries", so skip rather than import a partial picture.
  const guestCardsWritten = tables.some((t) => t.table === "guest_cards" && t.status === "success");
  tables.push(
    guestCardsWritten ? await importLeads(admin) : { table: "leads", status: "skipped", written: 0, note: "guest_cards not written this run" },
  );

  // 3. Record state.
  const finished = new Date();
  const anyError = reports.some((r) => r.status === "error") || tables.some((t) => t.status === "error");
  const anySuccess = tables.some((t) => t.status === "success");
  const status: SalesSyncResult["status"] = anyError ? "error" : "success";
  const result: SalesSyncResult = {
    startedAt,
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    status,
    dateRange: salesDateRange(),
    reports,
    tables,
  };

  await admin.from("sync_state").upsert(
    {
      key: "sales",
      ...(anySuccess ? { last_synced_at: result.finishedAt } : {}),
      last_status: status,
      detail: result,
    },
    { onConflict: "key" },
  );

  return result;
}

async function writeGuestCards(admin: SupabaseClient, rows: ReportRow[], syncedAt: string): Promise<TableOutcome[]> {
  const { people, interests } = mapGuestCards(rows);
  const peopleOut = await replaceTable(admin, "guest_cards", "guest_card_id", people as Record<string, unknown>[], syncedAt);
  const interestsOut = await replaceTable(
    admin,
    "guest_card_interests",
    "guest_card_id,property_id,received,row_index",
    interests as Record<string, unknown>[],
    syncedAt,
  );
  if (peopleOut.status === "success") {
    peopleOut.note = `${people.length} people from ${rows.length} AppFolio rows`;
  }
  if (interestsOut.status === "success") {
    interestsOut.note = `${interests.length} interests (nothing dropped)`;
  }
  return [peopleOut, interestsOut];
}

type LeadImportSummary = {
  leads_created: number;
  guest_cards_linked_to_existing: number;
  guest_cards_rejected: number;
  inquiry_events: number;
  showing_events: number;
  leads_with_applications: number;
  applications_unlinked: number;
};

async function importLeads(admin: SupabaseClient): Promise<TableOutcome> {
  const { data, error } = await admin.rpc("import_leads_from_appfolio");
  if (error) return { table: "leads", status: "error", written: 0, error: `import_leads_from_appfolio: ${error.message}` };
  const s = data as LeadImportSummary;
  return {
    table: "leads",
    status: "success",
    written: s.leads_created,
    note: [
      `${s.leads_created} new leads`,
      `${s.guest_cards_linked_to_existing} cards joined existing leads`,
      `${s.inquiry_events} inquiries`,
      `${s.showing_events} showings`,
      `${s.leads_with_applications} leads with applications`,
      `${s.guest_cards_rejected} cards without email/phone`,
      `${s.applications_unlinked} applications without a guest card`,
    ].join("; "),
  };
}

async function writeTenantContacts(admin: SupabaseClient, directory: ReportRow[], delinquency: ReportRow[], syncedAt: string): Promise<TableOutcome> {
  const allowed = occupancyIdsFromDelinquency(delinquency);
  const seen = new Set<string>();
  const rows: NonNullable<ReturnType<typeof mapTenantContact>>[] = [];
  for (const raw of directory) {
    const mapped = mapTenantContact(raw, allowed);
    if (!mapped) continue;
    const key = `${mapped.occupancy_id}:${mapped.tenant_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(mapped);
  }
  const out = await replaceTable(admin, "tenant_contacts", "occupancy_id,tenant_id", rows as Record<string, unknown>[], syncedAt);
  if (out.status === "success") {
    out.note = `${rows.length} contacts for ${allowed.size} delinquent occupancies (from ${directory.length} tenant_directory rows)`;
  }
  return out;
}

async function writeDelinquencies(
  admin: SupabaseClient,
  delinquency: ReportRow[],
  rentRoll: ReportRow[],
  aged: ReportRow[],
  syncedAt: string,
): Promise<TableOutcome> {
  const leases = leaseByOccupancy(rentRoll);
  const oldest = oldestInvoiceByOccupancy(aged);
  const seen = new Set<number>();
  const rows: DelinquencyRow[] = [];
  for (const raw of delinquency) {
    const mapped = mapDelinquency(raw);
    if (!mapped || seen.has(mapped.occupancy_id)) continue;
    seen.add(mapped.occupancy_id);
    const lease = leases.get(mapped.occupancy_id);
    rows.push({
      ...mapped,
      lease_to: mapped.lease_to ?? lease?.lease_to ?? null,
      tenant_agent: mapped.tenant_agent ?? lease?.tenant_agent ?? null,
      oldest_invoice_on: oldest.get(mapped.occupancy_id) ?? null,
    });
  }
  const note = [
    `${rows.length} occupancies`,
    rentRoll.length ? "lease_to from rent_roll" : "rent_roll missing — lease_to unset",
    aged.length ? "oldest invoice from aged_receivables_detail" : "aged_receivables_detail missing — days past due unset",
  ].join("; ");
  const out = await replaceTable(admin, "delinquencies", "occupancy_id", rows as unknown as Record<string, unknown>[], syncedAt);
  if (out.status === "success") out.note = note;
  return out;
}

function mapAll<T extends Record<string, unknown>>(rows: ReportRow[], map: (r: ReportRow) => T | null): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const row of rows) {
    const m = map(row);
    if (!m) continue;
    const key = Object.values(m)[0]; // first field is the primary key in every mapper
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
