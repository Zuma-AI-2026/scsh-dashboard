-- 0008_leads_rotation.sql
-- Lead ownership + rotations A/B. Lives entirely in our Supabase; the
-- AppFolio-synced tables (guest_cards, guest_card_interests, showings,
-- applications) and their sync are NOT changed.
--
-- Turn accounting: a lead that got its owner by rotation records WHICH
-- agent's turn it consumed (turn_agent_id), for WHICH rotation
-- (turn_rotation) and WHEN (turn_at). Rotation picks the active agent with
-- the fewest counted turns of that rotation in the last 14 days; leads with
-- status test / duplicate_of are not counted, which is how a turn is
-- "returned". Reassigning a lead moves ownership, not the turn.

-- ---------------------------------------------------------------------------
-- agents
-- ---------------------------------------------------------------------------
create table public.agents (
  id               bigint generated always as identity primary key,
  name             text not null,
  email            text not null unique check (email = lower(email)),
  appfolio_name    text,           -- exact AppFolio assigned_user string (case-insensitive match)
  active           boolean not null default true,
  a_turns          integer not null default 0,  -- lifetime counted A turns (net of returns)
  b_turns          integer not null default 0,  -- lifetime counted B turns (net of returns)
  last_assigned_at timestamptz,
  created_at       timestamptz not null default now()
);
create unique index agents_appfolio_name_idx on public.agents (lower(appfolio_name)) where appfolio_name is not null;
comment on table public.agents is
  'Leasing agents who own leads. Paulina is intentionally not an agent. a_turns/b_turns are lifetime counters; rotation decisions use the 14-day window computed from leads.turn_*.';

insert into public.agents (name, email, appfolio_name) values
  ('Jennifer', 'jennifer@scshdev.com', 'Jennifer Villanueva'),
  ('Arianne',  'arianne@scshdev.com',  'Arianne Quinto');

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id                     bigint generated always as identity primary key,
  -- If the guest card ages out of the AppFolio sync window the link is
  -- cleared; the lead itself is never deleted and still matches by email/phone.
  guest_card_id          integer unique references public.guest_cards (guest_card_id) on delete set null,
  email_norm             text check (email_norm = lower(email_norm) and email_norm like '%_@_%'),
  phone_norm             text check (phone_norm ~ '^[0-9]{7,15}$'),
  name                   text,
  first_seen_at          timestamptz not null default now(),
  source_first           text,
  owner_agent_id         bigint references public.agents (id),
  rotation               text not null check (rotation in ('A', 'B')),
  converted_from_b       boolean not null default false,
  has_form               boolean not null default false,
  has_application        boolean not null default false,
  stage                  text not null default 'new'
                           check (stage in ('new', 'contacted', 'form_filled', 'tour', 'application', 'leased', 'not_interested', 'expired')),
  status                 text not null default 'active'
                           check (status in ('active', 'test', 'duplicate_of', 'not_interested', 'leased')),
  duplicate_of_lead_id   bigint references public.leads (id),
  appfolio_assigned_user text,
  owner_mismatch         boolean not null default false,  -- maintained by trigger
  -- ownership bookkeeping
  assigned_via           text check (assigned_via in ('appfolio', 'rotation', 'admin')),
  assigned_at            timestamptz,
  turn_agent_id          bigint references public.agents (id),
  turn_rotation          text check (turn_rotation in ('A', 'B')),
  turn_at                timestamptz,
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint leads_has_contact check (email_norm is not null or phone_norm is not null),
  constraint leads_duplicate_target check ((status = 'duplicate_of') = (duplicate_of_lead_id is not null)),
  constraint leads_not_self_duplicate check (duplicate_of_lead_id is distinct from id),
  constraint leads_owner_has_via check (owner_agent_id is null or assigned_via is not null),
  constraint leads_turn_complete check (
    (turn_agent_id is null and turn_rotation is null and turn_at is null)
    or (turn_agent_id is not null and turn_rotation is not null and turn_at is not null)
  ),
  constraint leads_converted_is_a check (not converted_from_b or rotation = 'A')
);
create index leads_email_idx    on public.leads (email_norm) where email_norm is not null;
create index leads_phone_idx    on public.leads (phone_norm) where phone_norm is not null;
create index leads_owner_idx    on public.leads (owner_agent_id);
create index leads_turn_idx     on public.leads (turn_agent_id, turn_rotation, turn_at);
create index leads_first_seen   on public.leads (first_seen_at desc);
comment on table public.leads is
  'One row per prospect. Identity: guest_card_id, else email_norm, else phone_norm. The dashboard owns owner_agent_id; owner_mismatch flags when AppFolio assigned_user disagrees. Never deleted.';

create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- owner_mismatch = AppFolio names a user AND the dashboard owner is someone else.
create or replace function public.leads_set_owner_mismatch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.owner_mismatch := new.owner_agent_id is not null
    and new.appfolio_assigned_user is not null
    and not exists (
      select 1 from public.agents a
      where a.id = new.owner_agent_id
        and lower(trim(new.appfolio_assigned_user)) in (lower(trim(a.appfolio_name)), lower(trim(a.name)))
    );
  return new;
end $$;
create trigger leads_owner_mismatch before insert or update of owner_agent_id, appfolio_assigned_user on public.leads
  for each row execute function public.leads_set_owner_mismatch();

create or replace function public.leads_no_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'leads are never deleted; set status instead (lead %)', old.id;
end $$;
create trigger leads_no_delete before delete on public.leads
  for each row execute function public.leads_no_delete();

-- ---------------------------------------------------------------------------
-- lead_events
-- ---------------------------------------------------------------------------
create table public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     bigint not null references public.leads (id),
  type        text not null check (type in ('inquiry', 'form', 'application', 'showing', 'assigned', 'reassigned', 'status_change', 'notified')),
  payload     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now(),
  actor       text,
  -- Idempotency for repeat imports (e.g. 'gc:123:45:2026-10-01T…', 'pq:<submission_id>').
  dedupe_key  text unique
);
create index lead_events_lead_idx on public.lead_events (lead_id, at desc);
comment on table public.lead_events is 'Append-only lead history. dedupe_key makes re-imports idempotent.';

-- Keeps leads.last_event_at current (drives the 7-day "expired" B stage).
create or replace function public.lead_events_touch_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set last_event_at = greatest(coalesce(last_event_at, new.at), new.at)
   where id = new.lead_id;
  return new;
end $$;
create trigger lead_events_touch_lead after insert on public.lead_events
  for each row execute function public.lead_events_touch_lead();

-- ---------------------------------------------------------------------------
-- Intake records rejected for having neither email nor phone
-- ---------------------------------------------------------------------------
create table public.lead_intake_rejections (
  id            bigint generated always as identity primary key,
  source        text not null check (source in ('guest_card', 'pq_form', 'application')),
  source_ref    text not null,           -- guest_card_id, submission_id, rental_application_id
  reason        text not null,
  payload       jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (source, source_ref)
);
comment on table public.lead_intake_rejections is 'Inbound records that could not become a lead (no email and no phone). One row per source record; last_seen_at bumps on repeats.';

-- ---------------------------------------------------------------------------
-- Rotation
-- ---------------------------------------------------------------------------
-- Active agent with the fewest counted turns of p_rotation in the 14 days
-- before p_now; ties → older last_assigned_at (never assigned first); then id.
create or replace function public.rotation_agent_for(p_rotation text, p_now timestamptz default now())
returns bigint
language sql stable security definer set search_path = public as $$
  select a.id
  from public.agents a
  left join lateral (
    select count(*) as n
    from public.leads l
    where l.turn_agent_id = a.id
      and l.turn_rotation = p_rotation
      and l.turn_at > p_now - interval '14 days'
      and l.turn_at <= p_now
      and l.status not in ('test', 'duplicate_of')
  ) t on true
  where a.active
  order by t.n asc, a.last_assigned_at asc nulls first, a.id asc
  limit 1
$$;

-- Admin from the app, or the service role / SQL editor (no JWT).
create or replace function public.require_admin_or_service()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role'
     and public.current_app_role() is distinct from 'admin' then
    raise exception 'admin role required';
  end if;
end $$;

-- Assign an unowned lead by rotation. Serialized with an advisory lock so two
-- simultaneous leads can't both pick the same "least busy" agent.
create or replace function public.assign_lead_by_rotation(p_lead_id bigint, p_actor text default 'system')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_lead  public.leads%rowtype;
  v_agent bigint;
  v_now   timestamptz := clock_timestamp();
begin
  perform public.require_admin_or_service();
  perform pg_advisory_xact_lock(hashtext('public.lead_rotation'));

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead % not found', p_lead_id; end if;
  if v_lead.owner_agent_id is not null then return v_lead.owner_agent_id; end if;
  if v_lead.status in ('test', 'duplicate_of') then return null; end if;

  v_agent := public.rotation_agent_for(v_lead.rotation, v_now);
  if v_agent is null then
    insert into public.lead_events (lead_id, type, payload, actor)
    values (p_lead_id, 'assigned', jsonb_build_object('result', 'no_active_agent', 'rotation', v_lead.rotation), p_actor);
    return null;
  end if;

  update public.leads
     set owner_agent_id = v_agent, assigned_via = 'rotation', assigned_at = v_now,
         turn_agent_id = v_agent, turn_rotation = v_lead.rotation, turn_at = v_now
   where id = p_lead_id;
  update public.agents
     set a_turns = a_turns + (v_lead.rotation = 'A')::int,
         b_turns = b_turns + (v_lead.rotation = 'B')::int,
         last_assigned_at = v_now
   where id = v_agent;
  insert into public.lead_events (lead_id, type, payload, actor)
  values (p_lead_id, 'assigned', jsonb_build_object('agent_id', v_agent, 'via', 'rotation', 'rotation', v_lead.rotation, 'turn', true), p_actor);
  return v_agent;
end $$;

-- Admin reassign. Reason required. Ownership moves; the consumed turn does not.
create or replace function public.reassign_lead(p_lead_id bigint, p_agent_id bigint, p_reason text, p_actor text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lead  public.leads%rowtype;
  v_actor text := coalesce(auth.jwt() ->> 'email', p_actor, 'system');
begin
  perform public.require_admin_or_service();
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required to reassign'; end if;
  if not exists (select 1 from public.agents where id = p_agent_id and active) then raise exception 'agent % is not active', p_agent_id; end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead % not found', p_lead_id; end if;
  if v_lead.owner_agent_id = p_agent_id then return; end if;

  update public.leads set owner_agent_id = p_agent_id, assigned_via = 'admin', assigned_at = clock_timestamp() where id = p_lead_id;
  insert into public.lead_events (lead_id, type, payload, actor)
  values (p_lead_id, 'reassigned', jsonb_build_object('from_agent_id', v_lead.owner_agent_id, 'to_agent_id', p_agent_id, 'reason', trim(p_reason)), v_actor);
end $$;

-- Admin status change. test / duplicate_of return the turn (and leave all
-- counts because views exclude them); moving back to a counted status takes it again.
create or replace function public.set_lead_status(p_lead_id bigint, p_status text, p_reason text default null, p_duplicate_of bigint default null, p_actor text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lead        public.leads%rowtype;
  v_actor       text := coalesce(auth.jwt() ->> 'email', p_actor, 'system');
  v_was_counted boolean;
  v_now_counted boolean;
  v_delta       int;
begin
  perform public.require_admin_or_service();
  if p_status not in ('active', 'test', 'duplicate_of', 'not_interested', 'leased') then raise exception 'invalid status %', p_status; end if;
  if p_status = 'duplicate_of' then
    if p_duplicate_of is null or p_duplicate_of = p_lead_id then raise exception 'duplicate_of needs another lead id'; end if;
    if not exists (select 1 from public.leads where id = p_duplicate_of and status <> 'duplicate_of') then
      raise exception 'lead % does not exist or is itself a duplicate', p_duplicate_of;
    end if;
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead % not found', p_lead_id; end if;
  if v_lead.status = p_status and v_lead.duplicate_of_lead_id is not distinct from (case when p_status = 'duplicate_of' then p_duplicate_of end) then return; end if;

  update public.leads
     set status = p_status,
         duplicate_of_lead_id = case when p_status = 'duplicate_of' then p_duplicate_of end,
         stage = case p_status when 'leased' then 'leased' when 'not_interested' then 'not_interested' else stage end
   where id = p_lead_id;

  v_was_counted := v_lead.status not in ('test', 'duplicate_of');
  v_now_counted := p_status not in ('test', 'duplicate_of');
  if v_lead.turn_agent_id is not null and v_was_counted <> v_now_counted then
    v_delta := case when v_now_counted then 1 else -1 end;
    update public.agents
       set a_turns = a_turns + case when v_lead.turn_rotation = 'A' then v_delta else 0 end,
           b_turns = b_turns + case when v_lead.turn_rotation = 'B' then v_delta else 0 end
     where id = v_lead.turn_agent_id;
  end if;

  insert into public.lead_events (lead_id, type, payload, actor)
  values (p_lead_id, 'status_change',
          jsonb_build_object('from', v_lead.status, 'to', p_status, 'reason', nullif(trim(coalesce(p_reason, '')), ''),
                             'duplicate_of', p_duplicate_of, 'turn_returned', v_was_counted and not v_now_counted and v_lead.turn_agent_id is not null),
          v_actor);
end $$;

revoke execute on function public.rotation_agent_for(text, timestamptz) from public, anon;
revoke execute on function public.require_admin_or_service() from public, anon;
revoke execute on function public.assign_lead_by_rotation(bigint, text) from public, anon, authenticated;
revoke execute on function public.reassign_lead(bigint, bigint, text, text) from public, anon;
revoke execute on function public.set_lead_status(bigint, text, text, bigint, text) from public, anon;
grant execute on function public.rotation_agent_for(text, timestamptz) to authenticated, service_role;
grant execute on function public.assign_lead_by_rotation(bigint, text) to service_role;
grant execute on function public.reassign_lead(bigint, bigint, text, text) to authenticated, service_role;
grant execute on function public.set_lead_status(bigint, text, text, bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: read = admin, sales, partner (same audience as guest_cards). Writes go
-- through the functions above or the service role. Agents: admin may edit.
-- ---------------------------------------------------------------------------
alter table public.agents                 enable row level security;
alter table public.leads                  enable row level security;
alter table public.lead_events            enable row level security;
alter table public.lead_intake_rejections enable row level security;

create policy agents_read on public.agents
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy agents_admin_insert on public.agents
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy agents_admin_update on public.agents
  for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy leads_read on public.leads
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy lead_events_read on public.lead_events
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy lead_intake_rejections_read on public.lead_intake_rejections
  for select to authenticated using (public.current_app_role() = 'admin');
