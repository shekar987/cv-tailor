-- Close the one advisor finding left after 20260831140000: the refund
-- functions were created by 20260830120000 with `revoke ... from public`
-- only, but Supabase's default privileges ALSO grant EXECUTE to anon
-- explicitly on function creation — so anon could still call them via
-- /rest/v1/rpc/* (harmlessly: their auth.uid() guard no-ops for anonymous
-- callers, but the surface shouldn't exist). The hardening migration revoked
-- anon by name on the older functions; these two weren't on live yet when it
-- was written.

revoke execute on function public.refund_tailor_count(uuid) from anon;
revoke execute on function public.refund_claude_lifetime(uuid) from anon;
