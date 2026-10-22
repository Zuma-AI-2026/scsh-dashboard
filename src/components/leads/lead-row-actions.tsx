"use client";

import { useActionState, useState } from "react";
import { reassignLeadAction, setLeadStatusAction, type RowActionState } from "@/app/(app)/sales/actions";
import { cn } from "@/lib/utils";

const input = "h-7 rounded-md border border-input bg-background px-2 text-xs";
const button = "h-7 rounded-md border px-2 text-xs font-medium hover:border-primary/60 disabled:opacity-50";

function Message({ state }: { state: RowActionState }) {
  if (!state) return null;
  return <p className={cn("text-[11px]", state.ok ? "text-positive" : "text-negative")}>{state.message}</p>;
}

/**
 * Status + reassign for one lead. Shown only to an admin or the lead's owner;
 * the database checks again (require_lead_actor).
 */
export function LeadRowActions({ leadId, ownerId, agents }: { leadId: number; ownerId: number | null; agents: { id: number; name: string }[] }) {
  const [statusState, statusAction, statusPending] = useActionState(setLeadStatusAction, null);
  const [assignState, assignAction, assignPending] = useActionState(reassignLeadAction, null);
  const [status, setStatus] = useState("");
  const others = agents.filter((a) => a.id !== ownerId);

  return (
    <details className="group">
      <summary className="w-fit cursor-pointer list-none rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground group-open:border-primary/60">
        Actions
      </summary>
      <div className="mt-1 w-72 space-y-3 rounded-md border bg-popover p-3 text-left whitespace-normal">
        <form action={statusAction} className="space-y-1.5">
          <input type="hidden" name="lead_id" value={leadId} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
          <div className="flex gap-1.5">
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={cn(input, "flex-1")} required>
              <option value="">Choose…</option>
              <option value="not_interested">Not interested</option>
              <option value="leased">Leased</option>
              <option value="duplicate_of">Duplicate of…</option>
              <option value="test">Test (returns the turn)</option>
            </select>
            {status === "duplicate_of" && <input name="duplicate_of" inputMode="numeric" placeholder="Lead #" className={cn(input, "w-20")} required />}
          </div>
          <input name="reason" placeholder="Reason (optional)" className={cn(input, "w-full")} />
          <button type="submit" disabled={statusPending} className={button}>
            {statusPending ? "Saving…" : "Save status"}
          </button>
          <Message state={statusState} />
        </form>

        <form action={assignAction} className="space-y-1.5 border-t pt-3">
          <input type="hidden" name="lead_id" value={leadId} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reassign</div>
          <select name="agent_id" defaultValue="" className={cn(input, "w-full")} required>
            <option value="" disabled>
              To agent…
            </option>
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input name="reason" placeholder="Reason (required)" className={cn(input, "w-full")} required />
          <button type="submit" disabled={assignPending || others.length === 0} className={button}>
            {assignPending ? "Saving…" : "Reassign"}
          </button>
          <Message state={assignState} />
        </form>
      </div>
    </details>
  );
}
