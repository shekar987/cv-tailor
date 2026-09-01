# Jobhuntz (formerly CV.Tailor) — Project Status

## What this is

Honest, ATS-aware CV tailoring tool. Next.js 16 + TypeScript + vanilla CSS tokens + Supabase Auth + Anthropic API (OpenRouter/Gemini adapters for the owner account and users' own keys).
Deployed: https://www.jobhuntz.app (every `*.vercel.app` host 308-redirects there — see `next.config.ts`) | Repo: github.com/shekar987/cv-tailor
Owner: Soma Shekar Keesari, London.

> `CLAUDE.md` is the maintained guide. This file is a status log; where the two disagree, trust `CLAUDE.md` and the code.
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
  claude_tailors_used    int   — lifetime free-Claude counter
  is_unlimited           bool  — owner account; set manually
  anthropic_api_key      text  — column-level UPDATE re-granted to authenticated
  section_order          jsonb — the user's CV section order (null = default)

master_cvs
  user_id      uuid  FK → auth.users (unique)
  text         text  — NOT cv_text
  updated_at   timestamptz

cv_profiles
  user_id      uuid  FK → auth.users (unique)
  data         jsonb — serialised Profile object; NOT profile_json
  updated_at   timestamptz

user_api_keys        (user_id, provider) PK; key_enc, key_hint, updated_at
applications         tracker rows — see supabase/migrations/ and supabase/schema.md
user_feedback        user_id, email, message (insert-only)
user_projects, user_skills   present in the DB, unused by the code (routes removed)
```

**Trigger:** `handle_new_user()` (SECURITY DEFINER) inserts a `profiles` row on every `auth.users` INSERT.

**RPCs:** `check_and_increment_tailor_count(uid, daily_limit, window_seconds)` → `{ allowed, reason, reset_at }`; `check_and_increment_claude_lifetime(uid, lifetime_limit)` → `{ reason }`; `get_encrypted_key(p_user_id, p_provider)` → ciphertext or null. All SECURITY DEFINER with `FOR UPDATE` row locks on the counters.

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

**`middleware.ts` doesn't exist — it's `src/proxy.ts`, Node.js runtime** — Next.js 16 uses `proxy.ts` for session-refresh middleware (not `middleware.ts`), and it runs on Node.js by default, which `@supabase/ssr` needs. Do NOT add `export const runtime = 'nodejs'` to it — Next 16 throws on a `runtime` option in a proxy file.

**`getClaims()` not `getSession()` in route handlers** — `getClaims()` verifies the JWT locally (no network call). `getSession()` hits the network and can return stale data. All auth checks in Route Handlers use `getClaims()`.

**Projects keyed by index** — The projects AI step returns `{ "0": [...], "1": [...] }`. Index matches `profile.projects` order. If the user reorders or removes projects, old tailored bullets will be mismatched. Saving a new master CV clears the result.

**`MASTER_CV` is dev-only** — `src/prompts/masterCV.ts` contains the owner's CV (name and public links; phone/email were replaced with placeholders in S3). Never import it in any route or production path.

---

## Stage 2 (application tracker) + audit pass — on branch `stage-2-application-tracker`, not yet on `main`

- `/applications`: spreadsheet-style tracker (inline cell editing, status funnel, Today/This week/This month filter, CSV export honouring the filters, CV/JD/Notes panels, stacked cards under 900px).
- "Applied — save to tracker" on `/app` snapshots the run (JD, derived notes, strict-regex salary, the tailored CV with profile + section order) keyed by a per-run session id (no duplicate rows on a second click).
- Migrations checked in for the first time: `supabase/migrations/20260826120000_create_applications.sql`, `20260829120000_applications_tailored_cv.sql` (the second must be applied by hand; the routes degrade until it is).
- Full audit + fixes: login open redirect closed; quotas fail closed; every route guards its input; download routes no longer crash on non-Latin names; profile JSON normalised; design-system refresh (Geist applied, shared header, one field/button skin, Tailwind removed). See the commit messages on the branch.
- `PROJECT_STATUS.md` `cv_text` / `profile_json` column names were wrong for a long time — corrected above.

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
| `src/app/applications/page.tsx` + `src/app/api/applications/` | Application tracker page and CRUD/export routes |
| `src/components/ui/` | Button, Card, Input, Textarea, FormField, Badge, StatusText, AppHeader, EmptyState, Skeleton |
| `src/proxy.ts` → `src/lib/supabase/proxy.ts` | Session-refresh middleware + PROTECTED_PREFIXES (Next.js 16 name) |
