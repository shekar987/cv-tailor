-- 30 Sep 2026 audit, Phase 5: a user deletes their own account.
--
-- Every user-owned table references auth.users with ON DELETE CASCADE
-- (profiles, master_cvs, cv_profiles, user_api_keys, user_feedback,
-- applications → mock_interviews, company_profiles, user_settings), so
-- deleting the auth row removes every row. Storage files are not cascaded:
-- /api/account/delete removes them through the Storage API (as the user,
-- under the bucket's own-folder policies) BEFORE calling this, and the
-- delete below only clears any object row left behind.
--
-- SECURITY DEFINER because `authenticated` cannot touch auth.users; the only
-- row it can ever delete is auth.uid()'s own — the function takes no
-- argument. Same grant discipline as the quota functions: revoke from
-- public AND anon by name (Supabase grants anon EXECUTE explicitly on
-- creation), grant to authenticated. $func$ delimiter: the SQL editor
-- mangles plain $$.
--
-- Reversible: drop function public.delete_own_account();  (no data changes)

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from storage.objects
   where bucket_id = 'application-cvs'
     and (storage.foldername(name))[1] = uid::text;
  delete from auth.users where id = uid;
end;
$func$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
