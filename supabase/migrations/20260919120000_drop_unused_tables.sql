-- user_projects and user_skills were created for routes that were removed
-- before they were ever wired; no code has referenced them since, and both
-- held 0 rows on 2026-09-19 (verified on the live project before this was
-- written). Dropping them removes two RLS-policied tables nobody reads.

drop table if exists public.user_projects;
drop table if exists public.user_skills;
