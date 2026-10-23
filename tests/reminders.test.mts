import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOpenCharges } from "../src/lib/appfolio/mappers/open-charges.ts";
import { cleanAiText, pickAi, polishText, systemPrompt, type AiChoice, type PolishFacts } from "../src/lib/collections/ai.ts";
import { daysLate, defaultSubject, formatCents, type OpenCharge } from "../src/lib/collections/charges.ts";
import { contactedRecently, isTextingQuietHours, lastContactByOccupancy, notContactedFor, type ReminderMessage } from "../src/lib/collections/contact.ts";
import { contactChips, defaultTo } from "../src/lib/collections/contacts.ts";
import { renderReminderEmail } from "../src/lib/collections/email.ts";
import { unexpectedFigures } from "../src/lib/collections/figures.ts";
import { createDraft } from "../src/lib/collections/graph.ts";
import { buildReminder, parseReminderRequest, reminderAccess, type ReminderContext } from "../src/lib/collections/request.ts";
import { effectiveTone, toneDescription, toneForStage, TONES } from "../src/lib/collections/tones.ts";

const NOW = new Date("2026-10-22T19:00:00Z"); // Thu Oct 22, 12:00 PM PDT

const open: OpenCharge[] = [
  { id: 9001, occupancy_id: 77, description: "Rent", occurred_on: "2026-10-01", amount_cents: 130000 },
  { id: 9002, occupancy_id: 77, description: "Late Fee", occurred_on: "2026-10-06", amount_cents: 7500 },
  { id: 9003, occupancy_id: 77, description: "Parking", occurred_on: "2026-09-01", amount_cents: 15000 },
  { id: 5555, occupancy_id: 88, description: "Rent (someone else)", occurred_on: "2026-10-01", amount_cents: 99900 },
];

const ctx: ReminderContext = {
  occupancyId: 77,
  tenant: "Jane Doe",
  property: "2642 Ellendale Place",
  unit: "101",
  openCharges: open,
  senders: [
    { id: 1, email: "accounting@scshdev.com", display_name: "SCSH Accounting", reply_to: null, signature: "SCSH Accounting", active: true },
    { id: 2, email: "old@scshdev.com", display_name: "Old", reply_to: null, signature: "", active: false },
  ],
  paymentNote: "Pay in the portal.",
  now: NOW,
};

const body = (over: Record<string, unknown> = {}) => ({
  occupancyId: 77,
  chargeIds: [9001, 9002],
  senderId: 1,
  to: "Jane@Example.com",
  cc: "",
  replyTo: "",
  subject: "",
  message: "Hi Jane, the total is $1,375.00 for the charges listed below.",
  tone: "Friendly reminder",
  ...over,
});

function build(over: Record<string, unknown> = {}, enforceFigures = true) {
  const parsed = parseReminderRequest(body(over), true);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error();
  return buildReminder(parsed.value, ctx, { enforceFigures });
}

describe("server-built reminder", () => {
  it("ignores any amounts the browser sends and computes the total itself", () => {
    const r = build({ totalCents: 1, amount: 0.01, charges: [{ id: 9001, amount_cents: 1 }] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.totalCents, 137500);
    assert.deepEqual(r.value.charges.map((c) => c.amount_cents), [130000, 7500]);
    assert.equal(r.value.subject, "Balance due — 2642 Ellendale Place 101: $1,375.00");
  });
  it("drops charges that belong to another occupancy or aren't open", () => {
    const r = build({ chargeIds: [9001, 5555, 123], message: "Hi Jane, the total is $1,300.00." });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value.charges.map((c) => c.id), [9001]);
    const none = build({ chargeIds: [5555] });
    assert.equal(none.ok, false);
  });
  it("blocks unlisted figures unless confirmed", () => {
    const bad = build({ message: "Please pay $2,000 by Friday (invoice #4471)." });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 400);
    const confirmed = build({ message: "Please pay $2,000 by Friday.", confirmFigures: true });
    assert.equal(confirmed.ok, true);
    const preview = build({ message: "Please pay $2,000." }, false);
    assert.equal(preview.ok && preview.value.figures.join(), "$2,000");
  });
  it("only allows listed, active sender mailboxes", () => {
    assert.equal(build({ senderId: 2 }).ok, false);
    assert.equal(build({ senderId: 99 }).ok, false);
  });
  it("validates recipients", () => {
    assert.equal(parseReminderRequest(body({ to: "" }), true).ok, false);
    assert.equal(parseReminderRequest(body({ to: "not-an-email" }), true).ok, false);
    const p = parseReminderRequest(body({ to: "a@x.co; B@x.co, a@x.co" }), true);
    assert.deepEqual(p.ok && p.value.to, ["a@x.co", "b@x.co"]);
    assert.equal(parseReminderRequest(body({ to: "" }), false).ok, true);
  });
});

describe("figure scan", () => {
  const facts = { totalCents: 137500, charges: [{ id: 9001, amount_cents: 130000 }, { id: 9002, amount_cents: 7500 }] };
  it("allows the total, a selected charge, whole-dollar rounding and selected charge ids", () => {
    assert.deepEqual(unexpectedFigures("Total $1,375.00, rent $1,300 and a $75 fee (charge #9001).", facts), []);
    assert.deepEqual(unexpectedFigures("Total $1,375", facts), []);
  });
  it("flags other amounts and references", () => {
    assert.deepEqual(unexpectedFigures("You owe $1,375.50 plus a $50 fee, invoice 4471, 200 dollars", facts), ["$1,375.50", "$50", "200 dollars", "invoice 4471"]);
  });
});

describe("email", () => {
  it("orders message → table → note → signature and escapes everything", () => {
    const r = build({ message: "Hi <b>Jane</b> & co,\n\nsee the charges listed below." });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { html, text } = r.value;
    assert.ok(html.includes("Hi &lt;b&gt;Jane&lt;/b&gt; &amp; co,"));
    assert.ok(!html.includes("<b>Jane"));
    const order = ["Hi &lt;b&gt;", "Balance due for Jane Doe, 2642 Ellendale Place 101", "Late Fee", "$1,375.00", "Pay in the portal.", "SCSH Accounting"].map((s) => html.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every((i) => i >= 0));
    assert.ok(text.includes("- Rent · 10/01/2026 · 21 days late · $1,300.00"));
    assert.ok(text.endsWith("Pay in the portal.\n\nSCSH Accounting"));
  });
  it("escapes charge descriptions from AppFolio too", () => {
    const { html } = renderReminderEmail({ message: "x", tenant: "A", property: null, unit: null, charges: [{ ...open[0], description: "<script>", days_late: 1 }], paymentNote: "", signature: "" });
    assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
  });
  it("money and dates", () => {
    assert.equal(formatCents(214000), "$2,140.00");
    assert.equal(formatCents(5), "$0.05");
    assert.equal(daysLate("2026-10-22", NOW), 0);
    assert.equal(daysLate("2026-10-21", new Date("2026-10-22T06:30:00Z")), 0); // still Oct 21 in LA
    assert.equal(defaultSubject(null, null, 100), "Balance due: $1.00");
  });
});

describe("access", () => {
  it("admin/accounting send, partner reads, everyone else 403", () => {
    assert.equal(reminderAccess("admin"), "send");
    assert.equal(reminderAccess("accounting"), "send");
    assert.equal(reminderAccess("partner"), "read");
    for (const r of ["sales", "viewer", "maintenance"]) assert.equal(reminderAccess(r), "none");
  });
});

describe("contact timing", () => {
  const msg = (over: Partial<ReminderMessage>): ReminderMessage => ({
    id: 1, created_at: "2026-10-21T20:00:00Z", sent_by: "jen@scshdev.com", channel: "email", occupancy_id: 77, sender: "accounting@scshdev.com",
    to: ["jane@example.com"], cc: [], subject: "s", total_cents: 100, status: "drafted", ...over,
  });
  it("24-hour warning", () => {
    assert.equal(contactedRecently("2026-10-21T19:00:01Z", NOW), true);
    assert.equal(contactedRecently("2026-10-21T19:00:00Z", NOW), false);
    assert.equal(contactedRecently(null, NOW), false);
    assert.equal(contactedRecently("2026-10-23T00:00:00Z", NOW), false);
  });
  it("7-day filter", () => {
    assert.equal(notContactedFor(null, NOW), true);
    assert.equal(notContactedFor("2026-10-15T19:00:00Z", NOW), true);
    assert.equal(notContactedFor("2026-10-16T19:00:00Z", NOW), false);
  });
  it("drafts and failures never count as contact", () => {
    const last = lastContactByOccupancy([msg({ id: 4, status: "drafted" }), msg({ id: 5, status: "failed" })], []);
    assert.equal(last.has(77), false);
  });
  it("last contact: sent emails, opened texts and follow-up log, one contact counted once", () => {
    const last = lastContactByOccupancy(
      [msg({ id: 5, status: "drafted", created_at: "2026-10-22T18:00:00Z" }), msg({ id: 6, status: "sent" }), msg({ id: 7, status: "text_opened", channel: "text", occupancy_id: 99 })],
      [
        { occupancy_id: 77, action: "Emailed", acted_by: "jen@scshdev.com", acted_at: "2026-10-21T20:00:01Z", collection_message_id: 6 },
        { occupancy_id: 77, action: "Escalated to owner", acted_by: "x", acted_at: "2026-10-22T10:00:00Z" },
        { occupancy_id: 88, action: "Called", acted_by: "x", acted_at: "2026-10-20T10:00:00Z" },
      ],
    );
    assert.equal(last.get(77)?.at, "2026-10-21T20:00:00Z");
    assert.equal(last.get(77)?.to, "jane@example.com");
    assert.equal(last.get(88)?.channel, "Called (logged)");
    assert.equal(last.get(99)?.channel, "Text (text opened)");
  });
  it("quiet hours 9 PM – 8 AM Los Angeles", () => {
    assert.equal(isTextingQuietHours(new Date("2026-10-23T04:00:00Z")), true); // 9 PM PDT
    assert.equal(isTextingQuietHours(new Date("2026-10-23T03:59:00Z")), false); // 8:59 PM
    assert.equal(isTextingQuietHours(new Date("2026-12-01T15:59:00Z")), true); // 7:59 AM PST
    assert.equal(isTextingQuietHours(new Date("2026-12-01T16:00:00Z")), false); // 8:00 AM PST
  });
});

describe("contacts and tones", () => {
  it("guarantors are chips but never default recipients", () => {
    const chips = contactChips([
      { tenant: "Guar Antor", emails: "g@x.com", phone_numbers: "Mobile: (310) 555-0199", tenant_type: "Co-signer", primary_tenant: false },
      { tenant: "Jane", emails: "jane@x.com, JANE2@x.com", phone_numbers: "Mobile: (310) 555-0123, Home: 213.555.0100", tenant_type: "Financially Responsible", primary_tenant: true },
    ]);
    assert.deepEqual(chips.emails.map((c) => `${c.kind}:${c.value}`), ["tenant:jane@x.com", "tenant:jane2@x.com", "guarantor:g@x.com"]);
    assert.deepEqual(defaultTo(chips.emails, null), ["jane@x.com", "jane2@x.com"]);
    assert.deepEqual(defaultTo(chips.emails, ["saved@x.com"]), ["saved@x.com"]);
    assert.equal(chips.phones.length, 3);
  });
  it("stage → tone", () => {
    assert.equal(toneForStage({ name: "Courtesy reminder", message_tone: "friendly" }), "friendly");
    assert.equal(toneForStage({ name: "Late notice", message_tone: "firm" }), "firm");
    assert.equal(toneForStage({ name: "Personal contact", message_tone: null }), "professional");
    assert.equal(toneForStage({ name: "Final warning", message_tone: "final" }), "last");
    assert.equal(toneForStage({ name: "3-day notice served", message_tone: null }), null);
  });
  it("open charges from aged_receivables_detail", () => {
    const rows = mapOpenCharges(
      [
        { txn_id: 1, occupancy_id: 77, account_name: "Rent", amount_receivable: "1,300.00", invoice_occurred_on: "2026-10-01" },
        { txn_id: 1, occupancy_id: 77, account_name: "Rent", amount_receivable: "1,300.00", invoice_occurred_on: "2026-10-01" },
        { txn_id: 2, occupancy_id: 77, account: "45100000 - Parking", amount_receivable: "0.00" },
        { txn_id: 3, occupancy_id: 99, account_name: "Rent", amount_receivable: "10" },
        { txn_id: 4, occupancy_id: 77, account: "45100000 - Parking", amount_receivable: "15.00", posting_date: "2026-09-01" },
      ],
      new Set([77]),
    );
    assert.deepEqual(rows, [
      { txn_id: 1, occupancy_id: 77, description: "Rent", occurred_on: "2026-10-01", amount: 1300 },
      { txn_id: 4, occupancy_id: 77, description: "Parking", occurred_on: "2026-09-01", amount: 15 },
    ]);
  });
});

type Call = { url: string; init: RequestInit };
function mockFetch(responses: { status: number; json: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("Microsoft Graph draft (mocked)", () => {
  const creds = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" };
  it("client-credentials token, then POST /users/{sender}/messages", async () => {
    const { calls, impl } = mockFetch([
      { status: 200, json: { access_token: "tok" } },
      { status: 201, json: { id: "draft-1", webLink: "https://outlook/x" } },
    ]);
    const r = await createDraft(creds, { sender: "accounting@scshdev.com", to: ["a@x.co"], cc: ["b@x.co"], replyTo: "ar@scshdev.com", subject: "S", html: "<p>h</p>" }, impl);
    assert.equal(r.id, "draft-1");
    assert.equal(calls[0].url, "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    const form = new URLSearchParams(String(calls[0].init.body));
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("scope"), "https://graph.microsoft.com/.default");
    assert.equal(form.get("client_id"), "client-1");
    assert.equal(calls[1].url, "https://graph.microsoft.com/v1.0/users/accounting%40scshdev.com/messages");
    assert.equal(calls[1].init.method, "POST");
    assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
      subject: "S",
      body: { contentType: "HTML", content: "<p>h</p>" },
      toRecipients: [{ emailAddress: { address: "a@x.co" } }],
      ccRecipients: [{ emailAddress: { address: "b@x.co" } }],
      replyTo: [{ emailAddress: { address: "ar@scshdev.com" } }],
    });
    assert.ok(!calls.some((c) => c.url.includes("sendMail")));
  });
  it("403 → plain message about the permission", async () => {
    const { impl } = mockFetch([
      { status: 200, json: { access_token: "tok" } },
      { status: 403, json: { error: { code: "ErrorAccessDenied", message: "Access is denied." } } },
    ]);
    await assert.rejects(createDraft(creds, { sender: "x@scshdev.com", to: ["a@x.co"], cc: [], replyTo: null, subject: "S", html: "" }, impl), /Microsoft rejected the sender x@scshdev.com/);
  });
});

describe("AI polish (mocked)", () => {
  const facts: PolishFacts = { mode: "email", toneDescription: "clear", tenant: "Jane", propertyUnit: "Ellendale 101", chargeCount: 2, total: "$1,375.00", oldestDaysLate: 21, senderName: "SCSH Accounting", draft: "pls pay" };

  it("picks the provider and model from env", () => {
    assert.deepEqual(pickAi({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }), { ok: true, value: { provider: "openai", model: "gpt-6-luna", key: "o" } });
    assert.deepEqual(pickAi({ AI_PROVIDER: "gemini", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }), { ok: true, value: { provider: "gemini", model: "gemini-3.8-flash", key: "g" } });
    assert.deepEqual(pickAi({ ANTHROPIC_API_KEY: "a", AI_MODEL: "gpt-6-luna" }), { ok: true, value: { provider: "anthropic", model: "claude-sonnet-5", key: "a" } });
    assert.deepEqual(pickAi({ ANTHROPIC_API_KEY: "a", AI_MODEL: "claude-opus-5" }), { ok: true, value: { provider: "anthropic", model: "claude-opus-5", key: "a" } });
    assert.equal(pickAi({ AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "a" }).ok, false);
    assert.equal(pickAi({}).ok, false);
  });

  it("Anthropic request format", async () => {
    const { calls, impl } = mockFetch([{ status: 200, json: { content: [{ type: "text", text: "Hi Jane, …" }] } }]);
    const c: AiChoice = { provider: "anthropic", model: "claude-sonnet-5", key: "ka" };
    assert.equal(await polishText(c, facts, impl), "Hi Jane, …");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h["x-api-key"], "ka");
    assert.equal(h["anthropic-version"], "2023-06-01");
    const b = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(Object.keys(b).sort(), ["max_tokens", "messages", "model", "system"]);
    assert.equal(b.max_tokens, 900);
    assert.equal(b.messages[0].role, "user");
    assert.match(b.system, /^You edit short rent-balance reminders from Southern California Student Housing \(SCSH\)/);
    assert.match(b.system, /refer to it as "the charges listed below"/);
    assert.match(b.messages[0].content, /Total: \$1,375\.00/);
    assert.match(b.messages[0].content, /Draft:\npls pay/);
  });

  it("OpenAI request format", async () => {
    const { calls, impl } = mockFetch([{ status: 200, json: { choices: [{ message: { content: "**Hi** Jane" } }] } }]);
    assert.equal(await polishText({ provider: "openai", model: "gpt-6-luna", key: "ko" }, { ...facts, draft: "" }, impl), "Hi Jane");
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer ko");
    const b = JSON.parse(String(calls[0].init.body));
    assert.equal(b.max_completion_tokens, 3600);
    assert.deepEqual(b.messages.map((m: { role: string }) => m.role), ["system", "user"]);
    assert.match(b.messages[1].content, /No draft: write a short reminder from these facts\./);
  });

  it("Gemini request format and both output shapes", async () => {
    const a = mockFetch([{ status: 200, json: { output_text: "Hi from output_text" } }]);
    const c: AiChoice = { provider: "gemini", model: "gemini-3.8-flash", key: "kg" };
    assert.equal(await polishText(c, { ...facts, mode: "sms" }, a.impl), "Hi from output_text");
    assert.equal(a.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal((a.calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "kg");
    const b = JSON.parse(String(a.calls[0].init.body));
    assert.deepEqual(Object.keys(b).sort(), ["input", "model", "system_instruction"]);
    assert.match(b.system_instruction, /under 300 characters/);
    const s = mockFetch([{ status: 200, json: { steps: [{ type: "thought", content: [{ type: "text", text: "no" }] }, { type: "model_output", content: [{ type: "text", text: "Hi from steps" }] }] } }]);
    assert.equal(await polishText(c, facts, s.impl), "Hi from steps");
  });

  it("401/403 → '<Provider> rejected the API key'", async () => {
    for (const [provider, name] of [["anthropic", "Anthropic"], ["openai", "OpenAI"], ["gemini", "Gemini"]] as const) {
      const { impl } = mockFetch([{ status: 401, json: {} }]);
      await assert.rejects(polishText({ provider, model: "m", key: "bad" }, facts, impl), new RegExp(`^Error: ${name} rejected the API key$`));
    }
    const { impl } = mockFetch([{ status: 500, json: { error: "boom" } }]);
    await assert.rejects(polishText({ provider: "openai", model: "m", key: "k" }, facts, impl), /OpenAI error 500/);
  });
});

describe("Keep my voice", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  it("becomes the default after ~20 words unless the user picked a tone", () => {
    assert.equal(effectiveTone(null, words(20), "firm"), "firm");
    assert.equal(effectiveTone(null, words(21), "firm"), "voice");
    assert.equal(effectiveTone("strict", words(40), "firm"), "strict");
    assert.equal(effectiveTone("firm", words(40), "friendly"), "firm"); // clicking the stage chip wins
    assert.equal(effectiveTone(null, "", "friendly"), "friendly");
  });
  it("instruction keeps the writer's words, length and clean drafts", () => {
    const d = toneDescription("voice", "");
    for (const s of ["spelling, grammar and punctuation only", "sentence order", "contractions", "do not add transitions", "within 10%", "return it unchanged", '"kindly"', '"at your earliest convenience"']) {
      assert.ok(d.includes(s), s);
    }
    assert.equal(TONES[0].key, "voice");
  });
  it("every tone's prompt bans boilerplate and exclamation marks; voice adds no greeting", () => {
    for (const t of TONES) {
      const p = systemPrompt({ mode: "email", toneDescription: toneDescription(t.key, ""), keepVoice: t.key === "voice" });
      for (const phrase of ['"kindly"', '"please be advised"', '"at your earliest convenience"', '"we appreciate your prompt attention"', '"I hope this message finds you well"', "No exclamation marks."]) {
        assert.ok(p.includes(phrase), `${t.key}: ${phrase}`);
      }
      assert.equal(p.includes("Short greeting"), t.key !== "voice");
    }
    assert.match(systemPrompt({ mode: "sms", toneDescription: "x", keepVoice: true }), /300-character limit wins/);
  });
  it("strips exclamation marks the model adds anyway", () => {
    assert.equal(cleanAiText("Hi Jane! Thanks!! Really?!"), "Hi Jane. Thanks. Really?");
  });
});
