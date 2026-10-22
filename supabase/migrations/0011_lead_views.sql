-- 0011_lead_views.sql
-- Read-only helper for the Sales → Rotation view and the funnel drill-downs:
-- which guest card each application belongs to. Same rule as the
-- application step in import_leads_from_appfolio(): the showing that produced
-- the application, else a guest card of the same AppFolio tenant (earliest).
create view public.application_guest_cards
with (security_invoker = true) as
  select distinct on (a.rental_application_id)
         a.rental_application_id, c.guest_card_id
  from public.applications a
  join lateral (
    select s.guest_card_id, 1 as pri, s.showing_time as t
    from public.showings s
    where s.rental_application_id = a.rental_application_id and s.guest_card_id is not null
    union all
    select gc.guest_card_id, 2, gc.received
    from public.guest_cards gc
    where a.tenant_id is not null and gc.tenant_id = a.tenant_id
  ) c on true
  order by a.rental_application_id, c.pri, c.t nulls last;
comment on view public.application_guest_cards is 'Application → guest card link (see import_leads_from_appfolio). RLS of the underlying tables applies.';
