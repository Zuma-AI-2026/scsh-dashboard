"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { daysLate, defaultSubject, formatCents, totalCents, type OpenCharge } from "@/lib/collections/charges";
import { contactedRecently, contactTooltip, isTextingQuietHours, type LastContact, type ReminderMessage } from "@/lib/collections/contact";
import { defaultTo, type ContactChip } from "@/lib/collections/contacts";
import { figuresWarning, unexpectedFigures } from "@/lib/collections/figures";
import { parseEmailList } from "@/lib/collections/request";
import { CUSTOM_TONE_MAX, effectiveTone, isToneKey, SMS_MAX, TONE_STORAGE_KEY, TONES, toneForStage, toneLabel, type ToneKey } from "@/lib/collections/tones";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Setup = {
  occupancyId: number;
  tenant: string | null;
  property: string | null;
  unit: string | null;
  stage: { id: number; name: string; owner_type: string; message_tone: string | null } | null;
  daysPastDue: number | null;
  openCharges: OpenCharge[];
  emailChips: ContactChip[];
  phoneChips: ContactChip[];
  remembered: { to: string[]; cc: string[] } | null;
  senders: { id: number; email: string; display_name: string; reply_to: string | null }[];
  defaultSenderId: number | null;
  paymentNote: string;
  history: ReminderMessage[];
  lastContact: LastContact | null;
};

const input = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";
const label = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
const LEGAL_BANNER = "This is not a legal notice. Notices are served by hand on the attorney-approved form.";

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? `Request failed (${res.status}).` };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}

const joinList = (list: string[]) => list.join(", ");
const listOf = (s: string) => parseEmailList(s) ?? [];

export function RemindButton({ occupancyId, tenant }: { occupancyId: number; tenant: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} aria-label={`Payment reminder for ${tenant ?? occupancyId}`}>
        Remind…
      </Button>
      {open && <ReminderComposer occupancyId={occupancyId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Tone before the user has written much: stage suggestion, then their last choice, else Professional. */
function initialToneFor(stage: Setup["stage"]): { key: ToneKey; custom: string } {
  const fromStage = toneForStage(stage);
  if (fromStage) return { key: fromStage, custom: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(TONE_STORAGE_KEY) ?? "null") as { key?: unknown; custom?: unknown } | null;
    if (saved && isToneKey(saved.key)) return { key: saved.key, custom: typeof saved.custom === "string" ? saved.custom.slice(0, CUSTOM_TONE_MAX) : "" };
  } catch {}
  return { key: "professional", custom: "" };
}

function ReminderComposer({ occupancyId, onClose }: { occupancyId: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    let cancelled = false;
    fetch(`/api/collections/context?occupancy=${occupancyId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError((json as { error?: string }).error ?? `Could not load (${res.status}).`);
        else setSetup(json as Setup);
      })
      .catch(() => !cancelled && setLoadError("Network error. Close and try again."));
    return () => {
      cancelled = true;
    };
  }, [occupancyId]);

  return (
    <dialog
      ref={ref}
      // Esc and clicks outside must not throw away a half-written message; only Close does.
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(960px,96vw)] max-w-none rounded-lg border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Payment reminder</h2>
            {setup && (
              <p className="text-xs text-muted-foreground">
                {[setup.tenant, [setup.property, setup.unit].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                {setup.stage && ` · stage: ${setup.stage.name}`}
                {setup.daysPastDue !== null && ` · ${setup.daysPastDue} days past due`}
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="overflow-y-auto px-4 py-3">
          {loadError ? (
            <p className="text-sm text-negative">{loadError}</p>
          ) : !setup ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading charges and contacts…
            </p>
          ) : (
            <ComposerBody setup={setup} />
          )}
        </div>
      </div>
    </dialog>
  );
}

function ComposerBody({ setup }: { setup: Setup }) {
  const router = useRouter();
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<"email" | "text">("email");

  const [senderId, setSenderId] = useState<number | null>(setup.defaultSenderId);
  const sender = setup.senders.find((s) => s.id === senderId) ?? null;
  const [replyTo, setReplyTo] = useState(sender?.reply_to ?? "");
  const [to, setTo] = useState(joinList(defaultTo(setup.emailChips, setup.remembered?.to ?? null)));
  const [cc, setCc] = useState(joinList(setup.remembered?.cc ?? []));
  const [remember, setRemember] = useState(true);

  const [selected, setSelected] = useState<Set<number>>(() => new Set(setup.openCharges.map((c) => c.id)));
  const charges = useMemo(
    () =>
      setup.openCharges
        .filter((c) => selected.has(c.id))
        .map((c) => ({ ...c, days_late: daysLate(c.occurred_on, now) })),
    [setup.openCharges, selected, now],
  );
  const total = totalCents(charges);

  const [initialTone] = useState(() => initialToneFor(setup.stage));
  const [pickedTone, setPickedTone] = useState<ToneKey | null>(null);
  const [customTone, setCustomTone] = useState(initialTone.custom);
  const chooseTone = (key: ToneKey, custom = customTone) => {
    setPickedTone(key);
    setCustomTone(custom);
    try {
      localStorage.setItem(TONE_STORAGE_KEY, JSON.stringify({ key, custom }));
    } catch {}
  };

  const [subject, setSubject] = useState("");
  const shownSubject = subject || defaultSubject(setup.property, setup.unit, total);
  const [message, setMessage] = useState("");
  const toneKey = effectiveTone(pickedTone, message, initialTone.key);
  const stageTone = toneForStage(setup.stage);
  const toneHints = {
    suggestion: stageTone && setup.stage ? { key: stageTone, stage: setup.stage.name } : null,
    autoVoice: pickedTone === null && toneKey === "voice",
  };
  const [beforePolish, setBeforePolish] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "polish" | "preview" | "send" | "text">(null);
  const [notice, setNotice] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [confirmFigures, setConfirmFigures] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<{ key: string; html: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const facts = { totalCents: total, charges };
  const figures = unexpectedFigures(`${shownSubject}\n${message}`, facts);
  const legal = setup.stage?.owner_type === "human_legal";
  const recent = contactedRecently(setup.lastContact?.at, now);

  const payload = {
    occupancyId: setup.occupancyId,
    chargeIds: [...selected],
    senderId,
    to,
    cc,
    replyTo: replyTo.trim() || null,
    subject: shownSubject,
    message,
    tone: toneLabel(toneKey, customTone),
    confirmFigures,
    remember,
  };
  const previewKey = JSON.stringify({ ...payload, confirmFigures: false, remember: false });

  const toList = listOf(to);
  const ccList = listOf(cc);
  const recipientError = parseEmailList(to) === null ? "To has an invalid address." : parseEmailList(cc) === null ? "CC has an invalid address." : toList.length === 0 ? "Add at least one recipient." : null;
  const sendBlocked = !sender || charges.length === 0 || !message.trim() || !!recipientError || (figures.length > 0 && !confirmFigures);

  async function polish(mode: "email" | "sms", draft: string, apply: (t: string) => void, keep: (t: string) => void) {
    setBusy("polish");
    setNotice(null);
    const r = await postJson<{ text: string; provider: string }>("/api/collections/polish", {
      occupancyId: setup.occupancyId,
      chargeIds: [...selected],
      senderId,
      draft,
      toneKey,
      customTone,
      mode,
    });
    setBusy(null);
    if (!r.ok) return setNotice({ tone: "error", text: r.error });
    keep(draft);
    apply(r.data.text);
    setConfirmFigures(false);
  }

  async function showPreview() {
    setBusy("preview");
    setNotice(null);
    const r = await postJson<{ html: string }>("/api/collections/preview", payload);
    setBusy(null);
    if (!r.ok) return setNotice({ tone: "error", text: r.error });
    setPreview({ key: previewKey, html: r.data.html });
  }

  async function send() {
    setBusy("send");
    setNotice(null);
    const r = await postJson<{ message: string }>("/api/collections/send", payload);
    setBusy(null);
    setConfirming(false);
    if (!r.ok) return setNotice({ tone: "error", text: r.error });
    setDone(r.data.message);
    router.refresh();
  }

  const toggleCharge = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (done) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive">{done}</p>
        <p className="text-xs text-muted-foreground">Logged in this tenant&apos;s reminder history as a draft. It doesn&apos;t count as contacting the tenant (Last contacted and the Overdue badge stay as they are) until it is actually sent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {legal && <p className="rounded-md border border-negative/50 bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{LEGAL_BANNER}</p>}

      <div className="flex gap-1 border-b">
        {(["email", "text"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t === "email" ? "Email" : "Text"}
          </button>
        ))}
      </div>

      <ChargesPicker charges={setup.openCharges} selected={selected} onToggle={toggleCharge} now={now} total={total} />

      {tab === "email" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={label}>From</span>
              {setup.senders.length === 0 ? (
                <p className="text-sm text-negative">No sender mailbox is set up. An admin adds one under Admin → Collections.</p>
              ) : (
                <select
                  className={input}
                  value={senderId ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSenderId(id);
                    setReplyTo(setup.senders.find((s) => s.id === id)?.reply_to ?? "");
                  }}
                >
                  {setup.senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name} &lt;{s.email}&gt;
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="space-y-1">
              <span className={label}>Reply-To (optional)</span>
              <input className={input} type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="Replies go to the sender" />
            </label>
          </div>

          <RecipientChips chips={setup.emailChips} to={to} cc={cc} setTo={setTo} setCc={setCc} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={label}>To</span>
              <input className={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="tenant@example.com, …" />
            </label>
            <label className="space-y-1">
              <span className={label}>CC</span>
              <input className={input} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-primary" />
            Use these recipients next time
          </label>

          <label className="block space-y-1">
            <span className={label}>Subject</span>
            <input className={input} value={shownSubject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>

          <MessageEditor
            value={message}
            onChange={(v) => {
              setMessage(v);
              setConfirmFigures(false);
            }}
            placeholder="Write or dictate your message. The charges table, payment note and signature are added below it automatically."
          />

          <ToneRow toneKey={toneKey} customTone={customTone} onChange={chooseTone} {...toneHints}>
            <Button size="sm" variant="outline" disabled={busy !== null || charges.length === 0} onClick={() => polish("email", message, setMessage, setBeforePolish)}>
              {busy === "polish" ? <Loader2 className="size-3.5 animate-spin" /> : null}✨ Polish with AI
            </Button>
            {beforePolish !== null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMessage(beforePolish);
                  setBeforePolish(null);
                }}
              >
                Undo polish
              </Button>
            )}
          </ToneRow>

          <FiguresWarning figures={figures} total={total} confirmed={confirmFigures} onConfirm={setConfirmFigures} />

          {notice && <p className={cn("text-sm", notice.tone === "error" ? "text-negative" : "text-positive")}>{notice.text}</p>}

          {confirming ? (
            <div className="space-y-2 rounded-md border bg-card p-3">
              {recent && setup.lastContact && (
                <p className="rounded-md border border-warning/50 bg-warning/10 px-2 py-1.5 text-sm text-warning">
                  This tenant was already contacted {relativeTime(setup.lastContact.at, now)} ({contactTooltip(setup.lastContact)}).
                </p>
              )}
              <p className="text-sm">
                Send {charges.length} charge{charges.length === 1 ? "" : "s"} ({formatCents(total)}) from {sender?.email} to {joinList([...toList, ...ccList])}?
              </p>
              <p className="text-xs text-muted-foreground">For now this saves a draft in the sender&apos;s Outlook; you press Send there. A draft doesn&apos;t clear the Overdue badge.</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={send}>
                  {busy === "send" && <Loader2 className="size-3.5 animate-spin" />}Yes, send it
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirming(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null || charges.length === 0 || !sender} onClick={showPreview}>
                {busy === "preview" && <Loader2 className="size-3.5 animate-spin" />}Preview
              </Button>
              <Button size="sm" disabled={busy !== null || sendBlocked} onClick={() => setConfirming(true)}>
                Send…
              </Button>
              {recipientError && message.trim() && <span className="text-xs text-negative">{recipientError}</span>}
            </div>
          )}

          {preview && (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className={label}>Preview{preview.key !== previewKey ? " — out of date, click Preview again" : ""}</span>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setPreview(null)}>
                  Hide
                </button>
              </div>
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-md border bg-white" />
            </div>
          )}
        </div>
      ) : (
        <TextTab
          setup={setup}
          now={now}
          message={message}
          charges={charges}
          total={total}
          toneKey={toneKey}
          customTone={customTone}
          chooseTone={chooseTone}
          toneHints={toneHints}
          polish={polish}
          busy={busy}
          setBusy={setBusy}
          onLogged={() => router.refresh()}
        />
      )}

      <History history={setup.history} />
    </div>
  );
}

function ChargesPicker({ charges, selected, onToggle, now, total }: { charges: OpenCharge[]; selected: Set<number>; onToggle: (id: number) => void; now: Date; total: number }) {
  if (charges.length === 0) {
    return <p className="text-sm text-negative">No open charges are on file for this tenant (they arrive with the next sync). Nothing can be sent yet.</p>;
  }
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className={label}>Charges</span>
        <span className="text-sm">
          Selected total <span className="font-semibold tabular-nums">{formatCents(total)}</span>
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1" />
              <th className="px-2 py-1 text-left font-medium">Description</th>
              <th className="px-2 py-1 text-left font-medium">Date</th>
              <th className="px-2 py-1 text-right font-medium">Days late</th>
              <th className="px-2 py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} className="size-3.5 accent-primary" aria-label={`Include ${c.description ?? "charge"}`} />
                </td>
                <td className="px-2 py-1">{c.description ?? "Charge"}</td>
                <td className="px-2 py-1 whitespace-nowrap">{c.occurred_on ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{daysLate(c.occurred_on, now) ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCents(c.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecipientChips({ chips, to, cc, setTo, setCc }: { chips: ContactChip[]; to: string; cc: string; setTo: (v: string) => void; setCc: (v: string) => void }) {
  if (chips.length === 0) {
    return <p className="text-xs text-warning">No email on file for this tenant in AppFolio — type the address below.</p>;
  }
  const toList = listOf(to);
  const ccList = listOf(cc);
  const toggle = (value: string, list: string[], set: (v: string) => void) => set(joinList(list.includes(value) ? list.filter((e) => e !== value) : [...list, value]));
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const inTo = toList.includes(c.value);
        const inCc = ccList.includes(c.value);
        return (
          <span key={c.value} className={cn("inline-flex items-center overflow-hidden rounded-full border text-xs", (inTo || inCc) && "border-primary/60 bg-primary/10", c.kind === "guarantor" && "border-dashed")}>
            <button type="button" className="px-2 py-0.5 hover:bg-muted" title={`${c.name ?? ""} — click to ${inTo ? "remove from" : "add to"} To`} onClick={() => toggle(c.value, toList, setTo)}>
              {c.kind !== "tenant" && <span className="mr-1 text-[10px] uppercase text-muted-foreground">{c.kind}</span>}
              {c.value}
            </button>
            <button type="button" className="border-l px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground hover:bg-muted" title={inCc ? "Remove from CC" : "Add to CC"} onClick={() => toggle(c.value, ccList, setCc)}>
              {inCc ? "cc ✓" : "cc"}
            </button>
          </span>
        );
      })}
    </div>
  );
}

type ToneHints = { suggestion: { key: ToneKey; stage: string } | null; autoVoice: boolean };

function ToneRow({
  toneKey,
  customTone,
  onChange,
  suggestion,
  autoVoice,
  children,
}: { toneKey: ToneKey; customTone: string; onChange: (k: ToneKey, custom?: string) => void; children: React.ReactNode } & ToneHints) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className={label}>Tone</span>
          <select className={cn(input, "w-48")} value={toneKey} onChange={(e) => onChange(e.target.value as ToneKey)}>
            {TONES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {toneKey === "custom" && (
          <input className={cn(input, "w-64")} maxLength={CUSTOM_TONE_MAX} value={customTone} placeholder="Describe the tone" onChange={(e) => onChange("custom", e.target.value)} />
        )}
        {children}
      </div>
      {(suggestion && suggestion.key !== toneKey) || autoVoice ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {autoVoice && <span>Keep my voice: only fixes spelling, grammar and punctuation in what you wrote.</span>}
          {suggestion && suggestion.key !== toneKey && (
            <button type="button" onClick={() => onChange(suggestion.key)} className="rounded-full border px-2 py-0.5 hover:bg-muted hover:text-foreground">
              Suggested for {suggestion.stage}: {TONES.find((t) => t.key === suggestion.key)?.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FiguresWarning({ figures, total, confirmed, onConfirm }: { figures: string[]; total: number; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  const warning = figuresWarning(figures, total);
  if (!warning) return null;
  return (
    <div className="space-y-1 rounded-md border border-negative/50 bg-negative/10 px-3 py-2 text-sm text-negative">
      <p>{warning}</p>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} className="size-3.5 accent-primary" />
        Send anyway — I checked the figures
      </label>
    </div>
  );
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function MessageEditor({ value, onChange, placeholder, rows = 7 }: { value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<Recognition | null>(null);
  // Rendered only after a click, never on the server, so reading window here is safe.
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = area.current;
      const current = el?.value ?? "";
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const before = current.slice(0, start);
      const spaced = (before && !/\s$/.test(before) ? " " : "") + text.trim();
      const next = before + spaced + current.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = before.length + spaced.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [onChange],
  );

  function toggleDictation() {
    if (listening) return rec.current?.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) insertAtCursor(res[0].transcript);
        else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e) => setMicError(e.error === "not-allowed" ? "Microphone access was blocked." : `Dictation stopped (${e.error}).`);
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setMicError(null);
    r.start();
    setListening(true);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className={label}>Message</span>
        {supported && (
          <Button size="xs" variant={listening ? "default" : "outline"} onClick={toggleDictation}>
            {listening ? "■ Stop dictating" : "🎤 Dictate"}
          </Button>
        )}
      </div>
      <textarea ref={area} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      {interim && <p className="text-xs italic text-muted-foreground">{interim}</p>}
      {micError && <p className="text-xs text-negative">{micError}</p>}
    </div>
  );
}

function smsStarter(setup: Setup, message: string, total: number): string {
  if (message.trim()) return message.replace(/\s+/g, " ").trim();
  const first = (setup.tenant ?? "").split(/[\s,]+/)[0];
  const where = [setup.property, setup.unit].filter(Boolean).join(" ");
  return `Hi${first ? ` ${first}` : ""}, this is SCSH. A reminder that the balance of ${formatCents(total)}${where ? ` for ${where}` : ""} is past due.`;
}

function TextTab({
  setup,
  now,
  message,
  charges,
  total,
  toneKey,
  customTone,
  chooseTone,
  toneHints,
  polish,
  busy,
  setBusy,
  onLogged,
}: {
  setup: Setup;
  now: Date;
  message: string;
  charges: { id: number; amount_cents: number }[];
  total: number;
  toneKey: ToneKey;
  customTone: string;
  chooseTone: (k: ToneKey, custom?: string) => void;
  toneHints: ToneHints;
  polish: (mode: "email" | "sms", draft: string, apply: (t: string) => void, keep: (t: string) => void) => Promise<void>;
  busy: string | null;
  setBusy: (b: null | "text") => void;
  onLogged: () => void;
}) {
  const [sms, setSms] = useState(() => smsStarter(setup, message, total));
  const [beforePolish, setBeforePolish] = useState<string | null>(null);
  const [phone, setPhone] = useState(setup.phoneChips.find((c) => c.kind === "tenant")?.value ?? "");
  const [confirmFigures, setConfirmFigures] = useState(false);
  const [state, setState] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const figures = unexpectedFigures(sms, { totalCents: total, charges });
  const quiet = isTextingQuietHours(now);
  const digits = phone.replace(/[^\d+]/g, "");
  const blocked = digits.replace(/\D/g, "").length < 10 || !sms.trim() || charges.length === 0 || (figures.length > 0 && !confirmFigures);

  async function openInMessages() {
    setBusy("text");
    setState(null);
    const r = await postJson("/api/collections/text", { occupancyId: setup.occupancyId, chargeIds: charges.map((c) => c.id), phone, body: sms, tone: toneLabel(toneKey, customTone), confirmFigures });
    setBusy(null);
    if (!r.ok) return setState({ tone: "error", text: r.error });
    setState({ tone: "ok", text: `Logged as a text to ${phone}. Messages should open now.` });
    onLogged();
    window.location.href = `sms:${digits}?&body=${encodeURIComponent(sms)}`;
  }

  return (
    <div className="space-y-3">
      {quiet && <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">It&apos;s between 9 PM and 8 AM in Los Angeles — don&apos;t text tenants now.</p>}
      {setup.phoneChips.length === 0 ? (
        <p className="text-xs text-warning">No phone number on file in AppFolio — type one below.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {setup.phoneChips.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setPhone(c.value)}
              title={c.name ?? undefined}
              className={cn("rounded-full border px-2 py-0.5 text-xs hover:bg-muted", phone === c.value && "border-primary/60 bg-primary/10", c.kind === "guarantor" && "border-dashed")}
            >
              {c.kind !== "tenant" && <span className="mr-1 text-[10px] uppercase text-muted-foreground">{c.kind}</span>}
              {c.value}
            </button>
          ))}
        </div>
      )}
      <label className="block space-y-1">
        <span className={label}>Phone</span>
        <input className={cn(input, "w-56")} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(310) 555-0123" />
      </label>
      <MessageEditor
        value={sms}
        rows={4}
        onChange={(v) => {
          setSms(v);
          setConfirmFigures(false);
        }}
        placeholder="Text message"
      />
      <p className={cn("text-xs", sms.length > SMS_MAX ? "text-warning" : "text-muted-foreground")}>
        {sms.length} characters{sms.length > SMS_MAX ? ` — over ${SMS_MAX}; "Shorten with AI" can trim it` : ""}
      </p>
      <ToneRow toneKey={toneKey} customTone={customTone} onChange={chooseTone} {...toneHints}>
        <Button size="sm" variant="outline" disabled={busy !== null || charges.length === 0} onClick={() => polish("sms", sms, setSms, setBeforePolish)}>
          {busy === "polish" ? <Loader2 className="size-3.5 animate-spin" /> : null}✨ Shorten with AI
        </Button>
        {beforePolish !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSms(beforePolish);
              setBeforePolish(null);
            }}
          >
            Undo polish
          </Button>
        )}
      </ToneRow>
      <FiguresWarning figures={figures} total={total} confirmed={confirmFigures} onConfirm={setConfirmFigures} />
      {state && <p className={cn("text-sm", state.tone === "error" ? "text-negative" : "text-positive")}>{state.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigator.clipboard.writeText(sms).then(
              () => setState({ tone: "ok", text: "Copied." }),
              () => setState({ tone: "error", text: "Could not copy — select the text and copy it by hand." }),
            )
          }
        >
          Copy text
        </Button>
        <Button size="sm" disabled={busy !== null || blocked} onClick={openInMessages}>
          {busy === "text" && <Loader2 className="size-3.5 animate-spin" />}Open in Messages
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Open in Messages logs the text on this row and as this stage&apos;s follow-up, then opens your phone&apos;s Messages app with the text filled in.</p>
    </div>
  );
}

const STATUS_LABEL: Record<ReminderMessage["status"], string> = { drafted: "Outlook draft", sent: "sent", failed: "failed", text_opened: "text opened" };

function History({ history }: { history: ReminderMessage[] }) {
  if (history.length === 0) return <p className="text-xs text-muted-foreground">No earlier reminders.</p>;
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">Earlier messages ({history.length})</summary>
      <ul className="divide-y text-xs">
        {history.map((m) => (
          <li key={m.id} className="grid grid-cols-[8rem_3.5rem_1fr_5rem_6rem] gap-2 px-3 py-1.5">
            <span>{formatDateTime(m.created_at)}</span>
            <span>{m.channel}</span>
            <span className="truncate" title={`${m.sender ?? m.sent_by} → ${[...m.to, ...m.cc].join(", ")}`}>
              {m.sender ?? m.sent_by} → {[...m.to, ...m.cc].join(", ")}
            </span>
            <span className="text-right tabular-nums">{formatCents(m.total_cents)}</span>
            <span className={cn(m.status === "failed" && "text-negative")}>{STATUS_LABEL[m.status]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
