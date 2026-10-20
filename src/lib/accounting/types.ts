import type { DelinquencyRow } from "@/lib/appfolio/mappers/delinquency";

export type Delinquency = DelinquencyRow & {
  property_name: string | null;
  property_address: string | null;
  owners: string | null;
  agent_of_record: string | null;
};

export type DelinquencyAction = {
  id: number;
  occupancy_id: number;
  action: string;
  note: string | null;
  acted_by: string;
  acted_at: string;
};

export const FOLLOW_UP_ACTIONS = ["Called", "Texted", "Emailed", "Payment plan", "Notice served", "Escalated to owner"] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

export function isFollowUpAction(value: unknown): value is FollowUpAction {
  return typeof value === "string" && (FOLLOW_UP_ACTIONS as readonly string[]).includes(value);
}

export const OCCUPIED_STATUSES = ["current", "notice", "evict"];
