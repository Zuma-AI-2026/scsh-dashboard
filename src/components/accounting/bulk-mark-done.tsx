"use client";

import { useEffect, useState } from "react";
import { bulkMarkCurrentStageDone } from "@/app/(app)/accounting/actions";
import { PendingButton } from "@/components/admin/pending-button";
import { BULK_FORM_ID } from "@/lib/accounting/types";

function boxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM_ID}"]`));
}

/**
 * Row checkboxes live in the table and attach to this form via the `form`
 * attribute, because each row already contains its own follow-up <form>.
 */
export function BulkMarkDoneBar({ eligible }: { eligible: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.getAttribute("form") === BULK_FORM_ID) setCount(boxes().filter((b) => b.checked).length);
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);

  return (
    <form
      id={BULK_FORM_ID}
      action={bulkMarkCurrentStageDone}
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-card px-3 py-2 text-xs"
    >
      <span className="font-medium uppercase tracking-wider text-muted-foreground">Admin</span>
      <button
        type="button"
        className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => {
          const all = boxes();
          const next = !all.every((b) => b.checked);
          for (const b of all) b.checked = next;
          setCount(next ? all.length : 0);
        }}
      >
        Select all with an open stage ({eligible})
      </button>
      <PendingButton
        size="xs"
        variant="outline"
        disabled={count === 0}
        pendingLabel="Backfilling…"
        onClick={(e) => {
          if (!window.confirm(`Log the current stage as done for ${count} row${count === 1 ? "" : "s"} with note "Backfilled at go-live"?`)) e.preventDefault();
        }}
      >
        Bulk: mark current stage done ({count})
      </PendingButton>
    </form>
  );
}
