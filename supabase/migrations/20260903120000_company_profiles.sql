-- Stage 3: per-user cache for company research results (/api/research).
--
-- One row per (user, domain). `data` holds the full research payload —
-- company profile, openings, website stack, fit score — and `fetched_at`
-- drives the 7-day TTL in the route. Rows are deliberately PER USER, not
-- shared: a shared cache would let content derived from one user's crafted
-- URL render on another user's screen.
--
-- The route degrades gracefully (research works, uncached) until this is
-- applied, per the missing-column/table convention.

create table if not exists public.company_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  domain     text not null,
  data       jsonb not null,
  fetched_at timestamptz not null default now(),
  constraint company_profiles_user_domain unique (user_id, domain)
);

alter table public.company_profiles enable row level security;

create policy "company_profiles_select" on public.company_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "company_profiles_insert" on public.company_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "company_profiles_update" on public.company_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "company_profiles_delete" on public.company_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists company_profiles_user_fetched
  on public.company_profiles (user_id, fetched_at desc);
