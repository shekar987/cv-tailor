-- 30 Sep 2026 audit, Phase 4: a "Ready to submit" status for an application
-- the user has prepared but not yet sent. The row sits in the tracker so the
-- CV, letter and posting are kept; it is not counted as an application
-- (lib/insights leaves it out, the follow-up chip ignores it) until the user
-- moves it to Applied.
--
-- Additive and reversible. No data changes. The CHECK constraint is the one
-- the baseline names applications_status_check (Postgres' default name for
-- the inline check in 20260826120000_create_applications.sql).
--
-- Apply by hand in the Supabase SQL editor. Until it is applied the API
-- answers 503 needs_migration for this one status and every other status
-- keeps working (src/app/api/applications/route.ts).

alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in ('Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'));

-- Down (run by hand to reverse; the first statement keeps every row valid
-- under the old constraint):
--
--   update public.applications set status = 'Applied' where status = 'Ready to submit';
--   alter table public.applications drop constraint if exists applications_status_check;
--   alter table public.applications
--     add constraint applications_status_check
--     check (status in ('Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'));
