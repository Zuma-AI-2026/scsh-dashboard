import { NextResponse } from "next/server";
import { AiError, pickAi, polishText, PROVIDER_NAME } from "@/lib/collections/ai";
import { formatCents, oldestDaysLate, selectCharges, totalCents } from "@/lib/collections/charges";
import { parsePolishRequest } from "@/lib/collections/request";
import { jsonError, readBody, reminderUser, setupOrResponse } from "@/lib/collections/server";
import { isToneKey, toneDescription } from "@/lib/collections/tones";

export const maxDuration = 60;

/** Rewrites the draft in the chosen tone. Facts (total, charges) are reloaded here, never taken from the browser. */
export async function POST(req: Request) {
  const auth = await reminderUser("send");
  if ("response" in auth) return auth.response;
  const parsed = parsePolishRequest(await readBody(req));
  if (!parsed.ok) return jsonError(parsed.error, parsed.status);
  const p = parsed.value;

  const ai = pickAi(process.env);
  if (!ai.ok) return jsonError(ai.error, 503);

  const r = await setupOrResponse(p.occupancyId);
  if ("response" in r) return r.response;
  const { setup } = r;
  const charges = selectCharges(setup.openCharges, setup.occupancyId, p.chargeIds, new Date());
  if (charges.length === 0) return jsonError("None of the selected charges are open any more. Reopen the reminder.", 422);
  const sender = setup.senders.find((s) => s.id === p.senderId) ?? setup.senders[0];

  try {
    const text = await polishText(ai.value, {
      mode: p.mode,
      toneDescription: toneDescription(isToneKey(p.toneKey) ? p.toneKey : "professional", p.customTone),
      tenant: setup.tenant,
      propertyUnit: [setup.property, setup.unit].filter(Boolean).join(" "),
      chargeCount: charges.length,
      total: formatCents(totalCents(charges)),
      oldestDaysLate: oldestDaysLate(charges),
      senderName: sender?.display_name ?? "SCSH Accounting",
      draft: p.draft,
    });
    return NextResponse.json({ text, provider: PROVIDER_NAME[ai.value.provider], model: ai.value.model });
  } catch (e) {
    if (e instanceof AiError) return jsonError(e.message, 502);
    throw e;
  }
}
