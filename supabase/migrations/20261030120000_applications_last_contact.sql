-- 30 Oct 2026 (Chunk 5): "Reply owed" on the tracker. Who spoke last on an
-- application — the user ('me') or the company / recruiter ('them') — and
-- when. When it was them and more than a day ago, /applications marks the
-- row "Reply owed" and lists it first (lib/tracker isReplyOwed). The 29–30
-- Oct sweep found a recruiter who had answered on 26 Sep and had gone a month
-- without a reply.
--
-- Additive and reversible. No data changes: every existing row reads as
-- "no contact recorded" (both columns null). RLS on applications already
-- covers the new columns (the four policies are row-level).
--
-- Apply by hand in the Supabase SQL editor. Until it is applied the tracker
-- list reads without the two columns (no badge), and a PUT that sets them
-- answers 503 needs_migration naming this file (src/app/api/applications/route.ts).

alter table public.applications
  add column if not exists last_contact_from text,
  add column if not exists last_contact_at timestamptz;

alter table public.applications
  drop constraint if exists applications_last_contact_from_check;

alter table public.applications
  add constraint applications_last_contact_from_check
  check (last_contact_from is null or last_contact_from in ('me', 'them'));

-- Down (run by hand to reverse):
--
--   alter table public.applications drop constraint if exists applications_last_contact_from_check;
--   alter table public.applications drop column if exists last_contact_at;
--   alter table public.applications drop column if exists last_contact_from;
