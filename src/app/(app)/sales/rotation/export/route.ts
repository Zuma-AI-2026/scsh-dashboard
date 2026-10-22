import { NextResponse, type NextRequest } from "next/server";
import { requireSection } from "@/lib/auth/current-user";
import { sectionByKey } from "@/lib/auth/roles";
import { filterRotation, leadRange, rotationCsv } from "@/lib/leads/analytics";
import { loadLeadsDataset } from "@/lib/leads/data";
import { sortRows } from "@/lib/sales/analytics";
import { loadSalesDataset } from "@/lib/sales/data";

/** GET /sales/rotation/export?rot=A|B&from&to&q&agent&mismatch — the Rotation table as CSV. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { allowed } = await requireSection(sectionByKey("sales"));
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const rotation = params.rot === "B" ? "B" : "A";
  const now = new Date();
  const leads = await loadLeadsDataset(await loadSalesDataset(), now);
  if (!leads) return NextResponse.json({ error: "leads not set up" }, { status: 409 });

  const range = leadRange(params, now);
  const rows = sortRows(filterRotation(leads.leads, rotation, params, range), "date", "desc", "date");
  return new NextResponse(rotationCsv(rows, rotation), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="rotation-${rotation}-${range.from}_${range.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
