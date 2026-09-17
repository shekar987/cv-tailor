-- Brief 2: per-user eligibility profile + claims registry, and an RLS-scoped
-- exact-JD lookup for the "already in your tracker" pre-check.
--
-- user_settings holds standing per-user answers the app never infers:
--   eligibility  - right to work / sponsorship, clearance, years, location,
--                  degree, licences, contract types (lib/knockouts.ts shape)
--   claims       - the claims registry: each skill's level (production /
--                  project / learning) and whether the user confirmed it
--                  (lib/claims.ts shape)
-- One row per user (PK user_id). Both columns are read by the browser client
-- (lib/cvStore.ts) and sent along in request bodies, like projects_pool -
-- the server reads no per-user tables for these. Not on `profiles`: that is
-- the quota table with table-level UPDATE revoked, and it should stay that
-- way. Same four-policy RLS as company_profiles.
--
-- The code degrades gracefully until this is applied (PGRST205 on the table,
-- PGRST202 on the function): eligibility gates read as "unknown", the claims
-- registry is absent (warn-mode, generic rules), no duplicate-JD check.

create table if not exists public.user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  eligibility jsonb,
  claims      jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user_settings_select" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_settings_insert" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_settings_update" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_settings_delete" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.user_settings from anon;

-- Exact-match JD lookup for the pre-check: "you already saved this exact job
-- description". A 15k-character JD cannot ride in a PostgREST filter URL, so
-- it goes through an RPC body. SECURITY INVOKER: the applications RLS
-- policies apply; the user_id predicate is belt and braces.
create or replace function public.find_applications_by_jd(p_jd text)
returns table (id uuid, company_name text, role text, date_applied date)
language sql stable security invoker
set search_path = public
as $func$
  select a.id, a.company_name, a.role, a.date_applied
  from public.applications a
  where a.user_id = (select auth.uid())
    and a.job_description = p_jd
  order by a.date_applied desc, a.created_at desc
  limit 3
$func$;

-- Supabase grants EXECUTE to anon explicitly by default; revoke by name.
revoke execute on function public.find_applications_by_jd(text) from public, anon;
grant execute on function public.find_applications_by_jd(text) to authenticated;
