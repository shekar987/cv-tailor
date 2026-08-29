-- Stage 2: Application Tracker.
-- One row per job application, per user. RLS is the security boundary
-- (auth.uid() = user_id, same rule as user_projects / user_skills).
-- First schema file checked into the repo; source of truth going forward.
-- Applied by hand in the Supabase SQL editor (this project does not run the
-- Supabase CLI migration workflow).

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_name text not null,
  role text not null,
  cv_reference text,
  tailor_session_id text,
  status text not null default 'Applied'
    check (status in ('Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn')),
  salary text,
  date_applied date not null,
  followup_date date,
  notes text,
  job_description text,
  source text not null default 'manual'
    check (source in ('tailored', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate rule: the SAME tailoring session saves at most one row per user.
-- Partial unique index, not a table constraint, so manual rows (NULL session
-- id) are unlimited. NOTE: PostgREST upsert onConflict cannot target a partial
-- index -- the create route must check-then-insert, catching 23505 as backstop.
create unique index if not exists applications_user_session_key
  on public.applications (user_id, tailor_session_id)
  where tailor_session_id is not null;

-- The list view sorts by date applied, newest first, scoped to one user.
create index if not exists applications_user_date_idx
  on public.applications (user_id, date_applied desc);

alter table public.applications enable row level security;

create policy "applications_select_own" on public.applications
  for select using (auth.uid() = user_id);

create policy "applications_insert_own" on public.applications
  for insert with check (auth.uid() = user_id);

create policy "applications_update_own" on public.applications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "applications_delete_own" on public.applications
  for delete using (auth.uid() = user_id);

-- $func$ delimiter deliberately: the Supabase SQL editor mangles plain $$.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

create trigger applications_set_updated_at
  before update on public.applications
  for each row
  execute function public.set_updated_at();
