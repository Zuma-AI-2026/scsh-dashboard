-- Checks for 0016_lead_actions.sql (who may act on a lead, notified events).
-- Paste into Supabase SQL Editor AFTER the migration. Rolled back — nothing
-- persists. Success = the notice "all lead action checks passed".

begin;

update public.agents set active = false;
insert into public.agents (name, email) values ('Check One', 'check1@test.local'), ('Check Two', 'check2@test.local');
insert into public.app_users (email, role) values ('check1@test.local', 'sales'), ('check2@test.local', 'sales'), ('checkpartner@test.local', 'partner')
  on conflict (email) do update set role = excluded.role;
insert into public.app_settings (key, value) values ('leads_go_live_at', to_jsonb('2026-10-01T00:00:00Z'::timestamptz))
  on conflict (key) do update set value = excluded.value;

do $$
declare
  a1 bigint := (select id from public.agents where email = 'check1@test.local');
  a2 bigint := (select id from public.agents where email = 'check2@test.local');
  l  bigint;
  r  jsonb;
  failed boolean;
  before timestamptz;
begin
  r := public.ingest_n8n_inquiry('{"email":"act1@test.local","source":"SCSH Email Inquiry (Zillow)","summary":"2 people, Aug move-in"}');
  l := (r ->> 'lead_id')::bigint;
  assert (r ->> 'owner_agent_id')::bigint = a1 and r ? 'test_recipient', '0 setup: ' || r::text;
  assert (select payload ->> 'summary' from public.lead_events where lead_id = l and type = 'inquiry') = '2 people, Aug move-in', '0 summary kept';

  -- 1. Another sales agent may not touch a1's lead.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"check2@test.local"}', true);
  failed := false;
  begin perform public.set_lead_status(l, 'not_interested', 'x'); exception when others then failed := true; end;
  assert failed, '1 other agent changed status';
  -- …nor a partner.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"checkpartner@test.local"}', true);
  failed := false;
  begin perform public.reassign_lead(l, a2, 'x'); exception when others then failed := true; end;
  assert failed, '1 partner reassigned';

  -- 2. The owner may reassign (reason required); the turn stays with a1.
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"check1@test.local"}', true);
  failed := false;
  begin perform public.reassign_lead(l, a2, ' '); exception when others then failed := true; end;
  assert failed, '2 reassign without reason';
  perform public.reassign_lead(l, a2, 'going on leave');
  assert (select owner_agent_id = a2 and turn_agent_id = a1 from public.leads where id = l), '2 owner moved, turn stayed';

  -- 3. a1 no longer owns it → may not set status; a2 (new owner) marks it test → turn returned to a1.
  failed := false;
  begin perform public.set_lead_status(l, 'test', 'x'); exception when others then failed := true; end;
  assert failed, '3 previous owner acted';
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"check2@test.local"}', true);
  perform public.set_lead_status(l, 'test', 'n8n test');
  assert (select b_turns from public.agents where id = a1) = 0, '3 turn not returned';
  assert exists (select 1 from public.leads where id = l), '3 never deleted';

  -- 4. Notified events: service only, idempotent, not prospect activity.
  perform set_config('request.jwt.claims', '', true);
  before := (select last_event_at from public.leads where id = l);
  r := public.record_lead_notified(jsonb_build_object('lead_id', l, 'channel', 'email', 'recipient', 'Check2@Test.local', 'test_redirect', false, 'sent_at', '2099-01-01T00:00:00Z'));
  assert r ->> 'status' = 'created', '4 created: ' || r::text;
  r := public.record_lead_notified(jsonb_build_object('lead_id', l, 'recipient', 'check2@test.local', 'sent_at', '2099-01-01T00:00:00Z'));
  assert r ->> 'status' = 'duplicate', '4 retry: ' || r::text;
  assert public.record_lead_notified('{"lead_id": -1, "recipient": "x@y.z"}') ->> 'status' = 'rejected', '4 unknown lead';
  assert (select last_event_at is not distinct from before from public.leads where id = l), '4 notified moved last_event_at';

  raise notice 'all lead action checks passed';
end $$;

rollback;
