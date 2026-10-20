"use client";

import Link from "next/link";
import { addDelinquencyAction } from "@/app/(app)/accounting/actions";
import { PendingButton } from "@/components/admin/pending-button";
import type { DelinquencyStage } from "@/lib/accounting/ladder";
import { FOLLOW_UP_ACTIONS, type DelinquencyAction } from "@/lib/accounting/types";
import { formatDate } from "@/lib/format";
import { hrefWith } from "@/lib/url";

export function FollowUpCell({
  occupancyId,
  canWrite,
  stages,
  nextDueId,
}: {
  occupancyId: number;
  canWrite: boolean;
  stages: DelinquencyStage[];
  nextDueId: number | null;
}) {
  if (!canWrite) return <span className="text-muted-foreground">—</span>;

  const active = stages.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <form key={`${occupancyId}-${nextDueId ?? "none"}`} action={addDelinquencyAction} className="flex min-w-56 flex-col gap-1">
      <input type="hidden" name="occupancy_id" value={occupancyId} />
      <div className="flex items-center gap-1">
        <select name="action" required defaultValue="" className="h-7 min-w-28 flex-1 rounded-md border border-input bg-background px-1.5 text-xs">
          <option value="" disabled>
            Log…
          </option>
          {FOLLOW_UP_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select name="stage_id" defaultValue={nextDueId !== null ? String(nextDueId) : ""} className="h-7 min-w-32 flex-1 rounded-md border border-input bg-background px-1.5 text-xs">
          <option value="">No stage</option>
          {active.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {nextDueId === s.id ? " (due)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <input
          name="note"
          type="text"
          maxLength={2000}
          placeholder="Note"
          className="h-7 min-w-24 flex-1 rounded-md border border-input bg-background px-1.5 text-xs"
        />
        <PendingButton size="xs" variant="outline" pendingLabel="…">
          Log
        </PendingButton>
      </div>
    </form>
  );
}

export function LastActionCell({
  occupancyId,
  latest,
  stageName,
  params,
}: {
  occupancyId: number;
  latest: DelinquencyAction | null;
  stageName: string | null;
  params: Record<string, string | undefined>;
}) {
  const historyHref = hrefWith("/accounting", params, { history: String(occupancyId) });
  if (!latest) {
    return (
      <Link href={historyHref} scroll={false} className="text-muted-foreground hover:underline">
        None
      </Link>
    );
  }
  return (
    <Link href={historyHref} scroll={false} className="text-left hover:underline" title={latest.note ?? undefined}>
      <span className="text-foreground">{latest.action}</span>
      {stageName && <span className="ml-1 text-muted-foreground">· {stageName}</span>}
      <span className="ml-1 text-muted-foreground">{formatDate(latest.acted_at)}</span>
    </Link>
  );
}

export function HistoryPanel({
  tenant,
  property,
  unit,
  actions,
  stages,
  closeHref,
}: {
  tenant: string | null;
  property: string | null;
  unit: string | null;
  actions: DelinquencyAction[];
  stages: DelinquencyStage[];
  closeHref: string;
}) {
  const nameById = new Map(stages.map((s) => [s.id, s.name]));
  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Follow-up history
          <span className="ml-2 font-normal text-muted-foreground">{[tenant, unit, property].filter(Boolean).join(" · ")}</span>
        </h2>
        <Link href={closeHref} scroll={false} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Close
        </Link>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
      ) : (
        <ol className="space-y-2">
          {actions.map((a) => (
            <li key={a.id} className="border-l-2 border-border pl-3 text-sm">
              <div className="font-medium">
                {a.action}
                {a.stage_id !== null && nameById.get(a.stage_id) && (
                  <span className="ml-2 font-normal text-muted-foreground">fulfilled {nameById.get(a.stage_id)}</span>
                )}
                <span className="ml-2 font-normal text-muted-foreground">
                  {formatDate(a.acted_at)} · {a.acted_by}
                </span>
              </div>
              {a.note && <p className="text-muted-foreground">{a.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
