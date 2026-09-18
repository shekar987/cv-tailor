-- Document preferences (lib/preferences.ts): small per-user switches for how
-- the CV document is rendered, stored beside eligibility, claims and
-- variants on user_settings; the existing four-policy RLS covers the column.
-- First switch: includeRightToWorkOnCv (default false — the Right to Work
-- section is left off the CV document; the wording is offered as a
-- copy-to-clipboard block for application forms instead).
--
-- The code degrades until this is applied: reads retry without the column
-- (42703) and use the defaults, writes report the missing column (PGRST204)
-- and the Customize card names this file.

alter table public.user_settings add column if not exists preferences jsonb;
