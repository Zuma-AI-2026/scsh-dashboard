import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { NoAccess } from "@/components/app-shell/section-page";
import { requireUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { savePaymentNote, saveSender, setDefaultSender } from "./actions";

export const metadata: Metadata = { title: "Collections · Admin" };

type SenderRow = { id: number; email: string; display_name: string; reply_to: string | null; signature: string; is_default: boolean; active: boolean };

const input = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";
const area = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const label = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

export default async function CollectionsAdminPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const supabase = await createSupabaseServerClient();
  const [senders, settings] = await Promise.all([
    supabase.from("collection_senders").select("id, email, display_name, reply_to, signature, is_default, active").order("id"),
    supabase.from("collection_settings").select("payment_note").eq("id", 1).maybeSingle(),
  ]);
  const missing = senders.error || settings.error;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground">
            Admin
          </Link>{" "}
          / Collections
        </div>
        <h1 className="text-lg font-semibold">Payment reminders</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Mailboxes Accounting may send reminders from, each with its signature and Reply-To, and the payment note added under the charges table. Only active mailboxes listed here can be used; the
          Microsoft app&apos;s access policy must allow the same mailboxes. For now each reminder is saved as a draft in that mailbox&apos;s Outlook.
        </p>
      </div>

      {missing ? (
        <p className="text-sm text-negative">Run migration 0017 first ({(senders.error ?? settings.error)!.message}).</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className={label}>Sender mailboxes</h2>
            {((senders.data ?? []) as SenderRow[]).map((s) => (
              <div key={s.id} className={cn("space-y-2 rounded-md border bg-card p-3", !s.active && "opacity-70")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {s.email}
                    {s.is_default && <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">default</span>}
                    {!s.active && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}
                  </div>
                  {!s.is_default && (
                    <form action={setDefaultSender}>
                      <input type="hidden" name="id" value={s.id} />
                      <PendingButton size="xs" variant="outline" pendingLabel="…">
                        Make default
                      </PendingButton>
                    </form>
                  )}
                </div>
                <SenderForm sender={s} />
              </div>
            ))}
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <div className="text-sm font-medium">Add a mailbox</div>
              <SenderForm />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className={label}>Payment note</h2>
            <form action={savePaymentNote} className="max-w-3xl space-y-2">
              <textarea name="payment_note" rows={4} maxLength={2000} defaultValue={(settings.data?.payment_note as string | undefined) ?? ""} className={area} />
              <p className="text-xs text-muted-foreground">Shown under the charges table in every reminder email, before the signature.</p>
              <PendingButton size="sm" pendingLabel="Saving…">
                Save payment note
              </PendingButton>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

function SenderForm({ sender }: { sender?: SenderRow }) {
  return (
    <form action={saveSender} className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1">
        <span className={label}>Mailbox</span>
        {sender ? <input type="hidden" name="email" value={sender.email} /> : null}
        <input className={input} type="email" name={sender ? undefined : "email"} required defaultValue={sender?.email} disabled={!!sender} placeholder="accounting@scshdev.com" />
      </label>
      <label className="space-y-1">
        <span className={label}>Display name</span>
        <input className={input} name="display_name" required maxLength={80} defaultValue={sender?.display_name} placeholder="SCSH Accounting" />
      </label>
      <label className="space-y-1">
        <span className={label}>Reply-To (optional)</span>
        <input className={input} type="email" name="reply_to" defaultValue={sender?.reply_to ?? ""} />
      </label>
      <label className="flex items-end gap-2 pb-1.5 text-sm">
        <input type="checkbox" name="active" defaultChecked={sender?.active ?? true} className="size-3.5 accent-primary" />
        Active
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className={label}>Signature</span>
        <textarea name="signature" rows={3} maxLength={1000} defaultValue={sender?.signature} className={area} />
      </label>
      <div className="sm:col-span-2">
        <PendingButton size="sm" variant="outline" pendingLabel="Saving…">
          {sender ? "Save" : "Add mailbox"}
        </PendingButton>
      </div>
    </form>
  );
}
