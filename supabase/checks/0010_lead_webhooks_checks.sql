-- Checks for 0010_lead_webhooks.sql (webhook responses, no-form intake).
-- Paste into Supabase SQL Editor AFTER the migration. Rolled back — nothing
-- persists. Success = the notice "all lead webhook checks passed".

begin;

update public.agents set active = false;
insert into public.agents (name, email) values ('Check One', 'check1@test.local'), ('Check Two', 'check2@test.local');
insert into public.app_settings (key, value) values ('leads_go_live_at', to_jsonb('2026-10-01T00:00:00Z'::timestamptz))
  on conflict (key) do update set value = excluded.value;
update public.app_settings set value = 'true'::jsonb where key = 'notifications_test_mode';

do $$
declare
  a1 bigint := (select id from public.agents where email = 'check1@test.local');
  a2 bigint := (select id from public.agents where email = 'check2@test.local');
  r  jsonb;
  r2 jsonb;
  l  bigint;
begin
  -- 1. New no-form lead → B rotation (a1), owner name/email returned, not returning.
  r := public.ingest_n8n_inquiry('{"email":"Nf1@Test.local","phone":"(310) 555-0201","name":"No Form","source":"Zillow"}');
  l := (r ->> 'lead_id')::bigint;
  assert r ->> 'status' = 'created' and r ->> 'rotation' = 'B', '1 created B: ' || r::text;
  assert (r ->> 'owner_agent_id')::bigint = a1 and r ->> 'owner_name' = 'Check One' and r ->> 'owner_email' = 'check1@test.local', '1 owner: ' || r::text;
  assert (r ->> 'is_returning')::boolean = false and (r ->> 'test_mode')::boolean, '1 flags: ' || r::text;

  -- 2. Same person again the same day (n8n retry) → duplicate, no new turn, returning.
  r := public.ingest_n8n_inquiry('{"phone":"+1 310 555 0201","source":"zillow"}');
  assert r ->> 'status' = 'duplicate' and (r ->> 'lead_id')::bigint = l and (r ->> 'is_returning')::boolean, '2 retry: ' || r::text;
  assert (select b_turns from public.agents where id = a1) = 1, '2 extra turn';

  -- 3. Same person, other source → updated (new inquiry event), still no turn.
  r := public.ingest_n8n_inquiry('{"email":"nf1@test.local","source":"Website"}');
  assert r ->> 'status' = 'updated' and (r ->> 'is_returning')::boolean, '3 other source: ' || r::text;

  -- 4. That B lead fills the PQ form → converted_now, same owner, returning.
  r := public.ingest_pq_submission('{"submission_id":"chk10-1","email":"nf1@test.local","score":70,"tier":"B"}');
  assert r ->> 'status' = 'updated' and (r ->> 'converted_now')::boolean and (r ->> 'converted_from_b')::boolean, '4 conversion: ' || r::text;
  assert r ->> 'owner_email' = 'check1@test.local' and (r ->> 'is_returning')::boolean and r ->> 'rotation' = 'A', '4 owner: ' || r::text;

  -- 5. Retry of that submission answers the same way.
  r2 := public.ingest_pq_submission('{"submission_id":"chk10-1","email":"nf1@test.local"}');
  assert r2 ->> 'status' = 'duplicate' and (r2 ->> 'converted_now')::boolean and (r2 ->> 'is_returning')::boolean, '5 retry: ' || r2::text;

  -- 6. Brand-new PQ person → A rotation: both have 0 A turns, a2 was never assigned → a2.
  r := public.ingest_pq_submission('{"submission_id":"chk10-2","email":"nf2@test.local"}');
  assert r ->> 'status' = 'created' and (r ->> 'is_returning')::boolean = false and (r ->> 'owner_agent_id')::bigint = a2, '6 new PQ: ' || r::text;

  -- 7. Pre-go-live person → no owner: owner_name / owner_email are null.
  r := public.ingest_pq_submission('{"submission_id":"chk10-3","email":"nf3@test.local","submitted_at":"2026-09-01T00:00:00Z"}');
  assert r -> 'owner_name' = 'null'::jsonb and r -> 'owner_email' = 'null'::jsonb, '7 unowned: ' || r::text;

  -- 8. No contact → rejected.
  assert public.ingest_n8n_inquiry('{"name":"Nobody"}') ->> 'status' = 'rejected', '8 rejected';

  raise notice 'all lead webhook checks passed';
end $$;

rollback;
