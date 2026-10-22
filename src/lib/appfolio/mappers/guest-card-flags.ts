import type { ReportRow } from "../client";

/**
 * guest_cards report -> public.guest_card_flags. Only the Notes entry that
 * starts "Property unresolved:" is kept (AppFolio prefixes entries with
 * "MM/DD/YYYY, "); the rest of the notes is never stored.
 */
export type GuestCardFlagRow = { guest_card_id: number; kind: "property_unresolved"; note: string };

const UNRESOLVED = /(?:^|\n)[ \t]*(?:\d{1,2}\/\d{1,2}\/\d{4},?[ \t]*)?(property unresolved:[^\n]*)/i;

export function unresolvedPropertyNote(notes: unknown): string | null {
  if (typeof notes !== "string") return null;
  const m = notes.match(UNRESOLVED);
  return m ? m[1].trim().slice(0, 300) : null;
}

export function mapGuestCardFlags(rows: ReportRow[]): GuestCardFlagRow[] {
  const out = new Map<number, GuestCardFlagRow>();
  for (const row of rows) {
    const id = Number(row.guest_card_id);
    if (!Number.isInteger(id) || out.has(id)) continue;
    const note = unresolvedPropertyNote(row.notes);
    if (note) out.set(id, { guest_card_id: id, kind: "property_unresolved", note });
  }
  return [...out.values()];
}
