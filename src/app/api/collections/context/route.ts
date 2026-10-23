import { NextResponse } from "next/server";
import { jsonError, reminderUser, setupOrResponse } from "@/lib/collections/server";

/** Composer data for one occupancy: charges, contacts, senders, history. Admin + accounting. */
export async function GET(req: Request) {
  const auth = await reminderUser("send");
  if ("response" in auth) return auth.response;
  const id = Number(new URL(req.url).searchParams.get("occupancy"));
  if (!Number.isInteger(id) || id <= 0) return jsonError("occupancy is required.", 400);
  const r = await setupOrResponse(id);
  if ("response" in r) return r.response;
  const { senders, ...rest } = r.setup;
  return NextResponse.json({ ...rest, senders: senders.map(({ id, email, display_name, reply_to }) => ({ id, email, display_name, reply_to })) });
}
