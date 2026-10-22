import { OwnerCell, StageBadge } from "@/components/leads/badges";
import { LeadRowActions } from "@/components/leads/lead-row-actions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { dayLabel, laDay } from "@/lib/leads/activity";
import { channelLabel, formatPhone } from "@/lib/leads/analytics";
import type { LeadsDataset } from "@/lib/leads/data";
import { EXPIRY_DAYS } from "@/lib/leads/rules";
import { MY_LEAD_GROUPS, myLeads, type MyLead, type MyLeadGroup } from "@/lib/leads/my-leads";
import type { Params } from "@/lib/sales/analytics";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "./data-table";
import { FilterBar } from "./filter-bar";
import { StatusBadge } from "./status-badge";

const dim = "text-muted-foreground";
const text = (v: string | null | undefined) => (v ? v : <span className={dim}>—</span>);

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">{children}</p>;
}

export function MyLeadsTab({ leads, params, now, user }: { leads: LeadsDataset | null; params: Params; now: Date; user: CurrentUser }) {
  if (!leads) return <Note>Lead tracking isn&apos;t set up yet. Run migrations 0008 – 0016 in Supabase, then sync once.</Note>;

  const isAdmin = user.role === "admin";
  const me = leads.agents.find((a) => a.email.toLowerCase() === user.email.toLowerCase()) ?? null;
  const picked = isAdmin && params.agent ? leads.agents.find((a) => String(a.id) === params.agent) ?? null : null;

  let owners: Set<number>;
  let title: string;
  if (picked) {
    owners = new Set([picked.id]);
    title = `${picked.name}'s leads`;
  } else if (isAdmin) {
    owners = new Set(leads.agents.map((a) => a.id));
    title = "Everyone's leads";
  } else if (me) {
    owners = new Set([me.id]);
    title = "My leads";
  } else {
    return (
      <Note>
        Your login ({user.email}) isn&apos;t linked to an agent. An admin can add it under Admin → Agents (the agent&apos;s email must match your login).
      </Note>
    );
  }

  const includeInactive = params.inactive === "1";
  const groups = myLeads(leads.leads, owners, now, includeInactive);
  const showOwner = owners.size > 1;

  const last: Column<MyLead> = {
    key: "last_activity",
    label: "Last activity",
    render: (r) => (
      <span>
        {dayLabel(r.last_activity, r.last_activity.slice(0, 4) !== laDay(now.toISOString()).slice(0, 4))}
        {r.appfolio_last_activity_type && r.appfolio_last_activity?.slice(0, 10) === r.last_activity && <span className={cn("ml-1 text-xs", dim)}>· {r.appfolio_last_activity_type}</span>}
      </span>
    ),
  };
  const name: Column<MyLead> = {
    key: "name",
    label: "Name",
    render: (r) => (
      <span className="flex flex-col">
        <span className="font-medium">{text(r.name ?? r.email_norm)}</span>
        {r.name && r.email_norm && <span className={cn("text-xs", dim)}>{r.email_norm}</span>}
      </span>
    ),
  };
  const phone: Column<MyLead> = {
    key: "phone_norm",
    label: "Phone",
    render: (r) => (r.phone_norm ? <span className="whitespace-nowrap">{formatPhone(r.phone_norm)}</span> : <span className={cn("text-xs italic", dim)}>no phone</span>),
  };
  const channel: Column<MyLead> = { key: "channel", label: "Channel", render: (r) => <span title={r.source_first ?? "No source"}>{channelLabel(r.channel)}</span> };
  const property: Column<MyLead> = { key: "property_name", label: "Property", render: (r) => text(r.property_name) };
  const owner: Column<MyLead>[] = showOwner ? [{ key: "owner_name", label: "Owner", render: (r) => <OwnerCell lead={r} /> }] : [];
  const activeAgents = leads.agents.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));
  const canAct = (r: MyLead) => isAdmin || (user.role === "sales" && me !== null && r.owner_agent_id === me.id);
  const actions: Column<MyLead> = {
    key: "actions",
    label: "",
    render: (r) => (canAct(r) ? <LeadRowActions leadId={r.id} ownerId={r.owner_agent_id} agents={activeAgents} /> : null),
  };

  const columns: Record<MyLeadGroup, Column<MyLead>[]> = {
    nurturing: [
      {
        key: "days_idle",
        label: "Days idle",
        align: "right",
        render: (r) => <span className={cn("tabular font-semibold", r.days_idle >= EXPIRY_DAYS ? "text-negative" : r.days_idle >= 3 ? "text-warning" : undefined)}>{r.days_idle}</span>,
      },
      last,
      name,
      phone,
      channel,
      property,
      { key: "first_seen_at", label: "First seen", render: (r) => dayLabel(laDay(r.first_seen_at), true) },
      ...owner,
      actions,
    ],
    active: [
      last,
      name,
      phone,
      channel,
      property,
      { key: "stage_now", label: "Stage", render: (r) => <StageBadge stage={r.stage_now} /> },
      { key: "why", label: "Why active", render: (r) => <span className={cn("text-xs", dim)}>{r.rotation === "A" ? (r.converted_from_b ? "Form (from B)" : "Form / application") : "Replied"}</span> },
      ...owner,
      actions,
    ],
    tour: [last, name, phone, channel, property, { key: "days_idle", label: "Days idle", align: "right", render: (r) => <span className="tabular">{r.days_idle}</span> }, ...owner, actions],
    application: [
      last,
      name,
      phone,
      property,
      { key: "application_status", label: "Application", render: (r) => (r.application_status ? <StatusBadge value={r.application_status} /> : "Yes") },
      ...owner,
      actions,
    ],
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className={cn("text-xs", dim)}>
            Open leads only (not leased, not marked not-interested{includeInactive ? "" : ", not Inactive/Cold in AppFolio"}). Last activity = the latest of AppFolio activity, inquiries, forms, tours, applications and replies.
          </p>
        </div>
        <FilterBar
          keep={["tab"]}
          filters={[
            ...(isAdmin
              ? [{ kind: "select" as const, name: "agent", label: "Agent", allLabel: "Everyone", options: leads.agents.map((a) => ({ value: String(a.id), label: a.active ? a.name : `${a.name} (inactive)` })) }]
              : []),
            { kind: "toggle", name: "inactive", label: "Include Inactive/Cold" },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {MY_LEAD_GROUPS.map((g) => (
          <a key={g.key} href={`#my-${g.key}`} className="min-w-28 rounded-md border bg-card px-3 py-2 hover:border-primary/60">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.label}</div>
            <div className="tabular mt-1 text-xl font-semibold leading-none">{groups[g.key].length}</div>
          </a>
        ))}
      </div>

      {MY_LEAD_GROUPS.map((g) => (
        <div key={g.key} id={`my-${g.key}`}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{g.label}</h3>
            <span className="tabular text-xs">{groups[g.key].length}</span>
            {g.hint && <span className={cn("text-xs", dim)}>· {g.hint}</span>}
          </div>
          <DataTable<MyLead> columns={columns[g.key]} rows={groups[g.key]} rowKey={(r) => r.id} params={{}} empty="Nothing here." />
        </div>
      ))}
    </section>
  );
}
