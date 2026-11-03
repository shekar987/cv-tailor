-- 3 Nov 2026 (Chunk 11): the "What's next" plan. Every upcoming screening,
-- interview, assessment and deadline, the user's free and busy time, and the
-- stages each application has passed through.
--
-- Safe to apply while the previous release is running: it only adds. The
-- status CHECK accepts the old labels AND the new keys, so code writing either
-- keeps working (some of the owner's rows are written outside the app, with the
-- old labels). The data rewrite is the next migration, 20261103130000, applied
-- after the deploy.
--
-- application_events.application_id is nullable: a networking call belongs to
-- no application. date_only marks a deadline with a day and no stated time
-- (due_at is then the end of that day in `timezone`), so the app never prints a
-- time nobody gave. offered_slots holds the slots of a to_book event.
--
-- Apply by hand in the Supabase SQL editor. Until it is applied /api/plan,
-- /api/events and /api/availability answer 503 needs_migration naming this file.

alter table public.applications
  add column if not exists status_raw text,
  add column if not exists stages_reached text[] not null default '{}',
  add column if not exists outcome_reason text;

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (status in (
  'saved', 'applied', 'screening', 'interview', 'assessment', 'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted',
  'Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'
));

-- A trigger, not the API, so a status written by anything is recorded. No
-- history exists before this migration: an earlier rejection reads as
-- ['applied', 'rejected'], and the funnel says so. The history stays true when a
-- status is corrected: an application has one ending, so leaving Rejected removes
-- it, and a move back to an earlier stage drops the later ones (an undo, or a
-- mis-pick in the status list). Interview and assessment share a rank, because
-- they come in either order. An ending keeps the path that led to it.
create or replace function public.applications_record_stage()
returns trigger
language plpgsql
set search_path = ''
as $func$
declare
  stage text := case new.status when 'Ready to submit' then 'saved' else lower(new.status) end;
  endings constant text[] := array['rejected', 'withdrawn', 'ghosted'];
  history text[];
begin
  select coalesce(array_agg(s order by o), '{}') into history
  from unnest(coalesce(new.stages_reached, '{}')) with ordinality as t(s, o)
  where s <> all (endings)
    and (
      stage = any (endings)
      or case s when 'saved' then 0 when 'applied' then 1 when 'screening' then 2 when 'interview' then 3 when 'assessment' then 3 when 'offer' then 4 when 'accepted' then 5 else 9 end
        <= case stage when 'saved' then 0 when 'applied' then 1 when 'screening' then 2 when 'interview' then 3 when 'assessment' then 3 when 'offer' then 4 when 'accepted' then 5 else 9 end
    );
  if not (history @> array[stage]) then
    history := history || stage;
  end if;
  new.stages_reached := history;
  return new;
end;
$func$;

drop trigger if exists applications_record_stage on public.applications;
create trigger applications_record_stage
  before insert or update of status on public.applications
  for each row execute function public.applications_record_stage();

-- Backfill without touching updated_at: a schema change is not an edit.
alter table public.applications disable trigger applications_set_updated_at;
update public.applications
set stages_reached = case
  when status in ('Ready to submit', 'saved') then array['saved']
  when lower(status) = 'applied' then array['applied']
  else array['applied', lower(status)]
end
where stages_reached = '{}';
alter table public.applications enable trigger applications_set_updated_at;

create table if not exists public.application_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  application_id   uuid references public.applications(id) on delete cascade,
  kind             text not null check (kind in ('screening_call', 'interview', 'assessment', 'take_home', 'deadline', 'follow_up', 'offer_deadline', 'networking')),
  title            text not null,
  stage_label      text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  due_at           timestamptz,
  date_only        boolean not null default false,
  timezone         text not null default 'Europe/London',
  location_or_link text,
  contact_name     text,
  prep_notes       text,
  offered_slots    jsonb not null default '[]'::jsonb,
  status           text not null default 'scheduled' check (status in ('scheduled', 'to_book', 'done', 'cancelled', 'missed')),
  source           text not null default 'manual' check (source in ('manual', 'gmail', 'calendar')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint application_events_time_order check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists application_events_user_starts_idx on public.application_events (user_id, starts_at);
create index if not exists application_events_user_due_idx on public.application_events (user_id, due_at);
create index if not exists application_events_application_idx on public.application_events (application_id);

alter table public.application_events enable row level security;

drop policy if exists "application_events_select" on public.application_events;
create policy "application_events_select" on public.application_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "application_events_insert" on public.application_events;
create policy "application_events_insert" on public.application_events
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (application_id is null or exists (
      select 1 from public.applications a where a.id = application_id and a.user_id = (select auth.uid())
    ))
  );
drop policy if exists "application_events_update" on public.application_events;
create policy "application_events_update" on public.application_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (application_id is null or exists (
      select 1 from public.applications a where a.id = application_id and a.user_id = (select auth.uid())
    ))
  );
drop policy if exists "application_events_delete" on public.application_events;
create policy "application_events_delete" on public.application_events
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.application_events from anon;

-- One row is either every week (weekday, 1 = Monday ... 7 = Sunday) or one day.
create table if not exists public.availability_windows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  weekday    smallint check (weekday between 1 and 7),
  date       date,
  start_time time not null,
  end_time   time not null,
  timezone   text not null default 'Europe/London',
  kind       text not null check (kind in ('free', 'busy')),
  label      text,
  created_at timestamptz not null default now(),
  constraint availability_windows_when check ((weekday is null) <> (date is null)),
  constraint availability_windows_order check (end_time > start_time)
);

create index if not exists availability_windows_user_idx on public.availability_windows (user_id, date);

alter table public.availability_windows enable row level security;

drop policy if exists "availability_windows_select" on public.availability_windows;
create policy "availability_windows_select" on public.availability_windows
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "availability_windows_insert" on public.availability_windows;
create policy "availability_windows_insert" on public.availability_windows
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "availability_windows_update" on public.availability_windows;
create policy "availability_windows_update" on public.availability_windows
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "availability_windows_delete" on public.availability_windows;
create policy "availability_windows_delete" on public.availability_windows
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.availability_windows from anon;

-- Down (run by hand to reverse; run the down of 20261103130000 first, so every
-- row is valid under the old constraint):
--
--   drop table if exists public.availability_windows;
--   drop table if exists public.application_events;
--   drop trigger if exists applications_record_stage on public.applications;
--   drop function if exists public.applications_record_stage();
--   alter table public.applications drop constraint if exists applications_status_check;
--   alter table public.applications add constraint applications_status_check
--     check (status in ('Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'));
--   alter table public.applications
--     drop column if exists outcome_reason,
--     drop column if exists stages_reached,
--     drop column if exists status_raw;
