-- Checks for 0017 (payment reminders). Run after the migration; changes nothing (rolls back).
begin;
insert into public.app_users (id, email, role) values
  ('00000000-0000-0000-0000-00000000a001', 'chk-acct@scshdev.com', 'accounting'),
  ('00000000-0000-0000-0000-00000000a002', 'chk-partner@scshdev.com', 'partner'),
  ('00000000-0000-0000-0000-00000000a003', 'chk-sales@scshdev.com', 'sales')
on conflict do nothing;

do $$
declare n int; ok boolean;
begin
  -- accounting may log a reminder and link a follow-up to it
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"chk-acct@scshdev.com"}', true);
  set local role authenticated;
  insert into public.collection_messages (sent_by, channel, occupancy_id, body, total_cents, status, "to")
  values ('chk-acct@scshdev.com', 'email', -1, 'hi', 100, 'drafted', '{a@x.co}');
  insert into public.delinquency_actions (occupancy_id, action, acted_by, collection_message_id)
  select -1, 'Emailed', 'chk-acct@scshdev.com', id from public.collection_messages where occupancy_id = -1;
  insert into public.collection_recipients (occupancy_id, to_emails) values (-1, '{a@x.co}');
  select count(*) into n from public.collection_senders where active;
  if n < 1 then raise exception '1 accounting should see sender mailboxes'; end if;
  reset role;

  -- partner reads history but cannot write, and cannot see open charges or senders
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"chk-partner@scshdev.com"}', true);
  set local role authenticated;
  select count(*) into n from public.collection_messages where occupancy_id = -1;
  if n <> 1 then raise exception '2 partner should read reminder history'; end if;
  select count(*) into n from public.collection_senders;
  if n <> 0 then raise exception '3 partner must not read sender settings'; end if;
  ok := false;
  begin
    insert into public.collection_messages (sent_by, channel, occupancy_id, body, total_cents, status) values ('p', 'email', -1, 'x', 1, 'drafted');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception '4 partner must not write reminders'; end if;
  reset role;

  -- sales sees nothing and writes nothing
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"chk-sales@scshdev.com"}', true);
  set local role authenticated;
  select count(*) into n from public.collection_messages;
  if n <> 0 then raise exception '5 sales must not read reminders'; end if;
  ok := false;
  begin
    insert into public.collection_messages (sent_by, channel, occupancy_id, body, total_cents, status) values ('s', 'email', -1, 'x', 1, 'drafted');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception '6 sales must not write reminders'; end if;
  ok := false;
  begin
    update public.collection_settings set payment_note = 'x' where id = 1;
    get diagnostics n = row_count;
    ok := n = 0;
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception '7 only admin edits the payment note'; end if;
  reset role;

  -- status / channel constraints
  ok := false;
  begin
    insert into public.collection_messages (sent_by, channel, occupancy_id, body, total_cents, status) values ('x', 'fax', -1, 'x', 1, 'drafted');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '8 channel must be email or text'; end if;
  raise notice '0017 checks passed';
end $$;
rollback;
