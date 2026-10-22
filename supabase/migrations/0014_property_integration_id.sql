-- 0014_property_integration_id.sql
-- AppFolio's property_integration_id (uuid) from property_directory, used by
-- n8n (GET /api/properties/resolve) to create guest cards on the right property.

alter table public.properties add column if not exists property_integration_id uuid;
create unique index if not exists properties_integration_id_idx on public.properties (property_integration_id)
  where property_integration_id is not null;

-- Backfill from the last stored property_directory pull; the next sync keeps it current.
do $$
begin
  if to_regclass('public.raw_property_directory') is not null then
    update public.properties p
       set property_integration_id = (r.row ->> 'property_integration_id')::uuid
      from public.raw_property_directory r
     where (r.row ->> 'property_id')::int = p.property_id
       and r.row ->> 'property_integration_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;
end $$;
