import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  AppfolioError,
  credentialsFromEnv,
  fetchReport,
  type ReportParams,
  type ReportRow,
  type RunOptions,
} from "./client";

export type RunReportResult = {
  rows: ReportRow[];
  pages: number;
  runId: number | null;
  durationMs: number;
};

/**
 * Runs an AppFolio report (all pages) and logs the attempt to `sync_runs`.
 *
 *   const { rows } = await runReport("rent_roll", {});
 *
 * Throws on failure *after* recording status='error' so callers can decide
 * whether to continue with other reports.
 */
export async function runReport(
  reportName: string,
  params: ReportParams = {},
  opts: RunOptions = {},
): Promise<RunReportResult> {
  const admin = createSupabaseAdminClient();
  const startedAt = new Date();

  const { data: runRow, error: insertError } = await admin
    .from("sync_runs")
    .insert({ report: reportName, params, started_at: startedAt.toISOString(), status: "running" })
    .select("id")
    .single();
  if (insertError) console.error("[runReport] could not insert sync_runs row", insertError.message);
  const runId: number | null = runRow?.id ?? null;

  const finish = async (patch: Record<string, unknown>) => {
    if (runId === null) return;
    const { error } = await admin.from("sync_runs").update(patch).eq("id", runId);
    if (error) console.error("[runReport] could not update sync_runs row", error.message);
  };

  try {
    const result = await fetchReport(credentialsFromEnv(), reportName, params, {
      log: (m) => console.log(`[appfolio] ${m}`),
      ...opts,
    });
    const finishedAt = new Date();
    await finish({
      finished_at: finishedAt.toISOString(),
      row_count: result.rows.length,
      status: "success",
      error: null,
    });
    return { rows: result.rows, pages: result.pages, runId, durationMs: finishedAt.getTime() - startedAt.getTime() };
  } catch (err) {
    const message =
      err instanceof AppfolioError
        ? `HTTP ${err.status}: ${err.body.slice(0, 1000)}`
        : err instanceof Error
          ? err.message
          : String(err);
    await finish({ finished_at: new Date().toISOString(), status: "error", error: message });
    throw err;
  }
}
