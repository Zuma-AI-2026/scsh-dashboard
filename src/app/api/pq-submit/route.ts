import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { parsePqSubmission } from "@/lib/leads/pq";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/pq-submit — PQ form submissions from n8n.
 *
 * Header X-PQ-Key must equal env PQ_SUBMIT_KEY. Idempotent on submission_id:
 * a repeat returns 200 with the existing lead and writes nothing.
 *
 *   200 { ok: true, status: "created" | "updated" | "duplicate", lead_id, … }
 *   400 bad JSON / payload     401 wrong key     422 neither email nor phone
 *   503 PQ_SUBMIT_KEY not set  500 database error (safe to retry)
 */
export const dynamic = "force-dynamic";

type IngestResult = {
  status: "created" | "updated" | "duplicate" | "rejected";
  lead_id?: number;
  rotation?: "A" | "B";
  owner_agent_id?: number | null;
  converted_from_b?: boolean;
  stage?: string;
  reason?: string;
};

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function keyMatches(given: string | null, expected: string): boolean {
  return given !== null && timingSafeEqual(digest(given), digest(expected));
}

export async function POST(request: NextRequest) {
  const expected = process.env.PQ_SUBMIT_KEY?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "pq_submit_not_configured" }, { status: 503 });
  if (!keyMatches(request.headers.get("x-pq-key"), expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = parsePqSubmission(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "invalid_payload", detail: parsed.error }, { status: 400 });

  const { data, error } = await createSupabaseAdminClient().rpc("ingest_pq_submission", { p: parsed.value });
  if (error) {
    console.error("[pq-submit]", parsed.value.submission_id, error.message);
    return NextResponse.json({ ok: false, error: "database_error" }, { status: 500 });
  }

  const result = data as IngestResult;
  const submission_id = parsed.value.submission_id;
  if (result.status === "rejected") {
    return NextResponse.json({ ok: false, error: result.reason ?? "rejected", submission_id }, { status: 422 });
  }
  return NextResponse.json({ ok: true, submission_id, ...result });
}
