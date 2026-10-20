-- 0007_delinquency_ladder.sql
-- Escalation ladder, stage-aware follow-up, and tenant contacts for delinquent occupancies.

-- ---------------------------------------------------------------------------
-- delinquency_stages (admin-editable ladder)
-- ---------------------------------------------------------------------------
create table public.delinquency_stages (
  id            integer generated always as identity primary key,
  sort_order    integer not null,
  name          text not null,
  trigger_day   integer not null check (trigger_day >= 0),
  owner_type    text not null check (owner_type in ('ai', 'bookkeeper', 'human_legal')),
  action_label  text not null,
  message_tone  text check (message_tone in ('friendly', 'firm', 'final')),
  is_active     boolean not null default true
);
comment on table public.delinquency_stages is
  'Admin-editable escalation ladder. current_stage = highest active stage whose trigger_day <= days past due.';

alter table public.delinquency_stages enable row level security;
create policy delinquency_stages_read on public.delinquency_stages
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting', 'partner'));
create policy delinquency_stages_admin_insert on public.delinquency_stages
  for insert to authenticated with check (public.current_app_role() = 'admin');
create policy delinquency_stages_admin_update on public.delinquency_stages
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
create policy delinquency_stages_admin_delete on public.delinquency_stages
  for delete to authenticated using (public.current_app_role() = 'admin');

insert into public.delinquency_stages (sort_order, name, trigger_day, owner_type, action_label, message_tone, is_active) values
  (1, 'Courtesy reminder',        2,  'ai',           'Courtesy reminder',        'friendly', true),
  (2, 'Late notice',              5,  'ai',           'Late notice',              'firm',     true),
  (3, 'Personal contact',         8,  'bookkeeper',   'Personal contact',         null,      true),
  (4, 'Final warning',           12,  'bookkeeper',   'Final warning',            'final',    true),
  (5, '3-day notice served',     15,  'human_legal',  '3-day notice served',      null,      true),
  (6, 'Owner/attorney decision', 19,  'human_legal',  'Owner/attorney decision',  null,      true);

-- ---------------------------------------------------------------------------
-- Follow-up rows can fulfil a ladder stage
-- ---------------------------------------------------------------------------
alter table public.delinquency_actions
  add column stage_id integer references public.delinquency_stages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- tenant_contacts — allowlisted columns, only occupancies currently delinquent
-- ---------------------------------------------------------------------------
create table public.tenant_contacts (
  occupancy_id     integer not null,
  tenant_id        integer not null,
  tenant           text,
  phone_numbers    text,
  emails           text,
  primary_tenant   boolean,
  synced_at        timestamptz not null default now(),
  primary key (occupancy_id, tenant_id)
);
comment on table public.tenant_contacts is
  'Phone/email from tenant_directory for occupancy_ids currently on the delinquency report. Replaced each sync; cured accounts disappear. Visible to admin + accounting only.';

alter table public.tenant_contacts enable row level security;
create policy tenant_contacts_read on public.tenant_contacts
  for select to authenticated
  using (public.current_app_role()::text in ('admin', 'accounting'));
