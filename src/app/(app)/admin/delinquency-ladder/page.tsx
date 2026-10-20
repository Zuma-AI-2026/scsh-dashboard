import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { NoAccess } from "@/components/app-shell/section-page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MESSAGE_TONES, OWNER_TYPE_LABEL, OWNER_TYPES, type DelinquencyStage } from "@/lib/accounting/ladder";
import { requireUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { moveStage, saveLadder } from "./actions";

export const metadata: Metadata = { title: "Delinquency ladder · Admin" };

export default async function DelinquencyLadderPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delinquency_stages")
    .select("id, sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active")
    .order("sort_order");
  if (error) throw new Error(error.message);
  const stages = (data ?? []) as DelinquencyStage[];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground">
            Admin
          </Link>{" "}
          / Delinquency ladder
        </div>
        <h1 className="text-lg font-semibold">Delinquency ladder</h1>
        <p className="text-sm text-muted-foreground">
          Days past due at which each stage starts. Trigger days must strictly increase down the list. Up/Down moves a stage onto the neighboring day. Save name, day, owner, and toggle edits with Save ladder. Nothing is sent from here — this only decides which step is due on Accounting.
        </p>
      </div>

      <form action={saveLadder} className="space-y-3">
        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-16 text-[11px] uppercase">Order</TableHead>
                <TableHead className="h-8 w-20 text-[11px] uppercase">Day</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Name</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Action label</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Owner</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Tone</TableHead>
                <TableHead className="h-8 text-[11px] uppercase">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="py-1.5">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="sort_order" value={s.sort_order} />
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="submit"
                        formAction={moveStage}
                        name="move"
                        value={`${s.id}:up`}
                        disabled={i === 0}
                        className="h-6 rounded-md border border-input px-1.5 text-[10px] uppercase disabled:opacity-30"
                      >
                        Up
                      </button>
                      <button
                        type="submit"
                        formAction={moveStage}
                        name="move"
                        value={`${s.id}:down`}
                        disabled={i === stages.length - 1}
                        className="h-6 rounded-md border border-input px-1.5 text-[10px] uppercase disabled:opacity-30"
                      >
                        Down
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <input
                      name="trigger_day"
                      type="number"
                      min={0}
                      required
                      defaultValue={s.trigger_day}
                      className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-sm tabular"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <input name="name" type="text" required defaultValue={s.name} className="h-7 w-full min-w-36 rounded-md border border-input bg-background px-1.5 text-sm" />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <input
                      name="action_label"
                      type="text"
                      required
                      defaultValue={s.action_label}
                      className="h-7 w-full min-w-36 rounded-md border border-input bg-background px-1.5 text-sm"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <select name="owner_type" defaultValue={s.owner_type} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
                      {OWNER_TYPES.map((o) => (
                        <option key={o} value={o}>
                          {OWNER_TYPE_LABEL[o]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <select name="message_tone" defaultValue={s.message_tone ?? "none"} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
                      <option value="none">None</option>
                      {MESSAGE_TONES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <select name="is_active" defaultValue={s.is_active ? "true" : "false"} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PendingButton pendingLabel="Saving…">Save ladder</PendingButton>
      </form>
    </div>
  );
}
