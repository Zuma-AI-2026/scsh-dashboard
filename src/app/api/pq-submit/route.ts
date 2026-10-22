import type { NextRequest } from "next/server";
import { parsePqSubmission } from "@/lib/leads/webhook-payloads";
import { invalidPayload, readJson, rejectUnauthorized, runIntake } from "@/lib/leads/webhook";

/**
 * POST /api/pq-submit — PQ form submissions from n8n. Idempotent on
 * submission_id: a repeat writes nothing and answers like the original.
 * Auth and response shape: see lib/leads/webhook.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;
  const json = await readJson(request);
  if (!json.ok) return json.response;
  const parsed = parsePqSubmission(json.body);
  if (!parsed.ok) return invalidPayload(parsed.error);
  return runIntake("ingest_pq_submission", parsed.value, { submission_id: parsed.value.submission_id });
}
