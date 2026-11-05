-- 5 Nov 2026 (Chunk 15, the owner's call): stages_reached is append-only, so a count of how
-- far applications got can never drop without the owner knowing. Until now a move back
-- dropped later stages, and leaving an ending removed it, so one sweep writing Screening on
-- an Interview row took that row off the interview count without a word.
--
-- Safe to apply while the previous release is running: no row is rewritten, and a page on the
-- old code only shows a stale history until it reloads.
--
-- The trigger now also fires on a direct write to stages_reached and answers from OLD, so no
-- client can shrink the history either, RLS or not. A status keeps its place the first time it
-- is reached: the list is a record of what happened, and the current stage is the status
-- column, not the last entry. To correct a real mistake, an administrator disables the trigger
-- around the update:
--   alter table public.applications disable trigger applications_record_stage;
--   update public.applications set stages_reached = array_remove(stages_reached, 'interview') where id = '...';
--   alter table public.applications enable trigger applications_record_stage;
--
-- undo_snapshot is what Move to Closed replaced: Undo restores from it instead of editing the
-- history. Written only by a confirmed close, it is cleared by the next change to the row,
-- whoever makes it (the second trigger), and /api/applications refuses one older than the
-- 10-second toast plus a few seconds of network. An expired one is inert until that next change.
--
-- Apply by hand in the Supabase SQL editor.

alter table public.applications add column if not exists undo_snapshot jsonb;

create or replace function public.applications_record_stage()
returns trigger
language plpgsql
set search_path = ''
as $func$
declare
  stage text := case new.status when 'Ready to submit' then 'saved' else lower(new.status) end;
  history text[] := case when tg_op = 'UPDATE' then coalesce(old.stages_reached, '{}') else coalesce(new.stages_reached, '{}') end;
begin
  if not (stage = any (history)) then
    history := history || stage;
  end if;
  new.stages_reached := history;
  return new;
end;
$func$;

drop trigger if exists applications_record_stage on public.applications;
create trigger applications_record_stage
  before insert or update of status, stages_reached on public.applications
  for each row execute function public.applications_record_stage();

create or replace function public.applications_clear_undo()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  -- A write that does not set its own snapshot is the next change: Undo no longer applies.
  if new.undo_snapshot is not distinct from old.undo_snapshot then
    new.undo_snapshot := null;
  end if;
  return new;
end;
$func$;

drop trigger if exists applications_clear_undo on public.applications;
create trigger applications_clear_undo
  before update on public.applications
  for each row
  when (old.undo_snapshot is not null)
  execute function public.applications_clear_undo();

-- Down (run by hand to reverse). Entries the append-only trigger kept stay in the list.
--
--   drop trigger if exists applications_clear_undo on public.applications;
--   drop function if exists public.applications_clear_undo();
--   alter table public.applications drop column if exists undo_snapshot;
--   Then re-run the applications_record_stage function and trigger from
--   supabase/migrations/20261103120000_application_events.sql.
