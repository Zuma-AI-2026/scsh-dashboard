import { BOILERPLATE_PHRASES, SMS_MAX, type StageKind } from "./tones.ts";

/**
 * "Polish with AI" for reminders. Provider and keys come from server env only
 * (AI_PROVIDER, AI_MODEL, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).
 * No framework imports; `fetchImpl` is injectable for tests.
 */

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-6-luna",
  gemini: "gemini-3.8-flash",
};

const KEY_ENV: Record<AiProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
export const PROVIDER_NAME: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" };


type Env = Record<string, string | undefined>;
const val = (env: Env, k: string) => (env[k] ?? "").trim();

export function providerOfModel(model: string): AiProvider | null {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("chatgpt") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "gemini";
  return null;
}

export type AiChoice = { provider: AiProvider; model: string; key: string };

/** AI_PROVIDER if set (it must have a key), else the first provider with a key. */
export function pickAi(env: Env): { ok: true; value: AiChoice } | { ok: false; error: string } {
  const wanted = val(env, "AI_PROVIDER").toLowerCase();
  let provider: AiProvider | undefined;
  if ((AI_PROVIDERS as readonly string[]).includes(wanted)) {
    provider = wanted as AiProvider;
    if (!val(env, KEY_ENV[provider])) return { ok: false, error: `AI_PROVIDER is ${provider} but ${KEY_ENV[provider]} is not set.` };
  } else {
    provider = AI_PROVIDERS.find((p) => val(env, KEY_ENV[p]));
  }
  if (!provider) return { ok: false, error: "AI is not set up: add ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in Vercel." };
  const custom = val(env, "AI_MODEL");
  const family = custom ? providerOfModel(custom) : null;
  const model = custom && (family === provider || family === null) ? custom : DEFAULT_MODELS[provider];
  return { ok: true, value: { provider, model, key: val(env, KEY_ENV[provider]) } };
}

export type PolishFacts = {
  mode: "email" | "sms";
  /** "Keep my voice": edit lightly, no added greeting. */
  keepVoice?: boolean;
  toneDescription: string;
  tenant: string | null;
  propertyUnit: string;
  chargeCount: number;
  total: string;
  oldestDaysLate: number | null;
  senderName: string;
  draft: string;
};

export function systemPrompt(f: Pick<PolishFacts, "mode" | "toneDescription" | "keepVoice">): string {
  const where =
    f.mode === "email"
      ? 'The charges table is added below automatically — refer to it as "the charges listed below".'
      : `This is a text message (SMS): under ${SMS_MAX} characters, one short paragraph; no table is attached.${f.keepVoice ? ` If the draft is longer, the ${SMS_MAX}-character limit wins over the length rule: trim it using the writer's own words.` : ""}`;
  return [
    "You edit short rent-balance reminders from Southern California Student Housing (SCSH) to tenants.",
    "Keep every fact and request in the draft.",
    "Add no new facts, promises, deadlines, fees, threats, eviction, legal or credit-reporting language unless the draft says it.",
    "The only dollar amount allowed is the total, written exactly as $X.XX; no other dates or amounts.",
    where,
    f.keepVoice ? "Keep the writer's greeting as written (add none); no sign-off or signature." : "Short greeting; no sign-off or signature.",
    "Plain text, no markdown, no subject line.",
    `No corporate boilerplate: never use ${BOILERPLATE_PHRASES.map((p) => `"${p}"`).join(", ")} or similar stock phrases. No exclamation marks.`,
    `Tone: ${f.toneDescription}.`,
  ].join(" ");
}

export function userPrompt(f: PolishFacts): string {
  return [
    `Tone: ${f.toneDescription}`,
    `Tenant name: ${f.tenant ?? "unknown"}`,
    `Property/unit: ${f.propertyUnit || "unknown"}`,
    `Number of charges: ${f.chargeCount}`,
    `Total: ${f.total}`,
    `Oldest charge: ${f.oldestDaysLate === null ? "unknown" : `${f.oldestDaysLate} days late`}`,
    `Sender name: ${f.senderName}`,
    `Format: ${f.mode === "email" ? "email body" : `text message under ${SMS_MAX} characters`}`,
    "",
    f.draft.trim() ? `Draft:\n${f.draft.trim()}` : "No draft: write a short reminder from these facts.",
  ].join("\n");
}

export class AiError extends Error {}

export type AiRequest = { url: string; init: RequestInit };

/** The exact HTTP request for each provider. */
export function aiRequest(c: AiChoice, system: string, user: string): AiRequest {
  const json = { "Content-Type": "application/json" };
  if (c.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: { ...json, "x-api-key": c.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: c.model, max_tokens: 900, system, messages: [{ role: "user", content: user }] }),
      },
    };
  }
  if (c.provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { ...json, Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({
          model: c.model,
          max_completion_tokens: 3600,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      },
    };
  }
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    init: {
      method: "POST",
      headers: { ...json, "x-goog-api-key": c.key },
      body: JSON.stringify({ model: c.model, system_instruction: system, input: user }),
    },
  };
}

type Part = { type?: string; text?: string };

export function extractAiText(provider: AiProvider, json: unknown): string {
  const j = (json ?? {}) as Record<string, unknown>;
  if (provider === "anthropic") {
    const content = Array.isArray(j.content) ? (j.content as Part[]) : [];
    return content.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("");
  }
  if (provider === "openai") {
    const choices = Array.isArray(j.choices) ? (j.choices as { message?: { content?: unknown } }[]) : [];
    const c = choices[0]?.message?.content;
    return typeof c === "string" ? c : "";
  }
  if (typeof j.output_text === "string") return j.output_text;
  const steps = Array.isArray(j.steps) ? (j.steps as { type?: string; content?: Part[] }[]) : [];
  return steps
    .filter((s) => s.type === "model_output")
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** Strips markdown emphasis/quotes and exclamation marks a model may add despite the prompt. */
export function cleanAiText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*["“]|["”]\s*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([?.]?)!+/g, (_, mark: string) => mark || ".")
    .trim();
}

/** One request to the chosen provider; errors are short, user-facing messages. */
export async function askAi(c: AiChoice, system: string, user: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { url, init } = aiRequest(c, system, user);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(45_000) });
  } catch {
    throw new AiError(`${PROVIDER_NAME[c.provider]} did not answer. Try again.`);
  }
  if (res.status === 401 || res.status === 403) throw new AiError(`${PROVIDER_NAME[c.provider]} rejected the API key`);
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    throw new AiError(`${PROVIDER_NAME[c.provider]} error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const text = cleanAiText(extractAiText(c.provider, await res.json().catch(() => null)));
  if (!text) throw new AiError(`${PROVIDER_NAME[c.provider]} returned no text.`);
  return text;
}

export function polishText(c: AiChoice, facts: PolishFacts, fetchImpl: typeof fetch = fetch): Promise<string> {
  return askAi(c, systemPrompt(facts), userPrompt(facts), fetchImpl);
}

// ---------------------------------------------------------------------------
// "Help me write it": a first draft from the row's facts
// ---------------------------------------------------------------------------

export type DraftFacts = {
  tenantFirstName: string | null;
  propertyUnit: string;
  chargeCount: number;
  total: string;
  oldestDaysLate: number | null;
  stageName: string | null;
  stageKind: StageKind;
  /** e.g. "emailed 8 days ago (Oct 14)"; null = first contact. */
  earlierContact: string | null;
  lastPayment: string | null;
  senderFirstName: string;
};

const FIRMNESS: Record<StageKind, string> = {
  easy: "easygoing and matter-of-fact; it may simply have slipped their mind",
  personal: "a little more direct; say you'd like to hear from them about it",
  final: "serious and plain; say clearly that if it isn't sorted out, the next step is a formal notice. No legal wording beyond that",
  legal: "direct and plain; do not mention notices, attorneys, court or any legal step",
};

export function draftSystemPrompt(f: Pick<DraftFacts, "stageKind" | "earlierContact" | "senderFirstName">): string {
  return [
    "You write payment reminder emails for Southern California Student Housing (SCSH) to tenants, as the person named below.",
    "Write like a real person: a short, plain email of 4 to 7 sentences, with contractions.",
    "Open with a short greeting using the tenant's first name.",
    'Say plainly that this is a reminder about their balance, state the total exactly as given ($X.XX), and refer to "the charges listed below" (the table is added automatically).',
    "Offer one concrete next step: pay in the tenant portal, or reply if something looks wrong or they need a payment plan.",
    `Close with a plain line: "Thanks — ${f.senderFirstName}".`,
    "No humor, no apology for writing, no threats, no eviction or credit-reporting language.",
    "Add no facts, fees, deadlines or promises that aren't given. The only dollar amount allowed is the total; the only date you may mention is the last payment date if given.",
    "Plain text, no markdown, no subject line.",
    `No corporate boilerplate: never use ${BOILERPLATE_PHRASES.map((p) => `"${p}"`).join(", ")} or similar stock phrases. No exclamation marks.`,
    `Firmness: ${FIRMNESS[f.stageKind]}.`,
    f.earlierContact
      ? `This is a follow-up: we already ${f.earlierContact}. Reference it naturally, e.g. "I wrote last week about…" (use the right verb and timing).`
      : "This is the first time we're reaching out about this balance; don't refer to earlier messages.",
  ].join(" ");
}

export function draftUserPrompt(f: DraftFacts): string {
  return [
    `Tenant first name: ${f.tenantFirstName ?? "unknown (greet with just \"Hi,\")"}`,
    `Property/unit: ${f.propertyUnit || "unknown"}`,
    `Number of charges: ${f.chargeCount}`,
    `Total: ${f.total}`,
    `Oldest charge: ${f.oldestDaysLate === null ? "unknown" : `${f.oldestDaysLate} days late`}`,
    `Ladder stage: ${f.stageName ?? "none"}`,
    `Earlier contact: ${f.earlierContact ?? "none — first contact"}`,
    `Last payment: ${f.lastPayment ?? "unknown"}`,
    `Sender first name: ${f.senderFirstName}`,
    "",
    "Write the email body.",
  ].join("\n");
}

export function draftReminder(c: AiChoice, facts: DraftFacts, fetchImpl: typeof fetch = fetch): Promise<string> {
  return askAi(c, draftSystemPrompt(facts), draftUserPrompt(facts), fetchImpl);
}
