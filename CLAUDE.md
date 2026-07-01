@AGENTS.md

# CV.Tailor — Claude Code Guide

## Project purpose

CV.Tailor is an honest CV tailoring tool for engineers. A user pastes their master CV once (stored in their browser), then pastes job descriptions to get:

- A tailored CV (summary, skills, experience, projects) emphasising the most relevant real experience
- A cover letter matched to the company's tone and values
- An ATS keyword score showing exactly which keywords matched and which genuinely didn't

The core product promise: **nothing is invented**. Every claim in the output must trace back to the master CV verbatim. The tool will surface honest gaps rather than fabricate keywords to match a JD.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.7 (App Router) |
| UI | React 19.2.4 + TypeScript 5 |
| Styling | Tailwind CSS 4 |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) via Claude |
| Word output | `docx` v9 |
| PDF output | `html2pdf.js` (DOM capture, client-side) |
| Auth & storage | Supabase (`@supabase/ssr@0.12.0` + `@supabase/supabase-js@2.108.2`) |

> **This is Next.js 16, not 13/14.** APIs, conventions, and file structure differ from training data. Read `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.

---

## Architecture / folder structure

```
src/
  app/
    page.tsx                  ← Landing page (Server Component)
    app/
      page.tsx                ← Main tool UI (Client Component — "use client")
    auth/
      login/page.tsx          ← Email/password login + Google/GitHub OAuth buttons
      signup/page.tsx         ← Email/password registration
      callback/route.ts       ← OAuth exchange handler (PKCE)
      error/page.tsx          ← On-brand auth error page
    CvPreview.tsx             ← In-browser CV preview + download logic
    CoverLetterPreview.tsx    ← In-browser cover letter preview + download
    api/
      tailor/route.ts         ← Main AI pipeline (2-wave parallel Claude calls) — auth-gated
      download/route.ts       ← Generates CV Word .docx from DOM-extracted content
      download-cover/route.ts ← Generates cover letter Word .docx
      extract-profile/route.ts← Extracts structured profile (name/contact/edu/projects) — auth-gated
      analyze/route.ts        ← Standalone JD analysis endpoint — auth-gated
  lib/
    claude.ts                 ← callClaude() wrapper — all AI calls go through here
    cvStore.ts                ← MasterCV + Profile CRUD — reads/writes Supabase DB (was localStorage)
    rateLimit.ts              ← DEPRECATED — replaced by SECURITY DEFINER RPC; do not use
    supabase/
      client.ts               ← createBrowserClient() — use in Client Components only
      server.ts               ← createServerClient() — use in Server Components + Route Handlers
  prompts/
    rules.ts                  ← ABSOLUTE_RULES constant (the honesty contract)
    steps.ts                  ← All prompt templates (summaryPrompt, skillsPrompt, etc.)
    masterCV.ts               ← Hardcoded owner CV — DEV FALLBACK ONLY, never for production
proxy.ts                      ← Session-refresh middleware (Next.js 16: named proxy.ts, not middleware.ts)
```

### Routes

- `/` — landing page
- `/app` — the tool itself (requires auth — redirected to login if unauthenticated)
- `/auth/login` — email/password login + OAuth
- `/auth/signup` — email/password registration
- `/auth/callback` — OAuth PKCE exchange (must match Supabase redirect allowlist)
- `/auth/error` — auth error display

---

## Data flow

1. User signs in → `proxy.ts` verifies the JWT and refreshes the session cookie
2. User pastes master CV → `saveMasterCV()` writes to Supabase `master_cvs` table
3. `POST /api/extract-profile` parses the CV and extracts a `Profile` object → saved to `cv_profiles` table
4. User pastes JD → clicks "Tailor my CV"
5. Client sends `{ jobDescription, cvText, projectNames }` to `POST /api/tailor`
6. Server verifies auth via `getClaims()`, checks per-user rate limit via SECURITY DEFINER RPC, then runs the 2-wave AI pipeline and returns `{ summary, skills, experience, projects, coverLetter, atsScore, analysis, research }`
7. Results render in `CvPreview` and `CoverLetterPreview` (both are `contentEditable` — user can edit inline)
8. Download: `CvPreview.downloadWord()` walks the live DOM to capture any inline edits, converts to `@@JOB@@` markers for the experience section, then POSTs to `/api/download` which builds the `.docx` file

**CV text is stored server-side in Supabase** (`master_cvs` table, one row per user). The client reads it from DB on load and sends it per-tailor request. The app is fully multi-user — each user's CV is isolated by `user_id` and Supabase RLS.

---

## Auth & database

### Supabase clients — which to use where

| Context | Import | Why |
|---|---|---|
| Client Components | `createBrowserClient()` from `@/lib/supabase/client.ts` | Runs in browser, reads cookies directly |
| Server Components / Route Handlers | `createServerClient()` from `@/lib/supabase/server.ts` | Requires `await cookies()`; reads from request headers |

**Auth verification in Route Handlers: always use `getClaims()`.** It verifies the JWT locally (no network call) and returns `claims.sub` as the user ID. Never use `getSession()` in server contexts — it makes a network round-trip and can return stale data.

```ts
const supabase = await createClient();
const { data, error } = await supabase.auth.getClaims();
if (error || !data?.claims?.sub) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
const userId = data.claims.sub as string;
```

### Database schema

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (FK → `auth.users`), `tailor_count`, `tailor_count_reset_at`, `is_unlimited`, `anthropic_api_key` | Auto-created by trigger on signup. `authenticated` role has table-level UPDATE revoked; only `anthropic_api_key` column is re-granted. |
| `master_cvs` | `user_id`, `cv_text`, `updated_at` | One row per user, upserted on save. |
| `cv_profiles` | `user_id`, `profile_json`, `updated_at` | Extracted `Profile` JSON (name/contact/edu/projects). |

**Trigger:** `handle_new_user()` — SECURITY DEFINER function, inserts a `profiles` row on every `auth.users` INSERT. Ensures the rate-limit row always exists.

### Per-user rate limiting

Implemented as a SECURITY DEFINER Postgres function `check_and_increment_tailor_count`. It:
- Acquires a `FOR UPDATE` row lock to prevent race conditions
- Resets `tailor_count` when `tailor_count_reset_at` is in the past
- Returns `{ allowed: bool, reason: string, reset_at: timestamp }`

Called via `supabase.rpc("check_and_increment_tailor_count", { uid, daily_limit, window_seconds })`.

The `authenticated` role cannot write `tailor_count`, `tailor_count_reset_at`, or `is_unlimited` directly — the B2 SQL migration revoked table-level UPDATE and re-granted only `anthropic_api_key`:
```sql
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (anthropic_api_key) ON profiles TO authenticated;
```

`lib/rateLimit.ts` (in-memory, per-IP) is now dead code — do not use it.

---

## AI pipeline (`/api/tailor`)

### Wave 1 — parallel

All fired after the initial JD analysis completes:

| Step | Prompt | Output |
|---|---|---|
| JD analysis | `JD_ANALYZER_PROMPT` | JSON: role, skills, keywords, tone |
| Company research | `COMPANY_RESEARCH_PROMPT` | JSON: hooks, values, cautions |
| Summary | `summaryPrompt(cv)` | Plain text, 3 lines |
| Skills | `skillsPrompt(cv)` | Plain text, 1–2 lines |
| Experience | `experiencePrompt(cv)` | Plain text, role headers + bullets |
| Projects | `projectsPrompt(cv, names)` | JSON: `{ "0": [...bullets], "1": [...] }` |

### Wave 2 — parallel, after Wave 1

| Step | Input | Output |
|---|---|---|
| Cover letter | analysis + research | Plain text, ≤400 words |
| ATS score | analysis + tailored sections | JSON: hits, misses, recommendations |

Each Promise in both waves has an independent `.catch()`. One step failing does not kill the whole response — it returns empty/null for that field.

### Models

- Default: `claude-haiku-4-5-20251001` (fast, cheap — used for all steps)
- Available: `claude-sonnet-4-6` (higher quality — override per step via `model` option in `callClaude`)
- Change the model in `callClaude()` options, not in `lib/claude.ts` defaults, unless the change should apply globally

---

## Non-negotiable honesty rules

These are in `src/prompts/rules.ts` as `ABSOLUTE_RULES` and are injected into every prompt. They must never be weakened, removed, or worked around:

1. **No invention.** Never add skills, experiences, achievements, technologies, metrics, or dates not in the master CV.
2. **No "(Learning)" tags.** Omit a skill entirely rather than hedge it. Hedges are still lies.
3. **Strict output format.** Each step must produce its stated format — no prose wrapping JSON, no JSON wrapping prose.
4. **Faithful metrics.** Exact numbers only. Never round, combine, inflate, or invent figures.
5. **Adjacent skill framing — bounded.** You may surface a related genuine skill as the nearest match. You may NOT import JD terminology to describe work the candidate didn't do.
6. **Never graft JD vocabulary.** If the JD says "multi-tenant", "idempotent", "payment processing" — only use those words if the master CV shows exactly that work.
7. **Never merge projects.** Each project's tech and outcomes stay with that project. No cross-attribution.
8. **Job titles, employers, dates are immutable.** Verbatim from the master CV.
9. **The interview test.** If a claim couldn't be defended in an interview using only the master CV, don't make it.

These rules apply to prompts, to AI output validation, and to any code that post-processes AI output. The ATS scorer also follows them — it never recommends adding skills the candidate lacks.

---

## Patterns to follow

**All Claude calls go through `callClaude()`** in `lib/claude.ts`. Never call the Anthropic SDK directly in route files.

**`expectJson: true`** for any step that returns structured data. `callClaude` strips markdown fences and throws if JSON is invalid.

**Each parallel step must `.catch()`** to a sensible empty value so partial failures degrade gracefully:
```ts
callClaude({ ... }).catch(() => "")     // prose steps
callClaude({ ... }).catch(() => ({}))   // JSON steps
callClaude({ ... }).catch(() => null)   // nullable steps (atsScore)
```

**Rate limiting** lives only in `/api/tailor` (the expensive endpoint). Download and extract-profile endpoints don't need it.

**Profile in request body, always.** The download routes receive `profile` in the POST body. They use it exclusively. If a field is missing, it renders blank. See the fallback-leakage trap below.

**`MASTER_CV` is dev-only.** The hardcoded CV in `src/prompts/masterCV.ts` is a fallback for local prompt testing only. Production always receives `cvText` from the client. Never reference `MASTER_CV` in a production code path.

**`React.memo` on `CvPreview`** exists specifically to prevent `contentEditable` from being reset by parent re-renders (e.g. the user typing in the JD box). Don't remove it.

---

## Anti-patterns

**Don't add libraries for small problems.** If the standard library or a 10-line function solves it, use that.

**Don't swallow errors.** The top-level catch in each route logs the error and returns a structured error JSON. Inner `.catch()` on individual Promise.all steps return empty values only — they don't silently hide problems from the user.

**Don't add "just in case" features.** No feature flags, no hypothetical future paths, no `// might need this later` code.

**Push back on bad ideas.** If a requested change would weaken the honesty rules, introduce fallback leakage, or add complexity that doesn't serve users — say so explicitly before implementing.

**Don't add error handling for scenarios that can't happen.** Trust the TypeScript types and framework. Only validate at system boundaries (user input, Claude API response parsing).

---

## Commands

```bash
npm run dev       # development server — http://localhost:3000
npm run build     # production build
npm run start     # production server (run after build)
npm run lint      # ESLint
```

**Deploy:** push to `main` → Vercel auto-deploys.

**Env vars required (set in Vercel dashboard and `.env.local` for local dev):**

```
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

The Supabase anon key now uses the `sb_publishable_...` format (previously called "anon key"). The service role key (`sb_secret_...`) is not used by the app — the only server-side privilege escalation goes through SECURITY DEFINER functions.

---

## Known gotchas

### Stale `.next` cache

If you see impossible or inconsistent behavior after a refactor (routes not updating, old code running, build errors that don't match the source), delete `.next/` and rebuild:

```bash
rm -rf .next && npm run build
```

Next.js 16's caching is aggressive. When in doubt, nuke it first.

### Fallback-leakage trap

The download routes (`/api/download`, `/api/download-cover`) receive user data in the request body. They must **never** fall back to hardcoded owner data. The pattern to follow:

```ts
// CORRECT — missing fields render blank
const contactName = profile?.name || "";

// WRONG — leaks owner data onto other users' CVs
const contactName = profile?.name || OWNER_NAME_FALLBACK;
```

`src/prompts/masterCV.ts` contains the owner's real CV. It must never be imported in any download or tailor route. It exists only for prompt development/testing.

### The @@JOB@@ marker system

The experience section goes through a two-step rendering pipeline:

1. Claude outputs experience as plain text: `Role Title | Employer | June 2024 – Present`
2. `CvPreview` renders this as `<p class="cvJobHeader">` elements (role left, date right)
3. When the user clicks "Download Word", `CvPreview.downloadWord()` walks the live DOM and converts each `cvJobHeader` element into `@@JOB@@<role>@@<date>` — this captures any inline edits the user made
4. `/api/download` receives this string and `textToParagraphs()` parses the `@@JOB@@` markers into bold, tab-aligned Word paragraphs

**If you change the experience format or the DOM class names, you must update both sides** — `CvPreview.downloadWord()` (the emitter) and `textToParagraphs()` in the download route (the parser). A mismatch will silently produce plain-text job headers in the Word output instead of the formatted bold version.

### Projects are keyed by index, not name

The projects AI step returns `{ "0": [...bullets], "1": [...] }`. The index corresponds to the order of `profile.projects` (extracted from the master CV). If a user's projects change order or count, old tailored project bullets will be mismatched. This is acceptable in the current browser-only design — saving a new master CV clears the old tailoring result.

### Rate limiter is now in Supabase, not memory

`lib/rateLimit.ts` is dead code — do not call it. Rate limiting moved to a SECURITY DEFINER Postgres function (see Auth & database section). The old in-memory `Map` would reset on every serverless cold start and wasn't shared across instances anyway.

### OneDrive .next corruption

The project lives on OneDrive. OneDrive's sync process corrupts `.next/` — symptoms include impossible TypeScript errors, stale routes running after edits, or build outputs that don't match the source. Delete `.next/` and rebuild before investigating any such anomaly.

### Supabase key format changed

Supabase projects now issue `sb_publishable_...` (formerly "anon key") and `sb_secret_...` (formerly "service role key"). The env var name stays `NEXT_PUBLIC_SUPABASE_ANON_KEY` but the value now starts with `sb_publishable_`. If you see auth failures after a project reset or key rotation, check this first.

### Test Postgres permissions via PostgREST, not the SQL editor

`SET LOCAL ROLE authenticated` in the Supabase SQL editor does NOT replicate how PostgREST enforces the role. Column-level REVOKE tests run there will show the wrong result. The only authoritative test is a real browser request using the app's session cookie. Use DevTools → console with `createBrowserClient()` and attempt the operation directly.

---

## What "done" means

A change is done when it is **verified in the browser and the Word download** — not just when it compiles.

Checklist:
- [ ] The preview renders correctly in the browser (check Experience job headers, project bullets, contact info)
- [ ] The Word download opens in Word/LibreOffice and formatting matches: bold job headers with date right-aligned, bullet points, section headings in navy
- [ ] Inline edits (name, experience text, etc.) made in the contentEditable preview are preserved in the Word download
- [ ] No content from one user bleeds into another user's output (profile fields, CV text)
- [ ] Type check passes (`npm run build`)

TypeScript compiling and ESLint passing are necessary but not sufficient. Feature correctness means verifying the actual output — browser + Word.
