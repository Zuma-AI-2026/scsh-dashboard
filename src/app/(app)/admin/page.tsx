import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { NoAccess } from "@/components/app-shell/section-page";
import { StatusBadge } from "@/components/sales/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SalesSyncResult } from "@/lib/appfolio/sync";
import { requireUser } from "@/lib/auth/current-user";
import { formatDateTime, relativeTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSyncState } from "@/lib/sync/state";
import { cn } from "@/lib/utils";
import { runSyncNow } from "./actions";

export const metadata: Metadata = { title: "Admin" };
// "Sync now" server action runs ~45s (10 reports with pauses).
export const maxDuration = 120;

type SyncRun = { id: number; report: string; started_at: string; finished_at: string | null; row_count: number | null; status: string; error: string | null };

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const supabase = await createSupabaseServerClient();
  const [state, runs, pending] = await Promise.all([
    getSyncState("sales"),
    supabase.from("sync_runs").select("id, report, started_at, finished_at, row_count, status, error").order("started_at", { ascending: false }).limit(25),
    supabase.from("properties").select("property_id", { count: "exact", head: true }).is("managed_reviewed_at", null),
  ]);
  const last = (state?.detail as SalesSyncResult | null) ?? null;
  const pendingReview = pending.count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Last sync {state?.last_synced_at ? `${relativeTime(state.last_synced_at)} (${formatDateTime(state.last_synced_at)})` : "never"}
            {state?.last_status && (
              <>
                {" · "}
                <StatusBadge value={state.last_status} />
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Users
          </Link>
          <Link href="/admin/agents" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Agents
          </Link>
          <Link href="/admin/delinquency-ladder" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Ladder
          </Link>
          <Link href="/admin/collections" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Collections
          </Link>
          <Link href="/admin/properties" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Properties
            {pendingReview > 0 && <span className="ml-1.5 rounded-sm bg-warning/15 px-1 text-[10px] font-medium uppercase text-warning">{pendingReview} to review</span>}
          </Link>
          <form action={runSyncNow}>
            <PendingButton pendingLabel="Syncing… (~45s)">Sync now</PendingButton>
          </form>
        </div>
      </div>

      {last && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Last run · reports <span className="normal-case tracking-normal">(date range {last.dateRange.from} → {last.dateRange.to})</span>
            </h2>
            <div className="rounded-md border bg-card">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 text-[11px] uppercase">Report</TableHead>
                    <TableHead className="h-8 text-right text-[11px] uppercase">Rows</TableHead>
                    <TableHead className="h-8 text-right text-[11px] uppercase">Pages</TableHead>
                    <TableHead className="h-8 text-[11px] uppercase">Filters sent</TableHead>
                    <TableHead className="h-8 text-[11px] uppercase">Raw</TableHead>
                    <TableHead className="h-8 text-[11px] uppercase">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {last.reports.map((r) => (
                    <TableRow key={r.report}>
                      <TableCell className="py-1.5 font-mono text-xs">{r.report}</TableCell>
                      <TableCell className="tabular py-1.5 text-right">{r.rows}</TableCell>
                      <TableCell className="tabular py-1.5 text-right text-muted-foreground">{r.pages}</TableCell>
                      <TableCell className="py-1.5 text-xs">
                        <FiltersSent params={r.params} />
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">{r.rawStored ? "stored" : "skipped"}</TableCell>
                      <TableCell className="py-1.5">
                        <StatusBadge value={r.status} />
                        {r.error && <div className="mt-1 max-w-xs truncate text-xs text-negative" title={r.error}>{r.error}</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Last run · tables written</h2>
            <div className="rounded-md border bg-card">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 text-[11px] uppercase">Table</TableHead>
                    <TableHead className="h-8 text-right text-[11px] uppercase">Rows</TableHead>
                    <TableHead className="h-8 text-[11px] uppercase">Status</TableHead>
                    <TableHead className="h-8 text-[11px] uppercase">Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {last.tables.map((t) => (
                    <TableRow key={t.table}>
                      <TableCell className="py-1.5 font-mono text-xs">{t.table}</TableCell>
                      <TableCell className="tabular py-1.5 text-right">{t.written}</TableCell>
                      <TableCell className="py-1.5"><StatusBadge value={t.status} /></TableCell>
                      <TableCell className={cn("py-1.5 text-xs", t.error ? "text-negative" : "text-muted-foreground")}>{t.error ?? t.note ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Took {(last.durationMs / 1000).toFixed(1)}s · finished {formatDateTime(last.finishedAt)}</p>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent report pulls (sync_runs)</h2>
        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-[11px] uppercase">Started</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Report</TableHead>
                <TableHead className="h-8 text-right text-[11px] uppercase">Rows</TableHead>
                <TableHead className="h-8 text-right text-[11px] uppercase">Secs</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Status</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((runs.data ?? []) as SyncRun[]).length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">No syncs yet. Click “Sync now”.</TableCell>
                </TableRow>
              ) : (
                ((runs.data ?? []) as SyncRun[]).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5 whitespace-nowrap">{formatDateTime(r.started_at)}</TableCell>
                    <TableCell className="py-1.5 font-mono text-xs">{r.report}</TableCell>
                    <TableCell className="tabular py-1.5 text-right">{r.row_count ?? "—"}</TableCell>
                    <TableCell className="tabular py-1.5 text-right text-muted-foreground">
                      {r.finished_at ? ((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1) : "…"}
                    </TableCell>
                    <TableCell className="py-1.5"><StatusBadge value={r.status} /></TableCell>
                    <TableCell className="max-w-md truncate py-1.5 text-xs text-negative" title={r.error ?? undefined}>{r.error ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/** Compact rendering of the request body, e.g. "received_on 2025-08-01→2026-10-18 · guest_card_statuses=all". */
function FiltersSent({ params }: { params: Record<string, unknown> | undefined }) {
  const entries = Object.entries(params ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">none (report defaults)</span>;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const [k, v] of entries) {
    if (seen.has(k)) continue;
    const m = k.match(/^(.*)_from$/);
    if (m && `${m[1]}_to` in (params ?? {})) {
      parts.push(`${m[1]} ${String(v)}→${String(params![`${m[1]}_to`])}`);
      seen.add(`${m[1]}_to`);
    } else {
      parts.push(`${k}=${Array.isArray(v) ? v.join(",") : String(v)}`);
    }
  }
  return <span className="font-mono text-[11px] text-muted-foreground">{parts.join(" · ")}</span>;
}
