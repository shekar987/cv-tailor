-- scripts/normalise-status.sql — Chunk JH-3 (22 Nov 2026)
--
-- NEEDS SHEKAR'S APPROVAL TO RUN. This script is committed but NOT run by the
-- chunk. It rewrites the LEGACY capitalised statuses in `applications` to the
-- lower-case keys every write path now stores (lib/tracker normaliseStatus), so
-- one spelling is left in the database. It is the same rewrite as migration
-- 20261103130000_normalise_application_status.sql, which was written for Chunk
-- 11 but has not been applied to production — on 22 Nov Shekar's 1,557 rows held
-- 606 lower-case and 951 capitalised rows of the same statuses, which is why
-- `?status=Interview` could miss rows and counts could disagree.
--
-- Nothing in the app needs this run: reads already fold both spellings
-- (lib/tracker storedStatusValues / apiStatus), so the sweeps' contract is
-- unchanged either way. It only unifies the STORED value. Idempotent: only rows
-- still holding a capitalised label change. A spelling change is not an edit, so
-- the UPDATE disables the updated_at trigger around itself (as the migration
-- does) to keep each row's updated_at.
--
-- Run order: (1) the dry run below, read the counts; (2) only then, the UPDATE.

-- ── 1. DRY RUN (read-only): how many rows each change would touch ────────────
select status as current_stored,
       case status
         when 'Ready to submit' then 'saved'
         when 'Applied' then 'applied'
         when 'Screening' then 'screening'
         when 'Interview' then 'interview'
         when 'Offer' then 'offer'
         when 'Rejected' then 'rejected'
         when 'Withdrawn' then 'withdrawn'
       end as will_become,
       count(*) as rows
from public.applications
where status in ('Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn')
group by status
order by status;

-- ── 2. THE WRITE (run only after approving the dry-run counts) ───────────────
-- Uncomment and run as one statement block. `status_raw` keeps the old text for
-- one release, exactly as migration 20261103130000 does.
--
-- begin;
-- alter table public.applications disable trigger applications_set_updated_at;
-- update public.applications
-- set status_raw = status,
--     status = case status
--       when 'Ready to submit' then 'saved'
--       when 'Applied' then 'applied'
--       when 'Screening' then 'screening'
--       when 'Interview' then 'interview'
--       when 'Offer' then 'offer'
--       when 'Rejected' then 'rejected'
--       when 'Withdrawn' then 'withdrawn'
--     end
-- where status in ('Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn');
-- alter table public.applications enable trigger applications_set_updated_at;
-- commit;
--
-- Assessment, Won/Accepted, No reply/Ghosted have no capitalised legacy form in
-- the CHECK (20261103120000), so nothing to rewrite for them.
