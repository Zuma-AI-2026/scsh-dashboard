/**
 * AppFolio report discovery.
 *
 * For each candidate report name, POSTs one page to the Reports API and
 * prints: exists? (HTTP status), row count on page 1, total pages hint,
 * and the column names from the first row.
 *
 * Run:   npm run discover
 *        (= node --env-file=.env.local scripts/discover-reports.mts)
 *
 * Add names:  edit CANDIDATE_REPORTS below, or pass extra names as args:
 *        npm run discover -- some_other_report another_one
 *
 * A 1.5s pause is kept between probes — AppFolio returned HTTP 429 when hit
 * back-to-back.
 *
 * Read-only: only report endpoints are called.
 */
import { credentialsFromEnv, reportUrl, requestWithRetry, type ReportRow } from "../src/lib/appfolio/client.ts";

// Confirmed working on 2026-10-18. Names that returned 400 "Id is not a valid
// report" were removed. tenant_directory exists but is not synced in phase 1.
const CANDIDATE_REPORTS: string[] = [
  "property_directory",
  "unit_directory",
  "unit_vacancy",
  "rent_roll",
  "guest_cards",
  "showings",
  "rental_applications",
  "tenant_directory",
];

type Outcome = {
  report: string;
  status: number;
  exists: boolean;
  rows: number;
  hasMore: boolean;
  columns: string[];
  sample: ReportRow | null;
  note: string;
};

async function probe(report: string): Promise<Outcome> {
  const creds = credentialsFromEnv();
  const headers = {
    Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await requestWithRetry(
    reportUrl(creds.db, report),
    { method: "POST", headers, body: JSON.stringify({ paginate_results: true }) },
    report,
    { maxAttempts: 3, log: (m) => console.error(`  … ${m}`) },
  );

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }

  const out: Outcome = { report, status: res.status, exists: false, rows: 0, hasMore: false, columns: [], sample: null, note: "" };

  if (res.status === 404) {
    out.note = "not found (report name does not exist or is not exposed via API)";
    return out;
  }
  if (res.status === 401) {
    out.note = "UNAUTHORIZED — check APPFOLIO_CLIENT_ID / APPFOLIO_CLIENT_SECRET";
    return out;
  }
  if (res.status === 403) {
    out.note = "exists but this API client lacks permission for it";
    out.exists = true;
    return out;
  }
  if (!res.ok) {
    out.exists = res.status === 422 || res.status === 400; // exists but rejected our params
    out.note = `HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`;
    return out;
  }

  out.exists = true;
  const rows: ReportRow[] = Array.isArray(json)
    ? (json as ReportRow[])
    : json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)
      ? ((json as { results: ReportRow[] }).results)
      : [];
  out.rows = rows.length;
  out.hasMore = Boolean(json && typeof json === "object" && (json as { next_page_url?: unknown }).next_page_url);
  out.sample = rows[0] ?? null;
  out.columns = out.sample ? Object.keys(out.sample) : [];
  if (!out.sample) out.note = "0 rows returned (report exists but is empty or needs params)";
  return out;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

async function main() {
  const extra = process.argv.slice(2).filter((a) => /^[a-z0-9_]+$/.test(a));
  const names = Array.from(new Set([...CANDIDATE_REPORTS, ...extra]));
  const creds = credentialsFromEnv();

  console.log(`AppFolio report discovery — ${creds.db}.appfolio.com — ${names.length} candidates\n`);

  const results: Outcome[] = [];
  for (const [i, name] of names.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    process.stdout.write(`▸ ${name.padEnd(24)} `);
    try {
      const r = await probe(name);
      results.push(r);
      const flag = r.exists ? (r.status === 200 ? "YES" : "yes?") : "no ";
      console.log(`${flag}  HTTP ${r.status}  rows(page1)=${r.rows}${r.hasMore ? "+" : ""}  cols=${r.columns.length}${r.note ? `  — ${r.note}` : ""}`);
      if (r.status === 401) {
        console.log("\nStopping: credentials rejected.");
        process.exit(1);
      }
    } catch (err) {
      console.log(`ERR  ${err instanceof Error ? err.message : String(err)}`);
      results.push({ report: name, status: 0, exists: false, rows: 0, hasMore: false, columns: [], sample: null, note: "network error" });
    }
  }

  console.log("\n==================== DETAILS (paste this back) ====================\n");
  for (const r of results) {
    console.log(`## ${r.report}  (HTTP ${r.status}, exists=${r.exists ? "yes" : "no"}, rows_page1=${r.rows}${r.hasMore ? ", more pages" : ""})`);
    if (r.columns.length) {
      console.log("columns:");
      for (const c of r.columns) console.log(`  - ${c}  = ${formatValue(r.sample?.[c])}`);
    } else if (r.note) {
      console.log(`  ${r.note}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
