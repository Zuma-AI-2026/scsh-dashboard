import type { LeadView } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const pill = "inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap";

/** Dashboard owner; flags when AppFolio's assigned user is someone else. */
export function OwnerCell({ lead }: { lead: Pick<LeadView, "owner_name" | "owner_mismatch" | "appfolio_assigned_user"> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {lead.owner_name ? <span>{lead.owner_name}</span> : <span className="text-muted-foreground">Unassigned</span>}
      {lead.owner_mismatch && (
        <span title={`AppFolio says: ${lead.appfolio_assigned_user ?? "—"}`} className={cn(pill, "border-warning/40 bg-warning/10 text-warning")}>
          AF: {lead.appfolio_assigned_user ?? "—"}
        </span>
      )}
    </span>
  );
}

export function RotationBadge({ rotation, converted }: { rotation: "A" | "B"; converted?: boolean }) {
  return (
    <span
      title={converted ? "Converted from B" : rotation === "A" ? "Rotation A: form or application" : "Rotation B: no form"}
      className={cn(pill, rotation === "A" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted text-foreground/80")}
    >
      {rotation}
      {converted && <span className="ml-0.5 text-[10px] opacity-80">←B</span>}
    </span>
  );
}

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  form_filled: "Form filled",
  tour: "Tour",
  application: "Application",
  leased: "Leased",
  not_interested: "Not interested",
  expired: "Expired",
};

export function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "leased"
      ? "border-positive/40 bg-positive/10 text-positive"
      : stage === "not_interested" || stage === "expired"
        ? "border-negative/40 bg-negative/10 text-negative"
        : stage === "new"
          ? "border-border bg-muted text-foreground/80"
          : "border-primary/40 bg-primary/10 text-primary";
  return <span className={cn(pill, tone)}>{STAGE_LABEL[stage] ?? stage}</span>;
}

export const LEAD_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  test: "Test",
  duplicate_of: "Duplicate",
  not_interested: "Not interested",
  leased: "Leased",
};
