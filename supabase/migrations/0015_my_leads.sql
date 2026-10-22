-- 0015_my_leads.sql
-- * guest_card_flags: guest cards whose AppFolio Notes contain an entry
--   starting "Property unresolved:" (n8n couldn't place the inquiry). Only that
--   one line is stored — guest card notes are otherwise never kept. Written by
--   the sync from the same guest_cards pull; guest_cards and its sync unchanged.
-- * leads.replied_at: first time the prospect answered (AppFolio activity
--   "Text Received" / "Email Received" on any of the lead's guest cards).
--   AppFolio only exposes the LATEST activity, so the first sighting is kept
--   here; a later outbound text doesn't undo it. Used by Sales → My leads.

create table public.guest_card_flags (
  guest_card_id integer primary key,
  kind          text not null default 'property_unresolved' check (kind in ('property_unresolved')),
  note          text not null check (length(note) <= 300),
  synced_at     timestamptz not null default now()
);
comment on table public.guest_card_flags is
  'Guest cards whose Notes have a "Property unresolved:" entry (that line only). Replaced on every sync.';
alter table public.guest_card_flags enable row level security;
create policy guest_card_flags_admin_read on public.guest_card_flags
  for select to authenticated using (public.current_app_role() = 'admin');

alter table public.leads add column replied_at timestamptz;

create or replace function public.mark_lead_replies()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  perform public.require_admin_or_service();
  with replies as (
    select lg.lead_id,
           min(coalesce((i.last_activity_date + time '12:00') at time zone 'America/Los_Angeles', now())) as at
    from public.guest_card_interests i
    join public.lead_guest_cards lg on lg.guest_card_id = i.guest_card_id
    where i.last_activity_type in ('Text Received', 'Email Received')
    group by lg.lead_id
  )
  update public.leads l
     set replied_at = r.at
    from replies r
   where l.id = r.lead_id and l.replied_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.mark_lead_replies() from public, anon, authenticated;
grant execute on function public.mark_lead_replies() to service_role;

select public.mark_lead_replies();
