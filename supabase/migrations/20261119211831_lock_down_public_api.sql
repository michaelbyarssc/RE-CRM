-- Lock down the Supabase public API for the RE CRM tables (2026-11-19).
--
-- Why: every table in the public schema had row level security off, and the
-- anon and authenticated roles could read and change every row through the
-- Supabase REST API using the site's public key.
--
-- What this file does:
--   1. Turns on row level security for each of the 16 app tables, with no
--      policies. The app connects straight to Postgres as the table owner,
--      which row level security does not affect, so the app keeps working.
--      The public API roles see no rows.
--   2. Removes every privilege anon and authenticated have on the tables and
--      sequences in the public schema.
--   3. Removes their default privileges in public for the role running this
--      file, so tables created later by that role are not exposed either.
--
-- Safe to run more than once. It never reads or changes a data row. On a
-- plain Postgres without the anon and authenticated roles, steps 2 and 3 are
-- skipped.

alter table if exists public.user_profiles enable row level security;
alter table if exists public.leads enable row level security;
alter table if exists public.tags enable row level security;
alter table if exists public.lead_tags enable row level security;
alter table if exists public.notes enable row level security;
alter table if exists public.sequences enable row level security;
alter table if exists public.sequence_steps enable row level security;
alter table if exists public.lead_sequences enable row level security;
alter table if exists public.call_log enable row level security;
alter table if exists public.skip_trace_results enable row level security;
alter table if exists public.csv_imports enable row level security;
alter table if exists public.buyers enable row level security;
alter table if exists public.documents enable row level security;
alter table if exists public.settings enable row level security;
alter table if exists public.calendar_events enable row level security;
alter table if exists public.google_calendar_tokens enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on all tables in schema public from %I', api_role);
      execute format('revoke all on all sequences in schema public from %I', api_role);
      execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
    end if;
  end loop;
end
$$;
