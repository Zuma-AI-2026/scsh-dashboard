-- Checks for 0009_lead_intake.sql (PQ intake, go-live rule, bulk assign).
-- Paste into Supabase SQL Editor and run AFTER the migration. Everything runs
-- in one transaction and is ROLLED BACK — the real go-live date, agents and
-- leads are untouched. Success = the notice "all lead intake checks passed".

begin;

update public.agents set active = false;
insert into public.agents (name, email) values ('Check One', 'check1@test.local'), ('Check Two', 'check2@test.local');
insert into public.app_settings (key, value) values ('leads_go_live_at', to_jsonb('2026-10-01T00:00:00Z'::timestamptz))
  on conflict (key) do update set value = excluded.value;

do $$
declare
  a1    bigint := (select id from public.agents where email = 'check1@test.local');
  a2    bigint := (select id from public.agents where email = 'check2@test.local');
  r     jsonb;
  l_new bigint;
  l_old bigint;
  l_b   bigint;
begin
  -- 1. New person after go-live submits the PQ form → new A lead, rotation picks a1 (tie → lowest id).
  r := public.ingest_pq_submission('{"submission_id":"chk-1","name":"Check Person","email":" Chk1@Test.local ","phone":"+1 (310) 555-0101","property":"Check House","submitted_at":"2026-10-20T10:00:00Z","score":82,"tier":"A"}');
  assert r ->> 'status' = 'created', '1 status: ' || r::text;
  assert r ->> 'rotation' = 'A', '1 rotation: ' || r::text;
  assert (r ->> 'owner_agent_id')::bigint = a1, '1 owner: ' || r::text;
  l_new := (r ->> 'lead_id')::bigint;
  assert (select email_norm = 'chk1@test.local' and phone_norm = '3105550101' and has_form and stage = 'form_filled' and pq_score = 82
          from public.leads where id = l_new), '1 lead fields';

  -- 2. Same submission_id again → 200-style duplicate, same lead, nothing new.
  r := public.ingest_pq_submission('{"submission_id":"chk-1","email":"someone-else@test.local"}');
  assert r ->> 'status' = 'duplicate' and (r ->> 'lead_id')::bigint = l_new, '2 duplicate: ' || r::text;
  assert (select count(*) from public.lead_events where lead_id = l_new and type = 'form') = 1, '2 second form event written';

  -- 3. Submitted before go-live → no owner, no turn.
  r := public.ingest_pq_submission('{"submission_id":"chk-2","email":"chk2@test.local","submitted_at":"2026-09-01T00:00:00Z"}');
  l_old := (r ->> 'lead_id')::bigint;
  assert r ->> 'status' = 'created' and r -> 'owner_agent_id' = 'null'::jsonb, '3 pre-go-live owned: ' || r::text;
  assert (select turn_agent_id is null from public.leads where id = l_old), '3 pre-go-live consumed a turn';

  -- 4. A B lead (owned by rotation) submits the form → moves to A, keeps owner, no A turn.
  insert into public.leads (email_norm, rotation, first_seen_at) values ('chk3@test.local', 'B', '2026-10-21') returning id into l_b;
  perform public.assign_lead_by_rotation(l_b);  -- a2: equal B turns, a2 never assigned
  r := public.ingest_pq_submission('{"submission_id":"chk-3","email":"CHK3@test.local","score":55,"tier":"C"}');
  assert r ->> 'status' = 'updated' and (r ->> 'lead_id')::bigint = l_b, '4 match: ' || r::text;
  assert (r ->> 'converted_from_b')::boolean and r ->> 'rotation' = 'A' and (r ->> 'owner_agent_id')::bigint = a2, '4 conversion: ' || r::text;
  assert (select a_turns from public.agents where id = a2) = 0, '4 conversion consumed an A turn';
  assert (select turn_rotation = 'B' from public.leads where id = l_b), '4 original B turn lost';

  -- 5. Matching by phone when email differs.
  r := public.ingest_pq_submission('{"submission_id":"chk-5","email":"new-address@test.local","phone":"310.555.0101"}');
  assert (r ->> 'lead_id')::bigint = l_new and r ->> 'status' = 'updated', '5 phone match: ' || r::text;

  -- 6. Neither email nor phone → rejected and logged.
  r := public.ingest_pq_submission('{"submission_id":"chk-6","name":"Nobody","phone":"12"}');
  assert r ->> 'status' = 'rejected', '6 rejected: ' || r::text;
  assert exists (select 1 from public.lead_intake_rejections where source = 'pq_form' and source_ref = 'chk-6'), '6 not logged';

  -- 7. Bulk assign: unowned → a2 with no turn; already-owned leads are skipped.
  assert public.bulk_assign_leads(array[l_old, l_new], a2) = 1, '7 bulk count';
  assert (select owner_agent_id = a2 and assigned_via = 'admin' and turn_agent_id is null from public.leads where id = l_old), '7 bulk result';
  assert (select owner_agent_id from public.leads where id = l_new) = a1, '7 owned lead was taken';

  -- 8. Helpers.
  assert public.normalize_phone('+1 (310) 555-0101') = '3105550101', '8 phone';
  assert public.normalize_phone('+44 20 7946 0958') = '442079460958', '8 intl phone';
  assert public.normalize_phone('123') is null, '8 short phone';
  assert public.normalize_email('  A.B@USC.edu ') = 'a.b@usc.edu' and public.normalize_email('junk') is null, '8 email';
  assert public.lead_stage_advance('tour', 'contacted') = 'tour' and public.lead_stage_advance('contacted', 'tour') = 'tour', '8 forward only';
  assert public.lead_stage_advance('leased', 'application') = 'leased', '8 terminal';

  raise notice 'all lead intake checks passed';
end $$;

rollback;
