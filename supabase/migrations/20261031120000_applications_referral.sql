-- 31 Oct 2026 (Chunk 6): referrals on the tracker. Per application: whether a
-- referral is being sought (`referral`), who could refer (`referrer_name`),
-- the posting's requisition id the referrer needs (`req_id`), and where the
-- ask stands (`referral_status`: to_ask → asked → referred | declined).
-- /applications shows the open asks (to_ask, asked) in a "Referral asks"
-- strip above the sheet (lib/referrals referralAsks).
--
-- Additive and reversible. No data changes: every existing row reads as "no
-- referral" (false, nulls). RLS on applications already covers the new
-- columns (the four policies are row-level).
--
-- Apply by hand in the Supabase SQL editor. Until it is applied the tracker
-- list reads without the four columns (no strip), and a PUT that sets them
-- answers 503 needs_migration naming this file (src/app/api/applications/route.ts).

alter table public.applications
  add column if not exists referral boolean not null default false,
  add column if not exists referrer_name text,
  add column if not exists req_id text,
  add column if not exists referral_status text;

alter table public.applications
  drop constraint if exists applications_referral_status_check;

alter table public.applications
  add constraint applications_referral_status_check
  check (referral_status is null or referral_status in ('to_ask', 'asked', 'referred', 'declined'));

alter table public.applications
  drop constraint if exists applications_referral_text_length_check;

alter table public.applications
  add constraint applications_referral_text_length_check
  check ((referrer_name is null or char_length(referrer_name) <= 120) and (req_id is null or char_length(req_id) <= 60));

-- Down (run by hand to reverse):
--
--   alter table public.applications drop constraint if exists applications_referral_text_length_check;
--   alter table public.applications drop constraint if exists applications_referral_status_check;
--   alter table public.applications drop column if exists referral_status;
--   alter table public.applications drop column if exists req_id;
--   alter table public.applications drop column if exists referrer_name;
--   alter table public.applications drop column if exists referral;
