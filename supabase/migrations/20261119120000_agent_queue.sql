-- 19 Nov 2026 (Chunk 33): the Local Agent apply queue. The website writes jobs
-- here; a worker on the user's own PC (Chunk 34) claims them and reports back.
-- No browser automation in this chunk — this is the bridge only.
--
-- Three tables: apply_jobs (the queue), apply_events (a per-job timeline) and
-- agent_devices (one row per user PC, the token stored hashed).
--
-- The worker has no Supabase session and never holds the service-role key. It
-- acts through four SECURITY DEFINER functions that validate a device token it
-- was given once: claim_next_job, heartbeat, update_job_status, log_event. They
-- are the ONLY functions here granted to anon — the device token is the whole
-- credential, and a wrong token matches no device, so it gets nothing. The
-- website, by contrast, reads and writes these tables as the signed-in user
-- under RLS.
--
-- Safe to apply while the current release runs: it only adds.
--
-- Apply by hand in the Supabase SQL editor (one paste, one transaction).

-- digest() for hashing the device token at resolve time lives in pgcrypto.
create extension if not exists pgcrypto with schema extensions;

-- 1. agent_devices (created first: apply_jobs.claimed_by points at it) --------------

create table if not exists public.agent_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'My PC' check (length(name) between 1 and 80),
  -- sha256 hex of the token the website showed once; the plaintext is never stored.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists agent_devices_user_idx on public.agent_devices (user_id);

alter table public.agent_devices enable row level security;
drop policy if exists agent_devices_select_own on public.agent_devices;
create policy agent_devices_select_own on public.agent_devices
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists agent_devices_insert_own on public.agent_devices;
create policy agent_devices_insert_own on public.agent_devices
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists agent_devices_update_own on public.agent_devices;
create policy agent_devices_update_own on public.agent_devices
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists agent_devices_delete_own on public.agent_devices;
create policy agent_devices_delete_own on public.agent_devices
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.agent_devices from anon;

-- 2. apply_jobs (the queue) ----------------------------------------------------------

create table if not exists public.apply_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- The tracker row this job relates to, if any. No reliable link exists at queue
  -- time (applications has no URL), so the worker may fill it later.
  application_id  uuid references public.applications(id) on delete set null,
  job_url         text not null check (length(job_url) between 1 and 2000),
  -- The normalised URL the duplicate check keys on (lib/agent/ats normaliseJobUrl).
  job_url_norm    text not null,
  company         text,
  role            text,
  ats             text not null default 'unknown'
                    check (ats in ('greenhouse', 'lever', 'ashby', 'workday', 'pinpoint', 'workable', 'other', 'unknown')),
  status          text not null default 'queued'
                    check (status in ('queued', 'claimed', 'processing', 'needs_review', 'needs_human', 'dry_run_done', 'submitted', 'failed', 'cancelled')),
  mode            text not null default 'dry_run' check (mode in ('dry_run', 'submit')),
  priority        int not null default 0,
  attempts        int not null default 0,
  claimed_by      uuid references public.agent_devices(id) on delete set null,
  claimed_at      timestamptz,
  heartbeat_at    timestamptz,
  last_error      text,
  confirmation_url text,
  screenshot_path  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint apply_jobs_user_url_unique unique (user_id, job_url_norm)
);

create index if not exists apply_jobs_user_status_idx on public.apply_jobs (user_id, status);
-- The claim order: highest priority, then oldest.
create index if not exists apply_jobs_queue_idx on public.apply_jobs (user_id, priority desc, created_at) where status = 'queued';

-- Reuse the applications migration's set_updated_at() trigger function.
drop trigger if exists apply_jobs_set_updated_at on public.apply_jobs;
create trigger apply_jobs_set_updated_at
  before update on public.apply_jobs
  for each row execute function public.set_updated_at();

alter table public.apply_jobs enable row level security;
drop policy if exists apply_jobs_select_own on public.apply_jobs;
create policy apply_jobs_select_own on public.apply_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists apply_jobs_insert_own on public.apply_jobs;
create policy apply_jobs_insert_own on public.apply_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists apply_jobs_update_own on public.apply_jobs;
create policy apply_jobs_update_own on public.apply_jobs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists apply_jobs_delete_own on public.apply_jobs;
create policy apply_jobs_delete_own on public.apply_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.apply_jobs from anon;

-- 3. apply_events (a per-job timeline) -----------------------------------------------

create table if not exists public.apply_events (
  id       uuid primary key default gen_random_uuid(),
  job_id   uuid not null references public.apply_jobs(id) on delete cascade,
  -- Carried for RLS so a user reads their own job's events without a join.
  user_id  uuid not null references auth.users(id) on delete cascade,
  ts       timestamptz not null default now(),
  level    text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  step     text,
  message  text,
  data     jsonb
);

create index if not exists apply_events_job_ts_idx on public.apply_events (job_id, ts desc);

alter table public.apply_events enable row level security;
drop policy if exists apply_events_select_own on public.apply_events;
create policy apply_events_select_own on public.apply_events
  for select to authenticated using ((select auth.uid()) = user_id);
-- Insert is only ever done by log_event() (SECURITY DEFINER); the website never
-- writes events directly, but a self-insert of one's own row is harmless.
drop policy if exists apply_events_insert_own on public.apply_events;
create policy apply_events_insert_own on public.apply_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
revoke all on public.apply_events from anon;

-- 4. Worker RPCs -- device-token checked, SECURITY DEFINER ----------------------------

-- Resolve a device token to its row, or NULL. Internal to the four functions
-- below; never granted to anyone, so it can only be reached from within them
-- (they run as the owner, which may execute it).
create or replace function public.agent_resolve_device(p_token text)
returns public.agent_devices
language sql
security definer
set search_path = ''
stable
as $func$
  select * from public.agent_devices
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and revoked = false
  limit 1;
$func$;

revoke all on function public.agent_resolve_device(text) from public, anon, authenticated;

-- Atomically claim the user's oldest queued job for this device. Respects the
-- user's daily submit cap (user_settings.preferences.agentDailySubmitCap,
-- default 15): once hit, submit-mode jobs are skipped and only dry_run jobs are
-- claimed. Returns the claimed job, or NULL when nothing is claimable.
create or replace function public.claim_next_job(p_device_token text)
returns public.apply_jobs
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_device public.agent_devices;
  v_user uuid;
  v_cap int;
  v_submit_today int;
  v_today_start timestamptz;
  v_job public.apply_jobs;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'invalid_device_token' using errcode = '28000';
  end if;
  v_user := v_device.user_id;

  update public.agent_devices set last_seen_at = now() where id = v_device.id;

  v_cap := coalesce(
    nullif((select preferences->>'agentDailySubmitCap' from public.user_settings where user_id = v_user), '')::int,
    15
  );

  v_today_start := date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London';
  select count(*) into v_submit_today
  from public.apply_jobs
  where user_id = v_user
    and mode = 'submit'
    and status in ('claimed', 'processing', 'needs_review', 'needs_human', 'submitted')
    and claimed_at >= v_today_start;

  update public.apply_jobs j
  set status = 'claimed',
      claimed_by = v_device.id,
      claimed_at = now(),
      heartbeat_at = now(),
      attempts = j.attempts + 1
  where j.id = (
    select id from public.apply_jobs
    where user_id = v_user
      and status = 'queued'
      and (mode = 'dry_run' or v_submit_today < v_cap)
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  returning j.* into v_job;

  return v_job;
end;
$func$;

-- A claimed/processing job is still alive. Also stamps the device.
create or replace function public.heartbeat(p_device_token text, p_job_id uuid)
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
  update public.apply_jobs
  set heartbeat_at = now()
  where id = p_job_id
    and user_id = v_device.user_id
    and claimed_by = v_device.id
    and status in ('claimed', 'processing');
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$func$;

-- Move a job the worker holds to a new status, with an optional error and data
-- (confirmation_url / screenshot_path are pulled out of data).
create or replace function public.update_job_status(
  p_device_token text,
  p_job_id uuid,
  p_status text,
  p_error text default null,
  p_data jsonb default null
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
  -- The statuses a worker may set (not queued/claimed/cancelled — those are the
  -- website's and the claim's own).
  if p_status not in ('processing', 'needs_review', 'needs_human', 'dry_run_done', 'submitted', 'failed') then
    raise exception 'invalid_status: %', p_status using errcode = '22023';
  end if;
  update public.apply_jobs
  set status = p_status,
      last_error = coalesce(p_error, last_error),
      confirmation_url = coalesce(p_data->>'confirmation_url', confirmation_url),
      screenshot_path = coalesce(p_data->>'screenshot_path', screenshot_path),
      heartbeat_at = now()
  where id = p_job_id
    and user_id = v_device.user_id
    and claimed_by = v_device.id;
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$func$;

-- Append one line to a job's timeline.
create or replace function public.log_event(
  p_device_token text,
  p_job_id uuid,
  p_level text,
  p_step text,
  p_message text,
  p_data jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_device public.agent_devices;
  v_id uuid;
begin
  v_device := public.agent_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'invalid_device_token' using errcode = '28000';
  end if;
  insert into public.apply_events (job_id, user_id, level, step, message, data)
  select p_job_id, v_device.user_id, coalesce(p_level, 'info'), p_step, p_message, p_data
  where exists (
    select 1 from public.apply_jobs where id = p_job_id and user_id = v_device.user_id
  )
  returning id into v_id;
  return v_id;
end;
$func$;

-- The worker calls these with a device token and the publishable key, so anon
-- (and authenticated) may execute them; the token is the credential.
revoke all on function public.claim_next_job(text) from public;
revoke all on function public.heartbeat(text, uuid) from public;
revoke all on function public.update_job_status(text, uuid, text, text, jsonb) from public;
revoke all on function public.log_event(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.claim_next_job(text) to anon, authenticated;
grant execute on function public.heartbeat(text, uuid) to anon, authenticated;
grant execute on function public.update_job_status(text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.log_event(text, uuid, text, text, text, jsonb) to anon, authenticated;

-- 5. Live status on the Agent page: realtime on the queue and its timeline.
-- RLS still applies per subscriber, so each user sees only their own rows.
-- Guarded so re-pasting the migration does not error ("add table" is not
-- idempotent on its own).
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apply_jobs'
  ) then
    alter publication supabase_realtime add table public.apply_jobs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apply_events'
  ) then
    alter publication supabase_realtime add table public.apply_events;
  end if;
end;
$pub$;

-- Down (run by hand to reverse):
--
--   alter publication supabase_realtime drop table public.apply_events;
--   alter publication supabase_realtime drop table public.apply_jobs;
--   drop function if exists public.log_event(text, uuid, text, text, text, jsonb);
--   drop function if exists public.update_job_status(text, uuid, text, text, jsonb);
--   drop function if exists public.heartbeat(text, uuid);
--   drop function if exists public.claim_next_job(text);
--   drop function if exists public.agent_resolve_device(text);
--   drop table if exists public.apply_events;
--   drop table if exists public.apply_jobs;
--   drop table if exists public.agent_devices;
