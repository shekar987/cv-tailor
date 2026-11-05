-- 5 Nov 2026 (Chunk 15, the owner's call): "Remove a stage I picked by mistake". stages_reached
-- stays append-only for every write except this one function, which the row's menu calls after
-- the user confirms. It removes the one stage and writes the dated note in a single UPDATE, so
-- the count can never change without the note saying so, and it refuses (returns null) rather
-- than cut the notes when the line would take them past the cap.
--
-- The exception is a transaction-local setting only this function sets. PostgREST exposes only
-- the public schema, so a client can't call set_config, and a plain write still can't shrink the
-- list. SECURITY INVOKER: RLS applies, and the function also scopes by auth.uid().
--
-- /api/applications/{id}/remove-stage is the only caller. It takes the request only from the
-- page, on the user's confirmation, so a sweep's API call is refused there. A script holding the
-- user's session could call this function itself; nothing at this level can tell the two apart.
--
-- Safe to apply while the previous release is running: no row is rewritten, and the trigger
-- behaves as before while the setting is empty.
--
-- Apply by hand in the Supabase SQL editor.

create or replace function public.applications_record_stage()
returns trigger
language plpgsql
set search_path = ''
as $func$
declare
  stage text := case new.status when 'Ready to submit' then 'saved' else lower(new.status) end;
  removing text := nullif(current_setting('app.removing_stage', true), '');
  history text[] := case when tg_op = 'UPDATE' then coalesce(old.stages_reached, '{}') else coalesce(new.stages_reached, '{}') end;
begin
  if tg_op = 'UPDATE' and removing is not null then
    history := array(select s from unnest(history) with ordinality as h(s, n) where lower(s) <> lower(removing) order by n);
  end if;
  if not (stage = any (history)) then
    history := history || stage;
  end if;
  new.stages_reached := history;
  return new;
end;
$func$;

create or replace function public.remove_application_stage(p_id uuid, p_stage text, p_note text, p_max integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  result jsonb;
begin
  perform set_config('app.removing_stage', p_stage, true);
  update public.applications
  set stages_reached = stages_reached,
      notes = p_note || coalesce(E'\n' || nullif(notes, ''), '')
  where id = p_id
    and user_id = auth.uid()
    and p_stage in ('screening', 'assessment', 'interview', 'offer', 'accepted')
    and lower(status) <> p_stage
    and exists (select 1 from unnest(stages_reached) as s where lower(s) = p_stage)
    and length(p_note) + 1 + coalesce(length(notes), 0) <= p_max
  returning jsonb_build_object('notes', notes, 'stages_reached', stages_reached) into result;
  perform set_config('app.removing_stage', '', true);
  return result;
end;
$func$;

revoke all on function public.remove_application_stage(uuid, text, text, integer) from public, anon;
grant execute on function public.remove_application_stage(uuid, text, text, integer) to authenticated;

-- Down (run by hand to reverse). Stages already removed stay removed; their notes say so.
--
--   drop function if exists public.remove_application_stage(uuid, text, text, integer);
--   Then re-run the applications_record_stage function from
--   supabase/migrations/20261105120000_stages_append_only.sql.
