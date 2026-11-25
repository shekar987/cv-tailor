-- 21 Nov 2026 (Chunk 35): the Local Agent's browser artifacts. When the PC
-- worker opens a queued job's page, it observes the form and takes a full-page
-- screenshot. The observed field list travels in an apply_events row (jsonb,
-- via the existing log_event RPC — no storage needed). The screenshot is a
-- binary, so it goes to a PRIVATE Storage bucket, agent-artifacts, under
-- <user_id>/<job_id>/<filename>.
--
-- The worker has no Supabase session, so it cannot write the private bucket
-- directly. A small Supabase Edge Function (supabase/functions/agent-artifact-
-- sign) holds the privileged key and mints a short-lived signed upload URL
-- after validating the device token with agent_artifact_target() below — so no
-- service-role key ever lives on the user's PC. The WEBSITE reads the file as
-- the signed-in owner (the SELECT policy), creating a signed URL for the
-- thumbnail on the Agent page.
--
-- Safe to apply while the current release runs: it only adds. The code degrades
-- until this is applied — the worker still observes and records the field list;
-- only the screenshot upload is skipped (artifact_sign_url unset), and the
-- Agent page's GET simply finds no screenshot_path to sign.
--
-- Apply by hand in the Supabase SQL editor (one paste, one transaction).

-- 1. The private bucket --------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-artifacts',
  'agent-artifacts',
  false,
  10485760, -- 10 MB: a full-page screenshot can be large
  array['image/png', 'image/jpeg', 'image/webp', 'application/json']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The signed-in owner can read and remove their own artifacts; anon gets
-- nothing. The worker's write goes through the edge function's signed URL (not
-- RLS), so there is no authenticated INSERT policy here.
drop policy if exists "agent_artifacts_select_own" on storage.objects;
create policy "agent_artifacts_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'agent-artifacts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "agent_artifacts_delete_own" on storage.objects;
create policy "agent_artifacts_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'agent-artifacts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 2. Resolve a device token + job to the owning user --------------------------
-- The edge function calls this to prove the worker holding the token may write
-- a screenshot for this job, and to learn the folder (user_id) to write it in.
-- Returns the owning user_id when the token is valid, not revoked, and the job
-- belongs to that user; NULL otherwise. Reuses agent_resolve_device (Chunk 33).
create or replace function public.agent_artifact_target(p_device_token text, p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
stable
as $func$
declare
  v_device public.agent_devices;
  v_user uuid;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    return null;
  end if;
  select user_id into v_user
  from public.apply_jobs
  where id = p_job_id and user_id = v_device.user_id;
  return v_user; -- NULL when the job is not this device's user's
end;
$func$;

revoke all on function public.agent_artifact_target(text, uuid) from public;
grant execute on function public.agent_artifact_target(text, uuid) to anon, authenticated, service_role;

-- Down (run by hand to reverse):
--
--   drop function if exists public.agent_artifact_target(text, uuid);
--   drop policy if exists "agent_artifacts_delete_own" on storage.objects;
--   drop policy if exists "agent_artifacts_select_own" on storage.objects;
--   delete from storage.buckets where id = 'agent-artifacts';
