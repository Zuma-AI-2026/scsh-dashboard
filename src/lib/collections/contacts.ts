/** Recipient chips from tenant_contacts. Pure. */

export type ContactKind = "tenant" | "guarantor" | "occupant";
export type ContactChip = { kind: ContactKind; name: string | null; value: string };

export function contactKind(tenantType: string | null | undefined): ContactKind {
  const t = (tenantType ?? "").toLowerCase();
  if (t.includes("co-signer") || t.includes("cosigner") || t.includes("guarant")) return "guarantor";
  if (t.includes("occupant")) return "occupant";
  return "tenant";
}

export function splitEmails(s: string | null | undefined): string[] {
  return (s ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/** "Mobile: (310) 555-0123, Home: 213.555.0100" → ["(310) 555-0123", "213.555.0100"]. */
export function splitPhones(s: string | null | undefined): string[] {
  return [...(s ?? "").matchAll(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)].map((m) => m[0].trim());
}

type ContactRow = { tenant: string | null; emails: string | null; phone_numbers: string | null; tenant_type?: string | null; primary_tenant?: boolean | null };

export function contactChips(rows: ContactRow[]): { emails: ContactChip[]; phones: ContactChip[] } {
  const sorted = [...rows].sort((a, b) => Number(!!b.primary_tenant) - Number(!!a.primary_tenant));
  const emails: ContactChip[] = [];
  const phones: ContactChip[] = [];
  for (const r of sorted) {
    const kind = contactKind(r.tenant_type);
    for (const e of splitEmails(r.emails)) if (!emails.some((c) => c.value === e)) emails.push({ kind, name: r.tenant, value: e });
    for (const p of splitPhones(r.phone_numbers)) {
      const digits = p.replace(/\D/g, "").slice(-10);
      if (!phones.some((c) => c.value.replace(/\D/g, "").slice(-10) === digits)) phones.push({ kind, name: r.tenant, value: p });
    }
  }
  return { emails, phones };
}

/** Default To: remembered list, else every tenant (never guarantors/occupants). */
export function defaultTo(chips: ContactChip[], remembered: string[] | null): string[] {
  if (remembered && remembered.length) return remembered;
  return chips.filter((c) => c.kind === "tenant").map((c) => c.value);
}
