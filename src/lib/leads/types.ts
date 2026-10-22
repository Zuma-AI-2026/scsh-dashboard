import type { LeadStage, LeadStatus, Rotation } from "./rules";

export type Agent = {
  id: number;
  name: string;
  email: string;
  appfolio_name: string | null;
  active: boolean;
  a_turns: number;
  b_turns: number;
  last_assigned_at: string | null;
};

/** A row of public.leads. */
export type LeadRecord = {
  id: number;
  guest_card_id: number | null;
  email_norm: string | null;
  phone_norm: string | null;
  name: string | null;
  first_seen_at: string;
  source_first: string | null;
  owner_agent_id: number | null;
  rotation: Rotation;
  converted_from_b: boolean;
  has_form: boolean;
  has_application: boolean;
  stage: LeadStage;
  status: LeadStatus;
  duplicate_of_lead_id: number | null;
  appfolio_assigned_user: string | null;
  owner_mismatch: boolean;
  assigned_via: "appfolio" | "rotation" | "admin" | null;
  assigned_at: string | null;
  turn_agent_id: number | null;
  turn_rotation: Rotation | null;
  turn_at: string | null;
  last_event_at: string | null;
  appfolio_status: string | null;
  property_name: string | null;
  pq_score: number | null;
  pq_tier: string | null;
  /** From source_first via lead_source_channels (0012); missing before that migration. */
  channel?: string;
  /** First prospect reply seen in AppFolio (0015); missing before that migration. */
  replied_at?: string | null;
};

/** A lead plus what the views show next to it. */
export type LeadView = LeadRecord & {
  channel: string;
  owner_name: string | null;
  /** First form or application event — when the lead became an A lead. */
  qualified_at: string | null;
  /** Any non-cancelled showing on one of the lead's guest cards. */
  tour_booked: boolean;
  /** Latest application status (AppFolio), if any. */
  application_status: string | null;
  /** Stored stage, or "expired" for a B lead with no activity for 7 days. */
  stage_now: LeadStage;
  /** Latest AppFolio activity (date, type) across the lead's guest cards — includes agent outreach. */
  appfolio_last_activity: string | null;
  appfolio_last_activity_type: string | null;
};

export type LeadEvent = {
  id: number;
  lead_id: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
  actor: string | null;
};
