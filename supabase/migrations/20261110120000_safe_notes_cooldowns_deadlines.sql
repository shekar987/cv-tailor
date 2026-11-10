-- 10 Nov 2026 (Chunk 21): notes that can't be wiped by accident, company cooldown
-- rules, and a deadline radar with the address an application was made from.
--
-- Safe to apply while the current release runs: it only adds. Nothing here deletes
-- or rewrites a row. Apply by hand in the Supabase SQL editor (one paste; the editor
-- runs it as one transaction).
--
-- 1. notes_history: every time a row's notes change, the text they had is kept here,
--    by a trigger, so an automation that writes "new line + old notes" from a preview
--    (it happened twice on 10 Nov) can be undone with "Restore previous notes". The
--    trigger is the only writer: SECURITY DEFINER, and the table grants the user
--    SELECT only, so a history row can't be forged, edited or removed through the API.
--
-- 2. company_rules: what a company said about applying again ("wait at least one
--    year", "no new applications this intake year", "90 days", the same role). JD
--    triage on /app checks them, with the user's own rows, before any credit is spent.
--    No DELETE grant: a wrong rule is switched off (dismissed_at), never removed.
--
-- 3. applications.applied_from_email / next_deadline / deadline_note: which inbox an
--    application used and what is due when, for the "Due in the next 48 hours" strip
--    and GET /api/applications?due=48h. Indexed on (user_id, next_deadline).

-- 1. Notes history -----------------------------------------------------------------

create table if not exists public.notes_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  old_notes text not null,
  changed_at timestamptz not null default now()
);

create index if not exists notes_history_application_idx on public.notes_history (application_id, changed_at desc);

alter table public.notes_history enable row level security;
drop policy if exists notes_history_select_own on public.notes_history;
create policy notes_history_select_own on public.notes_history
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.notes_history from public, anon, authenticated;
grant select on public.notes_history to authenticated;

create or replace function public.record_notes_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
begin
  -- Empty notes have nothing to give back.
  if coalesce(old.notes, '') <> '' then
    insert into public.notes_history (application_id, user_id, old_notes)
    values (old.id, old.user_id, old.notes);
  end if;
  return null;
end;
$func$;

revoke all on function public.record_notes_history() from public, anon, authenticated;

drop trigger if exists applications_notes_history on public.applications;
create trigger applications_notes_history
  after update of notes on public.applications
  for each row
  when (old.notes is distinct from new.notes)
  execute function public.record_notes_history();

-- 2. Company cooldown rules ----------------------------------------------------------

create table if not exists public.company_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- lib/companyMatch normalizeCompanyName; the API matches names with companyNamesMatch.
  company_key text not null check (length(company_key) between 1 and 200),
  company_name text not null check (length(company_name) between 1 and 200),
  rule_type text not null check (rule_type in ('reapply_after_days', 'no_reapply_until', 'same_role_block')),
  -- reapply_after_days: a whole number of days; no_reapply_until: YYYY-MM-DD; same_role_block: the role.
  value text not null check (length(value) between 1 and 200),
  -- Where the days count from. Null: the latest application to that company on record.
  anchor_date date,
  source_text text not null default '' check (length(source_text) <= 500),
  source text not null default 'manual' check (source in ('manual', 'notes', 'seed')),
  application_id uuid references public.applications(id) on delete set null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  constraint company_rules_value_shape check (
    (rule_type <> 'reapply_after_days' or value ~ '^[1-9][0-9]{0,3}$')
    and (rule_type <> 'no_reapply_until' or value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  )
);

create index if not exists company_rules_user_company_idx on public.company_rules (user_id, company_key);

alter table public.company_rules enable row level security;
drop policy if exists company_rules_select_own on public.company_rules;
create policy company_rules_select_own on public.company_rules
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists company_rules_insert_own on public.company_rules;
create policy company_rules_insert_own on public.company_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists company_rules_update_own on public.company_rules;
create policy company_rules_update_own on public.company_rules
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.company_rules from public, anon, authenticated;
grant select, insert, update on public.company_rules to authenticated;

-- 3. The applied-from address and the next deadline ----------------------------------

alter table public.applications
  add column if not exists applied_from_email text,
  add column if not exists next_deadline timestamptz,
  add column if not exists deadline_note text;

alter table public.applications drop constraint if exists applications_applied_from_email_length;
alter table public.applications add constraint applications_applied_from_email_length check (applied_from_email is null or length(applied_from_email) <= 254);
alter table public.applications drop constraint if exists applications_deadline_note_length;
alter table public.applications add constraint applications_deadline_note_length check (deadline_note is null or length(deadline_note) <= 300);

create index if not exists applications_user_next_deadline_idx
  on public.applications (user_id, next_deadline)
  where next_deadline is not null;

-- Down (run by hand to reverse). It drops the history and the rules with their
-- tables: download them first (Settings → Download everything) if they matter.
--
--   drop index if exists public.applications_user_next_deadline_idx;
--   alter table public.applications drop constraint if exists applications_deadline_note_length;
--   alter table public.applications drop constraint if exists applications_applied_from_email_length;
--   alter table public.applications
--     drop column if exists deadline_note,
--     drop column if exists next_deadline,
--     drop column if exists applied_from_email;
--   drop table if exists public.company_rules;
--   drop trigger if exists applications_notes_history on public.applications;
--   drop function if exists public.record_notes_history();
--   drop table if exists public.notes_history;
