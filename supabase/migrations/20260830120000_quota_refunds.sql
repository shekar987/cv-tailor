-- Refund a consumed quota slot when a tailoring run fails AFTER the counters
-- were incremented (a provider 429, an upstream outage, a transport error).
-- check_and_increment_tailor_count / check_and_increment_claude_lifetime both
-- run before the pipeline, so without this a failed run still cost the user
-- one of their 3 daily and 3 lifetime slots.
--
-- Same guard as the counters: only the caller's own row, via auth.uid().
-- SECURITY DEFINER because table-level UPDATE on profiles is revoked from
-- `authenticated` (only specific columns are re-granted).
-- $func$ delimiter deliberately: the Supabase SQL editor mangles plain $$.

create or replace function public.refund_tailor_count(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null or auth.uid() <> uid then
    return;
  end if;
  update public.profiles
     set tailor_count = greatest(coalesce(tailor_count, 0) - 1, 0)
   where id = uid;
end;
$func$;

create or replace function public.refund_claude_lifetime(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null or auth.uid() <> uid then
    return;
  end if;
  update public.profiles
     set claude_tailors_used = greatest(coalesce(claude_tailors_used, 0) - 1, 0)
   where id = uid;
end;
$func$;

-- `from public` alone is NOT enough on Supabase: default privileges also
-- grant EXECUTE to anon explicitly on function creation. The live project was
-- first migrated without `anon` here; 20260831150000 carries that fix for it,
-- and this file includes it so a fresh install is right the first time.
revoke all on function public.refund_tailor_count(uuid) from public, anon;
revoke all on function public.refund_claude_lifetime(uuid) from public, anon;
grant execute on function public.refund_tailor_count(uuid) to authenticated;
grant execute on function public.refund_claude_lifetime(uuid) to authenticated;
