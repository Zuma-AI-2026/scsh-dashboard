-- 0004_replace_raw_truncate.sql
-- The project has pg-safeupdate semantics ("DELETE requires a WHERE clause"),
-- which also applies inside plpgsql. Replace the unqualified DELETE in
-- replace_raw_rows with TRUNCATE, which is transactional in Postgres and not
-- subject to that rule. The function body runs in one transaction, so readers
-- never observe an empty table between the truncate and the insert.
--
-- (The clean tables — units, guest_cards, showings, applications — are
-- replaced with "upsert everything, then DELETE … WHERE synced_at < run",
-- which already has a WHERE clause and is unaffected.)

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
  execute format('truncate table public.%I restart identity', t);
  execute format(
    'insert into public.%I (synced_at, row) select $1, value from jsonb_array_elements($2)', t)
    using p_synced_at, p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.replace_raw_rows(text, jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.replace_raw_rows(text, jsonb, timestamptz) to service_role;
