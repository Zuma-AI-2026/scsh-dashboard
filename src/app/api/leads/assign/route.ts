import type { NextRequest } from "next/server";
import { parseLeadInquiry } from "@/lib/leads/webhook-payloads";
import { invalidPayload, readJson, rejectUnauthorized, runIntake } from "@/lib/leads/webhook";

/**
 * POST /api/leads/assign — a no-form lead n8n has seen (email, Zillow, …).
 * Body { email, phone, name, source }. New person → B lead with an owner by
 * the normal rule; known person → their current owner, no new turn.
 * Auth and response shape: see lib/leads/webhook.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;
  const json = await readJson(request);
  if (!json.ok) return json.response;
  const parsed = parseLeadInquiry(json.body);
  if (!parsed.ok) return invalidPayload(parsed.error);
  return runIntake("ingest_n8n_inquiry", parsed.value);
}
