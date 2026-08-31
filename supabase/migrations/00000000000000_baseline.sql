-- Baseline: the complete pre-migration schema, captured VERBATIM from the
-- live project's catalogs on 2026-08-31 (read-only introspection — the same
-- queries as supabase/introspect.sql).
--
-- Purpose: rebuild a FRESH project. Never run this against the live project —
-- everything in here already exists there. Later migrations
-- (20260826120000 onward) apply on top of this state; note that
-- 20260826120000_create_applications.sql and 20260829120000 overlap with the
-- applications objects below on a fresh project — their `if not exists` /
-- `create or replace` forms make that harmless.
--
-- The live project's tracked migration history holds only three entries
-- (guard_rate_limit_rpcs_to_calling_user, add_section_order_to_profiles,
-- add_user_projects_and_user_skills); every other object was created by hand
-- in the SQL editor. All of it is captured here.

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  anthropic_api_key text,
  tailor_count integer not null default 0,
  tailor_count_reset_at timestamp with time zone not null default now(),
  is_unlimited boolean not null default false,
  claude_tailors_used integer not null default 0,
  section_order jsonb
);

create table if not exists public.master_cvs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  text text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.cv_profiles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.user_api_keys (
  user_id uuid not null,
  provider text not null,
  key_enc text not null,
  key_hint text not null default ''::text,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.user_feedback (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  message text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.applications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  company_name text not null,
  role text not null,
  cv_reference text,
  tailor_session_id text,
  status text not null default 'Applied'::text,
  salary text,
  date_applied date not null,
  followup_date date,
  notes text,
  job_description text,
  source text not null default 'manual'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  tailored_cv jsonb
);

-- In the DB but unused by the code since their routes were removed; kept in
-- the baseline because they exist on live. Droppable when the owner decides.
create table if not exists public.user_projects (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  project_name text not null,
  tech_stack text not null default ''::text,
  links jsonb not null default '[]'::jsonb,
  bullets jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.user_skills (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  skill text not null,
  category text not null,
  created_at timestamp with time zone not null default now()
);

-- ── Constraints ─────────────────────────────────────────────────────────────

alter table public.profiles add constraint profiles_pkey primary key (id);
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
alter table public.profiles add constraint profiles_section_order_is_array check (((section_order is null) or (jsonb_typeof(section_order) = 'array'::text)));

alter table public.master_cvs add constraint master_cvs_pkey primary key (id);
alter table public.master_cvs add constraint master_cvs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.master_cvs add constraint master_cvs_user_id_key unique (user_id);

alter table public.cv_profiles add constraint cv_profiles_pkey primary key (id);
alter table public.cv_profiles add constraint cv_profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.cv_profiles add constraint cv_profiles_user_id_key unique (user_id);

alter table public.user_api_keys add constraint user_api_keys_pkey primary key (user_id, provider);
alter table public.user_api_keys add constraint user_api_keys_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.user_api_keys add constraint user_api_keys_provider_check check ((provider = any (array['gemini'::text, 'openrouter'::text])));

alter table public.user_feedback add constraint user_feedback_pkey primary key (id);
alter table public.user_feedback add constraint user_feedback_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.applications add constraint applications_pkey primary key (id);
alter table public.applications add constraint applications_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.applications add constraint applications_status_check check ((status = any (array['Applied'::text, 'Screening'::text, 'Interview'::text, 'Offer'::text, 'Rejected'::text, 'Withdrawn'::text])));
alter table public.applications add constraint applications_source_check check ((source = any (array['tailored'::text, 'manual'::text])));

alter table public.user_projects add constraint user_projects_pkey primary key (id);
alter table public.user_projects add constraint user_projects_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.user_projects add constraint user_projects_name_not_blank check ((length(btrim(project_name)) > 0));
alter table public.user_projects add constraint user_projects_links_is_array check ((jsonb_typeof(links) = 'array'::text));
alter table public.user_projects add constraint user_projects_bullets_is_array check ((jsonb_typeof(bullets) = 'array'::text));

alter table public.user_skills add constraint user_skills_pkey primary key (id);
alter table public.user_skills add constraint user_skills_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.user_skills add constraint user_skills_category_check check ((category = any (array['functional'::text, 'technical'::text])));
alter table public.user_skills add constraint user_skills_not_blank check ((length(btrim(skill)) > 0));

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index applications_user_date_idx on public.applications using btree (user_id, date_applied desc);
-- Partial unique: the tracker's one-row-per-tailoring-session rule. PostgREST
-- upsert onConflict cannot target this — the route check-then-inserts and
-- catches 23505 as the backstop.
create unique index applications_user_session_key on public.applications using btree (user_id, tailor_session_id) where (tailor_session_id is not null);
create index user_projects_user_id_idx on public.user_projects using btree (user_id);
create unique index user_skills_unique_per_user on public.user_skills using btree (user_id, category, lower(btrim(skill)));
create index user_skills_user_id_idx on public.user_skills using btree (user_id);

-- ── Row level security ──────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.master_cvs enable row level security;
alter table public.cv_profiles enable row level security;
alter table public.user_api_keys enable row level security;
alter table public.user_feedback enable row level security;
alter table public.applications enable row level security;
alter table public.user_projects enable row level security;
alter table public.user_skills enable row level security;

create policy "users can manage own profile" on public.profiles as permissive for all to public using ((id = auth.uid())) with check ((id = auth.uid()));
create policy "users can manage own cv" on public.master_cvs as permissive for all to public using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "users can manage own cv profile" on public.cv_profiles as permissive for all to public using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

create policy own_rows_select on public.user_api_keys as permissive for select to public using ((auth.uid() = user_id));
create policy own_rows_insert on public.user_api_keys as permissive for insert to public with check ((auth.uid() = user_id));
create policy own_rows_update on public.user_api_keys as permissive for update to public using ((auth.uid() = user_id));
create policy own_rows_delete on public.user_api_keys as permissive for delete to public using ((auth.uid() = user_id));

create policy "insert own feedback" on public.user_feedback as permissive for insert to authenticated with check ((auth.uid() = user_id));

create policy applications_select_own on public.applications as permissive for select to public using ((auth.uid() = user_id));
create policy applications_insert_own on public.applications as permissive for insert to public with check ((auth.uid() = user_id));
create policy applications_update_own on public.applications as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy applications_delete_own on public.applications as permissive for delete to public using ((auth.uid() = user_id));

create policy own_rows_select on public.user_projects as permissive for select to public using ((auth.uid() = user_id));
create policy own_rows_insert on public.user_projects as permissive for insert to public with check ((auth.uid() = user_id));
create policy own_rows_update on public.user_projects as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_rows_delete on public.user_projects as permissive for delete to public using ((auth.uid() = user_id));

create policy own_rows_select on public.user_skills as permissive for select to public using ((auth.uid() = user_id));
create policy own_rows_insert on public.user_skills as permissive for insert to public with check ((auth.uid() = user_id));
create policy own_rows_update on public.user_skills as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy own_rows_delete on public.user_skills as permissive for delete to public using ((auth.uid() = user_id));

-- ── Functions ───────────────────────────────────────────────────────────────
-- Bodies verbatim from the live project (including the caller-guard added by
-- the tracked migration guard_rate_limit_rpcs_to_calling_user).

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_increment_tailor_count(uid uuid, daily_limit integer, window_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_count integer;
  reset_at timestamptz;
  is_unlim boolean;
  now_ts timestamptz := now();
BEGIN
  -- Callers may only act on their own row.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM uid THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'forbidden', 'reset_at', null);
  END IF;

  SELECT tailor_count, tailor_count_reset_at, is_unlimited
  INTO current_count, reset_at, is_unlim
  FROM public.profiles WHERE id = uid FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'profile_not_found', 'reset_at', null);
  END IF;

  IF is_unlim THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'unlimited', 'reset_at', reset_at);
  END IF;

  IF reset_at IS NULL OR reset_at <= now_ts THEN
    current_count := 0;
    reset_at := now_ts + make_interval(secs => window_seconds);
    UPDATE public.profiles SET tailor_count = 0, tailor_count_reset_at = reset_at WHERE id = uid;
  END IF;

  IF current_count >= daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'reset_at', reset_at);
  END IF;

  UPDATE public.profiles SET tailor_count = tailor_count + 1 WHERE id = uid;
  RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'reset_at', reset_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_increment_claude_lifetime(uid uuid, lifetime_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  prof profiles%ROWTYPE;
BEGIN
  -- Callers may only act on their own row.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM uid THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO prof
  FROM profiles
  WHERE id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'profile_not_found');
  END IF;

  -- is_unlimited accounts skip the cap and are never incremented
  IF prof.is_unlimited THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'unlimited');
  END IF;

  IF prof.claude_tailors_used >= lifetime_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'claude_limit_reached');
  END IF;

  UPDATE profiles
  SET claude_tailors_used = claude_tailors_used + 1
  WHERE id = uid;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_encrypted_key(p_user_id uuid, p_provider text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT key_enc
    FROM user_api_keys
    WHERE user_id = p_user_id
      AND provider = p_provider
  );
END;
$function$;

-- Live as of the capture WITHOUT a pinned search_path — the advisor-hardening
-- migration pins it. Captured as-is because a baseline records what exists.
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER applications_set_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_projects_touch_updated_at BEFORE UPDATE ON public.user_projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Grants — the deliberate deviations from Supabase defaults ───────────────
-- Every table keeps Supabase's default anon/authenticated grants (RLS is the
-- enforcement layer) EXCEPT the deviations below, which the app relies on.

-- B2 hardening: authenticated cannot write its own quota columns.
revoke update on public.profiles from authenticated;
grant update (anthropic_api_key, section_order) on public.profiles to authenticated;

-- These two tables were created without anon grants.
revoke all on public.user_projects from anon;
revoke all on public.user_skills from anon;
