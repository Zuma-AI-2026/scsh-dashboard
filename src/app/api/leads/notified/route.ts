import { NextResponse, type NextRequest } from "next/server";
import { parseLeadNotified } from "@/lib/leads/webhook-payloads";
import { invalidPayload, readJson, rejectUnauthorized, runIntake } from "@/lib/leads/webhook";

/**
 * POST /api/leads/notified — n8n reports a notice it sent about a lead.
 * Body { lead_id, channel: "email", recipient, test_redirect, sent_at }.
 * Writes lead_events type "notified" (shown in the Rotation tabs' Notified
 * column). Idempotent per lead + channel + recipient + sent_at.
 *   200 { ok, status: "created" | "duplicate", lead_id, event_id, test_mode }
 *   404 lead not found   400 bad body   401 wrong key   500 database error
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;
  const json = await readJson(request);
  if (!json.ok) return json.response;
  const parsed = parseLeadNotified(json.body);
  if (!parsed.ok) return invalidPayload(parsed.error);
  const res = await runIntake("record_lead_notified", parsed.value);
  return res.status === 422 ? NextResponse.json(await res.json(), { status: 404 }) : res;
}
