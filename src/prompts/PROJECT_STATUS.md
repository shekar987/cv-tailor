# CV.Tailor — Project Status

## What this is

Honest, ATS-aware CV tailoring tool. Next.js 16 + TypeScript + Tailwind + Supabase Auth + Anthropic API.
Deployed: cv-tailor-phi-rosy.vercel.app | Repo: github.com/shekar987/cv-tailor
Owner: Soma Shekar Keesari, London.
Purpose: personal job-hunt tool + portfolio piece, with a path to SaaS for other IT job seekers.

---

## Phase 1 (accounts + database): COMPLETE

Everything below has shipped to `main` and is live on Vercel.

| Feature | Status |
|---|---|
| Email/password login + signup | ✅ |
| Google OAuth | ✅ |
| GitHub OAuth | ✅ |
| Auth callback + error pages | ✅ |
| `/app` route guarded (unauthenticated → login) | ✅ |
| Master CV stored in Supabase (`master_cvs` table) | ✅ |
| Extracted profile stored in Supabase (`cv_profiles` table) | ✅ |
| Sign-out button + user email in header | ✅ |
| One-time localStorage → DB migration on first login | ✅ |
| Per-user rate limiting via SECURITY DEFINER RPC | ✅ |
| `is_unlimited` flag for owner account | ✅ |
| B1: auth-gate `/api/extract-profile` + `/api/analyze` | ✅ |
| B2: REVOKE table-level UPDATE on `profiles`; re-grant `anthropic_api_key` only | ✅ (SQL run on Supabase) |
| S2: input size caps (CV ≤ 20k chars, JD ≤ 15k chars) on all 3 AI endpoints | ✅ |

---

## Database schema (Supabase Postgres)

```
profiles
  id                     uuid  FK → auth.users (PK)
  tailor_count           int   — incremented by SECURITY DEFINER function only
  tailor_count_reset_at  timestamptz
  is_unlimited           bool  — bypasses rate limit; set manually for owner
  anthropic_api_key      text  — only column authenticated role can UPDATE directly

master_cvs
  user_id      uuid  FK → auth.users
  cv_text      text
  updated_at   timestamptz

cv_profiles
  user_id      uuid  FK → auth.users
  profile_json jsonb  — serialised Profile object (name/contact/edu/projects)
  updated_at   timestamptz
```

**Trigger:** `handle_new_user()` (SECURITY DEFINER) inserts a `profiles` row on every `auth.users` INSERT.

**Rate-limit RPC:** `check_and_increment_tailor_count(uid, daily_limit, window_seconds)` — atomically checks + increments with `FOR UPDATE` row lock. Returns `{ allowed, reason, reset_at }`.

---

## Security audit status

| ID | Issue | Status |
|---|---|---|
| B1 | `/api/extract-profile` + `/api/analyze` callable without auth | ✅ Fixed |
| B2 | Authenticated users could self-set `is_unlimited=true` via direct Supabase client | ✅ Fixed (REVOKE + SECURITY DEFINER) |
| S2 | No input size caps — cost-attack via oversized CV/JD | ✅ Fixed |
| S1 | `/api/download` + `/api/download-cover` have no auth guard; URLs in ExternalHyperlink unsanitised | ✅ Fixed |
| S3 | Real PII (phone, email) hardcoded in `src/prompts/masterCV.ts`, committed to git | ✅ Fixed — replaced with placeholders |
| N1 | `console.error("Tailor API error:", error)` could log full error object containing CV text | ✅ Fixed — logs message only |
| N2 | Rate-limit log included `userId` directly | ✅ Fixed — userId removed from log |
| N3 | `console.error("Profile extraction error:", error)` — same full-object risk | ✅ Fixed — logs message only |
| N4 | `console.log("[CVWord] ...")` debug lines in `CvPreview.tsx` printed CV content to browser console | ✅ Fixed — removed |
| RK | React duplicate-key warning in `CvPreview` `renderMixed` | ✅ Fixed — `nodeKey` counter already in place |

---

## Known gotchas

**OneDrive .next corruption** — The project lives on OneDrive. Sync corrupts `.next/`. Symptom: impossible errors, stale routes, build output that doesn't match source. Always delete `.next/` and rebuild before investigating.

**Supabase key format** — New projects issue `sb_publishable_...` (was "anon key") and `sb_secret_...` (was "service role key"). This project uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not the legacy `ANON_KEY` name) — get the value from Supabase → Project Settings → API → Project API keys.

**PostgREST ≠ SQL editor for permission testing** — `SET LOCAL ROLE authenticated` in the Supabase SQL editor does NOT replicate how PostgREST enforces roles. Column-level REVOKE tests there give wrong results. Test real permissions via DevTools console using the app's browser client and live session.

**`middleware.ts` doesn't exist — it's `proxy.ts`, Node.js runtime** — Next.js 16 uses `proxy.ts` for session-refresh middleware (not `middleware.ts`). It must run in the Node.js runtime; `@supabase/ssr` cookie handling is not compatible with the Edge runtime default. If middleware errors appear, ensure `src/proxy.ts` exports `export const runtime = 'nodejs'`.

**`getClaims()` not `getSession()` in route handlers** — `getClaims()` verifies the JWT locally (no network call). `getSession()` hits the network and can return stale data. All auth checks in Route Handlers use `getClaims()`.

**Projects keyed by index** — The projects AI step returns `{ "0": [...], "1": [...] }`. Index matches `profile.projects` order. If the user reorders or removes projects, old tailored bullets will be mismatched. Saving a new master CV clears the result.

**`MASTER_CV` is dev-only** — `src/prompts/masterCV.ts` contains the owner's real CV (and real PII). Never import it in any route or production path.

---

## Non-negotiable honesty rules (immutable)

- No invented skills, metrics, experience, or dates.
- "Currently studying" (Go, Kubernetes, Kafka, RAG, distributed-systems design) never appears as a current proficiency.
- Python is project-level — never "proficient in Python".
- Real metrics only: 25% API response, 30% SQL, 40% deploy, 15% downtime, 3 juniors, 20% defects, 8+ engineers.
- Job titles, employers, dates immutable — verbatim from master CV.

---

## Key files

| File | Purpose |
|---|---|
| `src/lib/claude.ts` | `callClaude()` — all AI calls go through here |
| `src/lib/cvStore.ts` | MasterCV + Profile CRUD against Supabase DB |
| `src/lib/supabase/client.ts` | `createBrowserClient()` for Client Components |
| `src/lib/supabase/server.ts` | `createServerClient()` for Route Handlers / Server Components |
| `src/prompts/rules.ts` | `ABSOLUTE_RULES` — injected into every prompt |
| `src/prompts/steps.ts` | All prompt templates |
| `src/app/api/tailor/route.ts` | 2-wave AI pipeline, auth-gated, rate-limited |
| `src/app/api/download/route.ts` | Word .docx generation |
| `src/app/CvPreview.tsx` | Editable CV preview + PDF/Word download |
| `proxy.ts` | Session-refresh middleware (Next.js 16 name) |
