-- Brief 3, part 3: role-targeted positioning variants. A variant is a small
-- set of rules (headline, skills to lead with, the role types it is for)
-- applied to the one master CV and the one claims registry - not a second
-- document. Stored beside eligibility and claims on user_settings; the
-- existing four-policy RLS covers the new column. The client sends the
-- chosen variant in the /api/tailor body, like everything else on this row.
--
-- The code degrades until this is applied: reads retry without the column
-- (42703), writes report the missing column (PGRST204) and the Customize
-- card names this file.

alter table public.user_settings add column if not exists variants jsonb;
