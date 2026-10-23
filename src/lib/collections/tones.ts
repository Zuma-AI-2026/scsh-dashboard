/** Reminder tones and how the ladder stage suggests one. Pure. */

export const VOICE_INSTRUCTION =
  "keep my voice — fix spelling, grammar and punctuation only; keep the writer's sentence order, word choices, contractions and informal phrasing; do not reorganise, do not add transitions, do not replace plain words with formal ones (no \"kindly\", \"please be advised\", \"at your earliest convenience\", \"we appreciate your prompt attention\"); keep it the same length within 10%; if the draft is already clean, return it unchanged";

export const TONES = [
  { key: "voice", label: "Keep my voice", description: VOICE_INSTRUCTION },
  { key: "nice", label: "Nice", description: "warm and kind; a gentle nudge" },
  { key: "casual", label: "Casual", description: "relaxed and conversational, brief" },
  { key: "friendly", label: "Friendly reminder", description: "upbeat and friendly; assumes it was an oversight" },
  { key: "professional", label: "Professional", description: "clear, courteous and businesslike" },
  { key: "firm", label: "Firm follow-up", description: "direct; asks for payment promptly without softening" },
  { key: "strict", label: "Strict", description: "serious and direct; expects payment now, still respectful" },
  { key: "cold", label: "Cold", description: "neutral and minimal; facts only, no pleasantries beyond a short greeting" },
  { key: "last", label: "Last reminder", description: "serious; says plainly this is the last reminder, without naming any consequence the draft doesn't name" },
] as const;

export type ToneKey = (typeof TONES)[number]["key"] | "custom";
export const CUSTOM_TONE_MAX = 120;
/** AI-shortened texts stay under this many characters. */
export const SMS_MAX = 300;
export const TONE_STORAGE_KEY = "scsh.reminder.tone";
/** Once the draft is longer than this, "Keep my voice" becomes the default tone. */
export const VOICE_MIN_WORDS = 20;

/** Phrases no tone may use (global rule in every polish prompt). */
export const BOILERPLATE_PHRASES = ["kindly", "please be advised", "at your earliest convenience", "we appreciate your prompt attention", "I hope this message finds you well"];

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * The tone in effect: the user's explicit pick this session wins; otherwise
 * "Keep my voice" once they've written > VOICE_MIN_WORDS words; otherwise the
 * stage suggestion / last choice (`fallback`).
 */
export function effectiveTone(picked: ToneKey | null, draft: string, fallback: ToneKey): ToneKey {
  if (picked) return picked;
  if (wordCount(draft) > VOICE_MIN_WORDS) return "voice";
  return fallback;
}

export function isToneKey(v: unknown): v is ToneKey {
  return v === "custom" || TONES.some((t) => t.key === v);
}

/** Description given to the AI; custom text is trimmed and capped. */
export function toneDescription(key: ToneKey, custom: string): string {
  if (key === "custom") return custom.trim().slice(0, CUSTOM_TONE_MAX) || "professional";
  return TONES.find((t) => t.key === key)!.description;
}

export function toneLabel(key: ToneKey, custom: string): string {
  if (key === "custom") return `Custom: ${custom.trim().slice(0, CUSTOM_TONE_MAX)}`;
  return TONES.find((t) => t.key === key)!.label;
}

/** courtesy → Friendly reminder, late notice → Firm follow-up, personal contact → Professional, final warning → Last reminder. */
export function toneForStage(stage: { name: string; message_tone: string | null } | null): ToneKey | null {
  if (!stage) return null;
  const name = stage.name.toLowerCase();
  if (name.includes("courtesy")) return "friendly";
  if (name.includes("late notice")) return "firm";
  if (name.includes("personal")) return "professional";
  if (name.includes("final")) return "last";
  if (stage.message_tone === "friendly") return "friendly";
  if (stage.message_tone === "firm") return "firm";
  if (stage.message_tone === "final") return "last";
  return null;
}

/** How firm a written-from-scratch draft is. Stages from owner_type human_legal never mention legal steps. */
export type StageKind = "easy" | "personal" | "final" | "legal";

export function stageKind(stage: { name: string; message_tone: string | null; owner_type?: string } | null): StageKind {
  if (!stage) return "easy";
  if (stage.owner_type === "human_legal") return "legal";
  const tone = toneForStage(stage);
  if (tone === "professional") return "personal";
  if (tone === "last") return "final";
  return "easy";
}

/** "Jane Doe" → "Jane"; AppFolio's "Doe, Jane" → "Jane". */
export function firstName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  const given = n.includes(",") ? n.split(",")[1].trim() : n;
  return given.split(/\s+/)[0] || null;
}
