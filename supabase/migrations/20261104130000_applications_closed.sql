-- Chunk 15 (4 Nov 2026): Screening and Interview pages with Live and Closed sections.
-- Additive and reversible. Existing rows keep every value; all four columns start null.
-- RLS is unchanged: these are columns on applications, whose four policies already hold
-- each user to their own rows. stages_reached stays the source of truth for how far a row
-- got; highest_stage is derived in lib/closing, not stored.

alter table public.applications
  -- When the user moved the row to Closed.
  add column if not exists closed_at timestamptz,
  add column if not exists close_reason text,
  -- A one-line lesson, e.g. "asked for 3+ years".
  add column if not exists lesson text,
  -- A rejection a sweep or the Gmail parse detected: { "outcome": "rejected", "date":
  -- "2026-11-02", "source": "gmail" }. Never changes status by itself.
  add column if not exists pending_outcome jsonb;

alter table public.applications drop constraint if exists applications_close_reason_check;
alter table public.applications add constraint applications_close_reason_check
  check (close_reason is null or close_reason in ('rejected', 'withdrawn', 'ghosted', 'declined_by_me', 'role_closed'));

alter table public.applications drop constraint if exists applications_lesson_length_check;
alter table public.applications add constraint applications_lesson_length_check
  check (lesson is null or char_length(lesson) <= 140);

-- To reverse:
--   alter table public.applications
--     drop constraint if exists applications_close_reason_check,
--     drop constraint if exists applications_lesson_length_check,
--     drop column if exists closed_at,
--     drop column if exists close_reason,
--     drop column if exists lesson,
--     drop column if exists pending_outcome;
