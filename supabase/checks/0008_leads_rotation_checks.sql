-- Checks for 0008_leads_rotation.sql against the real SQL functions.
-- Paste into Supabase SQL Editor and run AFTER the migration. Everything runs
-- in one transaction and is ROLLED BACK — no agents or leads are left behind.
-- Success = the notice "all lead rotation checks passed". Any failure raises
-- an error naming the check.

begin;

-- Isolate from real agents and real leads' turns.
update public.agents set active = false;
insert into public.agents (name, email) values ('Check One', 'check1@test.local'), ('Check Two', 'check2@test.local');

do $$
declare
  a1  bigint := (select id from public.agents where email = 'check1@test.local');
  a2  bigint := (select id from public.agents where email = 'check2@test.local');
  l1  bigint; l2 bigint; l3 bigint; l4 bigint;
  got bigint;
begin
  -- 1. Tie, nobody assigned yet → lowest id.
  insert into public.leads (email_norm, rotation) values ('r1@test.local', 'B') returning id into l1;
  got := public.assign_lead_by_rotation(l1);
  assert got = a1, format('1 first B lead: expected %s, got %s', a1, got);

  -- 2. Fewest B turns in 14 days.
  insert into public.leads (email_norm, rotation) values ('r2@test.local', 'B') returning id into l2;
  got := public.assign_lead_by_rotation(l2);
  assert got = a2, format('2 second B lead: expected %s, got %s', a2, got);

  -- 3. A turns are counted separately; tie → older last_assigned_at (a1 went first).
  insert into public.leads (email_norm, rotation, has_form) values ('r3@test.local', 'A', true) returning id into l3;
  got := public.assign_lead_by_rotation(l3);
  assert got = a1, format('3 first A lead: expected %s, got %s', a1, got);

  -- 4. Marking a lead test returns its turn: a2 drops to 0 B turns, gets the next B.
  perform public.set_lead_status(l2, 'test', 'check');
  insert into public.leads (phone_norm, rotation) values ('3105550199', 'B') returning id into l4;
  got := public.assign_lead_by_rotation(l4);
  assert got = a2, format('4 after returned turn: expected %s, got %s', a2, got);
  assert (select b_turns from public.agents where id = a2) = 1, '4 counter: a2 b_turns should be 1 (+1 -1 +1)';
  assert (select a_turns from public.agents where id = a1) = 1, '4 counter: a1 a_turns should be 1';

  -- 5. An owned lead is never re-picked by rotation.
  assert public.assign_lead_by_rotation(l1) = a1, '5 owned lead changed owner';

  -- 6. Reassign needs a reason; ownership moves, the turn stays with the original agent.
  begin
    perform public.reassign_lead(l1, a2, '  ');
    raise exception 'reassign without reason was accepted';
  exception when others then
    if sqlerrm not like '%reason is required%' then raise; end if;
  end;
  perform public.reassign_lead(l1, a2, 'covering vacation');
  assert (select owner_agent_id from public.leads where id = l1) = a2, '6 owner not moved';
  assert (select turn_agent_id from public.leads where id = l1) = a1, '6 turn moved with owner';
  assert exists (select 1 from public.lead_events where lead_id = l1 and type = 'reassigned' and payload ->> 'reason' = 'covering vacation'), '6 reassign not logged';

  -- 7. owner_mismatch follows AppFolio's assigned user.
  update public.agents set appfolio_name = 'Check Two Appfolio' where id = a2;
  update public.leads set appfolio_assigned_user = 'Somebody Else' where id = l4;
  assert (select owner_mismatch from public.leads where id = l4), '7 mismatch not flagged';
  update public.leads set appfolio_assigned_user = 'check two appfolio' where id = l4;
  assert not (select owner_mismatch from public.leads where id = l4), '7 mismatch not cleared';

  -- 8. A lead with neither email nor phone is refused.
  begin
    insert into public.leads (rotation) values ('B');
    raise exception 'lead without contact was accepted';
  exception when check_violation then null;
  end;

  -- 9. Leads are never deleted.
  begin
    delete from public.leads where id = l1;
    raise exception 'delete was accepted';
  exception when others then
    if sqlerrm not like '%never deleted%' then raise; end if;
  end;

  -- 10. No active agent → lead stays unowned and the attempt is logged.
  update public.agents set active = false;
  insert into public.leads (email_norm, rotation) values ('r5@test.local', 'B') returning id into l1;
  assert public.assign_lead_by_rotation(l1) is null, '10 assigned with no active agent';
  assert exists (select 1 from public.lead_events where lead_id = l1 and payload ->> 'result' = 'no_active_agent'), '10 not logged';

  raise notice 'all lead rotation checks passed';
end $$;

rollback;
