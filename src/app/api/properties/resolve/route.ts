import { NextResponse, type NextRequest } from "next/server";
import { rejectUnauthorized } from "@/lib/leads/webhook";
import { resolveProperty, type ResolvableProperty } from "@/lib/properties/resolve";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/properties/resolve?q=<free text> — best-matching MANAGED property
 * for n8n. Header X-PQ-Key = PQ_SUBMIT_KEY.
 *
 *   200 { ok, property_id, property_integration_id, property_name, confidence, test_mode }
 *   404 { ok: false, error: "no_match", best }          nothing scored ≥ 0.75
 *   409 { ok: false, error: "ambiguous", candidates }   two properties scored the same
 *   400 missing / overlong q   401 wrong key   500 database error
 */
export const dynamic = "force-dynamic";

const brief = (c: { property: ResolvableProperty; confidence: number }) => ({
  property_id: c.property.property_id,
  property_integration_id: c.property.property_integration_id,
  property_name: c.property.property_name,
  confidence: c.confidence,
});

export async function GET(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 300) {
    return NextResponse.json({ ok: false, error: "invalid_query", detail: "q is required (max 300 characters)" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const [props, setting] = await Promise.all([
    admin.from("properties").select("property_id, property_integration_id, property_name, property_street, property_street2").eq("is_managed", true),
    admin.from("app_settings").select("value").eq("key", "notifications_test_mode").maybeSingle(),
  ]);
  if (props.error) {
    console.error("[properties/resolve]", props.error.message);
    return NextResponse.json({ ok: false, error: "database_error" }, { status: 500 });
  }
  const test_mode = setting.data?.value === true;

  const r = resolveProperty(q, (props.data ?? []) as ResolvableProperty[]);
  if (r.kind === "match") return NextResponse.json({ ok: true, q, ...brief(r), test_mode });
  if (r.kind === "ambiguous") {
    return NextResponse.json({ ok: false, error: "ambiguous", q, candidates: r.candidates.map(brief), test_mode }, { status: 409 });
  }
  return NextResponse.json({ ok: false, error: "no_match", q, best: r.best ? brief(r.best) : null, test_mode }, { status: 404 });
}
