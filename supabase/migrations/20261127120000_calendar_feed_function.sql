-- JH-2C: SECURITY DEFINER function so the anon-key calendar subscriber can
-- read the user's events without a session.
--
-- calendar_feeds.anon is REVOKED (JH-2B migration), so a direct table query
-- from the publishable-key client always fails. The function runs with the
-- function-owner's privileges, bypasses RLS, and enforces isolation through
-- the JOIN (ae.user_id = cf.user_id) so a token hash can only yield the
-- token owner's own events.
--
-- LEFT JOIN semantics:
--   0 rows       → token not found (404)
--   1 row, ae.id IS NULL → valid token, no upcoming events (200 empty ICS)
--   N rows, ae.id NOT NULL → events to serve

create or replace function public.calendar_feed_events(p_token_hash text)
returns table (
  id uuid,
  kind text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  date_only boolean,
  prep_notes text,
  location_or_link text,
  timezone text,
  status text
)
security definer
set search_path = ''
stable
language sql
as $func$
  select
    ae.id,
    ae.kind,
    ae.title,
    ae.starts_at,
    ae.ends_at,
    ae.due_at,
    ae.date_only,
    ae.prep_notes,
    ae.location_or_link,
    ae.timezone,
    ae.status
  from public.calendar_feeds cf
  left join public.application_events ae
    on ae.user_id = cf.user_id
   and ae.status in ('scheduled', 'to_book')
  where cf.token_hash = p_token_hash
  order by ae.starts_at asc nulls last
$func$;

-- Grant execute to both anon (calendar subscriber, no session) and authenticated
-- (the user previewing their own feed).
grant execute on function public.calendar_feed_events(text) to anon, authenticated;
