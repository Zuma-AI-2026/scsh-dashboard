import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SALES_REPORTS, type SalesReportConfig } from "./mappers";
import { runReport } from "./runReport";

export type ReportSyncOutcome = {
  report: string;
  table: string;
  status: "success" | "error" | "skipped";
  rawRows: number;
  cleanRows: number;
  durationMs: number;
  error?: string;
};

export type SalesSyncResult = {
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  reports: ReportSyncOutcome[];
};

const UPSERT_BATCH = 500;

/**
 * Syncs one report:
 *   1. pull all rows from AppFolio (logged to sync_runs),
 *   2. replace raw_<report> wholesale (single transaction via RPC),
 *   3. map -> upsert into the clean table, then delete rows not seen this run.
 */
async function syncOne(cfg: SalesReportConfig, syncedAt: string): Promise<ReportSyncOutcome> {
  const t0 = Date.now();
  const base = { report: cfg.report, table: cfg.table, rawRows: 0, cleanRows: 0 };
  if (!cfg.enabled) return { ...base, status: "skipped", durationMs: 0 };

  const admin = createSupabaseAdminClient();
  try {
    const { rows } = await runReport(cfg.report, cfg.params);

    // 2. raw table, replaced wholesale.
    const { error: rawError } = await admin.rpc("replace_raw_rows", {
      p_report: cfg.report,
      p_rows: rows,
      p_synced_at: syncedAt,
    });
    if (rawError) throw new Error(`replace_raw_rows(${cfg.report}): ${rawError.message}`);

    // 3. clean table.
    const seen = new Set<string>();
    const clean: Record<string, unknown>[] = [];
    for (const row of rows) {
      const mapped = cfg.map(row);
      if (!mapped || typeof mapped.id !== "string" || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      clean.push({ ...mapped, synced_at: syncedAt });
    }

    for (let i = 0; i < clean.length; i += UPSERT_BATCH) {
      const batch = clean.slice(i, i + UPSERT_BATCH);
      const { error } = await admin.from(cfg.table).upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`upsert ${cfg.table}: ${error.message}`);
    }

    // Remove rows that disappeared from AppFolio (full-replace semantics).
    const { error: delError } = await admin.from(cfg.table).delete().lt("synced_at", syncedAt);
    if (delError) throw new Error(`prune ${cfg.table}: ${delError.message}`);

    return { ...base, status: "success", rawRows: rows.length, cleanRows: clean.length, durationMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] ${cfg.report} failed:`, message);
    return { ...base, status: "error", durationMs: Date.now() - t0, error: message };
  }
}

/** Runs every enabled sales report and records the result in sync_state('sales'). */
export async function syncSales(): Promise<SalesSyncResult> {
  const admin = createSupabaseAdminClient();
  const startedAt = new Date().toISOString();

  await admin.from("sync_state").upsert({ key: "sales", last_status: "running" }, { onConflict: "key" });

  // Reports run sequentially to stay well under AppFolio rate limits.
  const reports: ReportSyncOutcome[] = [];
  for (const cfg of SALES_REPORTS) {
    reports.push(await syncOne(cfg, startedAt));
  }

  const finishedAt = new Date().toISOString();
  const anyError = reports.some((r) => r.status === "error");
  const anySuccess = reports.some((r) => r.status === "success");
  const status: SalesSyncResult["status"] = anyError ? "error" : "success";

  await admin.from("sync_state").upsert(
    {
      key: "sales",
      // Only advance last_synced_at when at least one report actually landed.
      ...(anySuccess ? { last_synced_at: finishedAt } : {}),
      last_status: status,
      detail: { startedAt, finishedAt, reports },
    },
    { onConflict: "key" },
  );

  return { startedAt, finishedAt, status, reports };
}
