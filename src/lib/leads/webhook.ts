import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Shared plumbing for the n8n webhooks. Both are authenticated with header
 * X-PQ-Key = env PQ_SUBMIT_KEY and return the same shape (built in SQL by
 * lead_webhook_response):
 *
 *   200 { ok: true, status: "created" | "updated" | "duplicate", lead_id, rotation, stage,
 *         lead_status, owner_agent_id, owner_name, owner_email, is_returning,
 *         converted_from_b, converted_now, test_mode, … }
 *   400 bad JSON / payload   401 wrong key   422 neither email nor phone
 *   503 PQ_SUBMIT_KEY not set   500 database error (safe to retry)
 */

type WebhookResult = { status: "created" | "updated" | "duplicate" | "rejected"; reason?: string } & Record<string, unknown>;

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** null = authorized; otherwise the error response to return. */
export function rejectUnauthorized(request: NextRequest): NextResponse | null {
  const expected = process.env.PQ_SUBMIT_KEY?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "pq_submit_not_configured" }, { status: 503 });
  const given = request.headers.get("x-pq-key");
  if (given === null || !timingSafeEqual(digest(given), digest(expected))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function readJson(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }) };
  }
}

export function invalidPayload(detail: string): NextResponse {
  return NextResponse.json({ ok: false, error: "invalid_payload", detail }, { status: 400 });
}

/** Calls the SQL intake function and maps its result to the HTTP contract above. */
export async function runIntake(fn: "ingest_pq_submission" | "ingest_n8n_inquiry", payload: object, echo: Record<string, unknown> = {}): Promise<NextResponse> {
  const { data, error } = await createSupabaseAdminClient().rpc(fn, { p: payload });
  if (error) {
    console.error(`[${fn}]`, error.message);
    return NextResponse.json({ ok: false, error: "database_error" }, { status: 500 });
  }
  const result = data as WebhookResult;
  if (result.status === "rejected") {
    return NextResponse.json({ ok: false, error: result.reason ?? "rejected", ...echo }, { status: 422 });
  }
  return NextResponse.json({ ok: true, ...echo, ...result });
}
