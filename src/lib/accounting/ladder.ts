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

/** Days after a stage triggers before its missing action counts as overdue. */
export const OVERDUE_GRACE_DAYS = 2;

/**
 * The current stage if it has no logged action; otherwise null. Earlier
 * stages without a log are treated as skipped, not due.
 */
export function nextActionDueOf(stages: DelinquencyStage[], daysPastDue: number | null, fulfilledStageIds: Set<number>): DelinquencyStage | null {
  const current = currentStageOf(stages, daysPastDue);
  if (!current || fulfilledStageIds.has(current.id)) return null;
  return current;
}

/** next_action_due is the current stage and more than OVERDUE_GRACE_DAYS have passed since it triggered. */
export function isActionOverdue(next: DelinquencyStage | null, daysPastDue: number | null): boolean {
  if (!next || daysPastDue === null) return false;
  return daysPastDue > next.trigger_day + OVERDUE_GRACE_DAYS;
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
