import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createDraft, GraphError, graphCredentials } from "@/lib/collections/graph";
import { buildReminder, parseReminderRequest } from "@/lib/collections/request";
import { jsonError, readBody, recordReminder, rememberRecipients, reminderUser, setupOrResponse } from "@/lib/collections/server";

/**
 * RUN A: creates a DRAFT in the sender's Outlook (Graph POST /users/{sender}/messages)
 * and logs it as "drafted". The browser sends ids and text only; charges and the
 * total are reloaded and computed here.
 */
export async function POST(req: Request) {
  const auth = await reminderUser("send");
  if ("response" in auth) return auth.response;
  const parsed = parseReminderRequest(await readBody(req), true);
  if (!parsed.ok) return jsonError(parsed.error, parsed.status);
  const r = await setupOrResponse(parsed.value.occupancyId);
  if ("response" in r) return r.response;
  const built = buildReminder(parsed.value, { ...r.setup, now: new Date() }, { enforceFigures: true });
  if (!built.ok) return jsonError(built.error, built.status);

  const creds = graphCredentials(process.env);
  if (!creds) return jsonError("Outlook is not connected yet: add MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel.", 503);

  const input = parsed.value;
  const b = built.value;
  const replyTo = input.replyTo ?? b.sender.reply_to;
  const log = {
    channel: "email" as const,
    sender: b.sender.email,
    to: input.to,
    cc: input.cc,
    replyTo,
    subject: b.subject,
    body: b.text,
    tone: input.tone,
    charges: b.charges,
    totalCents: b.totalCents,
  };

  try {
    await createDraft(creds, { sender: b.sender.email, to: input.to, cc: input.cc, replyTo, subject: b.subject, html: b.html });
  } catch (e) {
    const message = e instanceof GraphError ? e.message : "Microsoft did not answer. Nothing was saved in Outlook; try again.";
    await recordReminder(auth.user, r.setup, { ...log, status: "failed", error: message }).catch((err) => console.error("[reminders]", err));
    return jsonError(message, 502);
  }

  await recordReminder(auth.user, r.setup, { ...log, status: "drafted" });
  if (input.remember) await rememberRecipients(auth.user, r.setup.occupancyId, input.to, input.cc);
  revalidatePath("/accounting");

  return NextResponse.json({
    status: "drafted",
    message: `Draft saved in ${b.sender.display_name}'s Outlook (${b.sender.email}) — open Outlook to send. To: ${[...input.to, ...input.cc].join(", ")}`,
  });
}
