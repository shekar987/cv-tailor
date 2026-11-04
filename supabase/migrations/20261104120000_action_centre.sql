-- 4 Nov 2026 (Chunk 12): the Action Centre. It extends application_events, which
-- 20261103120000 created; "to do" is the existing open statuses (scheduled, to_book).
--
-- Safe to apply while the previous release is running: it only adds.
--
-- kind gains video, work_trial and screening_questions. source gains aiapply, which
-- says which inbox holds the email. snoozed_until takes a card out of the main list
-- for a day and never moves the employer's date. closed_by and closed_at say a
-- confirmation in the row's notes closed the event, so the page can name it and undo it.
--
-- append_application_note prepends one line in a single UPDATE, so two writers cannot
-- lose each other's text, and refuses (returns null) rather than cut the notes when
-- the line would take them past the cap the tracker enforces. SECURITY INVOKER: RLS
-- applies, and the function also scopes by auth.uid().
--
-- Apply by hand in the Supabase SQL editor.

alter table public.application_events drop constraint if exists application_events_kind_check;
alter table public.application_events add constraint application_events_kind_check check (kind in (
  'screening_call', 'interview', 'assessment', 'take_home', 'deadline', 'follow_up', 'offer_deadline', 'networking',
  'video', 'work_trial', 'screening_questions'
));

alter table public.application_events drop constraint if exists application_events_source_check;
alter table public.application_events add constraint application_events_source_check check (source in ('manual', 'gmail', 'calendar', 'aiapply'));

alter table public.application_events
  add column if not exists snoozed_until timestamptz,
  add column if not exists closed_by text,
  add column if not exists closed_at timestamptz;

alter table public.application_events drop constraint if exists application_events_closed_by_check;
alter table public.application_events add constraint application_events_closed_by_check check (closed_by is null or closed_by = 'note');

create or replace function public.append_application_note(p_id uuid, p_line text, p_max integer)
returns text
language sql
security invoker
set search_path = ''
as $func$
  update public.applications
  set notes = p_line || coalesce(E'\n' || nullif(notes, ''), '')
  where id = p_id
    and user_id = auth.uid()
    and length(p_line) + 1 + coalesce(length(notes), 0) <= p_max
  returning notes;
$func$;

revoke all on function public.append_application_note(uuid, text, integer) from public, anon;
grant execute on function public.append_application_note(uuid, text, integer) to authenticated;

-- Down (run by hand to reverse; the updates first, so every row fits the old checks):
--
--   drop function if exists public.append_application_note(uuid, text, integer);
--   update public.application_events set kind = 'interview' where kind = 'video';
--   update public.application_events set kind = 'take_home' where kind = 'work_trial';
--   update public.application_events set kind = 'deadline' where kind = 'screening_questions';
--   update public.application_events set source = 'manual' where source = 'aiapply';
--   alter table public.application_events drop constraint if exists application_events_closed_by_check;
--   alter table public.application_events
--     drop column if exists closed_at,
--     drop column if exists closed_by,
--     drop column if exists snoozed_until;
--   alter table public.application_events drop constraint if exists application_events_source_check;
--   alter table public.application_events add constraint application_events_source_check check (source in ('manual', 'gmail', 'calendar'));
--   alter table public.application_events drop constraint if exists application_events_kind_check;
--   alter table public.application_events add constraint application_events_kind_check check (kind in (
--     'screening_call', 'interview', 'assessment', 'take_home', 'deadline', 'follow_up', 'offer_deadline', 'networking'
--   ));
