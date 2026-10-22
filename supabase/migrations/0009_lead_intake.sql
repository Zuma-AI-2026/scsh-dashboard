-- 0009_lead_intake.sql
-- Fills `leads` from three inputs, without changing the AppFolio tables or
-- their sync:
--   * guest cards (+ interests, showings) — import_leads_from_appfolio(), run after each sync
--   * PQ form submissions                — ingest_pq_submission(), called by POST /api/pq-submit
--   * applications                        — inside import_leads_from_appfolio()
--
-- Go-live rule: the first import stores app_settings.leads_go_live_at. A lead
-- first seen BEFORE it is never rotated: an active agent named by AppFolio
-- owns it (no turn), otherwise it stays unowned for an admin to bulk-assign
-- (no turn). Rotation only runs for leads first seen after go-live.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.app_settings is 'Small app-wide settings. leads_go_live_at is written once by the first lead import.';
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();
alter table public.app_settings enable row level security;
create policy app_settings_read on public.app_settings
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));

-- Returns the go-live timestamp, setting it to now() the first time it is asked for.
create or replace function public.lead_go_live_at()
returns timestamptz
language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings (key, value, updated_by)
  values ('leads_go_live_at', to_jsonb(now()), 'first lead import')
  on conflict (key) do nothing;
  return (select (value #>> '{}')::timestamptz from public.app_settings where key = 'leads_go_live_at');
end $$;

-- ---------------------------------------------------------------------------
-- Leads: extra display columns, guest-card links
-- ---------------------------------------------------------------------------
alter table public.leads
  add column appfolio_status text,     -- latest AppFolio guest card status (Active, Waitlisted, Inactive, …)
  add column property_name   text,     -- first property of interest (guest card or PQ form)
  add column pq_score        numeric,  -- latest PQ form score
  add column pq_tier         text;     -- latest PQ form tier
create index leads_unowned_idx on public.leads (first_seen_at desc) where owner_agent_id is null;

-- Every AppFolio guest card that belongs to a lead. leads.guest_card_id is the
-- first one; a person with several cards (same email/phone) has several rows
-- here. No FK to guest_cards: the sync prunes old cards, the link must stay.
create table public.lead_guest_cards (
  guest_card_id integer primary key,
  lead_id       bigint not null references public.leads (id),
  linked_at     timestamptz not null default now()
);
create index lead_guest_cards_lead_idx on public.lead_guest_cards (lead_id);
alter table public.lead_guest_cards enable row level security;
create policy lead_guest_cards_read on public.lead_guest_cards
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));

-- "Expired" (7 days without an event) is about the prospect, so only prospect
-- activity moves last_event_at — not assignments, status changes or emails.
create or replace function public.lead_events_touch_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type in ('inquiry', 'form', 'application', 'showing') then
    update public.leads
       set last_event_at = greatest(coalesce(last_event_at, new.at), new.at)
     where id = new.lead_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Pure helpers (mirrored and unit-tested in src/lib/leads/rules.ts)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_email(p text)
returns text language sql immutable as $$
  select case when e ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then e end
  from (select lower(trim(p)) as e) x
$$;

-- Digits only; an 11-digit number starting with 1 loses the US country code; 7–15 digits or null.
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select case when length(d2) between 7 and 15 then d2 end
  from (
    select case when length(d) = 11 and left(d, 1) = '1' then substr(d, 2) else d end as d2
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) a
  ) b
$$;

-- Stages only move forward; leased / not_interested / expired are final.
create or replace function public.lead_stage_advance(p_current text, p_to text)
returns text language sql immutable as $$
  select case
    when p_current in ('leased', 'not_interested', 'expired') then p_current
    when array_position(array['new', 'contacted', 'form_filled', 'tour', 'application', 'leased'], p_to) is null then p_to
    when array_position(array['new', 'contacted', 'form_filled', 'tour', 'application', 'leased'], p_to)
       > array_position(array['new', 'contacted', 'form_filled', 'tour', 'application', 'leased'], p_current) then p_to
    else p_current
  end
$$;

-- Follow duplicate_of pointers to the surviving lead (bounded, cycle-safe).
create or replace function public.lead_root(p_lead_id bigint)
returns bigint language plpgsql stable set search_path = public as $$
declare
  v_id   bigint := p_lead_id;
  v_next bigint;
begin
  for i in 1..20 loop
    select duplicate_of_lead_id into v_next from public.leads where id = v_id and status = 'duplicate_of';
    exit when v_next is null;
    v_id := v_next;
  end loop;
  return v_id;
end $$;

-- Identity: guest card link, else email, else phone. Within the first tier
-- that hits: resolve duplicates, prefer a non-duplicate, then the oldest.
create or replace function public.match_lead(p_guest_card_id integer, p_email text, p_phone text)
returns bigint language sql stable set search_path = public as $$
  with hits as (
    select 1 as tier, m.lead_id as id from public.lead_guest_cards m where p_guest_card_id is not null and m.guest_card_id = p_guest_card_id
    union all
    select 2, l.id from public.leads l where p_email is not null and l.email_norm = p_email
    union all
    select 3, l.id from public.leads l where p_phone is not null and l.phone_norm = p_phone
  ),
  best as (select min(tier) as tier from hits)
  select l.id
  from hits h
  join best b on b.tier = h.tier
  join public.leads l on l.id = public.lead_root(h.id)
  order by (l.status = 'duplicate_of'), l.first_seen_at, l.id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Owner of a brand-new lead
-- ---------------------------------------------------------------------------
create or replace function public.assign_new_lead(p_lead_id bigint, p_appfolio_user text, p_go_live timestamptz, p_actor text default 'system')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_lead  public.leads%rowtype;
  v_agent bigint;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead % not found', p_lead_id; end if;
  if v_lead.owner_agent_id is not null then return v_lead.owner_agent_id; end if;

  -- 1. AppFolio names an active agent → they own it, no turn (before or after go-live).
  select a.id into v_agent
  from public.agents a
  where a.active
    and p_appfolio_user is not null
    and lower(trim(p_appfolio_user)) in (lower(trim(a.appfolio_name)), lower(trim(a.name)))
  order by a.id
  limit 1;
  if v_agent is not null then
    update public.leads set owner_agent_id = v_agent, assigned_via = 'appfolio', assigned_at = clock_timestamp() where id = p_lead_id;
    insert into public.lead_events (lead_id, type, payload, actor)
    values (p_lead_id, 'assigned', jsonb_build_object('agent_id', v_agent, 'via', 'appfolio', 'rotation', v_lead.rotation, 'turn', false), p_actor);
    return v_agent;
  end if;

  -- 2. First seen before go-live → unowned, no turn.
  if v_lead.first_seen_at < p_go_live then
    insert into public.lead_events (lead_id, type, payload, actor)
    values (p_lead_id, 'assigned', jsonb_build_object('result', 'pre_go_live_unassigned', 'rotation', v_lead.rotation, 'turn', false, 'go_live_at', p_go_live), p_actor);
    return null;
  end if;

  -- 3. Rotation.
  return public.assign_lead_by_rotation(p_lead_id, p_actor);
end $$;

-- Admin: give unowned leads to an agent. No turn is consumed; already-owned,
-- test and duplicate leads are skipped. Returns how many were assigned.
create or replace function public.bulk_assign_leads(p_lead_ids bigint[], p_agent_id bigint, p_actor text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(auth.jwt() ->> 'email', p_actor, 'system');
  v_n     integer;
begin
  perform public.require_admin_or_service();
  if not exists (select 1 from public.agents where id = p_agent_id and active) then raise exception 'agent % is not active', p_agent_id; end if;

  with upd as (
    update public.leads
       set owner_agent_id = p_agent_id, assigned_via = 'admin', assigned_at = clock_timestamp()
     where id = any (p_lead_ids)
       and owner_agent_id is null
       and status not in ('test', 'duplicate_of')
    returning id, rotation
  )
  insert into public.lead_events (lead_id, type, payload, actor)
  select id, 'assigned', jsonb_build_object('agent_id', p_agent_id, 'via', 'admin_bulk', 'rotation', rotation, 'turn', false), v_actor
  from upd;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- PQ form
-- ---------------------------------------------------------------------------
-- p = the validated body from /api/pq-submit. Idempotent on submission_id.
-- Returns {status: created|updated|duplicate|rejected, lead_id, …}.
create or replace function public.ingest_pq_submission(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub       text := nullif(trim(p ->> 'submission_id'), '');
  v_key       text;
  v_existing  bigint;
  v_email     text := public.normalize_email(p ->> 'email');
  v_phone     text := public.normalize_phone(p ->> 'phone');
  v_name      text := nullif(trim(p ->> 'name'), '');
  v_property  text := nullif(trim(p ->> 'property'), '');
  v_tier      text := nullif(trim(p ->> 'tier'), '');
  v_score     numeric := (p ->> 'score')::numeric;
  v_at        timestamptz := coalesce((p ->> 'submitted_at')::timestamptz, now());
  v_go_live   timestamptz;
  v_lead      bigint;
  v_created   boolean := false;
  v_converted boolean := false;
  v_row       public.leads%rowtype;
begin
  perform public.require_admin_or_service();
  if v_sub is null then raise exception 'submission_id is required'; end if;
  perform pg_advisory_xact_lock(hashtext('public.lead_intake'));

  v_key := 'pq:' || v_sub;
  select lead_id into v_existing from public.lead_events where dedupe_key = v_key;
  if v_existing is not null then
    v_lead := public.lead_root(v_existing);
    select * into v_row from public.leads where id = v_lead;
    return jsonb_build_object('status', 'duplicate', 'lead_id', v_lead, 'rotation', v_row.rotation,
                              'owner_agent_id', v_row.owner_agent_id, 'converted_from_b', v_row.converted_from_b, 'stage', v_row.stage);
  end if;

  if v_email is null and v_phone is null then
    insert into public.lead_intake_rejections (source, source_ref, reason, payload)
    values ('pq_form', v_sub, 'no_email_or_phone', p)
    on conflict (source, source_ref) do update set last_seen_at = now(), payload = excluded.payload;
    return jsonb_build_object('status', 'rejected', 'reason', 'no_email_or_phone');
  end if;

  v_go_live := public.lead_go_live_at();
  v_lead := public.match_lead(null, v_email, v_phone);

  if v_lead is null then
    insert into public.leads (email_norm, phone_norm, name, first_seen_at, source_first, rotation, has_form, stage, property_name, pq_score, pq_tier)
    values (v_email, v_phone, v_name, v_at, 'PQ form', 'A', true, 'form_filled', v_property, v_score, v_tier)
    returning id into v_lead;
    v_created := true;
  else
    select * into v_row from public.leads where id = v_lead for update;
    v_converted := v_row.rotation = 'B';
    update public.leads
       set has_form         = true,
           rotation         = 'A',
           converted_from_b = converted_from_b or v_converted,
           stage            = public.lead_stage_advance(stage, 'form_filled'),
           email_norm       = coalesce(email_norm, v_email),
           phone_norm       = coalesce(phone_norm, v_phone),
           name             = coalesce(name, v_name),
           property_name    = coalesce(property_name, v_property),
           pq_score         = coalesce(v_score, pq_score),
           pq_tier          = coalesce(v_tier, pq_tier),
           first_seen_at    = least(first_seen_at, v_at)
     where id = v_lead;
  end if;

  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  values (v_lead, 'form', p || jsonb_build_object('new_lead', v_created, 'converted_from_b', v_converted), v_at, 'pq_form', v_key);

  if v_created then
    perform public.assign_new_lead(v_lead, null, v_go_live, 'pq_form');
  end if;

  select * into v_row from public.leads where id = v_lead;
  return jsonb_build_object('status', case when v_created then 'created' else 'updated' end, 'lead_id', v_lead,
                            'rotation', v_row.rotation, 'owner_agent_id', v_row.owner_agent_id,
                            'converted_from_b', v_converted, 'stage', v_row.stage);
end $$;

-- ---------------------------------------------------------------------------
-- AppFolio import (guest cards, showings, applications)
-- ---------------------------------------------------------------------------
-- Runs after each sync. Idempotent: links, events (dedupe_key) and stage
-- moves are all safe to repeat. Only guest cards with at least one interest
-- on an is_managed property become leads.
create or replace function public.import_leads_from_appfolio(p_actor text default 'appfolio_sync')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_go_live   timestamptz;
  g           record;
  v_email     text;
  v_phone     text;
  v_lead      bigint;
  v_has_app   boolean;
  n_created   integer := 0;
  n_linked    integer := 0;
  n_rejected  integer := 0;
  n_inquiries integer;
  n_showings  integer;
  n_app_leads integer;
  n_unlinked  integer;
begin
  perform public.require_admin_or_service();
  perform pg_advisory_xact_lock(hashtext('public.lead_intake'));
  v_go_live := public.lead_go_live_at();

  -- Application → guest card: the showing that produced it, else the same AppFolio tenant.
  -- (applications.inquiry_id is a different numbering from guest_cards.inquiry_id.)
  drop table if exists _app_gc;
  create temp table _app_gc on commit drop as
    select distinct on (a.rental_application_id)
           a.rental_application_id, a.status, a.received, a.property_name, c.guest_card_id
    from public.applications a
    join lateral (
      select s.guest_card_id, 1 as pri, s.showing_time as t
      from public.showings s
      where s.rental_application_id = a.rental_application_id and s.guest_card_id is not null
      union all
      select gc.guest_card_id, 2, gc.received
      from public.guest_cards gc
      where a.tenant_id is not null and gc.tenant_id = a.tenant_id
    ) c on true
    order by a.rental_application_id, c.pri, c.t nulls last;

  -- 1. New guest cards, oldest first so rotation follows arrival order.
  for g in
    select gc.*
    from public.guest_cards gc
    where not exists (select 1 from public.lead_guest_cards m where m.guest_card_id = gc.guest_card_id)
      and exists (
        select 1 from public.guest_card_interests i
        join public.properties p on p.property_id = i.property_id
        where i.guest_card_id = gc.guest_card_id and p.is_managed
      )
    order by gc.received asc nulls first, gc.guest_card_id
  loop
    v_email := public.normalize_email(g.email_address);
    v_phone := public.normalize_phone(g.phone_number);
    v_lead  := public.match_lead(g.guest_card_id, v_email, v_phone);

    if v_lead is null then
      if v_email is null and v_phone is null then
        insert into public.lead_intake_rejections (source, source_ref, reason, payload)
        values ('guest_card', g.guest_card_id::text, 'no_email_or_phone', jsonb_build_object('name', g.name, 'received', g.received, 'property_name', g.property_name))
        on conflict (source, source_ref) do update set last_seen_at = now();
        n_rejected := n_rejected + 1;
        continue;
      end if;

      v_has_app := exists (select 1 from _app_gc x where x.guest_card_id = g.guest_card_id);
      insert into public.leads (guest_card_id, email_norm, phone_norm, name, first_seen_at, source_first, rotation,
                                has_application, stage, appfolio_assigned_user, appfolio_status, property_name)
      values (g.guest_card_id, v_email, v_phone, g.name, coalesce(g.received, now()), g.source,
              case when v_has_app then 'A' else 'B' end, v_has_app,
              case when v_has_app then 'application' else 'new' end,
              g.assigned_user, g.status, g.property_name)
      returning id into v_lead;
      insert into public.lead_guest_cards (guest_card_id, lead_id) values (g.guest_card_id, v_lead);
      perform public.assign_new_lead(v_lead, g.assigned_user, v_go_live, p_actor);
      n_created := n_created + 1;
    else
      -- Same person, another guest card: link it, never a new turn.
      insert into public.lead_guest_cards (guest_card_id, lead_id) values (g.guest_card_id, v_lead);
      update public.leads l
         set guest_card_id = coalesce(l.guest_card_id,
                               case when not exists (select 1 from public.leads o where o.guest_card_id = g.guest_card_id) then g.guest_card_id end),
             email_norm    = coalesce(l.email_norm, v_email),
             phone_norm    = coalesce(l.phone_norm, v_phone),
             name          = coalesce(l.name, g.name),
             source_first  = case when g.received < l.first_seen_at then g.source else coalesce(l.source_first, g.source) end,
             property_name = case when g.received < l.first_seen_at then coalesce(g.property_name, l.property_name) else coalesce(l.property_name, g.property_name) end,
             first_seen_at = least(l.first_seen_at, coalesce(g.received, l.first_seen_at))
       where l.id = v_lead;
      n_linked := n_linked + 1;
    end if;
  end loop;

  -- 2. AppFolio's current view of each lead (latest guest card). Drives owner_mismatch.
  update public.leads l
     set appfolio_assigned_user = x.assigned_user, appfolio_status = x.status
    from (
      select distinct on (m.lead_id) m.lead_id, gc.assigned_user, gc.status
      from public.lead_guest_cards m
      join public.guest_cards gc on gc.guest_card_id = m.guest_card_id
      order by m.lead_id, gc.received desc nulls last
    ) x
   where l.id = x.lead_id
     and (l.appfolio_assigned_user is distinct from x.assigned_user or l.appfolio_status is distinct from x.status);

  -- 3. One inquiry event per AppFolio interest row. Later ones are "returning".
  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  select r.root_id, 'inquiry',
         jsonb_build_object('guest_card_id', i.guest_card_id, 'property_id', nullif(i.property_id, 0), 'property_name', p.property_name,
                            'source', i.source, 'assigned_user', i.assigned_user, 'status', i.status,
                            'returning', i.received > l.first_seen_at),
         case when i.received = 'epoch'::timestamptz then now() else i.received end,
         p_actor,
         format('gc:%s:%s:%s:%s', i.guest_card_id, i.property_id, extract(epoch from i.received)::bigint, i.row_index)
  from public.guest_card_interests i
  join (select m.guest_card_id, public.lead_root(m.lead_id) as root_id from public.lead_guest_cards m) r on r.guest_card_id = i.guest_card_id
  join public.leads l on l.id = r.root_id
  left join public.properties p on p.property_id = i.property_id
  on conflict (dedupe_key) do nothing;
  get diagnostics n_inquiries = row_count;

  -- 4. Contacted: AppFolio's latest activity on any interest is a call/text/email.
  update public.leads l
     set stage = public.lead_stage_advance(l.stage, 'contacted')
   where l.stage = 'new'
     and l.id in (
       select public.lead_root(m.lead_id)
       from public.lead_guest_cards m
       join public.guest_card_interests i on i.guest_card_id = m.guest_card_id
       where i.last_activity_type in ('Call', 'Text Sent', 'Text Received', 'Email Sent', 'Email Received')
     );

  -- 5. Showings → event + tour stage (cancelled showings don't count as a tour).
  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  select public.lead_root(m.lead_id), 'showing',
         jsonb_build_object('showing_id', s.showing_id, 'status', s.status, 'showing_time', s.showing_time,
                            'property_id', s.property_id, 'assigned_user', s.assigned_user, 'guest_card_id', s.guest_card_id),
         coalesce(s.created_at, s.showing_time, now()), p_actor, 'sh:' || s.showing_id
  from public.showings s
  join public.lead_guest_cards m on m.guest_card_id = s.guest_card_id
  on conflict (dedupe_key) do nothing;
  get diagnostics n_showings = row_count;

  update public.leads l
     set stage = public.lead_stage_advance(l.stage, 'tour')
   where l.stage <> public.lead_stage_advance(l.stage, 'tour')
     and l.id in (
       select public.lead_root(m.lead_id)
       from public.showings s
       join public.lead_guest_cards m on m.guest_card_id = s.guest_card_id
       where coalesce(s.status, '') not in ('Canceled', 'Prospect Canceled')
     );

  -- 6. Applications → has_application, A list (B leads convert, keep owner, no turn),
  --    stage application, or leased once AppFolio says Converted.
  drop table if exists _app_lead;
  create temp table _app_lead on commit drop as
    select x.*, public.lead_root(m.lead_id) as lead_id
    from _app_gc x
    join public.lead_guest_cards m on m.guest_card_id = x.guest_card_id;

  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  select a.lead_id, 'application',
         jsonb_build_object('rental_application_id', a.rental_application_id, 'status', a.status, 'property_name', a.property_name,
                            'guest_card_id', a.guest_card_id, 'converted_from_b', l.rotation = 'B'),
         coalesce(a.received, now()), p_actor, 'app:' || a.rental_application_id
  from _app_lead a
  join public.leads l on l.id = a.lead_id
  on conflict (dedupe_key) do nothing;

  with agg as (
    select lead_id, bool_or(status = 'Converted') as converted
    from _app_lead
    group by lead_id
  ), target as (
    select l.id,
           case when agg.converted then 'leased' else public.lead_stage_advance(l.stage, 'application') end as stage
    from public.leads l
    join agg on agg.lead_id = l.id
  )
  update public.leads l
     set has_application  = true,
         converted_from_b = l.converted_from_b or l.rotation = 'B',
         rotation         = 'A',
         stage            = t.stage
    from target t
   where l.id = t.id
     and (not l.has_application or l.rotation = 'B' or l.stage <> t.stage);

  select count(distinct lead_id) into n_app_leads from _app_lead;

  insert into public.lead_intake_rejections (source, source_ref, reason, payload)
  select 'application', a.rental_application_id::text,
         case when x.rental_application_id is null then 'no_linked_guest_card' else 'guest_card_not_a_lead' end,
         jsonb_build_object('applicants', a.applicants, 'property_name', a.property_name, 'received', a.received, 'status', a.status)
  from public.applications a
  left join _app_gc x on x.rental_application_id = a.rental_application_id
  where not exists (select 1 from _app_lead y where y.rental_application_id = a.rental_application_id)
  on conflict (source, source_ref) do update set last_seen_at = now(), reason = excluded.reason, payload = excluded.payload;
  get diagnostics n_unlinked = row_count;

  return jsonb_build_object(
    'go_live_at', v_go_live,
    'leads_created', n_created,
    'guest_cards_linked_to_existing', n_linked,
    'guest_cards_rejected', n_rejected,
    'inquiry_events', n_inquiries,
    'showing_events', n_showings,
    'leads_with_applications', n_app_leads,
    'applications_unlinked', n_unlinked
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.lead_go_live_at() from public, anon, authenticated;
revoke execute on function public.lead_root(bigint) from public, anon;
revoke execute on function public.match_lead(integer, text, text) from public, anon;
revoke execute on function public.assign_new_lead(bigint, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.bulk_assign_leads(bigint[], bigint, text) from public, anon;
revoke execute on function public.ingest_pq_submission(jsonb) from public, anon, authenticated;
revoke execute on function public.import_leads_from_appfolio(text) from public, anon, authenticated;
grant execute on function public.lead_go_live_at() to service_role;
grant execute on function public.lead_root(bigint) to authenticated, service_role;
grant execute on function public.match_lead(integer, text, text) to authenticated, service_role;
grant execute on function public.assign_new_lead(bigint, text, timestamptz, text) to service_role;
grant execute on function public.bulk_assign_leads(bigint[], bigint, text) to authenticated, service_role;
grant execute on function public.ingest_pq_submission(jsonb) to service_role;
grant execute on function public.import_leads_from_appfolio(text) to service_role;
