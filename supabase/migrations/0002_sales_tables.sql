-- 0002_sales_tables.sql
-- Clean, typed tables for the Sales (leasing) section. Populated from the
-- raw_* tables by lib/appfolio/mappers/*. Columns are a reasonable first
-- guess; expect to adjust after report discovery (add columns freely —
-- the mappers are the only writers).

create table public.units (
  id               text primary key,          -- AppFolio unit id, or "property|unit"
  property_name    text,
  property_address text,
  unit_name        text,
  bedrooms         numeric(4, 1),
  bathrooms        numeric(4, 1),
  sqft             integer,
  advertised_rent  numeric(10, 2),
  market_rent      numeric(10, 2),
  current_rent     numeric(10, 2),
  status           text,                      -- AppFolio status text (Vacant-Unrented, Occupied, Notice…)
  available_on     date,
  vacant_since     date,
  days_vacant      integer,
  tenant_name      text,
  lease_start      date,
  lease_end        date,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
create index units_property_idx on public.units (property_name, unit_name);
create index units_status_idx   on public.units (status);

create table public.guest_cards (
  id               text primary key,
  created_at       timestamptz,
  name             text,
  email            text,
  phone            text,
  property_name    text,
  unit_name        text,
  bedrooms_wanted  text,
  desired_move_in  timestamptz,
  source           text,
  agent            text,
  status           text,
  last_activity_at timestamptz,
  notes            text,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
create index guest_cards_created_idx on public.guest_cards (created_at desc);
create index guest_cards_agent_idx   on public.guest_cards (agent);
create index guest_cards_status_idx  on public.guest_cards (status);

create table public.showings (
  id             text primary key,
  scheduled_at   timestamptz,
  guest_card_id  text,
  lead_name      text,
  property_name  text,
  unit_name      text,
  agent          text,
  status         text,
  outcome        text,
  notes          text,
  raw            jsonb,
  synced_at      timestamptz not null default now()
);
create index showings_scheduled_idx on public.showings (scheduled_at desc);
create index showings_agent_idx     on public.showings (agent);

create table public.applications (
  id                text primary key,
  applicant_name    text,
  email             text,
  phone             text,
  property_name     text,
  unit_name         text,
  status            text,
  submitted_at      timestamptz,
  status_changed_at timestamptz,
  desired_move_in   timestamptz,
  agent             text,
  lease_signed_at   timestamptz,
  raw               jsonb,
  synced_at         timestamptz not null default now()
);
create index applications_submitted_idx on public.applications (submitted_at desc);
create index applications_status_idx    on public.applications (status);

-- Read access: admin + sales. Writes: service role only (sync).
alter table public.units        enable row level security;
alter table public.guest_cards  enable row level security;
alter table public.showings     enable row level security;
alter table public.applications enable row level security;

create policy units_read        on public.units        for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy guest_cards_read  on public.guest_cards  for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy showings_read     on public.showings     for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy applications_read on public.applications for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
