-- 25 Nov 2026 (Chunk TL-1): the Local Tailor queue. The website writes a
-- `tailor` job here; a worker on the user's own PC (the /agent Python project)
-- claims it, calls a local open-weight model through Ollama on localhost:11434
-- and writes a JSON result back. £0 per run, no paid LLM. The website NEVER
-- calls Ollama directly — this table is the only bridge.
--
-- WHY A SIBLING TABLE, NOT apply_jobs (Chunk 33):
--   apply_jobs is a browser-automation apply queue — its job_url is NOT NULL and
--   carries a UNIQUE(user_id, job_url_norm) key, its status enum is the apply
--   lifecycle (needs_review / submitted / dry_run_done …) and its mode is
--   dry_run|submit. A tailor job has no URL, a different lifecycle (queued →
--   done / failed), and needs structured input/output JSON. Bending apply_jobs
--   to hold both would mean nullable URLs, a widened status CHECK, a widened ats
--   CHECK and two input/output columns every apply-queue reader must ignore. A
--   separate, small table keeps each queue's meaning clean. It REUSES the
--   device-token model from the agent_queue migration verbatim: the same
--   agent_devices rows, the same hashed-token resolver (agent_resolve_device),
--   so a user connects ONE device and it serves both queues.
--
-- Safe to apply while the current release runs: it only adds. Depends on
-- 20261119120000_agent_queue.sql (agent_devices + agent_resolve_device) and on
-- 20260826120000_create_applications.sql (set_updated_at + applications).
--
-- Apply by hand in the Supabase SQL editor (one paste, one transaction).

-- 1. tailor_jobs (the queue) ----------------------------------------------------------

create table if not exists public.tailor_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- The tracker row this tailor relates to, if any (optional).
  application_id  uuid references public.applications(id) on delete set null,
  -- The task the worker runs. Only 'summary' in TL-1 (the Professional Summary);
  -- later TL chunks widen this to the rest of the pipeline.
  kind            text not null default 'summary' check (kind in ('summary')),
  status          text not null default 'queued'
                    check (status in ('queued', 'claimed', 'processing', 'done', 'failed', 'cancelled')),
  -- The input the worker reads: { jd_text, master_cv, kind, ... }. The website
  -- fills master_cv at queue time so the worker needs no Supabase read of its own.
  input           jsonb not null,
  -- The worker's JSON result: { summary, model, ... }. Null until done.
  output          jsonb,
  -- Which local model produced it, and how fast — for the "Local (£0)" badge and
  -- the cost counter. tokens_per_sec is the worker's own measurement.
  model           text,
  tokens_per_sec  numeric,
  -- What this run would have cost on the paid provider (GBP), set by the website
  -- at queue time so the Settings cost counter can total it.
  estimated_gbp   numeric not null default 0,
  attempts        int not null default 0,
  claimed_by      uuid references public.agent_devices(id) on delete set null,
  claimed_at      timestamptz,
  heartbeat_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tailor_jobs_user_status_idx on public.tailor_jobs (user_id, status);
-- The claim order: oldest queued first.
create index if not exists tailor_jobs_queue_idx on public.tailor_jobs (user_id, created_at) where status = 'queued';

-- Reuse the applications migration's set_updated_at() trigger function.
drop trigger if exists tailor_jobs_set_updated_at on public.tailor_jobs;
create trigger tailor_jobs_set_updated_at
  before update on public.tailor_jobs
  for each row execute function public.set_updated_at();

alter table public.tailor_jobs enable row level security;
drop policy if exists tailor_jobs_select_own on public.tailor_jobs;
create policy tailor_jobs_select_own on public.tailor_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tailor_jobs_insert_own on public.tailor_jobs;
create policy tailor_jobs_insert_own on public.tailor_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists tailor_jobs_update_own on public.tailor_jobs;
create policy tailor_jobs_update_own on public.tailor_jobs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists tailor_jobs_delete_own on public.tailor_jobs;
create policy tailor_jobs_delete_own on public.tailor_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.tailor_jobs from anon;

-- 2. Worker RPCs — device-token checked, SECURITY DEFINER -----------------------------
-- These mirror claim_next_job / update_job_status from the agent_queue migration,
-- but for tailor_jobs. They call public.agent_resolve_device (defined there) to
-- turn a device token into its row; a wrong token resolves to NULL and gets
-- nothing. The worker holds no Supabase session — the token is the whole
-- credential — so anon may execute these.

-- Atomically claim this user's oldest queued tailor job for the device.
create or replace function public.claim_next_tailor_job(p_device_token text)
returns public.tailor_jobs
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_device public.agent_devices;
  v_job public.tailor_jobs;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'invalid_device_token' using errcode = '28000';
  end if;

  update public.agent_devices set last_seen_at = now() where id = v_device.id;

  update public.tailor_jobs j
  set status = 'claimed',
      claimed_by = v_device.id,
      claimed_at = now(),
      heartbeat_at = now(),
      attempts = j.attempts + 1
  where j.id = (
    select id from public.tailor_jobs
    where user_id = v_device.user_id
      and status = 'queued'
    order by created_at asc
    for update skip locked
    limit 1
  )
  returning j.* into v_job;

  return v_job;
end;
$func$;

-- A claimed/processing tailor job is still alive. Also stamps the device.
create or replace function public.tailor_heartbeat(p_device_token text, p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_device public.agent_devices;
  v_hit boolean := false;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'invalid_device_token' using errcode = '28000';
  end if;
  update public.agent_devices set last_seen_at = now() where id = v_device.id;
  update public.tailor_jobs
  set heartbeat_at = now()
  where id = p_job_id
    and user_id = v_device.user_id
    and claimed_by = v_device.id
    and status in ('claimed', 'processing');
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$func$;

-- Move a tailor job the worker holds to a new status, writing its JSON output and
-- the model/speed it measured. The worker may only set processing/done/failed —
-- queued/claimed/cancelled are the website's and the claim's own.
create or replace function public.complete_tailor_job(
  p_device_token text,
  p_job_id uuid,
  p_status text,
  p_output jsonb default null,
  p_model text default null,
  p_tokens_per_sec numeric default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_device public.agent_devices;
  v_hit boolean := false;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'invalid_device_token' using errcode = '28000';
  end if;
  if p_status not in ('processing', 'done', 'failed') then
    raise exception 'invalid_status: %', p_status using errcode = '22023';
  end if;
  update public.tailor_jobs
  set status = p_status,
      output = coalesce(p_output, output),
      model = coalesce(p_model, model),
      tokens_per_sec = coalesce(p_tokens_per_sec, tokens_per_sec),
      last_error = coalesce(p_error, last_error),
      heartbeat_at = now()
  where id = p_job_id
    and user_id = v_device.user_id
    and claimed_by = v_device.id;
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$func$;

-- The worker calls these with a device token and the publishable key, so anon
-- (and authenticated) may execute them; the token is the credential.
revoke all on function public.claim_next_tailor_job(text) from public;
revoke all on function public.tailor_heartbeat(text, uuid) from public;
revoke all on function public.complete_tailor_job(text, uuid, text, jsonb, text, numeric, text) from public;
grant execute on function public.claim_next_tailor_job(text) to anon, authenticated;
grant execute on function public.tailor_heartbeat(text, uuid) to anon, authenticated;
grant execute on function public.complete_tailor_job(text, uuid, text, jsonb, text, numeric, text) to anon, authenticated;

-- 3. Live status on the preview: realtime on the tailor queue. RLS still applies
-- per subscriber, so each user sees only their own rows. Guarded so re-pasting
-- the migration does not error.
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tailor_jobs'
  ) then
    alter publication supabase_realtime add table public.tailor_jobs;
  end if;
end;
$pub$;

-- Down (run by hand to reverse):
--
--   alter publication supabase_realtime drop table public.tailor_jobs;
--   drop function if exists public.complete_tailor_job(text, uuid, text, jsonb, text, numeric, text);
--   drop function if exists public.tailor_heartbeat(text, uuid);
--   drop function if exists public.claim_next_tailor_job(text);
--   drop table if exists public.tailor_jobs;
