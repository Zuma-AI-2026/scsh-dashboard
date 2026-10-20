/** Pure ladder math. Safe to import anywhere (no server-only code). */

export const OWNER_TYPES = ["ai", "bookkeeper", "human_legal"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const MESSAGE_TONES = ["friendly", "firm", "final"] as const;
export type MessageTone = (typeof MESSAGE_TONES)[number];

export const OWNER_TYPE_LABEL: Record<OwnerType, string> = {
  ai: "AI",
  bookkeeper: "Bookkeeper",
  human_legal: "Legal",
};

export function isOwnerType(value: unknown): value is OwnerType {
  return typeof value === "string" && (OWNER_TYPES as readonly string[]).includes(value);
}

export function isMessageTone(value: unknown): value is MessageTone {
  return typeof value === "string" && (MESSAGE_TONES as readonly string[]).includes(value);
}

export type DelinquencyStage = {
  id: number;
  sort_order: number;
  name: string;
  trigger_day: number;
  owner_type: OwnerType;
  action_label: string;
  message_tone: MessageTone | null;
  is_active: boolean;
};

export function activeStages(stages: DelinquencyStage[]): DelinquencyStage[] {
  return [...stages].filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order || a.trigger_day - b.trigger_day);
}

/** Highest active stage whose trigger_day <= days past due. */
export function currentStageOf(stages: DelinquencyStage[], daysPastDue: number | null): DelinquencyStage | null {
  if (daysPastDue === null) return null;
  let current: DelinquencyStage | null = null;
  for (const s of activeStages(stages)) {
    if (s.trigger_day <= daysPastDue) current = s;
    else break;
  }
  return current;
}

/**
 * First stage at or below current_stage that has no logged action with that
 * stage_id. Null when nothing has triggered yet, or every due stage is logged.
 */
export function nextActionDueOf(stages: DelinquencyStage[], daysPastDue: number | null, fulfilledStageIds: Set<number>): DelinquencyStage | null {
  const current = currentStageOf(stages, daysPastDue);
  if (!current) return null;
  return activeStages(stages).filter((s) => s.trigger_day <= current.trigger_day).find((s) => !fulfilledStageIds.has(s.id)) ?? null;
}

export function isActionOverdue(next: DelinquencyStage | null, daysPastDue: number | null): boolean {
  if (!next || daysPastDue === null) return false;
  return next.trigger_day <= daysPastDue;
}

/** When ordered by sort_order, each trigger_day must be greater than the previous. */
export function triggerDaysIncreasingError(stages: { sort_order: number; trigger_day: number }[]): string | null {
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].trigger_day <= ordered[i - 1].trigger_day) {
      return `Trigger days must be strictly increasing along the ladder (day ${ordered[i - 1].trigger_day} is not before day ${ordered[i].trigger_day}).`;
    }
  }
  return null;
}
