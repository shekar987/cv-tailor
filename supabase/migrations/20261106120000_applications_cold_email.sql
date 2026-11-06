-- 6 Nov 2026 (Chunk 18): cold emails sent from Gmail, logged on the tracker.
-- Twelve of the 30 Oct cold emails were sent and never logged, so their
-- follow-ups were nearly missed. POST /api/applications/bulk-upsert inserts the
-- missing ones (lib/coldEmails), one row per (company, contact email), as
-- Applied with source 'cold-email'; it never changes an existing row.
--
-- Additive and reversible:
--   - applications.contact_email (nullable text, at most 254 characters, the
--     longest valid address): who the email went to;
--   - the source CHECK gains 'cold-email' beside 'tailored' and 'manual';
--   - an index on (user_id, lower(company_name), lower(contact_email)), the
--     key the endpoint dedupes on.
-- No data changes: every existing row reads as "no contact email" and keeps its
-- source. RLS on applications already covers the new column (the four policies
-- are row-level).
--
-- Apply by hand in the Supabase SQL editor. Until it is applied the tracker list
-- reads without the column, and the endpoint answers 503 needs_migration naming
-- this file (src/app/api/applications/bulk-upsert/route.ts).

alter table public.applications
  add column if not exists contact_email text;

alter table public.applications
  drop constraint if exists applications_contact_email_check;

alter table public.applications
  add constraint applications_contact_email_check
  check (contact_email is null or char_length(contact_email) <= 254);

alter table public.applications
  drop constraint if exists applications_source_check;

alter table public.applications
  add constraint applications_source_check
  check (source in ('tailored', 'manual', 'cold-email'));

create index if not exists applications_user_company_contact_idx
  on public.applications (user_id, lower(company_name), lower(contact_email));

-- Down (run by hand to reverse; the cold-email rows go back to 'manual' first,
-- or the old CHECK would refuse them):
--
--   drop index if exists public.applications_user_company_contact_idx;
--   alter table public.applications disable trigger applications_set_updated_at;
--   update public.applications set source = 'manual' where source = 'cold-email';
--   alter table public.applications enable trigger applications_set_updated_at;
--   alter table public.applications drop constraint if exists applications_source_check;
--   alter table public.applications add constraint applications_source_check check (source in ('tailored', 'manual'));
--   alter table public.applications drop constraint if exists applications_contact_email_check;
--   alter table public.applications drop column if exists contact_email;
