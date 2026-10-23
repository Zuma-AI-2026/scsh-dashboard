/** Server-rendered reminder email (HTML + plain text). Pure; every value is escaped. */
import { formatCents, totalCents, type SelectedCharge } from "./charges.ts";

export type ReminderEmailInput = {
  message: string;
  tenant: string | null;
  property: string | null;
  unit: string | null;
  charges: SelectedCharge[];
  paymentNote: string;
  signature: string;
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escaped text with blank-line paragraphs and line breaks. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function chargeDate(ymd: string | null): string {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "—";
}

export function balanceHeading(i: Pick<ReminderEmailInput, "tenant" | "property" | "unit">): string {
  const where = [i.property, i.unit].filter(Boolean).join(" ");
  return `Balance due for ${i.tenant ?? "your account"}${where ? `, ${where}` : ""}`;
}

export function renderReminderEmail(i: ReminderEmailInput): { html: string; text: string } {
  const total = formatCents(totalCents(i.charges));
  const cell = "padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:left";
  const num = `${cell};text-align:right;white-space:nowrap`;
  const rows = i.charges
    .map(
      (c) =>
        `<tr><td style="${cell}">${escapeHtml(c.description ?? "Charge")}</td><td style="${cell};white-space:nowrap">${chargeDate(c.occurred_on)}</td><td style="${num}">${c.days_late ?? "—"}</td><td style="${num}">${formatCents(c.amount_cents)}</td></tr>`,
    )
    .join("");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f;max-width:640px">`,
    paragraphs(i.message),
    `<p style="margin:16px 0 6px;font-weight:bold">${escapeHtml(balanceHeading(i))}</p>`,
    `<table style="border-collapse:collapse;width:100%;font-size:13px" cellpadding="0" cellspacing="0">`,
    `<thead><tr><th style="${cell}">Charge</th><th style="${cell}">Date</th><th style="${num}">Days late</th><th style="${num}">Amount</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `<tfoot><tr><td style="${cell};font-weight:bold" colspan="3">Total</td><td style="${num};font-weight:bold">${total}</td></tr></tfoot>`,
    `</table>`,
    i.paymentNote.trim() ? `<div style="margin-top:16px">${paragraphs(i.paymentNote)}</div>` : "",
    i.signature.trim() ? `<div style="margin-top:16px;color:#444">${escapeHtml(i.signature.trim()).replace(/\n/g, "<br>")}</div>` : "",
    `</div>`,
  ].join("");

  const text = [
    i.message.trim(),
    "",
    balanceHeading(i),
    ...i.charges.map((c) => `- ${c.description ?? "Charge"} · ${chargeDate(c.occurred_on)} · ${c.days_late ?? "—"} days late · ${formatCents(c.amount_cents)}`),
    `Total: ${total}`,
    ...(i.paymentNote.trim() ? ["", i.paymentNote.trim()] : []),
    ...(i.signature.trim() ? ["", i.signature.trim()] : []),
  ].join("\n");

  return { html, text };
}
