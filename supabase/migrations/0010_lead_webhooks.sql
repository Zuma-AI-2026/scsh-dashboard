-- 0010_lead_webhooks.sql
-- n8n sends all notification emails, so both webhooks return everything it
-- needs: owner name/email, whether the person was already known, whether
-- this request converted a B lead, and the admin "test mode" switch.
--   * ingest_pq_submission  — same behaviour, richer response
--   * ingest_n8n_inquiry    — new: no-form leads n8n sees (POST /api/leads/assign)

alter table public.lead_intake_rejections drop constraint lead_intake_rejections_source_check;
alter table public.lead_intake_rejections add constraint lead_intake_rejections_source_check
  check (source in ('guest_card', 'pq_form', 'application', 'n8n_inquiry'));

-- Admin switch read by n8n: when true, n8n sends every email to the test inbox.
insert into public.app_settings (key, value, updated_by) values ('notifications_test_mode', 'false'::jsonb, 'migration 0010')
  on conflict (key) do nothing;
create policy app_settings_admin_insert on public.app_settings
  for insert to authenticated with check (public.current_app_role() = 'admin' and key = 'notifications_test_mode');
create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using (public.current_app_role() = 'admin' and key = 'notifications_test_mode')
  with check (public.current_app_role() = 'admin' and key = 'notifications_test_mode');

-- The one response shape both webhooks return.
--   converted_from_b = the lead's flag;  converted_now = this request moved it B → A.
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
    'test_mode',        coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'notifications_test_mode'), false)
  )
  from public.leads l
  left join public.agents a on a.id = l.owner_agent_id
  where l.id = p_lead_id
$$;

-- ---------------------------------------------------------------------------
-- PQ form (replaces 0009's version; logic unchanged, response richer).
-- A repeat submission_id answers exactly like the original did, so an n8n
-- retry after a timeout still gets is_returning / converted_now right.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_pq_submission(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub       text := nullif(trim(p ->> 'submission_id'), '');
  v_key       text;
  v_existing  public.lead_events%rowtype;
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
begin
  perform public.require_admin_or_service();
  if v_sub is null then raise exception 'submission_id is required'; end if;
  perform pg_advisory_xact_lock(hashtext('public.lead_intake'));

  v_key := 'pq:' || v_sub;
  select * into v_existing from public.lead_events where dedupe_key = v_key;
  if found then
    return public.lead_webhook_response(public.lead_root(v_existing.lead_id), 'duplicate',
                                        not coalesce((v_existing.payload ->> 'new_lead')::boolean, false),
                                        coalesce((v_existing.payload ->> 'converted_from_b')::boolean, false));
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
    select rotation = 'B' into v_converted from public.leads where id = v_lead for update;
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

  return public.lead_webhook_response(v_lead, case when v_created then 'created' else 'updated' end, not v_created, v_converted);
end $$;

-- ---------------------------------------------------------------------------
-- No-form lead seen by n8n (email/Zillow/website inquiry before AppFolio has it).
-- New person → B lead, owner by the normal rule (rotation after go-live).
-- Known person → returned as-is plus an inquiry event; never a new turn.
-- One inquiry event per lead, source and LA calendar day, so n8n retries
-- don't stack events (a retry answers 'duplicate').
-- ---------------------------------------------------------------------------
create or replace function public.ingest_n8n_inquiry(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email   text := public.normalize_email(p ->> 'email');
  v_phone   text := public.normalize_phone(p ->> 'phone');
  v_name    text := nullif(trim(p ->> 'name'), '');
  v_source  text := coalesce(nullif(trim(p ->> 'source'), ''), 'n8n');
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
  values (v_lead, 'inquiry', jsonb_build_object('source', v_source, 'name', v_name, 'via', 'n8n', 'returning', not v_created), now(), 'n8n',
          format('n8n:%s:%s:%s', v_lead, lower(v_source), (now() at time zone 'America/Los_Angeles')::date))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_written = row_count;

  if v_created then
    perform public.assign_new_lead(v_lead, null, v_go_live, 'n8n');
  end if;

  return public.lead_webhook_response(v_lead, case when v_created then 'created' when v_written = 0 then 'duplicate' else 'updated' end,
                                      not v_created, false);
end $$;

revoke execute on function public.lead_webhook_response(bigint, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.ingest_n8n_inquiry(jsonb) from public, anon, authenticated;
grant execute on function public.lead_webhook_response(bigint, text, boolean, boolean) to service_role;
grant execute on function public.ingest_n8n_inquiry(jsonb) to service_role;
