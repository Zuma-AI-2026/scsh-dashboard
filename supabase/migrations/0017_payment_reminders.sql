-- 0017_payment_reminders.sql
-- Payment reminders from Accounting → Delinquency.
-- * open_charges: open invoices per delinquent occupancy (aged_receivables_detail, written by the sync).
-- * tenant_contacts.tenant_type: Financially Responsible / Co-signer / Other Occupant.
-- * collection_messages: every reminder (email draft / sent / failed, text opened).
-- * collection_recipients: remembered To / CC per occupancy.
-- * collection_senders + collection_settings: admin-managed sender mailboxes and payment note.
-- * delinquency_actions.collection_message_id: the ladder row a reminder wrote (one contact, one log).
-- AppFolio stays read-only; nothing here is written back.

-- ---------------------------------------------------------------------------
-- open_charges
-- ---------------------------------------------------------------------------
create table if not exists public.open_charges (
  txn_id        bigint primary key,
  occupancy_id  integer not null,
  description   text,
  occurred_on   date,
  amount        numeric(12, 2) not null check (amount > 0),
  synced_at     timestamptz not null default now()
);
create index if not exists open_charges_occ_idx on public.open_charges (occupancy_id);
comment on table public.open_charges is
  'Open charges (amount_receivable > 0) from AppFolio aged_receivables_detail, only for occupancies on the delinquency report. Replaced every sync.';

alter table public.open_charges enable row level security;
drop policy if exists open_charges_read on public.open_charges;
create policy open_charges_read on public.open_charges
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting'));

-- ---------------------------------------------------------------------------
-- tenant_contacts: who is this contact on the lease
-- ---------------------------------------------------------------------------
alter table public.tenant_contacts add column if not exists tenant_type text;

-- ---------------------------------------------------------------------------
-- Senders and settings (admin-managed)
-- ---------------------------------------------------------------------------
create table if not exists public.collection_senders (
  id            integer generated always as identity primary key,
  email         text not null unique check (email = lower(email) and email like '%@%.%'),
  display_name  text not null,
  reply_to      text check (reply_to is null or (reply_to = lower(reply_to) and reply_to like '%@%.%')),
  signature     text not null default '',
  is_default    boolean not null default false,
  active        boolean not null default true,
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create unique index if not exists collection_senders_one_default on public.collection_senders (is_default) where is_default;
comment on table public.collection_senders is
  'Mailboxes reminders may be drafted/sent from. The server only uses active rows from here; the Azure app access policy must allow the same mailboxes.';

insert into public.collection_senders (email, display_name, signature, is_default)
values ('accounting@scshdev.com', 'SCSH Accounting', E'SCSH Accounting\nSouthern California Student Housing', true)
on conflict (email) do nothing;

create table if not exists public.collection_settings (
  id            integer primary key default 1 check (id = 1),
  payment_note  text not null default '',
  updated_by    text,
  updated_at    timestamptz not null default now()
);
insert into public.collection_settings (id, payment_note)
values (1, 'You can pay through your tenant portal. If you have already paid, thank you, and please disregard this reminder.')
on conflict (id) do nothing;

alter table public.collection_senders enable row level security;
alter table public.collection_settings enable row level security;

drop policy if exists collection_senders_read on public.collection_senders;
create policy collection_senders_read on public.collection_senders
  for select to authenticated using (public.current_app_role()::text in ('admin', 'accounting'));
drop policy if exists collection_senders_admin_insert on public.collection_senders;
create policy collection_senders_admin_insert on public.collection_senders
  for insert to authenticated with check (public.current_app_role() = 'admin');
drop policy if exists collection_senders_admin_update on public.collection_senders;
create policy collection_senders_admin_update on public.collection_senders
  for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists collection_settings_read on public.collection_settings;
create policy collection_settings_read on public.collection_settings
  for select to authenticated using (public.current_app_role()::text in ('admin', 'accounting'));
drop policy if exists collection_settings_admin_update on public.collection_settings;
create policy collection_settings_admin_update on public.collection_settings
  for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- collection_messages
-- ---------------------------------------------------------------------------
create table if not exists public.collection_messages (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  sent_by       text not null,
  channel       text not null check (channel in ('email', 'text')),
  occupancy_id  integer not null,
  tenant        text,
  property      text,
  unit          text,
  sender        text,
  "to"          text[] not null default '{}',
  cc            text[] not null default '{}',
  reply_to      text,
  subject       text,
  body          text not null,
  tone          text,
  charges       jsonb not null default '[]'::jsonb,
  total_cents   bigint not null check (total_cents >= 0),
  status        text not null check (status in ('drafted', 'sent', 'failed', 'text_opened')),
  error         text
);
create index if not exists collection_messages_occ_idx on public.collection_messages (occupancy_id, created_at desc);
comment on table public.collection_messages is
  'Payment reminders: email drafts/sends (Microsoft Graph) and texts opened on the phone. charges = snapshot of the selected open charges (id, description, amount); total computed by the server.';

alter table public.collection_messages enable row level security;
drop policy if exists collection_messages_read on public.collection_messages;
create policy collection_messages_read on public.collection_messages
  for select to authenticated using (public.current_app_role()::text in ('admin', 'accounting', 'partner'));
drop policy if exists collection_messages_insert on public.collection_messages;
create policy collection_messages_insert on public.collection_messages
  for insert to authenticated with check (public.current_app_role()::text in ('admin', 'accounting'));

-- ---------------------------------------------------------------------------
-- collection_recipients ("Use these recipients next time")
-- ---------------------------------------------------------------------------
create table if not exists public.collection_recipients (
  occupancy_id  integer primary key,
  to_emails     text[] not null default '{}',
  cc_emails     text[] not null default '{}',
  updated_by    text,
  updated_at    timestamptz not null default now()
);
alter table public.collection_recipients enable row level security;
drop policy if exists collection_recipients_read on public.collection_recipients;
create policy collection_recipients_read on public.collection_recipients
  for select to authenticated using (public.current_app_role()::text in ('admin', 'accounting'));
drop policy if exists collection_recipients_insert on public.collection_recipients;
create policy collection_recipients_insert on public.collection_recipients
  for insert to authenticated with check (public.current_app_role()::text in ('admin', 'accounting'));
drop policy if exists collection_recipients_update on public.collection_recipients;
create policy collection_recipients_update on public.collection_recipients
  for update to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting'))
  with check (public.current_app_role()::text in ('admin', 'accounting'));

-- ---------------------------------------------------------------------------
-- Ladder link
-- ---------------------------------------------------------------------------
alter table public.delinquency_actions
  add column if not exists collection_message_id bigint references public.collection_messages (id) on delete set null;

grant select on public.open_charges, public.collection_senders, public.collection_settings, public.collection_messages, public.collection_recipients to authenticated;
grant insert, update on public.collection_senders, public.collection_recipients to authenticated;
grant update on public.collection_settings to authenticated;
grant insert on public.collection_messages to authenticated;
grant all on public.open_charges, public.collection_senders, public.collection_settings, public.collection_messages, public.collection_recipients to service_role;
