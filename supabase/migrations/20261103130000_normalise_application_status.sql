-- 3 Nov 2026 (Chunk 11): stored statuses become the lower-case keys in
-- lib/tracker. Apply AFTER the release that reads both spellings is live: the
-- previous release cannot read the new keys. The old text stays in status_raw
-- for one release. Idempotent: only rows still holding an old label change.
--
-- The stored value is all that changes. /api/applications keeps answering, and
-- keeps accepting, the strings the owner's sweeps use (lib/tracker API_STATUS):
--
--   the API says and takes    stored after this migration
--   "Ready to submit"         saved
--   "Applied"                 applied
--   "Screening"               screening
--   "Interview"               interview
--   "Rejected"                rejected
--   "Withdrawn"               withdrawn
--   "Offer"                   offer
--
-- scripts/smoke-sweep-contract.mjs proves it on a real database. The CHECK from
-- 20261103120000 keeps accepting the old labels too, as a second safety.

-- A spelling change is not an edit: updated_at keeps its value.
alter table public.applications disable trigger applications_set_updated_at;
update public.applications
set status_raw = status,
    status = case status
      when 'Ready to submit' then 'saved'
      when 'Applied' then 'applied'
      when 'Screening' then 'screening'
      when 'Interview' then 'interview'
      when 'Offer' then 'offer'
      when 'Rejected' then 'rejected'
      when 'Withdrawn' then 'withdrawn'
    end
where status in ('Ready to submit', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn');
alter table public.applications enable trigger applications_set_updated_at;

-- Down (run by hand to reverse). A status the old release does not know goes to
-- its nearest old label:
--
--   alter table public.applications disable trigger applications_set_updated_at;
--   update public.applications set status = case status
--       when 'saved' then 'Ready to submit'
--       when 'applied' then 'Applied'
--       when 'screening' then 'Screening'
--       when 'interview' then 'Interview'
--       when 'assessment' then 'Interview'
--       when 'offer' then 'Offer'
--       when 'accepted' then 'Offer'
--       when 'rejected' then 'Rejected'
--       when 'withdrawn' then 'Withdrawn'
--       when 'ghosted' then 'Applied'
--     end
--   where status in ('saved', 'applied', 'screening', 'interview', 'assessment', 'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted');
--   alter table public.applications enable trigger applications_set_updated_at;
