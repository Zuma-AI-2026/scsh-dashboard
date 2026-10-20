import { agingBucketOf, daysPastDue, type AgingBucket } from "@/lib/appfolio/mappers/delinquency";
import { formatMoney } from "@/lib/format";
import type { Kpi } from "@/lib/sales/analytics";
import { hrefWith } from "@/lib/url";
import type { AccountingDataset } from "./data";
import { currentStageOf, isActionOverdue, nextActionDueOf, OVERDUE_GRACE_DAYS, OWNER_TYPE_LABEL, type DelinquencyStage } from "./ladder";
import type { Delinquency, DelinquencyAction, TenantContact } from "./types";

export type Params = Record<string, string | undefined>;

export type DelinquencyView = Delinquency & {
  aging_bucket: AgingBucket | null;
  days_past_due: number | null;
  latest_action: DelinquencyAction | null;
  agent: string | null;
  current_stage: DelinquencyStage | null;
  next_action_due: DelinquencyStage | null;
  action_overdue: boolean;
  contact: TenantContact | null;
};

export function withDerived(data: AccountingDataset, now = new Date()): DelinquencyView[] {
  const latestByOcc = new Map<number, DelinquencyAction>();
  const fulfilledByOcc = new Map<number, Set<number>>();
  for (const a of data.actions) {
    if (!latestByOcc.has(a.occupancy_id)) latestByOcc.set(a.occupancy_id, a);
    if (a.stage_id !== null) {
      const set = fulfilledByOcc.get(a.occupancy_id) ?? new Set<number>();
      set.add(a.stage_id);
      fulfilledByOcc.set(a.occupancy_id, set);
    }
  }

  const contactByOcc = new Map<number, TenantContact>();
  for (const c of data.contacts) {
    const prev = contactByOcc.get(c.occupancy_id);
    if (!prev || (c.primary_tenant && !prev.primary_tenant)) contactByOcc.set(c.occupancy_id, c);
  }

  return data.delinquencies.map((d) => {
    const days = daysPastDue(d, now);
    const current = currentStageOf(data.stages, days);
    const next = nextActionDueOf(data.stages, days, fulfilledByOcc.get(d.occupancy_id) ?? new Set());
    return {
      ...d,
      aging_bucket: agingBucketOf(d),
      days_past_due: days,
      latest_action: latestByOcc.get(d.occupancy_id) ?? null,
      agent: d.tenant_agent || d.agent_of_record || null,
      current_stage: current,
      next_action_due: next,
      action_overdue: isActionOverdue(next, days),
      contact: contactByOcc.get(d.occupancy_id) ?? null,
    };
  });
}

function bucketSum(rows: Delinquency[], key: "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus"): number {
  return rows.reduce((n, r) => n + (r[key] ?? 0), 0);
}

export function computeKpis(rows: DelinquencyView[], occupiedManaged: number, stages: DelinquencyStage[]): { money: Kpi[]; ladder: Kpi[] } {
  const total = rows.reduce((n, r) => n + (r.amount_receivable ?? 0), 0);
  const count = rows.length;
  const pct = occupiedManaged ? `${Math.round((count / occupiedManaged) * 100)}%` : "—";
  const path = "/accounting";
  const buckets: { key: string; label: string; bucket: AgingBucket; field: "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus" }[] = [
    { key: "0-30", label: "0–30 days", bucket: "0-30", field: "bucket_0_30" },
    { key: "31-60", label: "31–60 days", bucket: "31-60", field: "bucket_31_60" },
    { key: "61-90", label: "61–90 days", bucket: "61-90", field: "bucket_61_90" },
    { key: "90+", label: "90+ days", bucket: "90+", field: "bucket_90_plus" },
  ];

  const overdueN = rows.filter((r) => r.action_overdue).length;

  const money: Kpi[] = [
    {
      key: "past-due",
      label: "Total past due",
      value: formatMoney(total),
      sub: `${count} occupanc${count === 1 ? "y" : "ies"}`,
      href: hrefWith(path, {}, { kpi: "past-due" }),
      tone: total > 0 ? "negative" : "positive",
    },
    {
      key: "delinquent-count",
      label: "Delinquent occupancies",
      value: String(count),
      sub: occupiedManaged ? `of ${occupiedManaged} occupied` : "managed occupancies",
      href: hrefWith(path, {}, { kpi: "delinquent-count" }),
      tone: count > 0 ? "negative" : "positive",
    },
    {
      key: "delinquent-pct",
      label: "% delinquent",
      value: pct,
      sub: occupiedManaged ? `${count} / ${occupiedManaged}` : "no occupied units yet",
      href: hrefWith(path, {}, { kpi: "delinquent-pct" }),
      tone: occupiedManaged && count / occupiedManaged > 0.1 ? "negative" : "neutral",
    },
    ...buckets.map((b) => {
      const amount = bucketSum(rows, b.field);
      const n = rows.filter((r) => r.aging_bucket === b.bucket).length;
      return {
        key: b.key,
        label: b.label,
        value: formatMoney(amount),
        sub: n ? `${n} occupanc${n === 1 ? "y" : "ies"}` : "none",
        href: hrefWith(path, {}, { bucket: b.bucket, kpi: b.key }),
        tone: amount > 0 ? ("negative" as const) : ("positive" as const),
      };
    }),
  ];

  const ladder: Kpi[] = [
    {
      key: "actions-overdue",
      label: "Actions overdue",
      value: String(overdueN),
      sub: overdueN ? `current stage unlogged > ${OVERDUE_GRACE_DAYS} days` : "no current stage overdue",
      href: hrefWith(path, {}, { overdue: "1", kpi: "actions-overdue" }),
      tone: overdueN ? "negative" : "positive",
    },
    ...stages
      .filter((s) => s.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => {
        const inStage = rows.filter((r) => r.current_stage?.id === s.id);
        const open = inStage.filter((r) => r.next_action_due?.id === s.id).length;
        const late = inStage.filter((r) => r.action_overdue).length;
        return {
          key: `stage-${s.id}`,
          label: s.name,
          value: String(inStage.length),
          sub: `day ${s.trigger_day} · ${OWNER_TYPE_LABEL[s.owner_type]} · ${open} open${late ? `, ${late} overdue` : ""}`,
          href: hrefWith(path, {}, { stage: String(s.id), kpi: `stage-${s.id}` }),
          tone: late ? ("negative" as const) : ("neutral" as const),
        };
      }),
  ];

  return { money, ladder };
}

export function activeKpi(p: Params): string | null {
  if (p.kpi) return p.kpi;
  if (p.overdue === "1") return "actions-overdue";
  if (p.stage) return `stage-${p.stage}`;
  if (p.bucket) return p.bucket;
  return null;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const eq = (a: string | null | undefined, b: string | undefined) => !b || lower(a) === lower(b);

export function filterRows(rows: DelinquencyView[], p: Params): DelinquencyView[] {
  return rows.filter((r) => {
    if (!eq(r.property_name, p.property)) return false;
    if (!eq(r.aging_bucket, p.bucket)) return false;
    if (!eq(r.agent, p.agent)) return false;
    if (!eq(r.owners, p.owner)) return false;
    if (p.stage && String(r.current_stage?.id ?? "") !== p.stage) return false;
    if (p.overdue === "1" && !r.action_overdue) return false;
    return true;
  });
}

export function sortDelinquencies(rows: DelinquencyView[], p: Params): DelinquencyView[] {
  if (p.sort) return sortRows(rows, p.sort, p.dir, "amount_receivable");
  return [...rows].sort((a, b) => {
    if (a.action_overdue !== b.action_overdue) return a.action_overdue ? -1 : 1;
    return (b.amount_receivable ?? 0) - (a.amount_receivable ?? 0);
  });
}

export function sortRows<T extends Record<string, unknown>>(rows: T[], key: string | undefined, dir: string | undefined, fallback: keyof T & string): T[] {
  const k = key && rows.length && key in rows[0] ? key : fallback;
  const asc = dir !== "desc";
  return [...rows].sort((a, b) => {
    const va = a[k] as unknown;
    const vb = b[k] as unknown;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return asc ? cmp : -cmp;
  });
}

export function distinct<T>(rows: T[], pick: (r: T) => string | null | undefined): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort((a, b) => a.localeCompare(b));
}

export function historyFor(actions: DelinquencyAction[], occupancyId: number): DelinquencyAction[] {
  return actions.filter((a) => a.occupancy_id === occupancyId);
}
