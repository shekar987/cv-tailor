-- Fixes for everything the Supabase advisors flagged on 2026-08-31
-- (get_advisors security + performance), plus one gap the grants dump exposed.
-- All statements are plain DDL — safe to paste into the SQL editor as-is.
--
-- NOT covered here (no SQL for it): "Leaked Password Protection Disabled" —
-- that's a dashboard toggle: Authentication → Providers → Email →
-- "Prevent use of leaked passwords". Turn it on by hand.

-- ── 1. RPC surface: anonymous callers get nothing ───────────────────────────
-- All four SECURITY DEFINER functions were executable by `anon` via
-- /rest/v1/rpc/* (functions default to EXECUTE for PUBLIC). Their internal
-- auth.uid() guards already made anonymous calls harmless, but the surface
-- shouldn't exist at all. handle_new_user is trigger-only — nobody calls it.

revoke all on function public.check_and_increment_tailor_count(uuid, integer, integer) from public, anon;
grant execute on function public.check_and_increment_tailor_count(uuid, integer, integer) to authenticated;

revoke all on function public.check_and_increment_claude_lifetime(uuid, integer) from public, anon;
grant execute on function public.check_and_increment_claude_lifetime(uuid, integer) to authenticated;

revoke all on function public.get_encrypted_key(uuid, text) from public, anon;
grant execute on function public.get_encrypted_key(uuid, text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ── 2. Pin the one unpinned search_path ─────────────────────────────────────
-- set_updated_at was created without SET search_path (the linter's
-- function_search_path_mutable warning); every other function already pins it.

alter function public.set_updated_at() set search_path = public;

-- ── 3. key_enc really is column-blocked now ─────────────────────────────────
-- The docs claimed authenticated couldn't SELECT key_enc; the live grants
-- showed plain table-level SELECT (RLS still limited it to the user's own
-- ciphertext). Make the documented posture true: no app code selects * from
-- this table — the settings page selects explicit columns, and the
-- upsert/delete predicates only touch user_id/provider, both re-granted.

revoke select on public.user_api_keys from authenticated;
grant select (user_id, provider, key_hint, updated_at) on public.user_api_keys to authenticated;
revoke all on public.user_api_keys from anon;

-- ── 4. RLS initplan: evaluate auth.uid() once per query, not per row ────────
-- The linter's auth_rls_initplan warning on every policy. (select auth.uid())
-- lets the planner treat it as a stable init-plan value. Same semantics.

alter policy "users can manage own profile" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "users can manage own cv" on public.master_cvs using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "users can manage own cv profile" on public.cv_profiles using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter policy own_rows_select on public.user_api_keys using ((select auth.uid()) = user_id);
alter policy own_rows_insert on public.user_api_keys with check ((select auth.uid()) = user_id);
alter policy own_rows_update on public.user_api_keys using ((select auth.uid()) = user_id);
alter policy own_rows_delete on public.user_api_keys using ((select auth.uid()) = user_id);

alter policy "insert own feedback" on public.user_feedback with check ((select auth.uid()) = user_id);

alter policy applications_select_own on public.applications using ((select auth.uid()) = user_id);
alter policy applications_insert_own on public.applications with check ((select auth.uid()) = user_id);
alter policy applications_update_own on public.applications using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy applications_delete_own on public.applications using ((select auth.uid()) = user_id);

alter policy own_rows_select on public.user_projects using ((select auth.uid()) = user_id);
alter policy own_rows_insert on public.user_projects with check ((select auth.uid()) = user_id);
alter policy own_rows_update on public.user_projects using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy own_rows_delete on public.user_projects using ((select auth.uid()) = user_id);

alter policy own_rows_select on public.user_skills using ((select auth.uid()) = user_id);
alter policy own_rows_insert on public.user_skills with check ((select auth.uid()) = user_id);
alter policy own_rows_update on public.user_skills using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy own_rows_delete on public.user_skills using ((select auth.uid()) = user_id);

-- ── 5. Cover the one unindexed foreign key ──────────────────────────────────

create index if not exists user_feedback_user_id_idx on public.user_feedback (user_id);
