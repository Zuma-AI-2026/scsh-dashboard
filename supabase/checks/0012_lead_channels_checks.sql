-- Checks for 0012_lead_channels.sql (channel map, website-form cards, B intake).
-- Paste into Supabase SQL Editor AFTER the migration. Rolled back — nothing
-- persists. Success = the notice "all lead channel checks passed".

begin;

update public.agents set active = false;
insert into public.agents (name, email, appfolio_name) values
  ('Check One', 'check1@test.local', null),
  ('Check Two', 'check2@test.local', 'Check Two AF');
insert into public.app_settings (key, value) values ('leads_go_live_at', to_jsonb('2026-10-01T00:00:00Z'::timestamptz))
  on conflict (key) do update set value = excluded.value;

do $$
declare
  a1 bigint := (select id from public.agents where email = 'check1@test.local');
  a2 bigint := (select id from public.agents where email = 'check2@test.local');
  r  jsonb;
  l  bigint;
begin
  -- 1. Map lookups: exact string, case/spacing ignored, unknown → other.
  assert public.lead_channel_for('SCSH Email Inquiry (Zillow)') = 'inbox_zillow', '1 inbox zillow';
  assert public.lead_channel_for('  scsh   email inquiry (off campus housing 101) ') = 'inbox_och101', '1 normalized';
  assert public.lead_channel_for('Zillow Rental Network') = 'feed_zillow', '1 feed';
  assert public.lead_channel_for('Something New') = 'other' and public.lead_channel_for(null) = 'other', '1 other';

  -- 2. n8n inbox lead → channel set, B rotation (a1: tie → lowest id).
  r := public.ingest_n8n_inquiry('{"email":"ch1@test.local","name":"Inbox","source":"SCSH Email Inquiry (Offcampus-Universe)"}');
  l := (r ->> 'lead_id')::bigint;
  assert r ->> 'rotation' = 'B' and (r ->> 'owner_agent_id')::bigint = a1, '2 B rotation: ' || r::text;
  assert (select channel from public.leads where id = l) = 'inbox_offcampus_universe', '2 channel';

  -- 3. A lead born from the website form's guest card is an A lead (A rotation, a2 never assigned an A).
  r := public.ingest_n8n_inquiry('{"email":"ch2@test.local","source":"SCSH Website (PQ Form)"}');
  assert r ->> 'rotation' = 'A' and (r ->> 'owner_agent_id')::bigint = a2, '3 form card → A: ' || r::text;
  assert (select has_form and stage = 'form_filled' and not converted_from_b from public.leads where id = (r ->> 'lead_id')::bigint), '3 form flags';

  -- 4. After go-live AppFolio's assigned user does not pick the owner: rotation does.
  insert into public.leads (name, email_norm, rotation, stage, source_first, first_seen_at, appfolio_assigned_user)
  values ('AF Named', 'ch3@test.local', 'B', 'new', 'Zumper', '2026-10-05', 'Check Two AF') returning id into l;
  assert public.assign_new_lead(l, 'Check Two AF', '2026-10-01', 'check') = a2, '4 rotation picks a2 (fewer B turns)';
  assert (select assigned_via = 'rotation' and turn_rotation = 'B' from public.leads where id = l), '4 via rotation';
  -- …before go-live it still does (no turn).
  insert into public.leads (name, email_norm, rotation, stage, source_first, first_seen_at)
  values ('AF Old', 'ch4@test.local', 'B', 'new', 'Zumper', '2026-09-05') returning id into l;
  assert public.assign_new_lead(l, 'Check Two AF', '2026-10-01', 'check') = a2, '4 pre-go-live AppFolio agent';
  assert (select assigned_via = 'appfolio' and turn_agent_id is null from public.leads where id = l), '4 pre-go-live no turn';

  -- 5. Sync safety net: an unowned post-go-live lead gets rotated; none active → nothing, no event.
  update public.agents set active = false where id in (a1, a2);
  r := public.ingest_n8n_inquiry('{"email":"ch5@test.local","source":"Zumper"}');
  l := (r ->> 'lead_id')::bigint;
  assert r -> 'owner_agent_id' = 'null'::jsonb, '5 unowned while nobody active';
  assert public.assign_unowned_leads('check') = 0, '5 no agents → 0';
  update public.agents set active = true where id = a1;
  assert public.assign_unowned_leads('check') >= 1, '5 sweep assigned';
  assert (select owner_agent_id = a1 and assigned_via = 'rotation' from public.leads where id = l), '5 owner a1';

  -- 6. Editing the map re-derives channels.
  insert into public.lead_source_channels (source_key, source, channel) values ('zumper', 'Zumper', 'social')
    on conflict (source_key) do update set channel = excluded.channel;
  assert (select channel from public.leads where id = l) = 'social', '6 re-derived';

  raise notice 'all lead channel checks passed';
end $$;

rollback;
