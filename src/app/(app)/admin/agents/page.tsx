import type { Metadata } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/admin/pending-button";
import { SelectAll } from "@/components/admin/select-all";
import { NoAccess } from "@/components/app-shell/section-page";
import { LEAD_STATUS_LABEL, OwnerCell, RotationBadge, StageBadge } from "@/components/leads/badges";
import { FilterBar } from "@/components/sales/filter-bar";
import { StatusBadge } from "@/components/sales/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/leads/analytics";
import { loadLeadsDataset, type LeadsDataset } from "@/lib/leads/data";
import { LEAD_STATUSES, ROTATION_WINDOW_DAYS, turnsInWindow, type Turn } from "@/lib/leads/rules";
import type { Agent, LeadEvent, LeadView } from "@/lib/leads/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { flattenParams, hrefWith } from "@/lib/url";
import { cn } from "@/lib/utils";
import { bulkAssignLeads, reassignLead, saveAgent, setAgentActive, setLeadStatus, setTestMode } from "./actions";

export const metadata: Metadata = { title: "Agents · Admin" };

type Tab = "agents" | "unassigned" | "leads";
const TABS: { key: Tab; label: string }[] = [
  { key: "agents", label: "Agents" },
  { key: "unassigned", label: "Unassigned leads" },
  { key: "leads", label: "Manage a lead" },
];

const head = "h-8 text-[11px] uppercase whitespace-nowrap";
const cell = "py-1.5 whitespace-nowrap";
const dim = "text-muted-foreground";
const input = "h-8 rounded-md border border-input bg-background px-2 text-sm";
const label = "text-[10px] uppercase tracking-wider text-muted-foreground";
const OPEN_APPFOLIO = ["active", "waitlisted"];

export default async function AdminAgentsPage({ searchParams }: PageProps<"/admin/agents">) {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess section={{ label: "Admin" }} user={user} />;

  const params = flattenParams(await searchParams);
  const tab: Tab = TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : "agents";
  const now = new Date();
  const data = await loadLeadsDataset(null, now);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>{" "}
            / Agents
          </div>
          <h1 className="text-lg font-semibold">Agents &amp; lead ownership</h1>
          <p className="text-sm text-muted-foreground">
            {data?.goLiveAt
              ? `Rotation started ${formatDateTime(data.goLiveAt)}. Leads first seen before then were not rotated.`
              : "Rotation starts with the first lead import after migrations 0008–0011."}
          </p>
        </div>
        {data && <TestModeSwitch on={data.testMode} />}
      </div>

      {!data ? (
        <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">Run migrations 0008 – 0015 in Supabase first.</p>
      ) : (
        <>
          <UnresolvedProperties data={data} />
          <nav className="flex items-center gap-1 border-b" role="tablist">
            {TABS.map((t) => {
              const count = t.key === "unassigned" ? unassignedLeads(data).length : undefined;
              return (
                <Link
                  key={t.key}
                  href={`/admin/agents?tab=${t.key}`}
                  role="tab"
                  aria-selected={t.key === tab}
                  className={cn(
                    "relative -mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm",
                    t.key === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {count !== undefined && <span className="tabular rounded-sm bg-muted px-1 text-[11px]">{count}</span>}
                </Link>
              );
            })}
          </nav>
          {tab === "agents" && <AgentsTab data={data} now={now} />}
          {tab === "unassigned" && <UnassignedTab data={data} params={params} />}
          {tab === "leads" && <ManageLeadTab data={data} params={params} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest cards n8n couldn't place ("Property unresolved:" in AppFolio Notes)
// ---------------------------------------------------------------------------
type UnresolvedCard = {
  guest_card_id: number;
  note: string;
  name: string | null;
  received: string | null;
  property_name: string | null;
  status: string | null;
};

async function UnresolvedProperties({ data }: { data: LeadsDataset }) {
  const supabase = await createSupabaseServerClient();
  const flags = await supabase.from("guest_card_flags").select("guest_card_id, note").order("guest_card_id", { ascending: false }).limit(200);
  if (flags.error) return null;
  const ids = (flags.data ?? []).map((f) => f.guest_card_id as number);
  const cards = ids.length
    ? ((await supabase.from("guest_cards").select("guest_card_id, name, received, property_name, status").in("guest_card_id", ids)).data ?? [])
    : [];
  const cardById = new Map(cards.map((c) => [c.guest_card_id as number, c]));
  const rows: UnresolvedCard[] = (flags.data ?? [])
    .map((f) => ({ guest_card_id: f.guest_card_id as number, note: f.note as string, name: null, received: null, property_name: null, status: null, ...cardById.get(f.guest_card_id as number) }))
    .sort((a, b) => (b.received ?? "").localeCompare(a.received ?? ""));

  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Property unresolved</h2>
        <span className={cn("tabular rounded-sm px-1 text-[11px]", rows.length ? "bg-warning/15 text-warning" : "bg-muted")}>{rows.length}</span>
        <span className={cn("text-xs", dim)}>Guest cards n8n couldn&apos;t place on a property. Fix the property in AppFolio and edit the note; the card leaves this list on the next sync.</span>
      </div>
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={head}>Received</TableHead>
              <TableHead className={head}>Name</TableHead>
              <TableHead className={head}>Note</TableHead>
              <TableHead className={head}>AppFolio property</TableHead>
              <TableHead className={head}>Status</TableHead>
              <TableHead className={head}>Lead</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const lead = data.byCard.get(r.guest_card_id);
              return (
                <TableRow key={r.guest_card_id}>
                  <TableCell className={cell}>{r.received ? formatDate(r.received) : <span className={dim}>—</span>}</TableCell>
                  <TableCell className={cn(cell, "font-medium")}>{r.name ?? <span className={dim}>Card #{r.guest_card_id}</span>}</TableCell>
                  <TableCell className="max-w-md py-1.5 text-xs whitespace-normal">{r.note}</TableCell>
                  <TableCell className={cell}>{r.property_name ?? <span className={dim}>—</span>}</TableCell>
                  <TableCell className={cell}>{r.status ? <StatusBadge value={r.status} /> : <span className={dim}>—</span>}</TableCell>
                  <TableCell className={cell}>
                    {lead ? (
                      <Link href={`/admin/agents?tab=leads&lead=${lead.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                        #{lead.id} <OwnerCell lead={lead} />
                      </Link>
                    ) : (
                      <span className={dim}>not a lead yet</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function TestModeSwitch({ on }: { on: boolean }) {
  return (
    <form action={setTestMode} className={cn("flex items-center gap-3 rounded-md border px-3 py-2", on ? "border-warning/50 bg-warning/10" : "bg-card")}>
      <input type="hidden" name="test_mode" value={on ? "false" : "true"} />
      <div className="text-xs">
        <div className="font-medium">Email test mode: {on ? <span className="text-warning">ON</span> : <span className={dim}>off</span>}</div>
        <div className={dim}>Sent to n8n as test_mode; n8n routes mail to the test inbox.</div>
      </div>
      <PendingButton size="sm" variant={on ? "default" : "outline"} pendingLabel="Saving…">
        {on ? "Turn off" : "Turn on"}
      </PendingButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
function AgentsTab({ data, now }: { data: LeadsDataset; now: Date }) {
  const turns: Turn[] = data.leads
    .filter((l) => l.turn_agent_id !== null && l.turn_rotation !== null && l.turn_at !== null)
    .map((l) => ({ agent_id: l.turn_agent_id!, rotation: l.turn_rotation!, at: l.turn_at!, status: l.status }));
  const openOwned = (a: Agent) => data.leads.filter((l) => l.owner_agent_id === a.id && l.status === "active").length;

  return (
    <section className="space-y-4">
      <div className="rounded-md border bg-card">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={head}>Agent</TableHead>
              <TableHead className={head}>Email</TableHead>
              <TableHead className={head}>AppFolio name</TableHead>
              <TableHead className={cn(head, "text-right")}>A turns · {ROTATION_WINDOW_DAYS}d</TableHead>
              <TableHead className={cn(head, "text-right")}>B turns · {ROTATION_WINDOW_DAYS}d</TableHead>
              <TableHead className={cn(head, "text-right")}>Lifetime A / B</TableHead>
              <TableHead className={cn(head, "text-right")}>Open leads</TableHead>
              <TableHead className={head}>Last assigned</TableHead>
              <TableHead className={head} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.agents.map((a) => (
              <TableRow key={a.id} className={cn(!a.active && "opacity-60")}>
                <TableCell className={cn(cell, "font-medium")}>
                  {a.name}
                  {!a.active && <span className="ml-2 text-[10px] uppercase text-muted-foreground">inactive</span>}
                </TableCell>
                <TableCell className={cn(cell, "font-mono text-xs")}>{a.email}</TableCell>
                <TableCell className={cell}>{a.appfolio_name ?? <span className={dim}>—</span>}</TableCell>
                <TableCell className={cn(cell, "tabular text-right")}>{turnsInWindow(turns, a.id, "A", now)}</TableCell>
                <TableCell className={cn(cell, "tabular text-right")}>{turnsInWindow(turns, a.id, "B", now)}</TableCell>
                <TableCell className={cn(cell, "tabular text-right", dim)}>
                  {a.a_turns} / {a.b_turns}
                </TableCell>
                <TableCell className={cn(cell, "tabular text-right")}>{openOwned(a)}</TableCell>
                <TableCell className={cn(cell, dim)}>{formatDateTime(a.last_assigned_at)}</TableCell>
                <TableCell className={cn(cell, "text-right")}>
                  <form action={setAgentActive}>
                    <input type="hidden" name="agent_id" value={a.id} />
                    <input type="hidden" name="active" value={a.active ? "false" : "true"} />
                    <PendingButton size="xs" variant="ghost" pendingLabel="Saving…">
                      {a.active ? "Deactivate" : "Activate"}
                    </PendingButton>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className={cn("text-xs", dim)}>
        Rotation gives each new lead to the active agent with the fewest turns of that rotation in the last {ROTATION_WINDOW_DAYS} days. Deactivating stops new
        leads; leads the agent already owns keep their owner until reassigned.
      </p>

      <form action={saveAgent} className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
        <div className="w-full text-xs font-medium uppercase tracking-wider text-muted-foreground">Add or update an agent (matched by email)</div>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Name</span>
          <input name="name" required placeholder="Jennifer" className={cn(input, "w-40")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Email</span>
          <input name="email" type="email" required placeholder="name@scshdev.com" className={cn(input, "w-56")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>AppFolio name (exact)</span>
          <input name="appfolio_name" placeholder="Jennifer Villanueva" className={cn(input, "w-48")} />
        </label>
        <PendingButton size="sm" pendingLabel="Saving…">
          Save agent
        </PendingButton>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Unassigned leads
// ---------------------------------------------------------------------------
function unassignedLeads(data: LeadsDataset): LeadView[] {
  return data.leads.filter((l) => l.owner_agent_id === null && l.status !== "test" && l.status !== "duplicate_of");
}

const isOpenInAppfolio = (l: LeadView) => OPEN_APPFOLIO.includes((l.appfolio_status ?? "").toLowerCase());

function UnassignedTab({ data, params }: { data: LeadsDataset; params: Record<string, string | undefined> }) {
  const q = (params.q ?? "").trim().toLowerCase();
  const all = unassignedLeads(data);
  const rows = all
    .filter((l) => params.open !== "1" || isOpenInAppfolio(l))
    .filter((l) => !q || (l.name ?? "").toLowerCase().includes(q) || (l.email_norm ?? "").includes(q) || (l.property_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(isOpenInAppfolio(b)) - Number(isOpenInAppfolio(a)) || b.first_seen_at.localeCompare(a.first_seen_at));
  const openCount = all.filter(isOpenInAppfolio).length;
  const active = data.agents.filter((a) => a.active);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar
          filters={[
            { kind: "search", name: "q", label: "Search", placeholder: "Name, email or property" },
            { kind: "toggle", name: "open", label: `Active / Waitlisted only (${openCount})` },
          ]}
        />
        <span className={cn("text-xs", dim)}>
          {rows.length} of {all.length} unassigned · AppFolio Active / Waitlisted listed first
        </span>
      </div>

      <form action={bulkAssignLeads} className="space-y-2">
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
          <label className="flex flex-col gap-0.5">
            <span className={label}>Assign selected to</span>
            <select name="agent_id" required className={input} defaultValue="">
              <option value="" disabled>
                Choose agent…
              </option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <PendingButton size="sm" pendingLabel="Assigning…">
            Assign (no turn)
          </PendingButton>
          <span className={cn("text-xs", dim)}>Bulk assignment never counts as a rotation turn.</span>
        </div>

        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(head, "w-8")}>
                  <SelectAll name="lead_id" />
                </TableHead>
                <TableHead className={head}>First seen</TableHead>
                <TableHead className={head}>Name</TableHead>
                <TableHead className={head}>Phone</TableHead>
                <TableHead className={head}>Email</TableHead>
                <TableHead className={head}>Property</TableHead>
                <TableHead className={head}>AppFolio status</TableHead>
                <TableHead className={head}>AppFolio agent</TableHead>
                <TableHead className={head}>Rot.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="h-16 text-center text-muted-foreground">
                    No unassigned leads.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className={cell}>
                      <input type="checkbox" name="lead_id" value={l.id} aria-label={`Select ${l.name ?? l.id}`} className="size-3.5 accent-primary" />
                    </TableCell>
                    <TableCell className={cn(cell, dim)}>{formatDate(l.first_seen_at)}</TableCell>
                    <TableCell className={cn(cell, "font-medium")}>
                      <Link href={`/admin/agents?tab=leads&lead=${l.id}`} className="hover:underline">
                        {l.name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className={cell}>{formatPhone(l.phone_norm) ?? "—"}</TableCell>
                    <TableCell className={cn(cell, "font-mono text-xs")}>{l.email_norm ?? "—"}</TableCell>
                    <TableCell className={cell}>{l.property_name ?? "—"}</TableCell>
                    <TableCell className={cell}>
                      <StatusBadge value={l.appfolio_status} />
                    </TableCell>
                    <TableCell className={cn(cell, dim)}>{l.appfolio_assigned_user ?? "—"}</TableCell>
                    <TableCell className={cell}>
                      <RotationBadge rotation={l.rotation} converted={l.converted_from_b} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Manage a lead: find → reassign / status / history
// ---------------------------------------------------------------------------
const MAX_RESULTS = 100;

function ManageLeadTab({ data, params }: { data: LeadsDataset; params: Record<string, string | undefined> }) {
  const q = (params.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const selected = params.lead ? data.byId.get(Number(params.lead)) : undefined;
  const results = q
    ? data.leads.filter(
        (l) =>
          String(l.id) === q ||
          (l.name ?? "").toLowerCase().includes(q) ||
          (l.email_norm ?? "").includes(q) ||
          (qDigits.length >= 3 && (l.phone_norm ?? "").includes(qDigits)),
      )
    : [];

  return (
    <section className="space-y-4">
      <FilterBar keep={["tab"]} filters={[{ kind: "search", name: "q", label: "Find a lead", placeholder: "Name, email, phone or lead #" }]} />

      {q && (
        <div className="rounded-md border bg-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={head}>#</TableHead>
                <TableHead className={head}>Name</TableHead>
                <TableHead className={head}>Email</TableHead>
                <TableHead className={head}>Phone</TableHead>
                <TableHead className={head}>Owner</TableHead>
                <TableHead className={head}>Rot.</TableHead>
                <TableHead className={head}>Status</TableHead>
                <TableHead className={head}>First seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-16 text-center text-muted-foreground">
                    No lead matches “{params.q}”.
                  </TableCell>
                </TableRow>
              ) : (
                results.slice(0, MAX_RESULTS).map((l) => (
                  <TableRow key={l.id} className={cn(selected?.id === l.id && "bg-primary/5")}>
                    <TableCell className={cn(cell, dim)}>{l.id}</TableCell>
                    <TableCell className={cn(cell, "font-medium")}>
                      <Link href={hrefWith("/admin/agents", params, { lead: String(l.id) })} scroll={false} className="hover:underline">
                        {l.name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className={cn(cell, "font-mono text-xs")}>{l.email_norm ?? "—"}</TableCell>
                    <TableCell className={cell}>{formatPhone(l.phone_norm) ?? "—"}</TableCell>
                    <TableCell className={cell}>
                      <OwnerCell lead={l} />
                    </TableCell>
                    <TableCell className={cell}>
                      <RotationBadge rotation={l.rotation} converted={l.converted_from_b} />
                    </TableCell>
                    <TableCell className={cell}>{LEAD_STATUS_LABEL[l.status] ?? l.status}</TableCell>
                    <TableCell className={cn(cell, dim)}>{formatDate(l.first_seen_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {results.length > MAX_RESULTS && <p className={cn("p-2 text-xs", dim)}>Showing the first {MAX_RESULTS} of {results.length}. Narrow the search.</p>}
        </div>
      )}

      {params.lead && !selected && <p className="text-sm text-negative">Lead #{params.lead} not found.</p>}
      {selected && <LeadPanel lead={selected} data={data} />}
    </section>
  );
}

async function LeadPanel({ lead, data }: { lead: LeadView; data: LeadsDataset }) {
  const supabase = await createSupabaseServerClient();
  const { data: events, error } = await supabase.from("lead_events").select("id, lead_id, type, payload, at, actor").eq("lead_id", lead.id).order("at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) throw new Error(`lead_events: ${error.message}`);
  const agentName = new Map(data.agents.map((a) => [a.id, a.name]));
  const active = data.agents.filter((a) => a.active);
  const turnAgent = lead.turn_agent_id === null ? null : (agentName.get(lead.turn_agent_id) ?? `#${lead.turn_agent_id}`);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-3 rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{lead.name ?? lead.email_norm ?? `Lead #${lead.id}`}</h2>
          <RotationBadge rotation={lead.rotation} converted={lead.converted_from_b} />
          <StageBadge stage={lead.stage_now} />
          <span className={cn("text-xs", dim)}>#{lead.id}</span>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className={dim}>Owner</dt>
          <dd>
            <OwnerCell lead={lead} /> {lead.assigned_via && <span className={cn("text-xs", dim)}>via {lead.assigned_via}</span>}
          </dd>
          <dt className={dim}>Turn</dt>
          <dd>{turnAgent ? `${lead.turn_rotation} turn · ${turnAgent} · ${formatDateTime(lead.turn_at)}` : <span className={dim}>none consumed</span>}</dd>
          <dt className={dim}>Status</dt>
          <dd>
            {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
            {lead.duplicate_of_lead_id && (
              <Link href={`/admin/agents?tab=leads&lead=${lead.duplicate_of_lead_id}`} className="ml-1 underline">
                of #{lead.duplicate_of_lead_id}
              </Link>
            )}
          </dd>
          <dt className={dim}>Email / phone</dt>
          <dd>
            {lead.email_norm ?? "—"} · {formatPhone(lead.phone_norm) ?? "—"}
          </dd>
          <dt className={dim}>Property</dt>
          <dd>{lead.property_name ?? "—"}</dd>
          <dt className={dim}>First seen</dt>
          <dd>
            {formatDateTime(lead.first_seen_at)} · {lead.source_first ?? "—"}
          </dd>
          <dt className={dim}>Form / application</dt>
          <dd>
            {lead.has_form ? `Form${lead.pq_score !== null ? ` (score ${lead.pq_score}${lead.pq_tier ? `, ${lead.pq_tier}` : ""})` : ""}` : "No form"} ·{" "}
            {lead.has_application ? "Applied" : "No application"}
          </dd>
          <dt className={dim}>AppFolio</dt>
          <dd>
            {lead.appfolio_status ?? "—"} · {lead.appfolio_assigned_user ?? "no agent"}
          </dd>
        </dl>

        <form action={reassignLead} className="flex flex-wrap items-end gap-2 border-t pt-3">
          <input type="hidden" name="lead_id" value={lead.id} />
          <label className="flex flex-col gap-0.5">
            <span className={label}>{lead.owner_agent_id === null ? "Assign to" : "Reassign to"}</span>
            <select name="agent_id" required defaultValue="" className={input}>
              <option value="" disabled>
                Choose agent…
              </option>
              {active
                .filter((a) => a.id !== lead.owner_agent_id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-0.5">
            <span className={label}>Reason (required, logged)</span>
            <input name="reason" required placeholder="e.g. covering vacation" className={input} />
          </label>
          <PendingButton size="sm" pendingLabel="Saving…">
            {lead.owner_agent_id === null ? "Assign" : "Reassign"}
          </PendingButton>
        </form>

        <form action={setLeadStatus} className="flex flex-wrap items-end gap-2 border-t pt-3">
          <input type="hidden" name="lead_id" value={lead.id} />
          <label className="flex flex-col gap-0.5">
            <span className={label}>Status</span>
            <select name="status" defaultValue={lead.status} className={input}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={label}>Duplicate of lead #</span>
            <input name="duplicate_of" inputMode="numeric" placeholder="only for Duplicate" defaultValue={lead.duplicate_of_lead_id ?? ""} className={cn(input, "w-36")} />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-0.5">
            <span className={label}>Reason (required, logged)</span>
            <input name="reason" required className={input} />
          </label>
          <PendingButton size="sm" pendingLabel="Saving…">
            Set status
          </PendingButton>
          <p className={cn("w-full text-xs", dim)}>Test and Duplicate remove the lead from every count and give its turn back. Leads are never deleted.</p>
        </form>
        {lead.assigned_via === "rotation" && lead.owner_agent_id !== lead.turn_agent_id && (
          <p className={cn("text-xs", dim)}>Reassigned after rotation: the turn stays counted for {turnAgent}.</p>
        )}
      </div>

      <div className="rounded-md border bg-card p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">History</h3>
        <ol className="space-y-1.5 text-[13px]">
          {((events ?? []) as LeadEvent[]).map((e) => (
            <li key={e.id} className="grid grid-cols-[110px_1fr] gap-2">
              <span className={cn("tabular text-xs", dim)}>{formatDateTime(e.at)}</span>
              <span>
                <span className="font-medium">{e.type.replace("_", " ")}</span> <span className={dim}>{eventSummary(e, agentName)}</span>
                {e.actor && <span className={cn("ml-1 text-[11px]", dim)}>· {e.actor}</span>}
              </span>
            </li>
          ))}
          {(events ?? []).length === 0 && <li className={dim}>No events yet.</li>}
        </ol>
      </div>
    </div>
  );
}

function eventSummary(e: LeadEvent, agentName: Map<number, string>): string {
  const p = e.payload ?? {};
  const s = (k: string) => (p[k] === null || p[k] === undefined ? null : String(p[k]));
  const agent = (k: string) => {
    const v = p[k];
    return typeof v === "number" ? (agentName.get(v) ?? `#${v}`) : "—";
  };
  switch (e.type) {
    case "assigned":
      if (s("result") === "pre_go_live_unassigned") return "left unassigned (before go-live)";
      if (s("result") === "no_active_agent") return "no active agent to rotate to";
      return `→ ${agent("agent_id")} via ${s("via")}${p.turn ? ` (${s("rotation")} turn)` : " (no turn)"}`;
    case "reassigned":
      return `${agent("from_agent_id")} → ${agent("to_agent_id")}: ${s("reason") ?? ""}`;
    case "status_change":
      return `${s("from")} → ${s("to")}${s("reason") ? `: ${s("reason")}` : ""}${p.turn_returned ? " (turn returned)" : ""}`;
    case "inquiry":
      return [s("source"), s("property_name"), p.returning ? "returning" : null].filter(Boolean).join(" · ");
    case "form":
      return [s("property"), s("score") && `score ${s("score")}`, s("tier"), p.converted_from_b ? "converted from B" : null].filter(Boolean).join(" · ");
    case "application":
      return [s("status"), s("property_name"), p.converted_from_b ? "converted from B" : null].filter(Boolean).join(" · ");
    case "showing":
      return [s("status"), s("showing_time") && formatDateTime(s("showing_time"))].filter(Boolean).join(" · ");
    default:
      return "";
  }
}
