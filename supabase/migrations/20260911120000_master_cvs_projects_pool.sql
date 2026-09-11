-- Advanced customization: the user's full project pool as free text.
-- When a pool is saved, EVERY tailor run selects the 2 most relevant projects
-- from it (1 if the pool has only one) and writes tailored bullets for those,
-- replacing the master-CV projects for that run. NULL = feature off.
--
-- Lives on master_cvs (one row per user); the existing RLS policies
-- (auth.uid() = user_id, all four verbs) cover the new column. Deleting the
-- master CV row ("Replace" on /customize) deliberately deletes the pool too.
--
-- Code degrades until this is applied: reads retry without the column (42703),
-- writes surface a run-this-migration hint (PGRST204).
alter table public.master_cvs
  add column if not exists projects_pool text;
