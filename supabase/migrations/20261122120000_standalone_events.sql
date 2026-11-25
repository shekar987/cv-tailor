-- 22 Nov 2026 (Chunk JH-2B): standalone chore and call events, and a private
-- ICS calendar feed.
--
-- Changes:
--   1. application_events.kind gains 'chore' and 'call'. application_id was
--      already nullable (the original migration never set NOT NULL); the API
--      route's guard is widened to match.
--   2. calendar_feeds: one row per user, holding the SHA-256 hash of their
--      private feed token. Regenerating the token writes a new hash and
--      invalidates the old URL. RLS: own row only.
--
-- Safe to apply while the previous release is running: it only adds.
-- Apply by hand in the Supabase SQL editor.

alter table public.application_events drop constraint if exists application_events_kind_check;
alter table public.application_events add constraint application_events_kind_check check (kind in (
  'screening_call', 'interview', 'assessment', 'take_home', 'deadline', 'follow_up', 'offer_deadline', 'networking',
  'video', 'work_trial', 'screening_questions',
  'chore', 'call'
));

create table if not exists public.calendar_feeds (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;

drop policy if exists "calendar_feeds_all" on public.calendar_feeds;
create policy "calendar_feeds_all" on public.calendar_feeds
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.calendar_feeds from anon;

-- Down (run by hand to reverse):
--
--   drop table if exists public.calendar_feeds;
--   alter table public.application_events drop constraint if exists application_events_kind_check;
--   alter table public.application_events add constraint application_events_kind_check check (kind in (
--     'screening_call', 'interview', 'assessment', 'take_home', 'deadline', 'follow_up', 'offer_deadline', 'networking',
--     'video', 'work_trial', 'screening_questions'
--   ));
