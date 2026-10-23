/** Reminder tones and how the ladder stage suggests one. Pure. */

export const TONES = [
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
