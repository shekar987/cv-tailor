-- Stage 2 follow-up: keep the tailored CV itself, not just its filename, so
-- the tracker can show the exact CV that was sent — weeks later, and even
-- after the master CV has changed.
--
-- JSON shape, as produced by the run that was saved:
--   { summary, skills, experience, projects, profile, sectionOrder }
-- Null for manual rows and for rows saved before this column existed.
-- Existing RLS policies cover the new column; nothing else changes.

alter table public.applications
  add column if not exists tailored_cv jsonb;
