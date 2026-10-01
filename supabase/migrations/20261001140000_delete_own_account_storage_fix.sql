-- Fix for 20261001130000: Supabase guards its storage tables against direct
-- DML — the first version's `delete from storage.objects …` raised
-- "Direct deletion from storage tables is not allowed. Use the Storage API
-- instead." on production (1 Oct 2026), so every account deletion answered
-- 500 and nothing was deleted. The uploaded files are removed BEFORE this
-- function runs, by /api/account/delete through the Storage API as the user
-- (the bucket's own-folder policies apply), so the function only has to
-- delete the auth row; every table cascades from it.
--
-- Replaces the function in place; grants are unchanged (EXECUTE revoked from
-- public and anon, granted to authenticated). Reversible: re-run
-- 20261001130000 (which fails the same way), or drop the function.

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
  delete from auth.users where id = uid;
end;
$func$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
