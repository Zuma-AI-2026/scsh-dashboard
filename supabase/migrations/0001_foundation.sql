-- 0001_foundation.sql
-- Users/roles, sync bookkeeping, and the generic raw-report storage.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Roles & users
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'sales', 'maintenance', 'accounting', 'viewer');

create table public.app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  role          public.app_role not null default 'viewer',
  display_name  text,
  auth_user_id  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
comment on table public.app_users is
  'Who may use the dashboard and what they can see. Rows are created on first successful Microsoft sign-in (viewer by default); ADMIN_EMAIL becomes admin. Change roles here.';

-- Role of the currently signed-in user (by email claim). NULL if unknown.
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select role
  from public.app_users
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;
revoke execute on function public.current_app_role() from public;
grant  execute on function public.current_app_role() to authenticated, service_role;

alter table public.app_users enable row level security;

-- Users can read their own row; admins can read everyone.
create policy app_users_read_self on public.app_users
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.current_app_role() = 'admin');
-- Writes happen only via the service role (auth callback), which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id          bigint generated always as identity primary key,
  report      text not null,
  params      jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  row_count   integer,
  status      text not null check (status in ('running', 'success', 'error')),
  error       text
);
create index sync_runs_report_started_idx on public.sync_runs (report, started_at desc);
comment on table public.sync_runs is 'One row per AppFolio report pull (see lib/appfolio/runReport.ts).';

create table public.sync_state (
  key            text primary key,          -- e.g. 'sales'
  last_synced_at timestamptz,
  last_status    text check (last_status in ('running', 'success', 'error')),
  detail         jsonb,
  updated_at     timestamptz not null default now()
);
comment on table public.sync_state is 'Latest sync status per group; last_synced_at is shown in the UI header.';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger sync_state_touch before update on public.sync_state
  for each row execute function public.touch_updated_at();

alter table public.sync_runs  enable row level security;
alter table public.sync_state enable row level security;

create policy sync_runs_read on public.sync_runs
  for select to authenticated using (public.current_app_role() is not null);
create policy sync_state_read on public.sync_state
  for select to authenticated using (public.current_app_role() is not null);

-- ---------------------------------------------------------------------------
-- Raw report storage: one table per report, raw_<report_name>,
-- replaced wholesale on each sync. Tables are created on demand so new
-- reports need no migration.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_raw_table(p_report text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  t text;
begin
  if p_report !~ '^[a-z0-9_]{1,50}$' then
    raise exception 'invalid report name: %', p_report;
  end if;
  t := 'raw_' || p_report;

  execute format(
    'create table if not exists public.%I (
       id        bigint generated always as identity primary key,
       synced_at timestamptz not null default now(),
       row       jsonb not null
     )', t);
  execute format('alter table public.%I enable row level security', t);

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'raw_read'
  ) then
    execute format(
      'create policy raw_read on public.%I for select to authenticated using (public.current_app_role() in (''admin'', ''sales''))',
      t);
  end if;

  return t;
end $$;

-- Atomically replace all rows of raw_<report> with the given JSON array.
create or replace function public.replace_raw_rows(
  p_report    text,
  p_rows      jsonb,
  p_synced_at timestamptz default now()
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t text;
  n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  t := public.ensure_raw_table(p_report);
  execute format('delete from public.%I', t);
  execute format(
    'insert into public.%I (synced_at, row) select $1, value from jsonb_array_elements($2)', t)
    using p_synced_at, p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

-- Only the service role (server-side sync) may call these.
revoke execute on function public.ensure_raw_table(text) from public, anon, authenticated;
revoke execute on function public.replace_raw_rows(text, jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.ensure_raw_table(text) to service_role;
grant  execute on function public.replace_raw_rows(text, jsonb, timestamptz) to service_role;
