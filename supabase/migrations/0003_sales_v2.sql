-- 0003_sales_v2.sql
-- Post-discovery schema for the Sales section.
--  * properties (with is_managed) — the AppFolio DB contains non-SCSH properties
--  * units / guest_cards / showings / applications rebuilt with the exact
--    confirmed AppFolio columns (guest_cards + applications are allowlisted,
--    no raw copies)
--  * views that join to properties and filter is_managed = true

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------
create table public.properties (
  property_id            integer primary key,
  property_name          text,
  property_address       text,
  property_street        text,
  property_street2       text,
  property_city          text,
  property_state         text,
  property_zip           text,
  units                  integer,
  owners                 text,
  portfolio              text,
  management_fee_percent numeric(6, 2),
  visibility             text,
  property_created_on    date,
  -- ours
  is_managed             boolean not null default false,
  managed_reviewed_at    timestamptz,
  first_seen_at          timestamptz not null default now(),
  synced_at              timestamptz not null default now()
);
comment on column public.properties.is_managed is
  'True = SCSH-managed; everything in the app filters on this. First sync sets all true; properties appearing later default to false until an admin reviews them.';
create index properties_is_managed_idx on public.properties (is_managed);

alter table public.properties enable row level security;
create policy properties_read on public.properties
  for select to authenticated using (public.current_app_role() is not null);
create policy properties_admin_update on public.properties
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- units  = unit_directory + unit_vacancy + rent_roll (current occupancy)
-- ---------------------------------------------------------------------------
drop table if exists public.units;
create table public.units (
  unit_id               integer primary key,
  property_id           integer,
  unit_name             text,
  bedrooms              numeric(4, 1),
  bathrooms             numeric(4, 1),
  sqft                  integer,
  advertised_rent       numeric(10, 2),
  market_rent           numeric(10, 2),
  rent_ready            boolean,
  rentable              boolean,
  visibility            text,
  posted_to_website     boolean,
  posted_to_internet    boolean,
  description           text,
  unit_tags             text,
  -- from unit_vacancy (null when the unit is not in that report)
  in_vacancy_report     boolean not null default false,
  unit_status           text,
  days_vacant           integer,
  available_on          date,
  next_move_in          date,
  last_move_out         date,
  ready_for_showing_on  date,
  unit_turn_target_date date,
  -- from rent_roll (the current occupancy row)
  occupancy_status      text,
  current_rent          numeric(10, 2),
  lease_from            date,
  lease_to              date,
  move_in               date,
  move_out              date,
  lease_expires_month   text,
  past_due              numeric(10, 2),
  tenant                text,
  beds_in_row           integer,
  beds_occupied         integer,
  synced_at             timestamptz not null default now()
);
create index units_property_idx on public.units (property_id, unit_name);

-- ---------------------------------------------------------------------------
-- guest_cards (leads) — ALLOWLISTED columns only, no raw copy
-- ---------------------------------------------------------------------------
drop table if exists public.guest_cards;
create table public.guest_cards (
  guest_card_id       integer primary key,
  guest_card_uuid     text,
  inquiry_id          integer,
  name                text,
  email_address       text,
  phone_number        text,
  received            timestamptz,
  last_activity_date  date,
  last_activity_type  text,
  status              text,
  move_in_preference  text,
  max_rent            numeric(10, 2),
  bed_bath_preference text,
  lead_type           text,
  source              text,
  property_id         integer,
  property_name       text,
  unit_id             integer,
  unit                text,
  assigned_user       text,
  assigned_user_id    integer,
  tenant_id           integer,
  synced_at           timestamptz not null default now()
);
create index guest_cards_received_idx on public.guest_cards (received desc);
create index guest_cards_property_idx on public.guest_cards (property_id);

-- ---------------------------------------------------------------------------
-- showings
-- ---------------------------------------------------------------------------
drop table if exists public.showings;
create table public.showings (
  showing_id                  integer primary key,
  guest_card_id               integer,
  inquiry_id                  integer,
  guest_card_name             text,
  property_id                 integer,
  unit_id                     integer,
  showing_unit                text,
  created_at                  timestamptz,
  created_by                  text,
  showing_time                timestamptz,
  confirmation_time           timestamptz,
  assigned_user               text,
  assigned_user_id            integer,
  description                 text,
  status                      text,
  type                        text,
  source                      text,
  inquiry_type                text,
  last_activity_date          date,
  last_activity_type          text,
  rental_application_id       integer,
  rental_application_status   text,
  showing_to_application_time numeric(10, 2),
  synced_at                   timestamptz not null default now()
);
create index showings_time_idx     on public.showings (showing_time desc);
create index showings_property_idx on public.showings (property_id);

-- ---------------------------------------------------------------------------
-- applications (rental_applications) — ALLOWLISTED columns only, no raw copy
-- ---------------------------------------------------------------------------
drop table if exists public.applications;
create table public.applications (
  rental_application_id       integer primary key,
  rental_application_group_id integer,
  inquiry_id                  integer,
  applicants                  text,
  received                    timestamptz,
  desired_move_in             date,
  lead_source                 text,
  applicant_reported_source   text,
  status                      text,
  application_status          text,
  screening                   text,
  screened_on                 date,
  approved_at                 timestamptz,
  denied_at                   timestamptz,
  canceled_at                 timestamptz,
  decision_made_at            timestamptz,
  time_to_conversion          numeric(10, 2),
  application_fee_paid        boolean,
  assigned_user               text,
  assigned_user_id            integer,
  created_by                  text,
  property_id                 integer,
  property_name               text,
  unit_id                     integer,
  unit_name                   text,
  move_in_date                date,
  lease_start_date            date,
  lease_end_date              date,
  tenant_id                   integer,
  synced_at                   timestamptz not null default now()
);
create index applications_received_idx on public.applications (received desc);
create index applications_property_idx on public.applications (property_id);

-- RLS (read: admin + sales; writes: service role only)
alter table public.units        enable row level security;
alter table public.guest_cards  enable row level security;
alter table public.showings     enable row level security;
alter table public.applications enable row level security;

create policy units_read        on public.units        for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy guest_cards_read  on public.guest_cards  for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy showings_read     on public.showings     for select to authenticated using (public.current_app_role() in ('admin', 'sales'));
create policy applications_read on public.applications for select to authenticated using (public.current_app_role() in ('admin', 'sales'));

-- ---------------------------------------------------------------------------
-- Views: everything the Sales UI reads goes through these, so the
-- is_managed filter can't be forgotten. security_invoker => RLS of the
-- underlying tables applies to the caller.
-- ---------------------------------------------------------------------------
create view public.managed_units
with (security_invoker = true) as
  select u.*, p.property_name, p.property_address
  from public.units u
  join public.properties p on p.property_id = u.property_id
  where p.is_managed;

-- A unit is available when unit_vacancy lists it OR its rent-roll status is not Current.
create view public.available_units
with (security_invoker = true) as
  select *
  from public.managed_units
  where in_vacancy_report
     or coalesce(occupancy_status, '') <> 'Current';

create view public.managed_guest_cards
with (security_invoker = true) as
  select g.*
  from public.guest_cards g
  join public.properties p on p.property_id = g.property_id
  where p.is_managed;

create view public.managed_showings
with (security_invoker = true) as
  select s.*, p.property_name
  from public.showings s
  join public.properties p on p.property_id = s.property_id
  where p.is_managed;

create view public.managed_applications
with (security_invoker = true) as
  select a.*
  from public.applications a
  join public.properties p on p.property_id = a.property_id
  where p.is_managed;
