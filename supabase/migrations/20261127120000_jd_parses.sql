-- TL-3: JD parse cache (27 Nov 2026).
-- Caches the parsed JD by a djb2 hash of the JD text so a re-opened JD does
-- not re-run the rules or the local Ollama call.
-- RLS: each user owns their own rows; no cross-user sharing (a crafted JD could
-- poison another user's cache).

create table if not exists jd_parses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  jd_hash         text not null,            -- djb2 hex of the JD text
  jd_text_prefix  text not null default '', -- first 500 chars for debugging
  parse           jsonb not null,           -- the full JdParse JSON
  rules_only      boolean not null default true,
  verdict         text not null,            -- "go" | "check" | "skip"
  parsed_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- One cached parse per (user, jd_hash)
create unique index if not exists jd_parses_user_hash
  on jd_parses (user_id, jd_hash);

-- RLS
alter table jd_parses enable row level security;

create policy "jd_parses: select own"
  on jd_parses for select
  using (auth.uid() = user_id);

create policy "jd_parses: insert own"
  on jd_parses for insert
  with check (auth.uid() = user_id);

create policy "jd_parses: update own"
  on jd_parses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "jd_parses: delete own"
  on jd_parses for delete
  using (auth.uid() = user_id);

-- Revoke from anon
revoke all on jd_parses from anon;

comment on table jd_parses is
  'TL-3: Cached JD parses (verdict, red flags, structured requirements). One row per (user, jd_hash). Applied by hand in Supabase SQL editor — not via CLI.';
