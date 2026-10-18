import { NextResponse, type NextRequest } from "next/server";
import { syncSales } from "@/lib/appfolio/sync";
import { requireEnv } from "@/lib/env";

/**
 * GET|POST /api/cron/sync-sales
 *
 * Scheduled AppFolio -> Supabase sync for the Sales section.
 * Protected by CRON_SECRET. Accepts either:
 *   Authorization: Bearer <CRON_SECRET>    (what Vercel Cron sends automatically)
 *   x-cron-secret: <CRON_SECRET>           (for cron-job.org, curl, etc.)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(request: NextRequest): boolean {
  const secret = requireEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization");
  const header = request.headers.get("x-cron-secret");
  return bearer === `Bearer ${secret}` || header === secret;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncSales();
    return NextResponse.json(result, { status: result.status === "success" ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sales] fatal", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
