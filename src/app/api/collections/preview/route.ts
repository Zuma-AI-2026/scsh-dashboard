import { NextResponse } from "next/server";
import { buildReminder, parseReminderRequest } from "@/lib/collections/request";
import { jsonError, readBody, reminderUser, setupOrResponse } from "@/lib/collections/server";

/** The exact email the server would draft, for the sandboxed preview. */
export async function POST(req: Request) {
  const auth = await reminderUser("send");
  if ("response" in auth) return auth.response;
  const parsed = parseReminderRequest(await readBody(req), false);
  if (!parsed.ok) return jsonError(parsed.error, parsed.status);
  const r = await setupOrResponse(parsed.value.occupancyId);
  if ("response" in r) return r.response;
  const built = buildReminder(parsed.value, { ...r.setup, now: new Date() }, { enforceFigures: false });
  if (!built.ok) return jsonError(built.error, built.status);
  const { html, text, subject, totalCents, figures, charges, sender } = built.value;
  return NextResponse.json({ html, text, subject, totalCents, figures, chargeCount: charges.length, sender: sender.email });
}
