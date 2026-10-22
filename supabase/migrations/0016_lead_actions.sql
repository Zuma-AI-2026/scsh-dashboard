-- 0016_lead_actions.sql
-- * Row actions: status and reassign may be done by an admin, or by the lead's
--   own owner when they have the sales role (agent matched by login email).
--   Step-1 rules unchanged: reason required to reassign; test / duplicate_of
--   return the turn; leads are never deleted.
-- * record_lead_notified(): n8n reports each notice it sent (POST /api/leads/notified)
--   → lead_events type 'notified' (not prospect activity: last_event_at unchanged).
-- * app_settings.notifications_test_recipient: where n8n sends every notice in
--   test mode; shown on Admin → Agents and returned to n8n as test_recipient.
-- * ingest_n8n_inquiry keeps an optional free-text summary of the inquiry.

-- ---------------------------------------------------------------------------
-- Who may act on a lead
-- ---------------------------------------------------------------------------
create or replace function public.current_agent_id()
returns bigint
language sql stable security definer set search_path = public as $$
  select a.id from public.agents a
  where lower(a.email) = lower(auth.jwt() ->> 'email')
  order by a.id limit 1
$$;

create or replace function public.require_lead_actor(p_lead_id bigint)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then return; end if;
  if public.current_app_role() = 'admin' then return; end if;
  if public.current_app_role() = 'sales'
     and exists (select 1 from public.leads l where l.id = p_lead_id and l.owner_agent_id = public.current_agent_id()) then
    return;
  end if;
  raise exception 'only an admin or the lead''s owner can change lead %', p_lead_id;
end $$;

-- Reassign (replaces 0008): admin or owner. Reason required. The consumed turn stays put.
create or replace function public.reassign_lead(p_lead_id bigint, p_agent_id bigint, p_reason text, p_actor text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lead  public.leads%rowtype;
  v_actor text := coalesce(auth.jwt() ->> 'email', p_actor, 'system');
begin
  perform public.require_lead_actor(p_lead_id);
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required to reassign'; end if;
  if not exists (select 1 from public.agents where id = p_agent_id and active) then raise exception 'agent % is not active', p_agent_id; end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'lead % not found', p_lead_id; end if;
  if v_lead.owner_agent_id = p_agent_id then return; end if;

  update public.leads set owner_agent_id = p_agent_id, assigned_via = 'admin', assigned_at = clock_timestamp() where id = p_lead_id;
  insert into public.lead_events (lead_id, type, payload, actor)
  values (p_lead_id, 'reassigned', jsonb_build_object('from_agent_id', v_lead.owner_agent_id, 'to_agent_id', p_agent_id, 'reason', trim(p_reason)), v_actor);
end $$;

-- Status (replaces 0008): admin or owner. test / duplicate_of return the turn;
-- moving back to a counted status takes it again.
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
  perform public.require_lead_actor(p_lead_id);
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

-- ---------------------------------------------------------------------------
-- Test-mode recipient
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, updated_by)
values ('notifications_test_recipient', to_jsonb('savas@scshdev.com'::text), 'migration 0016')
on conflict (key) do nothing;

drop policy app_settings_admin_insert on public.app_settings;
drop policy app_settings_admin_update on public.app_settings;
create policy app_settings_admin_insert on public.app_settings
  for insert to authenticated
  with check (public.current_app_role() = 'admin' and key in ('notifications_test_mode', 'notifications_test_recipient'));
create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using (public.current_app_role() = 'admin' and key in ('notifications_test_mode', 'notifications_test_recipient'))
  with check (public.current_app_role() = 'admin' and key in ('notifications_test_mode', 'notifications_test_recipient'));

-- Webhook response (replaces 0010) + test_recipient.
create or replace function public.lead_webhook_response(p_lead_id bigint, p_status text, p_is_returning boolean, p_converted_now boolean)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status',           p_status,
    'lead_id',          l.id,
    'rotation',         l.rotation,
    'stage',            l.stage,
    'lead_status',      l.status,
    'owner_agent_id',   l.owner_agent_id,
    'owner_name',       a.name,
    'owner_email',      a.email,
    'is_returning',     p_is_returning,
    'converted_from_b', l.converted_from_b,
    'converted_now',    p_converted_now,
    'test_mode',        coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'notifications_test_mode'), false),
    'test_recipient',   (select s.value #>> '{}' from public.app_settings s where s.key = 'notifications_test_recipient')
  )
  from public.leads l
  left join public.agents a on a.id = l.owner_agent_id
  where l.id = p_lead_id
$$;

-- ---------------------------------------------------------------------------
-- Notices sent by n8n
-- ---------------------------------------------------------------------------
create or replace function public.record_lead_notified(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead      bigint;
  v_recipient text := lower(nullif(trim(p ->> 'recipient'), ''));
  v_channel   text := coalesce(nullif(trim(p ->> 'channel'), ''), 'email');
  v_test      boolean := coalesce((p ->> 'test_redirect')::boolean, false);
  v_at        timestamptz := coalesce((p ->> 'sent_at')::timestamptz, now());
  v_id        bigint;
begin
  perform public.require_admin_or_service();
  if v_recipient is null then raise exception 'recipient is required'; end if;
  select public.lead_root(l.id) into v_lead from public.leads l where l.id = (p ->> 'lead_id')::bigint;
  if v_lead is null then return jsonb_build_object('status', 'rejected', 'reason', 'lead_not_found'); end if;

  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  values (v_lead, 'notified', jsonb_build_object('channel', v_channel, 'recipient', v_recipient, 'test_redirect', v_test), v_at, 'n8n',
          format('notified:%s:%s:%s:%s', v_lead, v_channel, v_recipient, extract(epoch from v_at)::bigint))
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return jsonb_build_object(
    'status', case when v_id is null then 'duplicate' else 'created' end,
    'lead_id', v_lead,
    'event_id', v_id,
    'test_mode', coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'notifications_test_mode'), false)
  );
end $$;

-- ---------------------------------------------------------------------------
-- n8n inquiry (replaces 0010) — same logic, plus an optional summary.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_n8n_inquiry(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email   text := public.normalize_email(p ->> 'email');
  v_phone   text := public.normalize_phone(p ->> 'phone');
  v_name    text := nullif(trim(p ->> 'name'), '');
  v_source  text := coalesce(nullif(trim(p ->> 'source'), ''), 'n8n');
  v_summary text := nullif(trim(p ->> 'summary'), '');
  v_go_live timestamptz;
  v_lead    bigint;
  v_created boolean := false;
  v_written integer;
begin
  perform public.require_admin_or_service();
  perform pg_advisory_xact_lock(hashtext('public.lead_intake'));

  if v_email is null and v_phone is null then
    insert into public.lead_intake_rejections (source, source_ref, reason, payload)
    values ('n8n_inquiry', md5(p::text), 'no_email_or_phone', p)
    on conflict (source, source_ref) do update set last_seen_at = now();
    return jsonb_build_object('status', 'rejected', 'reason', 'no_email_or_phone');
  end if;

  v_go_live := public.lead_go_live_at();
  v_lead := public.match_lead(null, v_email, v_phone);

  if v_lead is null then
    insert into public.leads (email_norm, phone_norm, name, first_seen_at, source_first, rotation, stage)
    values (v_email, v_phone, v_name, now(), v_source, 'B', 'new')
    returning id into v_lead;
    v_created := true;
  else
    update public.leads
       set email_norm = coalesce(email_norm, v_email),
           phone_norm = coalesce(phone_norm, v_phone),
           name       = coalesce(name, v_name)
     where id = v_lead;
  end if;

  insert into public.lead_events (lead_id, type, payload, at, actor, dedupe_key)
  values (v_lead, 'inquiry',
          jsonb_strip_nulls(jsonb_build_object('source', v_source, 'name', v_name, 'via', 'n8n', 'returning', not v_created, 'summary', v_summary)),
          now(), 'n8n',
          format('n8n:%s:%s:%s', v_lead, lower(v_source), (now() at time zone 'America/Los_Angeles')::date))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_written = row_count;

  if v_created then
    perform public.assign_new_lead(v_lead, null, v_go_live, 'n8n');
  end if;

  return public.lead_webhook_response(v_lead, case when v_created then 'created' when v_written = 0 then 'duplicate' else 'updated' end,
                                      not v_created, false);
end $$;

revoke execute on function public.current_agent_id() from public, anon;
revoke execute on function public.require_lead_actor(bigint) from public, anon;
revoke execute on function public.record_lead_notified(jsonb) from public, anon, authenticated;
grant execute on function public.current_agent_id() to authenticated, service_role;
grant execute on function public.require_lead_actor(bigint) to authenticated, service_role;
grant execute on function public.record_lead_notified(jsonb) to service_role;
