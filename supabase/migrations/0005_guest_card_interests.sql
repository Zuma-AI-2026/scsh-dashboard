-- 0005_guest_card_interests.sql
-- AppFolio guest_cards is one row per property-interest, not per person.
-- Keep guest_cards as one row per person; store every interest in a child table.
-- A lead is SCSH-visible if ANY interest is on an is_managed property.

create table public.guest_card_interests (
  guest_card_id      integer not null,
  property_id        integer not null,          -- 0 when AppFolio sent null (so the PK is never nullable)
  received           timestamptz not null,      -- epoch when AppFolio sent null
  row_index          smallint not null default 0, -- tiebreaker when the three-part key collides
  unit_id            integer,
  source             text,
  assigned_user      text,
  assigned_user_id   integer,
  status             text,
  last_activity_date date,
  last_activity_type text,
  synced_at          timestamptz not null default now(),
  primary key (guest_card_id, property_id, received, row_index)
);
create index guest_card_interests_card_idx     on public.guest_card_interests (guest_card_id);
create index guest_card_interests_property_idx on public.guest_card_interests (property_id);
comment on table public.guest_card_interests is
  'Every AppFolio guest_cards row. Person identity lives on guest_cards; this is the property-interest grain.';

alter table public.guest_card_interests enable row level security;
create policy guest_card_interests_read on public.guest_card_interests
  for select to authenticated using (public.current_app_role() in ('admin', 'sales'));

-- Recreate the Sales view: a person is in if they have at least one managed-property interest.
-- (Previously joined guest_cards.property_id, which was whichever AppFolio row arrived first.)
drop view if exists public.managed_guest_cards;
create view public.managed_guest_cards
with (security_invoker = true) as
  select g.*
  from public.guest_cards g
  where exists (
    select 1
    from public.guest_card_interests i
    join public.properties p on p.property_id = i.property_id
    where i.guest_card_id = g.guest_card_id
      and p.is_managed
  );

create view public.managed_guest_card_interests
with (security_invoker = true) as
  select i.*, p.property_name
  from public.guest_card_interests i
  join public.properties p on p.property_id = i.property_id
  where p.is_managed;
