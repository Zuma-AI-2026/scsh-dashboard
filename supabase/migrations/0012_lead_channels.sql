-- 0012_lead_channels.sql
-- Rotation B intake + lead channel.
--
--  * leads.channel, derived from the raw source (leads.source_first) through
--    one admin-editable map, lead_source_channels. Unknown sources → 'other'.
--  * A guest card whose source maps to website_form is a form lead (A).
--  * After go-live AppFolio's assigned user no longer picks the owner: every
--    new post-go-live lead is rotated (n8n's /api/leads/assign first; the sync
--    catches cards n8n never saw). Before go-live nothing changes.
--  * assign_unowned_leads(): run by the sync after the import, rotates any
--    post-go-live lead that still has no owner.

-- ---------------------------------------------------------------------------
-- Source → channel map
-- ---------------------------------------------------------------------------
-- Sources are compared trimmed, lower-case, with runs of spaces collapsed.
create or replace function public.lead_source_key(p text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

create table public.lead_source_channels (
  source_key text primary key check (source_key = public.lead_source_key(source_key)),
  source     text not null,   -- as AppFolio / n8n writes it, for display
  channel    text not null check (channel ~ '^(website_form|inbox_(zillow|offcampus_universe|och101|apartments|email)|feed_[a-z0-9_]+|phone|whatsapp|social|referral|other)$'),
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.lead_source_channels is
  'Source → channel. One row per distinct source string (normalized key). Sources not listed are channel ''other''. Editing a row re-derives leads.channel.';
create trigger lead_source_channels_touch before update on public.lead_source_channels
  for each row execute function public.touch_updated_at();

insert into public.lead_source_channels (source_key, source, channel)
select public.lead_source_key(s), s, c
from (values
  -- website form
  ('SCSH Website (PQ Form)', 'website_form'),
  ('PQ form', 'website_form'),
  -- sales@ inbox (n8n), plus the hand-entered sources agents used for the same emails
  ('SCSH Email Inquiry (Zillow)', 'inbox_zillow'),
  ('SCSH Email Inquiry (Offcampus-Universe)', 'inbox_offcampus_universe'),
  ('SCSH Email Inquiry (Off Campus Housing 101)', 'inbox_och101'),
  ('SCSH Email Inquiry (Apartments.com)', 'inbox_apartments'),
  ('SCSH Email Inquiry (Email)', 'inbox_email'),
  ('Source: Rental Website (Zillow)', 'inbox_zillow'),
  ('Source: Rental Website (Offcampus-Universe)', 'inbox_offcampus_universe'),
  ('Source: Rental Website (Off Campus Housing 101)', 'inbox_och101'),
  ('Source: Rental Website (Apartments.com)', 'inbox_apartments'),
  ('Source: Email', 'inbox_email'),
  ('Email', 'inbox_email'),
  -- AppFolio listing feeds (AppFolio's own source names)
  ('Zillow Rental Network', 'feed_zillow'),
  ('Rent.', 'feed_rent_com'),
  ('Rent.com', 'feed_rent_com'),
  ('Zumper', 'feed_zumper'),
  ('Apartment List', 'feed_apartment_list'),
  ('Apartments.com', 'feed_apartments_com'),
  ('Realtor.com', 'feed_realtor_com'),
  ('EveryApartment', 'feed_everyapartment'),
  ('Uloop', 'feed_uloop'),
  ('Rentler', 'feed_rentler'),
  ('Rentable', 'feed_rentable'),
  ('Redfin', 'feed_redfin'),
  ('Apartment Advisor', 'feed_apartment_advisor'),
  ('Website', 'feed_appfolio_website'),
  ('Website (chatgpt.com)', 'feed_appfolio_website'),
  ('Website (Yelp)', 'feed_appfolio_website'),
  ('Website (ig)', 'feed_appfolio_website'),
  ('Website (Apartments.com)', 'feed_appfolio_website'),
  -- phone / WhatsApp / social / referral
  ('Call', 'phone'),
  ('Caller Didn''t Provide Source', 'phone'),
  ('Source: WATI', 'whatsapp'),
  ('Source: Category (Facebook)', 'social'),
  ('Source: Reddit', 'social'),
  ('Source: Referred by the Owner', 'referral'),
  ('Source: Referred by a friend/family', 'referral'),
  ('Source: Referred by a tenant', 'referral'),
  ('Source: Referral', 'referral'),
  ('From Owner', 'referral')
) v(s, c);

create or replace function public.lead_channel_for(p_source text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.channel from public.lead_source_channels m where m.source_key = public.lead_source_key(p_source)), 'other')
$$;

alter table public.lead_source_channels enable row level security;
create policy lead_source_channels_read on public.lead_source_channels
  for select to authenticated using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy lead_source_channels_admin_insert on public.lead_source_channels
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy lead_source_channels_admin_update on public.lead_source_channels
  for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy lead_source_channels_admin_delete on public.lead_source_channels
  for delete to authenticated using (public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- leads.channel
-- ---------------------------------------------------------------------------
alter table public.leads add column channel text not null default 'other';
create index leads_channel_idx on public.leads (channel);

-- Channel follows source_first. A brand-new lead from the website form is an
-- A lead even before its PQ payload arrives (the PQ endpoint then just updates it).
create or replace function public.leads_set_channel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.channel := public.lead_channel_for(new.source_first);
  if tg_op = 'INSERT' and new.channel = 'website_form' and new.rotation = 'B' then
    new.rotation := 'A';
    new.has_form := true;
    new.stage    := public.lead_stage_advance(new.stage, 'form_filled');
  end if;
  return new;
end $$;
create trigger leads_set_channel before insert or update of source_first on public.leads
  for each row execute function public.leads_set_channel();

update public.leads set channel = public.lead_channel_for(source_first);

-- Editing the map re-derives every lead's channel.
create or replace function public.lead_source_channels_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads l
     set channel = public.lead_channel_for(l.source_first)
   where l.channel is distinct from public.lead_channel_for(l.source_first);
  return null;
end $$;
create trigger lead_source_channels_changed after insert or update or delete on public.lead_source_channels
  for each statement execute function public.lead_source_channels_changed();

-- Every source string seen (guest cards + leads) that maps to 'other'.
create view public.lead_sources_unmapped
with (security_invoker = true) as
  select s.source, count(*) as rows_seen, max(s.seen_at) as last_seen
  from (
    select i.source, i.received as seen_at from public.guest_card_interests i
    union all
    select l.source_first, l.first_seen_at from public.leads l
  ) s
  where public.lead_channel_for(s.source) = 'other'
  group by s.source
  order by count(*) desc;

-- ---------------------------------------------------------------------------
-- Owner of a brand-new lead (replaces 0009). Before go-live: an active agent
-- named by AppFolio owns it (no turn), else unowned. After go-live: rotation,
-- whatever AppFolio says (owner_mismatch shows the disagreement).
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

  if v_lead.first_seen_at >= p_go_live then
    return public.assign_lead_by_rotation(p_lead_id, p_actor);
  end if;

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

  insert into public.lead_events (lead_id, type, payload, actor)
  values (p_lead_id, 'assigned', jsonb_build_object('result', 'pre_go_live_unassigned', 'rotation', v_lead.rotation, 'turn', false, 'go_live_at', p_go_live), p_actor);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Sync safety net: rotate post-go-live leads that still have no owner.
-- Skips quietly when no agent is active (no event spam every 15 minutes).
-- ---------------------------------------------------------------------------
create or replace function public.assign_unowned_leads(p_actor text default 'appfolio_sync')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_go_live timestamptz;
  v_id      bigint;
  v_n       integer := 0;
begin
  perform public.require_admin_or_service();
  perform pg_advisory_xact_lock(hashtext('public.lead_intake'));
  select (value #>> '{}')::timestamptz into v_go_live from public.app_settings where key = 'leads_go_live_at';
  if v_go_live is null or not exists (select 1 from public.agents where active) then return 0; end if;

  for v_id in
    select id from public.leads
    where owner_agent_id is null
      and status not in ('test', 'duplicate_of')
      and first_seen_at >= v_go_live
    order by first_seen_at, id
  loop
    if public.assign_lead_by_rotation(v_id, p_actor) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

revoke execute on function public.lead_channel_for(text) from public, anon;
revoke execute on function public.assign_unowned_leads(text) from public, anon, authenticated;
grant execute on function public.lead_channel_for(text) to authenticated, service_role;
grant execute on function public.assign_unowned_leads(text) to service_role;
