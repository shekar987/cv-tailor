-- 12 Nov 2026 (Chunk 22): a fast tracker API for automations, writes that run once,
-- and one-call application logging.
--
-- Safe to apply while the current release runs: it only relaxes and adds. Nothing
-- here deletes or rewrites a row. Apply by hand in the Supabase SQL editor (one
-- paste; the editor runs it as one transaction).
--
-- 1. applications.date_applied may be empty, but ONLY on a row that is not sent yet
--    (status 'saved', shown as "Ready to submit"; its old spelling counts too). On
--    11 Nov a parked application was refused for want of a date it did not have, and
--    a made-up date is a false fact in the tracker. A trigger dates any other row
--    that arrives without one (today in London), so no writer — a sweep, the plan's
--    stage move, a reopen — can leave a sent row undated; a check states the rule.
--
-- 2. applications.sent_cover_letter: the cover letter file sent with an application,
--    the same record as sent_cv (lib/sentCv), stored in the same private bucket under
--    the same <user>/<application>/ folder (so the bucket's own-folder policies and
--    account deletion already cover it). Written by POST /api/applications/log and
--    /api/applications/cv?doc=cover_letter.
--
-- 3. api_idempotency: one row per Idempotency-Key a user's write sent (lib/idempotency):
--    the request's fingerprint and, once it has run, its answer, kept 24 hours so a
--    retry gets the same answer instead of writing again. Own rows only (RLS); the
--    route clears a user's rows past a day after each keyed write.

-- 1. A date applied only once a row is sent -----------------------------------------

alter table public.applications alter column date_applied drop not null;

create or replace function public.applications_date_when_sent()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  if new.date_applied is null and new.status not in ('saved', 'Ready to submit') then
    new.date_applied := (now() at time zone 'Europe/London')::date;
  end if;
  return new;
end;
$func$;

revoke all on function public.applications_date_when_sent() from public, anon, authenticated;

drop trigger if exists applications_date_when_sent on public.applications;
create trigger applications_date_when_sent
  before insert or update on public.applications
  for each row
  execute function public.applications_date_when_sent();

alter table public.applications drop constraint if exists applications_date_applied_when_sent;
alter table public.applications add constraint applications_date_applied_when_sent
  check (date_applied is not null or status in ('saved', 'Ready to submit'));

-- 2. The cover letter file sent -------------------------------------------------------

alter table public.applications add column if not exists sent_cover_letter jsonb;

-- 3. Idempotency keys -----------------------------------------------------------------

create table if not exists public.api_idempotency (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 255),
  method text not null check (method in ('POST', 'PUT', 'PATCH')),
  path text not null check (length(path) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  -- Null while the first request runs.
  status_code smallint check (status_code between 100 and 599),
  response jsonb check (response is null or length(response::text) <= 65536),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists api_idempotency_user_created_idx on public.api_idempotency (user_id, created_at);

alter table public.api_idempotency enable row level security;
drop policy if exists api_idempotency_select_own on public.api_idempotency;
create policy api_idempotency_select_own on public.api_idempotency
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists api_idempotency_insert_own on public.api_idempotency;
create policy api_idempotency_insert_own on public.api_idempotency
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists api_idempotency_update_own on public.api_idempotency;
create policy api_idempotency_update_own on public.api_idempotency
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists api_idempotency_delete_own on public.api_idempotency;
create policy api_idempotency_delete_own on public.api_idempotency
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.api_idempotency from public, anon, authenticated;
grant select, insert, update, delete on public.api_idempotency to authenticated;

-- Down (run by hand to reverse). The first update dates every undated row with the
-- day it was created, so the column can require a date again. Dropping
-- sent_cover_letter forgets the letter files' records: the files stay in the user's
-- own bucket folder until the account is deleted, so download them first if needed.
--
--   update public.applications set date_applied = (created_at at time zone 'Europe/London')::date where date_applied is null;
--   drop table if exists public.api_idempotency;
--   alter table public.applications drop column if exists sent_cover_letter;
--   alter table public.applications drop constraint if exists applications_date_applied_when_sent;
--   drop trigger if exists applications_date_when_sent on public.applications;
--   drop function if exists public.applications_date_when_sent();
--   alter table public.applications alter column date_applied set not null;
