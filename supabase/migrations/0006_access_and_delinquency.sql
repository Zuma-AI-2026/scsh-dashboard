-- 0006_access_and_delinquency.sql
--  * partner role (read Sales + Accounting, not Admin)
--  * allowed_emails allowlist (sign-in OR company domain)
--  * admin can change app_users.role
--  * delinquencies (from AppFolio `delinquency` report) + follow-up actions
--  * partner/accounting read policies

-- ---------------------------------------------------------------------------
-- partner
-- ---------------------------------------------------------------------------
-- ADD VALUE cannot be used in the same transaction that inserts it; this
-- migration only adds the value. Inserts of 'partner' happen later from the app.
alter type public.app_role add value if not exists 'partner';

-- ---------------------------------------------------------------------------
-- properties: agent_of_record (property_directory) for Accounting filters
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists agent_of_record text;

-- ---------------------------------------------------------------------------
-- allowed_emails
-- ---------------------------------------------------------------------------
create table public.allowed_emails (
  email     text primary key check (email = lower(email) and email like '%@%.%'),
  role      public.app_role not null default 'viewer',
  added_by  text,
  added_at  timestamptz not null default now()
);
comment on table public.allowed_emails is
  'Emails allowed to sign in even when the domain is not @scshdev.com / @scstudenthousing.com. First sign-in copies `role` onto app_users.';

alter table public.allowed_emails enable row level security;
create policy allowed_emails_admin_read on public.allowed_emails
  for select to authenticated using (public.current_app_role() = 'admin');
create policy allowed_emails_admin_insert on public.allowed_emails
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy allowed_emails_admin_update on public.allowed_emails
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy allowed_emails_admin_delete on public.allowed_emails
  for delete to authenticated using (public.current_app_role() = 'admin');

-- Admins can change anyone's role from /admin/users.
create policy app_users_admin_update on public.app_users
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- partner (+ accounting on units) may read Sales tables
-- ---------------------------------------------------------------------------
drop policy if exists units_read on public.units;
drop policy if exists guest_cards_read on public.guest_cards;
drop policy if exists showings_read on public.showings;
drop policy if exists applications_read on public.applications;
drop policy if exists guest_card_interests_read on public.guest_card_interests;

-- Compare as text so this file can run in one transaction with ADD VALUE 'partner'
-- (Postgres forbids using a newly added enum label until the txn commits).
create policy units_read on public.units
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'sales', 'partner', 'accounting'));
create policy guest_cards_read on public.guest_cards
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy showings_read on public.showings
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy applications_read on public.applications
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'sales', 'partner'));
create policy guest_card_interests_read on public.guest_card_interests
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'sales', 'partner'));

-- ---------------------------------------------------------------------------
-- delinquencies — one row per occupancy from the AppFolio `delinquency` report
-- ---------------------------------------------------------------------------
create table public.delinquencies (
  occupancy_id         integer primary key,
  unit_id              integer,
  property_id          integer not null,
  unit_name            text,
  tenant               text,
  tenant_status        text,
  amount_receivable    numeric(12, 2),
  not_yet_due          numeric(12, 2),
  bucket_0_30          numeric(12, 2),
  bucket_31_60         numeric(12, 2),
  bucket_61_90         numeric(12, 2),
  bucket_90_plus       numeric(12, 2),
  last_payment         date,
  payment_amount       numeric(12, 2),
  nsf                  integer,
  late                 integer,
  rent                 numeric(12, 2),
  delinquent_rent      numeric(12, 2),
  phone_numbers        text,
  primary_tenant_email text,
  move_in              date,
  move_out             date,
  lease_to             date,
  tenant_agent         text,
  in_collections       boolean,
  oldest_invoice_on    date,
  synced_at            timestamptz not null default now()
);
create index delinquencies_property_idx on public.delinquencies (property_id);
comment on table public.delinquencies is
  'Occupancy-grain past-due snapshot from AppFolio report `delinquency`, enriched with lease_to/tenant_agent from rent_roll and oldest unpaid invoice from aged_receivables_detail.';

alter table public.delinquencies enable row level security;
create policy delinquencies_read on public.delinquencies
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting', 'partner'));

create view public.managed_delinquencies
with (security_invoker = true) as
  select d.*, p.property_name, p.property_address, p.owners, p.agent_of_record
  from public.delinquencies d
  join public.properties p on p.property_id = d.property_id
  where p.is_managed
    and coalesce(d.amount_receivable, 0) > 0;

-- ---------------------------------------------------------------------------
-- delinquency_actions — the only user-written table; AppFolio stays read-only
-- ---------------------------------------------------------------------------
create table public.delinquency_actions (
  id            bigint generated always as identity primary key,
  occupancy_id  integer not null,
  action        text not null,
  note          text,
  acted_by      text not null,
  acted_at      timestamptz not null default now()
);
create index delinquency_actions_occ_idx on public.delinquency_actions (occupancy_id, acted_at desc);
comment on table public.delinquency_actions is
  'Follow-up log (Called / Texted / Emailed / Payment plan / Notice served / Escalated to owner). Written by accounting; everyone else reads.';

alter table public.delinquency_actions enable row level security;
create policy delinquency_actions_read on public.delinquency_actions
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting', 'partner'));
create policy delinquency_actions_insert on public.delinquency_actions
  for insert to authenticated
  with check (public.current_app_role()::text in ('admin', 'accounting'));
