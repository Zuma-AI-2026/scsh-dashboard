/**
 * Low-level AppFolio Reports API v2 client. READ-ONLY.
 *
 *   POST https://{db}.appfolio.com/api/v2/reports/{report_name}.json
 *   HTTP Basic auth: client_id:client_secret
 *   Paginated via `next_page_url`; follow until null.
 *
 * This file has NO framework or Supabase imports so that
 * scripts/discover-reports.ts can run it under plain Node. Keep it that way.
 * Logging to sync_runs lives in runReport.ts.
 */

export type AppfolioCredentials = {
  db: string;
  clientId: string;
  clientSecret: string;
};

export type ReportRow = Record<string, unknown>;

export type ReportParams = Record<string, unknown>;

export type RunOptions = {
  /** Max attempts per HTTP request on 429/5xx (default 5). */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default 1000). */
  baseDelayMs?: number;
  /** Safety cap on pages (default 500). */
  maxPages?: number;
  /** Optional logger for progress. */
  log?: (message: string) => void;
  fetchImpl?: typeof fetch;
};

export type ReportResult = {
  rows: ReportRow[];
  pages: number;
  /** HTTP status of the first page. */
  status: number;
};

export class AppfolioError extends Error {
  readonly status: number;
  readonly body: string;
  readonly reportName: string;
  constructor(reportName: string, status: number, body: string) {
    super(`AppFolio ${reportName} -> HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "AppfolioError";
    this.status = status;
    this.body = body;
    this.reportName = reportName;
  }
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AppfolioCredentials {
  const db = env.APPFOLIO_DB?.trim();
  const clientId = env.APPFOLIO_CLIENT_ID?.trim();
  const clientSecret = env.APPFOLIO_CLIENT_SECRET?.trim();
  if (!db || !clientId || !clientSecret) {
    throw new Error("Missing APPFOLIO_DB / APPFOLIO_CLIENT_ID / APPFOLIO_CLIENT_SECRET in the environment.");
  }
  return { db, clientId, clientSecret };
}

export function reportUrl(db: string, reportName: string): string {
  if (!/^[a-z0-9_]+$/.test(reportName)) {
    throw new Error(`Invalid report name "${reportName}" (expected snake_case).`);
  }
  return `https://${db}.appfolio.com/api/v2/reports/${reportName}.json`;
}

function basicAuthHeader(c: AppfolioCredentials): string {
  return `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelay(attempt: number, baseMs: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (!Number.isNaN(secs) && secs > 0) return Math.min(secs * 1000, 60_000);
  }
  const exp = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseMs;
  return Math.min(exp + jitter, 30_000);
}

/**
 * One HTTP request with retry on 429 and 5xx. Resolves with the Response for
 * any other status (including 4xx) so callers can decide what to do.
 */
export async function requestWithRetry(
  url: string,
  init: RequestInit,
  reportName: string,
  opts: RunOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const fetchImpl = opts.fetchImpl ?? fetch;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) return res;
      const delay = retryDelay(attempt, baseDelayMs, res.headers.get("retry-after"));
      opts.log?.(`${reportName}: HTTP ${res.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxAttempts})`);
      await res.text().catch(() => undefined); // drain
      await sleep(delay);
    } catch (err) {
      // Network-level failure: also retry.
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = retryDelay(attempt, baseDelayMs, null);
      opts.log?.(`${reportName}: network error, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request to ${url} failed`);
}

type PageJson = {
  results?: unknown;
  data?: unknown;
  next_page_url?: string | null;
  [k: string]: unknown;
};

function extractRows(json: unknown): ReportRow[] {
  if (Array.isArray(json)) return json as ReportRow[];
  if (json && typeof json === "object") {
    const j = json as PageJson;
    if (Array.isArray(j.results)) return j.results as ReportRow[];
    if (Array.isArray(j.data)) return j.data as ReportRow[];
  }
  return [];
}

function extractNext(json: unknown): string | null {
  if (json && typeof json === "object") {
    const n = (json as PageJson).next_page_url;
    if (typeof n === "string" && n.length > 0) return n;
  }
  return null;
}

/**
 * Fetches every page of a report and returns all rows.
 * Throws AppfolioError on a non-2xx first-page response.
 */
export async function fetchReport(
  creds: AppfolioCredentials,
  reportName: string,
  params: ReportParams = {},
  opts: RunOptions = {},
): Promise<ReportResult> {
  const maxPages = opts.maxPages ?? 500;
  const headers = {
    Authorization: basicAuthHeader(creds),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // paginate_results is what makes AppFolio return next_page_url.
  const firstBody = JSON.stringify({ paginate_results: true, ...params });

  const rows: ReportRow[] = [];
  const origin = `https://${creds.db}.appfolio.com`;
  let url: string | null = reportUrl(creds.db, reportName);
  let pages = 0;
  let firstStatus = 0;

  while (url && pages < maxPages) {
    // Per AppFolio docs: next_page_url points at an existing report run; it must be
    // POSTed WITHOUT filters (they're rejected), and it may be a relative path.
    const body = pages === 0 ? firstBody : "{}";
    const res: Response = await requestWithRetry(url, { method: "POST", headers, body }, reportName, opts);
    if (pages === 0) firstStatus = res.status;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AppfolioError(reportName, res.status, text);
    }

    const json: unknown = await res.json();
    rows.push(...extractRows(json));
    pages += 1;
    const next = extractNext(json);
    url = next ? new URL(next, origin).toString() : null;
    opts.log?.(`${reportName}: page ${pages}, ${rows.length} rows so far${url ? ", more…" : ""}`);
  }

  return { rows, pages, status: firstStatus };
}
