-- 0013_lead_channel_mappings.sql
-- Maps the sources that fell into 'other' after 0012 and adds four channels:
-- website_search, application_link, signage, ads. Sources mapped explicitly to
-- 'other' (e.g. "No Source Recorded") no longer show up as unmapped.

alter table public.lead_source_channels drop constraint lead_source_channels_channel_check;
alter table public.lead_source_channels add constraint lead_source_channels_channel_check
  check (channel ~ '^(website_form|website_search|application_link|signage|ads|inbox_(zillow|offcampus_universe|och101|apartments|email)|feed_[a-z0-9_]+|phone|whatsapp|social|referral|other)$');

insert into public.lead_source_channels (source_key, source, channel, updated_by)
select public.lead_source_key(s), s, c, '0013'
from (values
  ('No Source Recorded', 'other'),
  ('Source: SCSH Website (Google Search)', 'website_search'),
  ('Shared Application Link', 'application_link'),
  ('Source: Shared Application Link', 'application_link'),
  ('Co-Applicant', 'application_link'),
  ('Source: Traditional Ad (Banner)', 'signage'),
  ('Source: Banner', 'signage'),
  ('Signage', 'signage'),
  ('Source: GoTo (Unidentified Source)', 'phone'),
  ('go to', 'phone'),
  ('Source: Rental Website (Rent.com)', 'feed_rent_com'),
  ('Source: Rental Website - Rent.com', 'feed_rent_com'),
  ('Source: Rental Website (Zumper)', 'feed_zumper'),
  ('Source: Rental Website (EveryApartment)', 'feed_everyapartment'),
  ('Source: Rental Website (Realtor.com)', 'feed_realtor_com'),
  ('Source: Rental Website (Apartment List)', 'feed_apartment_list'),
  ('Source: Homes.com', 'feed_homes_com'),
  ('Source: RentHop', 'feed_renthop'),
  ('Source: Rental Website (Uloop)', 'feed_uloop'),
  ('Source: Rental Website (MLS)', 'feed_mls'),
  ('Source: Rental Website (NUP Off-Campus-Housing)', 'feed_nup'),
  ('Source: Rental Website(Trulia)', 'feed_trulia'),
  ('Source: Rental Website (Unishack)', 'feed_unishack'),
  ('Source: School (SCSH Ads)', 'ads'),
  ('Source: Moxie USC', 'ads')
) v(s, c)
on conflict (source_key) do update set channel = excluded.channel, source = excluded.source, updated_by = excluded.updated_by;

-- Unmapped = no row in the map at all (an explicit 'other' row counts as mapped).
create or replace view public.lead_sources_unmapped
with (security_invoker = true) as
  select s.source, count(*) as rows_seen, max(s.seen_at) as last_seen
  from (
    select i.source, i.received as seen_at from public.guest_card_interests i
    union all
    select l.source_first, l.first_seen_at from public.leads l
  ) s
  where not exists (select 1 from public.lead_source_channels m where m.source_key = public.lead_source_key(s.source))
  group by s.source
  order by count(*) desc;
