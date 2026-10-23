import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { selectCharges, totalCents } from "@/lib/collections/charges";
import { unexpectedFigures } from "@/lib/collections/figures";
import { parseTextRequest } from "@/lib/collections/request";
import { jsonError, readBody, recordReminder, reminderUser, setupOrResponse } from "@/lib/collections/server";

/** Logs a text the user opened in Messages (status text_opened); same figure rule as email. */
export async function POST(req: Request) {
  const auth = await reminderUser("send");
  if ("response" in auth) return auth.response;
  const parsed = parseTextRequest(await readBody(req));
  if (!parsed.ok) return jsonError(parsed.error, parsed.status);
  const t = parsed.value;
  const r = await setupOrResponse(t.occupancyId);
  if ("response" in r) return r.response;

  const charges = selectCharges(r.setup.openCharges, r.setup.occupancyId, t.chargeIds, new Date());
  if (charges.length === 0) return jsonError("None of the selected charges are open any more. Reopen the reminder.", 422);
  const total = totalCents(charges);
  const figures = unexpectedFigures(t.body, { totalCents: total, charges });
  if (figures.length && !t.confirmFigures) {
    return jsonError(`The text mentions figures that aren't the total or a selected charge (${figures.join(", ")}). Tick "Send anyway — I checked the figures" to continue.`, 400);
  }

  await recordReminder(auth.user, r.setup, {
    channel: "text",
    status: "text_opened",
    sender: null,
    to: [t.phone],
    cc: [],
    replyTo: null,
    subject: null,
    body: t.body,
    tone: t.tone,
    charges,
    totalCents: total,
  });
  revalidatePath("/accounting");
  return NextResponse.json({ status: "text_opened" });
}
