import { NextResponse } from "next/server";
import { AiError, draftReminder, pickAi, PROVIDER_NAME } from "@/lib/collections/ai";
import { formatCents, oldestDaysLate, selectCharges, totalCents } from "@/lib/collections/charges";
import { earlierContactPhrase } from "@/lib/collections/contact";
import { parsePolishRequest } from "@/lib/collections/request";
import { jsonError, readBody, reminderUser, setupOrResponse } from "@/lib/collections/server";
import { firstName, stageKind } from "@/lib/collections/tones";

export const maxDuration = 60;

function dateLabel(ymd: string | null): string | null {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

/** "Help me write it": a first draft from the row's facts, all reloaded here. */
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
  const now = new Date();
  const charges = selectCharges(setup.openCharges, setup.occupancyId, p.chargeIds, now);
  if (charges.length === 0) return jsonError("None of the selected charges are open any more. Reopen the reminder.", 422);
  const sender = setup.senders.find((s) => s.id === p.senderId) ?? setup.senders[0];

  try {
    const text = await draftReminder(ai.value, {
      tenantFirstName: firstName(setup.tenant),
      propertyUnit: [setup.property, setup.unit].filter(Boolean).join(" "),
      chargeCount: charges.length,
      total: formatCents(totalCents(charges)),
      oldestDaysLate: oldestDaysLate(charges),
      stageName: setup.stage?.name ?? null,
      stageKind: stageKind(setup.stage),
      earlierContact: earlierContactPhrase(setup.lastContact, now),
      lastPayment: dateLabel(setup.lastPayment),
      // The person writing signs the note; the mailbox's own signature still follows.
      senderFirstName: firstName(auth.user.displayName) ?? firstName(sender?.display_name) ?? "SCSH",
    });
    return NextResponse.json({ text, provider: PROVIDER_NAME[ai.value.provider] });
  } catch (e) {
    if (e instanceof AiError) return jsonError(e.message, 502);
    throw e;
  }
}
