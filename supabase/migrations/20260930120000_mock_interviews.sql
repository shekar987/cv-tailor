-- Mock interviews: one row per interview a user runs against one of their
-- tracked applications (/applications/[id]/interview, /api/interview).
--
--   type        - the round: screening, competency, strengths, technical,
--                 hiring_manager, final (lib/interviewTypes.ts)
--   persona     - the interviewer character who ran it
--   llm_path    - which wallet the start was charged to (claude / own_key /
--                 unlimited); every later turn is routed to the same one
--   plan        - the questions (lib/mockInterview InterviewPlan)
--   transcript  - who said what (TranscriptEntry[]); the audio is never sent
--                 or stored, only the text the browser transcribed
--   turn_seq    - bumped on every turn, so a double submit is refused
--   feedback    - written once the interview is finished
--
-- Deleted with its application (and with the user). Four-policy RLS like
-- user_settings; the insert policy also checks that the application is the
-- user's own, because a foreign key alone would let a row point at anyone's.
-- Rows are re-bounded on every read (the user can write their own row), and
-- the turn cap is counted from the transcript in code.
--
-- The code tolerates this migration not being applied: /api/interview answers
-- 503 needs_migration (PGRST205) before any credit is spent.

create table if not exists public.mock_interviews (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  type           text not null check (type in ('screening','competency','strengths','technical','hiring_manager','final')),
  persona        text not null,
  llm_path       text not null check (llm_path in ('claude','own_key','unlimited')),
  status         text not null default 'active' check (status in ('active','finished')),
  turn_seq       integer not null default 0,
  plan           jsonb not null,
  transcript     jsonb not null default '[]'::jsonb,
  feedback       jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists mock_interviews_user_app_idx
  on public.mock_interviews (user_id, application_id, created_at desc);

alter table public.mock_interviews enable row level security;

create policy "mock_interviews_select" on public.mock_interviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "mock_interviews_insert" on public.mock_interviews
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = (select auth.uid())
    )
  );
create policy "mock_interviews_update" on public.mock_interviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "mock_interviews_delete" on public.mock_interviews
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.mock_interviews from anon;
