import { agingBucketOf, daysPastDue, type AgingBucket } from "@/lib/appfolio/mappers/delinquency";
import { formatMoney } from "@/lib/format";
import type { Kpi } from "@/lib/sales/analytics";
import { hrefWith } from "@/lib/url";
import type { AccountingDataset } from "./data";
import type { Delinquency, DelinquencyAction } from "./types";

export type Params = Record<string, string | undefined>;

export type DelinquencyView = Delinquency & {
  aging_bucket: AgingBucket | null;
  days_past_due: number | null;
  latest_action: DelinquencyAction | null;
  agent: string | null;
};

export function withDerived(data: AccountingDataset, now = new Date()): DelinquencyView[] {
  const latestByOcc = new Map<number, DelinquencyAction>();
  for (const a of data.actions) {
    if (!latestByOcc.has(a.occupancy_id)) latestByOcc.set(a.occupancy_id, a);
  }
  return data.delinquencies.map((d) => ({
    ...d,
    aging_bucket: agingBucketOf(d),
    days_past_due: daysPastDue(d.oldest_invoice_on, now),
    latest_action: latestByOcc.get(d.occupancy_id) ?? null,
    agent: d.tenant_agent || d.agent_of_record || null,
  }));
}

function bucketSum(rows: Delinquency[], key: "bucket_0_30" | "bucket_31_60" | "bucket_61_90" | "bucket_90_plus"): number {
  return rows.reduce((n, r) => n + (r[key] ?? 0), 0);
}

export function computeKpis(rows: DelinquencyView[], occupiedManaged: number): Kpi[] {
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

  return [
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
}

export function activeKpi(p: Params): string | null {
  if (p.kpi) return p.kpi;
  if (p.bucket) return p.bucket;
  return null;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const eq = (a: string | null | undefined, b: string | undefined) => !b || lower(a) === lower(b);

export function filterRows(rows: DelinquencyView[], p: Params): DelinquencyView[] {
  return rows.filter((r) => eq(r.property_name, p.property) && eq(r.aging_bucket, p.bucket) && eq(r.agent, p.agent) && eq(r.owners, p.owner));
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
