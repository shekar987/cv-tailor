@AGENTS.md

# CV.Tailor — Claude Code Guide

## Project purpose

Jobhuntz (the codebase is still named `cv-tailor`; the product was renamed) is an honest CV tailoring tool for engineers. A user saves their master CV once on `/customize` (stored in their Supabase account), then pastes job descriptions on `/app` to get:

- A tailored CV (summary, skills, experience, projects) emphasising the most relevant real experience
- A cover letter matched to the company's tone and values
- A recruiter-search-visibility score — a deterministic keyword match against the role's terms — showing exactly which terms matched and which genuinely didn't. User-facing copy calls it "Recruiter search visibility" ("Search visibility" for short), never "ATS": the metric is how likely a recruiter searching their pipeline for the role's terms is to surface the CV, not a machine gate. Internal names (`atsScore`, `atsMatch`, CSS classes) keep the old word
- An application tracker (`/applications`) that snapshots each tailored CV they applied with, plus rows they add by hand, and a "What's working" view of which applications actually progress
- **Knockout gates** before any credit is spent: the free pre-check reads the eligibility conditions an application form screens on (right to work / sponsorship, clearance, years, location, degree, licences, contract type) off the JD and compares them with the user's own eligibility answers (`/customize`), giving one read per job — Apply / Long shot / Likely auto-rejected. Never guesses: an unanswered profile field is "unknown"
- **A claims registry** (`/customize`): each skill tagged production / project / learning; tailoring may describe a skill only at or below its level, a learning skill never appears, and every generated figure is checked against the master CV. Warns until the user confirms the registry, then blocks downloads until the flagged text is fixed
- **Quality read before sending** (`lib/quality.ts`): a page estimate from the download's own layout maths, content repeated across sections, bullets with no evidence, filler words — shown on `/app`, never blocking. **Positioning variants** (`/customize`, `lib/variants.ts`): one headline + lead skills per role family, picked per posting by role type, overridable per run. Prompt changes are measured with the evaluation harness in `eval/` (see *Evaluation harness*)

The core product promise: **nothing is invented**. Every claim in the output must trace back to the master CV verbatim. The tool will surface honest gaps rather than fabricate keywords to match a JD.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.7 (App Router) |
| UI | React 19.2.4 + TypeScript 5 |
| Styling | Vanilla CSS with design tokens in `src/app/globals.css`; Geist via `next/font`. (Tailwind was installed but never imported, so it generated nothing — removed.) |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) via Claude by default; OpenRouter / Gemini adapters in `src/lib/claude.ts` for the owner account and for users' own keys |
| Word output | `docx` v9 |
| PDF output | `jspdf`, server-side, real text layer — draws directly from the same structured content that builds the .docx, no rasterization (see `src/lib/buildCvPdf.ts`, `src/lib/buildCoverLetterPdf.ts`, `src/lib/pdfText.ts`) |
| Auth & storage | Supabase (`@supabase/ssr@0.12.0` + `@supabase/supabase-js@2.108.2`) |

> **This is Next.js 16, not 13/14.** APIs, conventions, and file structure differ from training data. Read `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.

---

## Architecture / folder structure

```
src/
  proxy.ts                    ← Session-refresh middleware entry (Next.js 16: proxy.ts, not middleware.ts). Logic lives in lib/supabase/proxy.ts
  app/
    layout.tsx                ← Root layout: Geist font, globals.css, <FeedbackWidget/>, metadataBase + OpenGraph/Twitter blocks and the "%s · Jobhuntz" title template
    icon.svg                  ← Branded favicon (amber "J"), drawn in code
    opengraph-image.tsx       ← Social-share card via next/og ImageResponse (NotoSans from lib/fonts)
    page.tsx                  ← Landing page ("use client" — scroll-reveal + count-up; nav adapts to a signed-in session)
    error.tsx / not-found.tsx ← Route-level error boundary and 404, in the auth-card style
    app/page.tsx              ← Main tool: JD → pre-check gate (keyword match, required skills, eligibility gates + read, duplicate/partial JD notices) → tailor → results + claims-check notice/highlights + Applied button; usage chip, stale-result + partial-failure notices (each auth-gated page also has a tiny layout.tsx that only exports its <title>)
    customize/page.tsx        ← Master CV (paste or upload), extracted profile fields + extracted-content summary + re-run extraction, Eligibility card, Claims registry card, section order
    settings/page.tsx         ← Account & usage card + user's own encrypted keys (OpenRouter primary — it runs tailoring; Gemini optional, not used for tailoring yet)
    applications/page.tsx     ← Application tracker: spreadsheet-style sheet, "What's working" insights card (progression by score band / eligibility read / role / company), CV/JD/Notes panels (the CV panel also shows the snapshot's search-visibility breakdown and the cover letter as sent for rows that stored them), CSV export, per-row Prep link
    applications/[id]/prep/   ← Stage 4 interview prep (the app's first dynamic route): page.tsx (states + generate/regenerate/PDF), PrepPackView.tsx (reading view with per-answer CV evidence + tracer verdicts), PracticeMode.tsx (keyboard flashcards + self-rating)
    auth/
      login/page.tsx          ← Email/password login AND signup (mode toggle) + Google/GitHub OAuth + forgot-password
      update-password/page.tsx← Set a new password after the recovery link (or while signed in)
      callback/route.ts       ← PKCE code exchange (OAuth, signup confirmation, password recovery)
      error/page.tsx          ← On-brand auth error page
    CvPreview.tsx             ← Editable CV preview; collectPayload() walks its DOM for both downloads and, via a forwardRef handle, for the Applied snapshot
    CoverLetterPreview.tsx    ← Editable cover letter preview + downloads; forwardRef handle collectText() feeds the Applied snapshot; withDateLine={false} renders a stored letter under its own first-line date (tracker)
    CvUpload.tsx              ← Drag/drop or pick a PDF/.docx/.txt → /api/parse-cv → textarea
    DownloadButton.tsx        ← "Download ▾" disclosure (PDF / Word)
    FeedbackWidget.tsx        ← Feedback card on the app routes (signed in only)
    api/
      tailor/route.ts         ← Main AI pipeline (Step 0 + 2 parallel waves) — auth-gated, DB quota + burst limit; accepts optional companyResearch (skips the synthetic research call)
      research/route.ts       ← Stage 3 company research + Fit Score: SSRF-guarded scrape → 2 model calls — auth-gated, burst limit, one tailor credit, per-user 7-day cache
      extras/route.ts         ← Research extras (pitch script / talking points / cold email) — auth-gated, burst limit, 1 call each, no DB quota; cold_email additionally gated on profiles.is_unlimited (owner-only)
      analyze/route.ts        ← JD analysis + the free pre-check: keyword + required-skill match against cvText, knockout gates compared with the body's `eligibility` (lib/knockouts), JD quality, duplicate-JD lookup via the find_applications_by_jd RPC — auth-gated, burst limit, never metered
      extract-profile/route.ts← Extracts + normalises the structured profile, plus the claims-registry seed (`skills` with evidence levels) — auth-gated, burst limit
      parse-cv/route.ts       ← Uploaded PDF/.docx → text via lib/parseCv.ts (unpdf/mammoth) — auth-gated, Node runtime
      download/route.ts       ← CV Word .docx from the DOM-extracted payload
      download-pdf/route.ts   ← CV PDF (real text layer, mirrors download/route.ts) — Node runtime
      download-cover/route.ts ← Cover letter .docx
      download-cover-pdf/route.ts ← Cover letter PDF — Node runtime
      applications/route.ts   ← Tracker CRUD (GET list / GET ?id= / POST / PUT / DELETE); POST scores the snapshot's `ats` lists server-side from the stored text (never trusts client verdicts)
      applications/export/route.ts ← Tracker CSV export (honours ?status/?from/?to)
      applications/insights/route.ts ← GET: progression rate by score band / eligibility read / role / company over the caller's rows (lib/insights); no LLM
      prep/route.ts           ← Stage 4 prep pack: free reads → cached pack (free) → resolveLlmRoute (1 tailor credit) → ONE interviewPrepPrompt call → normalize + evidence tracer → cached on applications.prep_pack; refund on throw / unusable pack
      prep-pdf/route.ts       ← Prep pack PDF (real text layer, "[traced]"/"[not traced]" as text) — Node runtime
      keys/route.ts           ← Save/delete a user's encrypted provider key
      section-order/route.ts  ← Read/write profiles.section_order
      feedback/route.ts       ← Insert-only feedback
  components/ui/              ← Thin wrappers over the globals.css classes: Button, Card, Input, Textarea,
                                 FormField, Badge, StatusText, AppHeader, EmptyState, Skeleton. Use these.
  lib/
    claude.ts                 ← callClaude() / callLLM() — every model call goes through here
    limits.ts                 ← MAX_JD_CHARS, MAX_CV_CHARS, notes/feedback/cover-letter caps, DAILY_TAILOR_LIMIT + CLAUDE_LIFETIME_LIMIT (one definition — UI and /api/tailor share these)
    usage.ts                  ← getUsage(): the signed-in user's own quota position from their profiles row; fail-soft null (consumers hide their usage UI). Powers the /app chip and the Settings account card
    profile.ts                ← Profile type + normalizeProfile() (coerces model JSON to the shape renderers assume)
    cvStore.ts                ← Master CV + profile CRUD against Supabase (browser client); also user_settings (getUserSettings / saveEligibility / saveClaims)
    workspace.ts              ← Per-user localStorage envelope: JD, result, provider, tailor session id, the text the result was tailored from + its source (jd/outreach), research
    applicationSnapshot.ts    ← Applied-button helpers: local dates, strict salary extraction, notes, second-person rewrite
    prepPack.ts               ← Stage 4 contract: normalizePrepPack (model JSON → bounded shape, ≥4/≤10 questions, gap questions never carry a story), verifyEvidence (deterministic CV-citation tracer + faithful-metrics number check), packFromRow (stored packs re-normalized on read), flattenTailoredCv, extractTalkingPoints, prepPdfFilename
    prepProgress.ts           ← Practice self-ratings per (user, application, pack generatedAt) in localStorage; swept on sign-out with the workspaces
    buildPrepPdf.ts           ← Prep pack PDF on the pdfText engine
    safeNext.ts               ← Same-origin-only `?next=` path (open-redirect guard)
    sectionOrder.ts / sections.ts ← Section order resolution; reserved section titles
    atsMatch.ts               ← THE deterministic keyword matcher (import-free, unit-tested in tests/): canonical naming variants (C#, .NET, Node.js, Postgres, k8s…), every specific token of a multi-word term within a tight window, "X and Y" = both / "X/Y" = either. Used by the pre-check gate, the post-tailor score (lib/visibilityVerdict), the tracker snapshot score and the Fit Score's hard-skill component; tailoredSectionsText() is the one text assembly they all score
    visibilityVerdict.ts      ← The post-tailor verdict, computed not written (tests/): bandFor(matched, total) = weak <50% / borderline 50–74% / ready 75%+ of the role's terms, BAND_LABELS (fixed strings), renderBandBlock() hands the settled band to the scoring prompt, reconcileAtsScore() builds the VisibilityScore from the matcher (membership, counts, band, verdict) plus the model's annotations and edits — praise is dropped from edits below "ready". Also re-derived client-side from "X/N" on /app and in the Applied notes
    companyMatch.ts           ← normalizeCompanyName() / companyNamesMatch(): the one company-name matcher — binds research to a run on /app and finds cached research in /api/prep
    seniority.ts              ← Pre-check seniority classifier (import-free, tests/): classifySeniority() reads title tokens (senior/staff/principal/lead/head of, level suffixes I/II/III), the stated minimum years, ownership language (mentoring, owning the roadmap, setting technical direction, line management, writing RFCs) and the posted annual salary band; seniorityFit() compares the level with the user's years — a mid-level read against under MID_MIN_YEARS (3) or a senior read under SENIOR_MIN_YEARS (5) is the blocking warning "This reads as mid-level — tailoring anyway will spend a credit"
    roleTitle.ts              ← coreTitle()/titleInText(): the exact role title must appear in the professional summary (highest-weighted search term); the tailor route checks the draft and retries the summary once, the harness asserts it (tests/)
    knockouts.ts              ← Knockout gates (import-free, tests/): detectGates() reads eligibility conditions off a JD with requirement/nice-to-have context, mergeModelGates() admits the analyzer's hard_gates only when quoted verbatim, compareGates() gives pass/soft/hard/unknown against the Eligibility profile (never guesses), readVerdict() = apply/long_shot/skip, jdQuality(), summarizeGates()
    claims.ts                 ← Claims registry (imports only ./atsMatch.ts, tests/): seedClaims/mergeClaims from the extraction seed, renderClaimsBlock() for every writing prompt, extractFigures() (figures with units; dates/phones/versions/classes ignored) and checkClaims() — the deterministic post-generation check run on the server AND on the edited preview; warn until confirmed, then blocking
    insights.ts               ← rowFromApplication()/computeInsights(): tracker progression rate by band (import-free, tests/); seniorityOf() (stored with every tailored save); scoreOutcome(): decided applications against their stored score, Mann-Whitney AUC, the top-N read — the "does the score predict the outcome?" panel
    quality.ts                ← estimatePages() (same line/heading arithmetic as cvDensity → the download's real length; `pages` is the stretched length the builders pick, `fitsOnePage` the honest one-page fit at the tightest spacing), onePageExpected(years) (< ONE_PAGE_MAX_YEARS = 3, from the user's own eligibility answer, never inferred), findDuplicateContent(), hasEvidence()/weakBullets(), inflationHits(), orderingSignature() for the harness (tests/)
    formatRules.ts            ← Hard post-generation formatting rules (imports only ./atsMatch.ts, tests/): capTechnicalTools() cuts the "Technical Tools:" line to MAX_TECHNICAL_TOOLS (15), keeping required-skill matches, then keyword matches, then the model's order; capSummary() cuts a summary to MAX_SUMMARY_SENTENCES (3), one per line; applyFormatRules() runs both in /api/tailor after wave 1 and reports `formatFixes` (what was dropped) for the /app notice. Drops only — never adds or rewrites
    extractionCheck.ts        ← expectedCounts()/extractionFlags(): entry-shaped lines under the CV's Projects/Education/Certifications headings vs what extraction returned (Bug C); mergeProfileEdits() keeps the user's contact fields on re-extraction (tests/)
    variants.ts               ← Positioning variants: normalizeVariants(), pickVariant() (override → role_type → lone catch-all → none, with the reason), renderVariantBlock() for the summary/skills prompts (tests/)
    fetchPage.ts              ← Stage 3 page fetcher: assertSafeUrl() SSRF guard (DNS-resolved private/metadata refusal, re-applied per redirect hop), capped bodies, regex HTML helpers
    techFingerprint.ts        ← Curated website-stack detection — labelled websiteStack, never presented as the engineering stack
    jobBoards.ts              ← Greenhouse/Lever/Ashby/Workable board discovery + free public JSON APIs; deterministic tech-keyword harvest from job ads
    fitScore.ts               ← Fit weights/tiers + reconcileFitScore() (caps the model's hard-skill score with the deterministic CV↔stack overlap)
    llmRouting.ts             ← resolveLlmRoute(): the shared quota + provider routing brain (daily RPC, lifetime RPC, Path C own-key) used by /api/tailor and /api/research
    companyResearch.ts        ← sanitizeCompanyResearch(): rebuilds client-forwarded research from typed, size-capped fields before it may enter a prompt
    markdownText.ts           ← parseBoldSegments() — the **bold** contract all three CV renderers share — and stripMarkdown() (master-CV save cleanup)
    contentBudget.ts          ← adaptive LENGTH BUDGET for the experience/projects prompts, computed from the actual master CV (fixed default on parse failure)
    cvDensity.ts / projectDate.ts / saveBlob.ts / pastePlainText.ts
    parseCv.ts                ← PDF/DOCX/TXT → text (byte sniffing, scanned-image detection)
    keyEncryption.ts          ← AES-256-GCM for users' provider keys (KEY_ENCRYPTION_SECRET)
    buildCvPdf.ts / buildCoverLetterPdf.ts / pdfText.ts ← jsPDF generators with a real text layer (NotoSans embedded from lib/fonts/)
    apiRateLimit.ts           ← Burst limiter: Upstash when configured, in-process sliding window otherwise
    supabase/
      env.ts                  ← Fail-loud readers for the two NEXT_PUBLIC_SUPABASE_* vars
      client.ts               ← createBrowserClient() — Client Components only
      server.ts               ← createServerClient() — Server Components + Route Handlers
      proxy.ts                ← updateSession() + PROTECTED_PREFIXES
  prompts/
    rules.ts                  ← ABSOLUTE_RULES constant (the honesty contract)
    steps.ts                  ← All prompt templates (summaryPrompt, skillsPrompt, etc.)
    masterCV.ts               ← Owner's CV — DEV FALLBACK ONLY, never imported by a production path
supabase/migrations/          ← Checked-in SQL (applications table, tailored_cv, company_profiles, projects_pool, prep_pack, user_settings + find_applications_by_jd, user_settings.variants …); see supabase/schema.md
tests/                        ← node:test unit suites (atsMatch, companyMatch, knockouts, claims, insights, quality, extractionCheck, variants, preferences, visibilityVerdict, formatRules) — `npm test`, zero dependencies
scripts/backfill-tracker-scores.mjs ← one-off: tracker rows saved before the snapshot carried a score get counts from the notes' reconciled "Search visibility: 13/15 keywords" line, a recomputed eligibility read and the role seniority (reads SUPABASE_SECRET_KEY from .env.local; dry run by default, --apply writes)
eval/                         ← Tailoring evaluation harness: pairs.json (5 synthetic CVs × 2 JDs), run.mjs (PAID: 10 tailors → eval/out/<label>), assert.mjs (free: the four assertions + metrics, two labels = a delta), inspect.mjs (filler words / weak bullets of a run)
```

### Routes

- `/` — landing page
- `/app` — the tool itself (requires auth — redirected to login if unauthenticated)
- `/customize` — master CV, extracted details, section order (requires auth)
- `/settings` — account & usage plus API-key management (requires auth). OpenRouter is presented as the key that runs tailoring; Gemini as optional/not used for tailoring yet — keep that framing honest if the tailor route's Path C ever changes.
- `/applications` — application tracker (requires auth)
- `/applications/[id]/prep` — interview prep pack + practice mode for one tracked application (requires auth; covered by the `/applications` prefix in `PROTECTED_PREFIXES`, so deep links round-trip through login)
- `/auth/login` — email/password login **and** signup, plus OAuth, plus "Forgot password?" (`resetPasswordForEmail`). One page with a `mode` toggle; there is no separate `/auth/signup` route.
- `/auth/callback` — PKCE code exchange for OAuth, signup confirmation and password recovery (must match the Supabase redirect allowlist)
- `/auth/update-password` — where the recovery email lands (via the callback with `?next=`); sets the new password with `updateUser`. Requires a session, so it's in `PROTECTED_PREFIXES`, and it's the one `/auth/*` path `safeNextPath()` allows as a destination.
- `/auth/error` — auth error display

Every signed-in page renders `<AppHeader>` (`src/components/ui/AppHeader.tsx`): the sticky bar with the full nav and Sign out, plus the page's `<h1>`. Don't hand-write a header.

Auth-gated pages are listed in `PROTECTED_PREFIXES` in `src/lib/supabase/proxy.ts`. Add new signed-in-only routes there so they redirect before render, rather than mounting and bouncing from the client.

---

## Data flow

1. User signs in → `src/proxy.ts` verifies the JWT and refreshes the session cookie
2. On `/customize` the user pastes or uploads their master CV → markdown syntax is cleaned by `stripMarkdown()` (shown back in the textarea) → `saveMasterCV()` writes to Supabase `master_cvs`
3. `POST /api/extract-profile` extracts a `Profile` object, `normalizeProfile()` coerces it to the expected shape → saved to `cv_profiles`. The same call returns `skills` (name + evidence level); `/customize` seeds or re-merges the **claims registry** from it (`lib/claims.ts`, stored in `user_settings.claims`) — the CV's own "currently studying" framing overrides the model's guess, confirmed levels survive re-extraction. The user's **eligibility profile** (`user_settings.eligibility`) is typed by hand on the same page and never inferred
4. On `/app` the user pastes a JD → "Tailor my CV" first runs the **pre-check gate**: `POST /api/analyze` with `cvText` (+ `eligibility`) returns Step 1's JD analysis plus, all deterministic and free: the keyword match (`lib/atsMatch.ts`, "X/15"), the required-skill match, the **knockout gates** (`lib/knockouts.ts` — detector gates plus the analyzer's verbatim-quoted `hard_gates`, each compared with the eligibility profile as pass/soft/hard/unknown) and the one-line read (apply / long_shot / skip), `jdQuality` (partial posting under 1,500 chars) and `duplicateOf` (rows with this exact JD, via the `find_applications_by_jd` RPC). The client also lists the tracker (`GET /api/applications`, free) and, when the analysis names a company, shows how many earlier rows are at that company (`companyNamesMatch`), with the last role, date and status — recruiters see every application to their company in one screen. The same call runs the **seniority classifier** (`lib/seniority.ts`: title tokens, stated minimum years, ownership language, posted salary band) against the user's years — a mid-level read under 3 years or a senior read under 5 is returned as `seniority.fits === false` and shown as the blocking warning "This reads as mid-level — tailoring anyway will spend a credit". A "skip" read or a seniority block demotes the continue button to "Tailor anyway"; nothing ever blocks
5. "Continue to full tailoring" sends `{ jobDescription, cvText, projectNames, analysis, claims }` (+ `provider` for the owner account) to `POST /api/tailor`; the gate's `analysis` is reused so Step 1 isn't paid for twice, and the registry is rendered into every writing prompt (`renderClaimsBlock`)
6. Server verifies auth via `getClaims()`, checks the daily and lifetime quotas via SECURITY DEFINER RPCs (fail-closed), then runs Step 0 + two parallel waves and returns `{ summary, skills, experience, projects, coverLetter, atsScore, analysis, research, claimCheck }` — `claimCheck` is `checkClaims()` over the finished text: figures absent from the master CV / pool, registered figures used in a different context (warning), learning skills present. The client shows it, highlights the flagged text on the previews (CSS Custom Highlight API), and in enforce mode (registry confirmed) holds Download and Applied shut until an edit passes the same check re-run client-side
7. Results render in `CvPreview` and `CoverLetterPreview` (both `contentEditable`); the JD, result and a per-run `tailorSessionId` are persisted per user in localStorage (`lib/workspace.ts`) so a reload doesn't lose them
8. Download: `CvPreview.collectPayload()` walks the live DOM to capture inline edits, converts job headers to `@@JOB@@` markers, then POSTs to `/api/download` (.docx) or `/api/download-pdf` (jsPDF, real text layer)
9. "Applied — save to tracker" POSTs the run to `/api/applications` with the text it was tailored from (the JD box for a JD run, the research brief for an outreach run), derived notes, a strict-regex salary and a `tailored_cv` snapshot: sections + profile + section order, plus `coverLetter` (the letter as it stands in the preview, date line first) and `ats` — the client sends only the role's terms (`analysis.top_15_ats_keywords` / `required_skills`) and the server scores the snapshot text against them with `lib/atsMatch`, storing the hit/miss lists with explicit `matched`/`total` counts (the denominator the insights divide by) — plus `gates`, the pre-check's eligibility read for this run (bounded server-side), and `seniority`, read off the role title (`lib/insights` `seniorityOf`), so every tailored save carries score, required-skill coverage, denominator, read and seniority. Rows saved before this were backfilled from the notes' reconciled "Search visibility: 13/15 keywords" line (`scripts/backfill-tracker-scores.mjs`; counts only, `source: "notes"`), and `/applications` shows a "Does the score predict the outcome?" panel plotting decided applications against their score with the Mann-Whitney AUC — it says so when the score has no predictive power. The CV is read from the preview via CvPreview's forwardRef handle so it captures inline edits, with the `@@JOB@@` markers converted back to plain "Role | Company | Date" lines; it falls back to the raw result if the preview isn't mounted. The session id makes a second click a no-op
10. **Interview prep (Stage 4):** the tracker's per-row "Prep" link opens `/applications/[id]/prep`. `POST /api/prep` gathers the row, the master CV, the extracted profile, any cached company research for that company name and the row's saved talking points — all free — then spends **one tailor credit** on a single `interviewPrepPrompt` call, normalizes the JSON, runs the deterministic evidence tracer against the master CV, and caches the pack on `applications.prep_pack` (re-opening is free; `force` regenerates for another credit). The page shows every STAR answer with the CV lines it was built from and a ✓/⚠ per line; practice mode drills the deck with self-ratings kept in localStorage

**CV text is stored server-side in Supabase** (`master_cvs` table, one row per user). The client reads it from DB on load and sends it per-tailor request. The app is fully multi-user — each user's CV is isolated by `user_id` and Supabase RLS.

---

## Auth & database

### Supabase clients — which to use where

| Context | Import | Why |
|---|---|---|
| Client Components | `createBrowserClient()` from `@/lib/supabase/client.ts` | Runs in browser, reads cookies directly |
| Server Components / Route Handlers | `createServerClient()` from `@/lib/supabase/server.ts` | Requires `await cookies()`; reads from request headers |
| Session-refresh middleware | `updateSession()` from `@/lib/supabase/proxy.ts` | Called by `src/proxy.ts`; refreshes session cookie on every request |

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
| `profiles` | `id` (FK → `auth.users`), `tailor_count`, `tailor_count_reset_at`, `is_unlimited`, `claude_tailors_used`, `anthropic_api_key`, `section_order` | Auto-created by trigger on signup. `authenticated` role has table-level UPDATE revoked; `anthropic_api_key` and `section_order` are re-granted column-wise. |
| `master_cvs` | `user_id`, `text`, `updated_at`, `projects_pool` | One row per user, upserted on save (unique `user_id`). The CV column is `text` — **not** `cv_text`. `projects_pool` (nullable text, migration `20260911120000`) is the Advanced-customization project pool; reads retry without it and writes hint at the migration when it's missing. |
| `cv_profiles` | `user_id`, `data`, `updated_at` | Extracted `Profile` JSON. The JSON column is `data` — **not** `profile_json`. |
| `user_api_keys` | `user_id` + `provider` (PK), `key_enc`, `key_hint`, `updated_at` | Users' own encrypted Gemini/OpenRouter keys. `provider` is CHECK-constrained. Read server-side via the `get_encrypted_key` RPC. |
| `applications` | `id`, `user_id`, `company_name`, `role`, `cv_reference`, `tailor_session_id`, `status`, `salary`, `date_applied`, `followup_date`, `notes`, `job_description`, `source`, `tailored_cv` (jsonb), `prep_pack` (jsonb), `created_at`, `updated_at` | Tracker rows. Partial unique index on `(user_id, tailor_session_id)`. `tailored_cv` holds the sections + profile + section order and, for rows saved from 2026-09-16, `coverLetter` and the server-scored `ats` lists — same jsonb, no migration; older rows simply lack the keys. `tailored_cv` (migration `20260829120000`) and `prep_pack` (migration `20260915120000`, Stage 4) are both hand-applied: the detail read walks a three-rung column ladder (both → without `prep_pack` → without either), each rung naming the migration it lacks; writes degrade with a warning. `prep_pack` is written only by `/api/prep` — never via the tracker PUT whitelist. |
| `user_feedback` | `user_id`, `email`, `message` | Insert-only for `authenticated`. |
| `company_profiles` | `user_id`, `domain`, `data` (jsonb), `fetched_at` | Stage 3 research cache, one row per (user, domain), unique on that pair, 7-day TTL enforced in the route. Deliberately per-user — a shared cache would let one user's crafted content render for another. `/api/research` degrades to uncached if the migration isn't applied. |
| `user_settings` | `user_id` (PK), `eligibility` (jsonb), `claims` (jsonb), `variants` (jsonb, migration `20260917130000`), `preferences` (jsonb, migration `20260918120000`) — reads walk a column ladder and retry without the newer columns, `updated_at` | Brief 2 (migration `20260917120000`): the eligibility profile (`lib/knockouts` `Eligibility`) and the claims registry (`lib/claims` `ClaimsRegistry`); Brief 3 added the positioning variants (`lib/variants`); `preferences` holds document switches (`lib/preferences`), first `includeRightToWorkOnCv`, default false — the Right to Work section stays off the CV document, its wording is a copy block for application forms on `/app`, and the cover letter pipeline is unchanged. Four-policy RLS, `anon` revoked. Read/written by `lib/cvStore.ts` in the browser and **sent along in request bodies** to `/api/analyze`, `/api/tailor`, `/api/extras` — the server reads no per-user tables for these, same as `projects_pool`. Missing table (`PGRST205`) degrades to "no profile / no registry"; the same migration adds the SECURITY INVOKER RPC `find_applications_by_jd` (`PGRST202` → no duplicate check). |
| `user_projects`, `user_skills` | — | Exist in the database but have **no code** referencing them since the unwired routes were removed. Safe to drop. |

Full column/constraint/RPC expectations, and how to verify them against the live project, are in `supabase/schema.md`.

**Trigger:** `handle_new_user()` — SECURITY DEFINER function, inserts a `profiles` row on every `auth.users` INSERT. Ensures the rate-limit row always exists.

### Rate limiting — two layers

| Layer | Where | What it protects | Failure mode |
|---|---|---|---|
| **Quota** (source of truth) | Postgres SECURITY DEFINER RPCs `check_and_increment_tailor_count` / `check_and_increment_claude_lifetime`, called from `/api/tailor`; `refund_tailor_count` / `refund_claude_lifetime` (migration `20260830120000_quota_refunds.sql`) give the slot back when the pipeline throws after the increment | How many tailors bill the owner's wallet. Can't be bypassed by the client. | **Fail-closed**: an RPC error, a null result, or a missing profile row → 503, never an unmetered run. Only `reason === "unlimited"` honours a client-chosen provider. The refund is best-effort: a missing refund function is logged, never surfaced. |
| **Burst** (cheap first gate) | `src/lib/apiRateLimit.ts` → `checkBurstLimit()`, called from `/api/tailor`, `/api/analyze`, `/api/extract-profile`, `/api/parse-cv`, `/api/research`, `/api/extras` | A logged-in user (or script) hammering any Claude-spending endpoint — `analyze` and `extract-profile` have no DB counter at all | Upstash Redis (shared across instances) when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set; otherwise, or on a Redis error, an **in-process sliding window** (10/min per user, per instance, resets on cold start). Never fully open. |

Any new route that calls Claude on the owner's key must call `checkBurstLimit()` first, before auth-heavy DB work or the paid LLM call.

#### Per-user quota RPC

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

The old in-memory per-IP `lib/rateLimit.ts` is gone. The in-process fallback inside `apiRateLimit.ts` is deliberately NOT a replacement for Upstash — it resets on every cold start and isn't shared across instances — it only stops the DB-counter-less routes from being completely unmetered when Redis is absent.

### Schema changes

- Migrations live in `supabase/migrations/*.sql` and are the source of truth for schema. Write the SQL file first, then apply it. The tables and functions created before this convention existed are documented in `supabase/schema.md`; `supabase/introspect.sql` dumps their live definitions so a baseline migration can be written from the real thing.
- Applied by hand in the Supabase SQL editor (this project does not run the CLI migration workflow). The Supabase MCP `apply_migration` / `execute_sql` tools hit the **live remote project** — use them only with explicit approval, and never for anything you haven't also checked into `supabase/migrations/`.
- Use `$func$` (not `$$`) as the PL/pgSQL delimiter — the SQL editor mangles plain `$$`.
- Every user-owned table gets RLS with `auth.uid() = user_id` on all four verbs, same as `applications` / `user_projects` / `user_skills`.
- PostgREST upsert `onConflict` cannot target a partial unique index — check-then-insert and catch `23505` as the backstop.

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
| Search-visibility annotation | the settled score (band, counts, present/absent terms) + tailored sections | JSON: hits, misses (annotations), edits — never a verdict or a count |

Each Promise in both waves has an independent `.catch()`. One step failing does not kill the whole response — it returns empty/null for that field.

Two deterministic pieces wrap the model calls:
- The experience/projects prompts receive an **adaptive length budget** from `lib/contentBudget.ts` — computed from how many bullets the master CV actually has vs. what two pages hold (~22 experience bullets). A CV that fits keeps every bullet; an oversized one gets per-role caps. Parse failure falls back to the fixed default text in `prompts/steps.ts`.
- **The search-visibility score is computed before wave 2, not written by the model.** The tailor route runs `lib/atsMatch` over the finished text (`tailoredSectionsText()` — the same assembly the tracker scores on Applied) for both the role's terms (`top_15_ats_keywords` → "X/15", the Matched/Missing lists) and the required skills (`required_skills` → "X/10", with its own missed list shown beside the figure — the two denominators are two term lists, never one). `lib/visibilityVerdict` turns the keyword fraction into a band — weak <50% "Weak match. Do not send as-is.", borderline 50–74% "Borderline. Fix these before sending.", ready 75%+ "Ready to send." — and `renderBandBlock()` hands that settled band to `atsScoringPrompt`, whose only job is to annotate the given lists and propose edits inside the band (exactly 2 for weak, the specific gaps for borderline, optional polish for ready). `reconcileAtsScore()` then keeps membership, counts, band and verdict from the matcher, attaches annotations by term prefix, drops any edit that reads as praise below "ready", and bounds the edit count; a failed annotation call still yields the full deterministic score. The client and the Applied notes re-derive the label from "X/N" with the same `bandFor()`. Never reintroduce a model-written assessment field: in production the old `overall_assessment` praised 3/15 as "strong" and 9/15 as "submittable" — `tests/visibilityVerdict.test.ts` asserts a 3/15 can never render those words. The matcher is deliberately conservative: an under-match is honest and actionable, an over-match is a lie on a number.

- The claims registry is **seeded deterministically from the CV** (`seedClaimsFromCv`): every skill in the skills section and in a project's tech line, `production` when the work-experience section shows it, `project` otherwise, `learning` when a "currently studying" line names it; achievement sentences are never mined for claims. Both pages seed on load when the registry is empty, so an empty registry is never the resting state, and the check is **blocking as soon as levels exist** (`claimMode` = enforce when the registry has skills; "Confirm levels" is a review). A project-only skill written into the experience section or with proficiency wording is a violation that names the claim.
- After wave 2, `checkClaims()` (`lib/claims.ts`) runs on the same text: every figure in the output (with its unit — `40%`, `£2.3m`, `150k users`; dates, phones, versions, degree classes and list numbers are ignored) must appear in the master CV or project pool, a registered figure used in a sentence sharing no content word with its source is a context warning, and any `learning` skill from the registry is flagged. The same function runs client-side on the edited preview, so "fix it and re-check" needs no model call. **Never weaken the registry's FORBIDDEN line in the prompts** — the owner-specific skill lists that used to sit in the summary/skills prompts were replaced by `renderClaimsBlock()`, which is per user.

**One verdict per screen.** The research panel's Fit Score (`lib/fitScore`, the master CV against the company's real stack) and the tailor panel's search-visibility band measured different things and once contradicted each other for the same company. `combineWithFit()` (`lib/visibilityVerdict`) makes the Fit Score authoritative: a low fit forces the verdict to "Weak fit. Company research scored N/100…", a medium fit caps "ready" at borderline, and the verdict line always names the research figure. Research applies only when it is for the run's company (`companyNamesMatch`).

**Every proper noun in the cover letter traces to a source.** `lib/properNouns` finds capitalised names in the letter (letter furniture, acronyms and sentence-initial words excluded) and checks each against the JD, the research payload and the master CV; the route asks the model to rewrite only the offending sentences (`coverLetterFixPrompt`), and drops them if a name is still unsupported. The response's `letterCheck` says what was unsupported and whether it was rewritten or dropped. The tracker metric has one name, "Search visibility:"; rows written under the old "ATS match:" label were relabelled by the backfill script.

**The exact role title is in the summary.** The gap list kept reporting the job title itself as missing ("forward deployed engineer — not actually present in the tailored text"), and it is the highest-weighted term in a recruiter's search. `summaryPrompt` takes the posting's core title (`lib/roleTitle` `coreTitle`, qualifiers stripped) as a hard constraint; the route checks the draft with `titleInText`, retries the summary once with the rejection spelled out, and returns `titleCheck { title, present, retried }`; the harness asserts it as a hard fail.

**Tailoring standards the prompts now carry** (Brief 3; `src/prompts/PROMPT_REPORT.md` is the audit they came from): bullets lead with the outcome; every bullet carries evidence (a figure, a quantified scale or a named system) or is cut; one positioning per summary; a widened filler ban list with a "search your draft and rewrite" self-check (that self-check is what actually halved the filler count — the ban list alone did nothing). `lib/quality.ts` measures the same standards deterministically on the output and the edited preview. **A bullet never ends by narrating its relevance to the employer** ("… - directly applicable to Acme's review workflows"): `BULLET_SHAPE_RULE` is a hard constraint in the experience/projects prompts, `relevanceBoltOns()` detects the shape (relevance phrases, an address to the employer or a demand verb in the trailing clause, the employer's name in it), and the tailor route runs `lintBullets()` (bolt-ons + filler) on the wave-1 draft and regenerates each flagged section **once** with the rejected bullets passed back via `rejectedBulletsBlock()`, keeping the retry only when it carries fewer flags. The response's `bulletLint` says what was retried and what remains; the harness reports `boltOns` and `retried` per run. **Two rules the prompts state are enforced in code, not trusted** (`lib/formatRules.ts`, run in the route right after wave 1 so the score and the claim check read the final text): real runs produced a 25-item Technical Tools line and a three-paragraph, ~180-word summary despite "exactly 3 lines" in the prompt. `capTechnicalTools()` keeps the 15 most JD-relevant terms (required-skill matches, then keyword matches, then the model's order — via `lib/atsMatch`, so k8s/Kubernetes count as one) and `capSummary()` keeps the first three sentences, one per line. Nothing is added or rewritten; the response's `formatFixes` lists what was dropped and `/app` shows it under "Formatting rules applied". Length: `/app` warns (not a neutral line) when the estimate exceeds one page for a user whose eligibility answer says under three years — with two honest readings, because the Word/PDF builders **deliberately stretch a short CV towards two pages** (`chooseDensity` picks the roomiest spacing that fits two): `fitsOnePage` false = cut content; true = the content would fit one page tightly and the layout is what makes it two. An unstated years figure never warns.

### Evaluation harness (`eval/`)

Run it on every prompt change; without it prompt edits are guesswork. `node eval/run.mjs <label>` is PAID (ten `/api/tailor` runs on a local server, one throwaway user per CV, ~80 Haiku calls) and stores raw results; `node eval/assert.mjs <label> [<other-label>]` is free and asserts: no figure in the output absent from the source CV (the cover letter may quote the JD's own facts), no tool in the skills line absent from the CV, within two pages, and bullet ordering differing between a CV's two JDs (run-level: two or more identical CVs of five fail — one is usually a legitimate "strongest bullet stays first"). It also reports learning-skill leaks, weak bullets, filler, letter length and run time, and prints the delta between two labels. To measure a prompt change: build with the old prompt (`git show <sha>:src/prompts/steps.ts > src/prompts/steps.ts`), run `before`, restore, rebuild, run `after`, assert both. First measurements (2026-09-17): learning leaks 5 → 2 → 1, absent figures 2 → 0, filler 15 → 18 → 9.

**Knockout gates** (`lib/knockouts.ts`) are deliberately conservative and deterministic: a `preferred` phrasing can never fail hard, a years shortfall up to `YEARS_SOFT_SHORTFALL` (2) is soft, a missing licence is soft, clearance that must be *held* is hard, and every unanswered profile field is "unknown". Location: a sentence that names one of the profile's base cities passes even when the parsed place is a street inside it ("central London near Tottenham Court Road"); a workplace named only by its city with no on-site/hybrid word ("Support Hub, Liverpool - Permanent") is a "located" gate with mode `unstated`, which can never fail hard. The analyzer's `hard_gates` are accepted only when the quoted sentence is found verbatim in the JD; the detector's own parse of the sentence always wins. Add a category by adding a detector + a `compareGate` branch + a test; never let the model's text produce a verdict directly.

**Pool mode (Advanced customization).** When the request carries `projectsPool` (the free-text pool saved on `/customize`, `master_cvs.projects_pool`, cap `MAX_POOL_CHARS`), the wave-1 projects slot runs `poolProjectsPrompt` instead: it SELECTS the 2 most relevant pool projects for this JD/stack (1 if the pool has one) and writes their bullets. `lib/poolProjects.ts` normalizes the selection at the boundary; the response gains `selectedProjects` and the client derives a **display profile** whose `projects` are the selection — CvPreview, both downloads (via `collectPayload`'s `projectsMeta`) and the Applied snapshot all read that one derivation, so pool results are self-contained (no index-keying against the stored profile). An empty/failed selection degrades to the master-CV projects plus a partial-failure notice.

### Stage 3 — company research (`/api/research`)

Paste a company URL on `/app` → the route fetches their homepage/about/careers pages through `lib/fetchPage.ts` (**every external fetch goes through `assertSafeUrl()` — never bypass it**), discovers their ATS board and pulls live job ads (`lib/jobBoards.ts`), then makes exactly two model calls: `COMPANY_PROFILE_PROMPT` and `FIT_SCORE_PROMPT`. `reconcileFitScore()` bounds the hard-skill component with the deterministic CV↔stack overlap. Order is deliberate: all free fetching happens BEFORE the quota RPCs, so an unreachable site costs no credit; the two model calls refund on throw. One research = one tailor credit, cached per (user, domain) for 7 days.

Honesty framing that must survive future edits: the website fingerprint is presented as "their website runs on" and the job-ad keywords as the engineering stack — a marketing site's tech is not the hiring stack. When the client forwards the research to `/api/tailor` as `companyResearch`, it is sanitized (`lib/companyResearch.ts`), the wave-1 synthetic research call is skipped, and rule 6 still bounds vocabulary use. **Research is bound to a company** (`lib/companyMatch.ts`): an outreach run is that company's brief and always carries it; a JD run carries it only when the pre-check read the same company off the JD; skipping the check or a JD with no detectable company carries nothing — the gate card says which happened, and the extras hint says when the tailored role is at a different company. Never inject research into a run for a company it wasn't run for. High-fit (80+) unlocks `/api/extras` (pitch script, talking points — one burst-limited call each, no DB quota). Two cold-outreach paths sit on top: **speculative mode** (a button turns the research into a transparent target brief in the JD box, so the normal pipeline tailors the CV/letter against the company's real stack with no posted job) and the **cold email draft** (`/api/extras` kind `cold_email`, owner-only via `profiles.is_unlimited`). The email follows the owner's UKJI template: subject exactly "Potential Opportunity at {Company}", interest → real-initiative paragraph → up-to-3-real-skills value line → "applying, CV and cover letter attached" close, 120-170 words, speculative when no analysis is supplied, never claims stack items the CV lacks, and the "I've been following…" history line may ONLY come from a user-typed personal note. For the owner, "Tailor CV + cover letter + cold email" auto-drafts it after a successful company tailor (fresh analysis passed explicitly — the React closure's `result` is stale at that moment); the email is best-effort and can never damage the tailor result.

### Stage 4 — interview prep (`/api/prep`)

One application row → one **prep pack**, generated by a single `interviewPrepPrompt` JSON call and cached on the row. Wallet order is research's: every free read first (row, master CV, profile, cached `company_profiles` matched by normalized company name, talking points parsed from notes), a missing JD or CV answers `400 needs_jd/needs_cv` before any metering, a cached pack returns before any metering; only then `resolveLlmRoute` spends **one tailor credit** and the call fires, refunded when it throws or when the JSON doesn't normalize (`500 bad_pack`). Cap is 10 questions with per-field word caps in the prompt (STAR fields/points ≤40 words, ≤2 evidence lines) at `maxTokens: 8000`. The budget must have headroom: on a `max_tokens` stop `callLLM` re-runs the whole call at double the budget — the first paid verification took 139 s for exactly that reason; with the caps it is ~60 s in one pass. Answer forms are per category: behavioral = STAR + evidence, technical = points + evidence, role/company = points, gap = strategy points only. `parseJsonWithRepair` slices to 6 000 chars, so an oversized pack would be "repaired" into a truncated one — another reason to keep it small. **Never set `model` on this call** — `callLLM` forwards it to OpenRouter/Gemini on the own-key path.

The honesty machinery (`lib/prepPack.ts`): `normalizePrepPack` bounds every field, drops question-less/unknown-category entries, forces `gap` questions to carry no STAR story and no evidence (they exist precisely so the pack says what the CV *can't* support), and reassigns ids. `verifyEvidence` is the deterministic tracer — an evidence line is ✓ when it is found in the master CV verbatim after normalization (bold markers, bullets, dashes, quotes and hard wraps neutralised) or as a contiguous run of ≥60% of its tokens with every number intact; separately every number in a STAR result or strategy point must exist in the CV or it is listed under "check these figures" (rule 4). The prompt tells the model the checker exists and to copy lines verbatim. Stored packs are re-normalized on every read (`packFromRow`) because a user can write their own row under RLS. The UI shows the verdicts; the PDF writes them as `[traced]`/`[not traced]` text (no ✓ glyph in the embedded font).

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

**Rate limiting:** the DB quota RPC lives only in `/api/tailor` (the expensive endpoint); the Upstash burst gate wraps every route that calls Claude. Download routes don't spend Claude credits and need neither.

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

## How to work on this project

**For anything non-trivial (new route, schema change, pipeline change, UI redesign):** understand → clarify → plan in plain English → get approval → build → verify. Don't write code while the requirement is still vague; ask the targeted question instead of assuming. For small, obvious fixes just do it.

**Look for existing code first.** Before adding a helper, a route, or a prompt, check `src/lib/`, `src/app/api/`, and `src/prompts/`. Most things you'd reach for already exist (`callClaude`, `checkBurstLimit`, `parseCvFile`, `pdfText`, the Supabase clients).

**Paid calls cost real money.** `/api/tailor`, `/api/analyze`, `/api/extract-profile`, `/api/research`, `/api/extras` and `/api/prep` spend Claude credits on the owner's key (`/api/parse-cv` is burst-limited but makes no model call). When testing locally, one run is a test; a loop is a bill. Before repeatedly re-running a paid step to debug it, ask — and prefer testing prompt changes with `expectJson`/parsing logic isolated from the live call where you can.

**Self-improvement loop.** When you hit a failure that wasn't obvious from the code — a runtime quirk, a Supabase/PostgREST behaviour, a Next.js 16 difference, an OneDrive corruption — after fixing it, add a short entry to *Known gotchas* below so the next session doesn't rediscover it. That is how every entry in that section got there.

**Don't rewrite this file's rules without asking.** Add gotchas and fix stale facts freely; changing the honesty rules, the "done" definition, or the security patterns needs the owner's say-so.

---

## Secrets & environment variables

- **Every secret lives in `.env.local`** (gitignored via `.env*` — verify this is still true before any commit). Never hardcode a key, token, or project ref in source — not temporarily, not in a comment.
- **Never log secret values.** `console.log("key:", apiKey)` is a security violation. Log presence (`!!process.env.X`) or a hint, never the value. (`user_api_keys.key_hint` exists precisely so the UI never needs the real key.)
- **Required secrets fail loudly, optional integrations fail open.** `ANTHROPIC_API_KEY` and the Supabase vars missing = throw at module top (`if (!x) throw new Error("X is not set")`). Optional infrastructure like Upstash follows the `apiRateLimit.ts` pattern instead: no-op with a one-time `console.warn`, because a monitoring/limiting outage must never take the app down.
- **When adding a new env var, do all four:** (1) add it to `.env.local` with a comment saying where to get it, (2) add it to the Vercel dashboard for **Production and Preview**, (3) add it to the list under *Commands* below, (4) tell the owner you did steps 1–3. A var present locally but missing in Vercel is the #1 cause of "works on my machine, 500s in prod".
- Third-party IDs (Supabase project ref, Upstash URL) are configuration, not code — env vars, never literals.

---

## Deploying

**Never push to `main` without explicit approval.** `main` auto-deploys to production on Vercel. After a change passes the "done" checklist locally, stop and wait for the owner to say "push it" / "deploy" / "ship it". Approval for one change does not carry over to the next.

Pre-deploy checklist:
- [ ] `npm run build` passes clean (delete `.next/` first if anything looks off — see gotchas)
- [ ] The "What done means" checklist below is satisfied — browser + Word + PDF verified
- [ ] Any new env vars are in the Vercel dashboard, not just `.env.local`
- [ ] Any new schema is in `supabase/migrations/` **and** applied to the live project
- [ ] New auth-gated pages are in `PROTECTED_PREFIXES`; new OAuth redirect URLs are in the Supabase allowlist
- [ ] Owner has explicitly approved the deploy

After deploying: confirm the Vercel deployment is `READY`, then smoke-test sign-in → tailor → Word download → PDF download on the production URL. If a step fails, read the Vercel build/runtime logs before touching code.

**When production breaks and local doesn't**, check in this order: (1) env var missing or misnamed in Vercel, (2) Supabase redirect allowlist / key name (`PUBLISHABLE_KEY`, not `ANON_KEY`), (3) a migration applied locally in the SQL editor but not to the project Vercel points at, (4) Edge vs Node runtime on a route that needs `Buffer`/cookies.

---

## MCP tools — prefer them over guessing

When these connectors are available in the session, use them instead of reasoning from memory or shelling out:

| Need | Tool |
|---|---|
| Next.js 16 / Supabase / Tailwind 4 API details | Context7 (`resolve-library-id` → `query-docs`) — complements `node_modules/next/dist/docs/` |
| Inspect live schema, RLS, indexes | Supabase `list_tables`, `execute_sql` (read-only queries) |
| Security/performance lint on the live DB | Supabase `get_advisors` — run after any schema change |
| Debug auth/DB errors in prod | Supabase `query_logs` |
| Apply a migration | Supabase `apply_migration` — **only with explicit approval**, and only for SQL already saved in `supabase/migrations/` |
| Check a deploy, read build/runtime errors | Vercel `list_deployments`, `get_deployment_build_logs`, `get_runtime_errors`, `get_runtime_logs` |

Anything that writes to the live database or triggers a deploy is an outward-facing action: say what you're about to do and get a yes first.

---

## UI & frontend rules

The app has a deliberate look — a dark, warm, amber-accented interface — and every design decision already lives as a token in `src/app/globals.css`. Use them; don't reinvent.

- **Colors come from tokens only:** `--bg`, `--surface(-2/-3/-glass)`, `--border(-strong)`, `--text` / `--text-subtle` / `--muted`, `--amber` / `--amber-bright` / `--amber-dim` / `--amber-border` / `--amber-ink`, `--success(-dim/-border)`, `--danger(-dim/-border)`, and the `--doc-*` palette for the white CV document. Never ad-hoc hex values in components or rules. If you need a new colour, add a token and derive it from the existing ones.
- **Type scale, radii, shadows, motion are tokens too:** `--text-xs…3xl`, `--leading-*`, `--tracking-*`, `--space-1…24`, `--radius-xs/sm/md/lg/pill`, `--shadow-xs/sm/md/lg/doc` (layered, not flat), `--surface-inset`, `--focus-ring`, `--ease`, `--duration-fast/--duration/--duration-slow`.
- **Fonts:** Geist via `next/font/google` in `layout.tsx`, applied through `--font-sans`. Don't add fonts through a `<link>` or CDN. There is no Tailwind in this project; it's plain CSS in `globals.css`.
- **Shared skins:** every text control (`textarea`, `.textInput`, `.authInput`, `.keyInput`, `.profileGrid input`, selects) shares one `:is()` field rule, and every button-like control shares one base with hover/active/disabled. Add a new control to those lists rather than writing a fresh skin.
- **Components first:** `<AppHeader>`, `<Card>`, `<Button>`, `<Input>`, `<Textarea>`, `<FormField>`, `<StatusText>`, `<Badge>`, `<EmptyState>`, `<Skeleton>` in `src/components/ui/`. Loading = `<Skeleton>`, not a "Loading…" sentence; empty = `<EmptyState>` inside a `<Card>`.
- **Animation:** only animate `transform` and `opacity`. Never `transition-all` (the codebase currently has zero — keep it that way). Use `var(--ease)` and `var(--duration)`.
- **Every clickable element** needs `hover`, `focus-visible`, and `active` states. No exceptions — this is a keyboard-heavy tool.
- **Depth is a layering system** (base → surface → floating), expressed with the shadow tokens and `--border`/`--border-strong`, not by everything sitting on one plane.
- **Reference image supplied?** Match its layout, spacing, typography, and colour exactly; don't "improve" it or add sections. No reference? Design from the tokens with the same restraint as the existing screens.
- **Verify visually, not just by compiling.** Run `npm run dev`, open the page, and look at it (the `/run` skill can drive the app and screenshot it). Compare against the reference or the neighbouring screens, fix mismatches, look again — at least two rounds. Be specific when comparing ("gap is 16px, should be 24px").
- **`CvPreview` / `CoverLetterPreview` are special.** They're `contentEditable`, wrapped in `React.memo`, and their DOM class names (`cvJobHeader` etc.) are parsed by `downloadWord()`. A "cosmetic" change there can silently break the Word/PDF output — re-run the download checks after touching them.

---

## Commands

```bash
npm run dev        # development server — http://localhost:3000
npm run build      # production build (also the full type check)
npm run typecheck  # tsc --noEmit — faster than a build when you only want types
npm run start      # production server (run after build)
npm run lint       # ESLint
npm test           # node:test unit suites in tests/ (explicit file list — see gotchas)
```

**Deploy:** push to `main` → Vercel auto-deploys. See *Deploying* above — never push without approval.

**Env vars (set in Vercel dashboard and `.env.local` for local dev):**

```
# Required — the app fails loudly without these
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# Required for /settings and for tailoring on a user's own key: AES-256-GCM key for
# user_api_keys.key_enc. 64 hex chars (32 bytes) — e.g. `openssl rand -hex 32`.
# Rotating it makes every saved key unreadable (users see "re-enter your key").
KEY_ENCRYPTION_SECRET=<64 hex chars>

# Optional — burst rate limiting (src/lib/apiRateLimit.ts). Absent = in-process fallback.
# Get from a free Upstash Redis DB → REST API section.
UPSTASH_REDIS_REST_URL=https://<...>.upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# Optional — owner-account provider routing (src/lib/claude.ts, /api/tailor Path A)
LLM_PROVIDER=anthropic            # anthropic | openrouter | gemini (default anthropic)
OPENROUTER_API_KEY=sk-or-v1-...   # env key for the openrouter provider
OPENROUTER_MODEL=openrouter/free  # pin a specific free model if the auto-router misbehaves
GEMINI_API_KEY=AIza...            # env key for the gemini provider
GEMINI_MODEL=gemini-2.5-flash

# Not read by the app. Present locally only for the smoke-test scripts (admin API for a
# throwaway user) — never reference it from src/.
SUPABASE_SECRET_KEY=sb_secret_...
```

The env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not the legacy `ANON_KEY` name). Its value starts `sb_publishable_...` — the new Supabase key format. The only server-side privilege escalation in the app goes through SECURITY DEFINER functions.

---

## Known gotchas

### Stale `.next` cache

If you see impossible or inconsistent behavior after a refactor (routes not updating, old code running, build errors that don't match the source), delete `.next/` and rebuild:

```bash
rm -rf .next && npm run build
```

Next.js 16's caching is aggressive. When in doubt, nuke it first.

### Fallback-leakage trap

The download routes (`/api/download`, `/api/download-cover`, `/api/download-pdf`, `/api/download-cover-pdf`) receive user data in the request body. They must **never** fall back to hardcoded owner data. The pattern to follow:

```ts
// CORRECT — missing fields render blank
const contactName = profile?.name || "";

// WRONG — leaks owner data onto other users' CVs
const contactName = profile?.name || OWNER_NAME_FALLBACK;
```

`src/prompts/masterCV.ts` contains the owner's real CV. It must never be imported in any download or tailor route. It exists only for prompt development/testing.

### PDF must have a real text layer — never rasterize it

An earlier version of this app generated PDFs by rendering the .docx with
`docx-preview`, snapshotting it with `html2canvas` into a `<canvas>`, and
dropping that canvas into the PDF as a JPEG (`src/lib/docxToPdf.ts`, removed).
The only real content in that PDF was invisible link-annotation rectangles
layered on top of a picture — **there was no text layer at all**. Every ATS
that parses a resume for text saw nothing. This shipped to production and
broke real users' job applications before it was caught.

The fix (`src/lib/buildCvPdf.ts`, `src/lib/buildCoverLetterPdf.ts`,
`src/lib/pdfText.ts`) generates the PDF server-side with `jsPDF`, drawing real
text (`doc.text(...)`) directly from the same structured content that builds
the `.docx` in `src/app/api/download/route.ts` / `download-cover/route.ts` —
not by converting rendered HTML into text. Both PDF routes
(`/api/download-pdf`, `/api/download-cover-pdf`) mirror their `.docx`
counterparts function-for-function: same density calc from `cvDensity.ts`,
same section order, same job-header/bullet/skills parsing — just drawn with
jsPDF's text APIs instead of building `docx` `Paragraph`/`TextRun` objects.

Consequences for anyone touching this:

- **Never reintroduce html2canvas/docx-preview for PDF generation.** If a
  future "PDF doesn't match Word exactly" complaint tempts you toward
  rendering-and-rasterizing again, don't — that trade (visual fidelity for a
  dead text layer) is exactly the bug described above, and it costs users
  real job applications, not just a cosmetic mismatch.
- Font is NotoSans, embedded from `src/lib/fonts/` (a real, extractable
  Unicode font; `next.config.ts` traces the files into the deployment), not
  Calibri — Calibri isn't redistributable/embeddable, and text correctness
  matters far more than matching Word's exact typeface.
- Body text and bullets are justified by `pdfText.ts`'s own line layout, to
  match the .docx's `AlignmentType.JUSTIFIED`; the skills "Label:" lines stay
  left-aligned on both sides.
- **jsPDF drops glyphs the embedded font lacks SILENTLY.** NotoSans
  Regular/Bold has no "→": a real download printed "GitHub→Vercel" as
  "GitHubVercel" — content loss with no error. `fixGlyphs()` in `pdfText.ts`
  substitutes ASCII fallbacks at the drawing choke points; extend its map
  before assuming a new symbol renders. Relatedly, never assume a date
  format: real CVs write "07/2022 to 09/2024" as readily as "Jul 2022 –
  Present", and every header/date detector (CvPreview, contentBudget,
  projectDate) must accept en-dash, "to", month-name and MM/YYYY forms —
  an unrecognised format used to blank the preview's whole Experience
  section.
- **Any change to the PDF generators must be verified by actually extracting
  text back out of the generated PDF** (e.g. via `unpdf`, already a
  dependency, used elsewhere for parsing uploaded resumes) and confirming the
  real content comes back — not just that the code compiles or "looks right"
  visually. That check is what would have caught the original bug
  immediately, and its absence is why it shipped.

### The @@JOB@@ marker system

The experience section goes through a two-step rendering pipeline:

1. Claude outputs experience as plain text: `Role Title | Employer | June 2024 – Present`
2. `CvPreview` renders this as `<p class="cvJobHeader">` elements (role left, date right)
3. When the user clicks "Download Word", `CvPreview.downloadWord()` walks the live DOM and converts each `cvJobHeader` element into `@@JOB@@<role>@@<date>` — this captures any inline edits the user made
4. `/api/download` receives this string and `textToParagraphs()` parses the `@@JOB@@` markers into bold, tab-aligned Word paragraphs

**If you change the experience format or the DOM class names, you must update all three sides** — `CvPreview.collectPayload()` (the emitter), `textToParagraphs()` in the download route and `drawTextBlock()` in `buildCvPdf.ts` (the parsers). A mismatch will silently produce plain-text job headers in the output instead of the formatted bold version. The emitter strips a literal `@@` from role/date text so an inline edit can't corrupt the marker.

### The **bold** contract

`**span**` (multi-word allowed) is how bold travels between the pipeline and
the renderers. `lib/markdownText.ts#parseBoldSegments` is the ONE parser: the
preview renders spans as `<strong>` (renderInline) and `collectPayload()`
reads them back to `**…**` (readInline), while `buildRuns` (docx) and
`parseWords` (PDF) build real bold runs from the same segments. Touch any of
the three and keep them in lockstep — and never "clean" `**` out of a
renderer again: stripping it in the preview silently flattened bold for every
download, because the DOM read IS the wire. A markdown-formatted master CV is
a separate concern: that is cleaned once, at save time, by `stripMarkdown`
on /customize.

### Projects are keyed by index, not name

The projects AI step returns `{ "0": [...bullets], "1": [...] }`. The index corresponds to the order of `profile.projects` (extracted from the master CV). If a user's projects change order or count, old tailored project bullets will be mismatched. Saving a new master CV on `/customize` clears the tailored result in the workspace for that reason. In the preview, each project wrapper carries `data-proj-index` and `collectPayload()` matches on it — never on DOM position, which a stray `<div>` from contentEditable would shift. `normalizeProfile()` deliberately never filters projects out for the same reason.

### Dynamic route segments: `params` is a Promise, and `.next/types` goes stale

`/applications/[id]/prep` is the app's first dynamic segment. In Next 16 a page's `params` prop is a `Promise` — a client page reads it with `use(params)` from React, not by destructuring. After adding a new route, `npm run typecheck` can fail inside `.next/dev/types/validator.ts` with "Type '"/applications/[id]/prep"' is not assignable to type 'LayoutRoutes'": the dev server regenerated `.next/dev/types` but the last production build's `.next/types` predates the route. `npm run build` (or deleting `.next/`) regenerates it; the app source is fine.

### Rate limiting is two layers, and one of them is optional

The DB quota RPC (fail-closed, `/api/tailor` only) and the Upstash burst gate (fail-open, every Claude-spending route) are different things — see *Rate limiting — two layers*. If burst limiting "isn't working", the first check is whether `UPSTASH_REDIS_REST_URL`/`TOKEN` are set in that environment; a one-time `[apiRateLimit] … DISABLED` warning in the logs is the tell. The old in-memory per-IP limiter is gone — don't recreate it.

### OneDrive .next corruption

The project lives on OneDrive. OneDrive's sync process corrupts `.next/` — symptoms include impossible TypeScript errors, stale routes running after edits, or build outputs that don't match the source. Delete `.next/` and rebuild before investigating any such anomaly.

### Supabase key format changed

Supabase projects now issue `sb_publishable_...` (formerly "anon key") and `sb_secret_...` (formerly "service role key"). The env var in this project is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — note it is NOT the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` name. If you see auth failures after a project reset or key rotation, check the env var name and value both.

### proxy.ts runs in the Node.js runtime — and must NOT declare it

In Next.js 16 the proxy file (`src/proxy.ts`, formerly middleware.ts) runs on the Node.js runtime by default, which is what `@supabase/ssr`'s cookie handling needs. **Do not add `export const runtime = 'nodejs'` to it** — per `node_modules/next/dist/docs/.../proxy.md`, setting the `runtime` option in a proxy file throws at build time. (An earlier version of this note said the opposite.) `next.config.ts` must not force Edge globally either.

### PostgREST resolves an RPC by its argument names

`POST /rest/v1/rpc/<fn>` with the wrong parameter set (or an empty body for a function that has parameters) returns `PGRST202 "Could not find the function"` — which looks exactly like the function not existing. When probing whether an RPC exists, send the real argument names (a zero UUID is safe for the counters: they answer `profile_not_found`/`forbidden` without touching anyone's quota).

### Supabase function grants: revoking from PUBLIC alone is not enough

On Supabase, a newly created function gets EXECUTE granted to `anon`,
`authenticated` and `service_role` **explicitly** via default privileges — not
only through the `PUBLIC` pseudo-role. `revoke ... from public` therefore
still leaves `anon` able to call the RPC over `/rest/v1/rpc/*`. Revoke
`from public, anon` by name (compare `20260830120000_quota_refunds.sql`,
which shipped without `anon` and needed `20260831150000` to close it —
`get_advisors` is what caught it).

Corollary in the other direction: a column-level SELECT revoke can break
WRITES. PostgREST's upsert (`resolution=merge-duplicates`) emits
`ON CONFLICT … DO UPDATE SET col = excluded.col` for every supplied column,
and Postgres requires SELECT privilege on any column read through
`excluded.*` — so revoking SELECT on a column the app upserts fails the whole
save with 42501, even though the app never reads that column back. Revoking
SELECT(key_enc) on `user_api_keys` broke `/api/keys` exactly this way
(`20260831140000`, withdrawn by `20260831160000`). Test grant changes with a
real authenticated request through PostgREST, not by reasoning about reads.

### Migrations are manual, so the code tolerates a missing column

`applications.tailored_cv` was added in a second migration. Until it's applied, PostgREST reports the column as `PGRST204` on writes and Postgres as `42703` on reads. `/api/applications` handles both: it inserts without the snapshot (returning a `warning` the UI shows) and reads the row without it. Follow that pattern for any future additive column — the alternative is a tracker that stops working entirely because one statement wasn't pasted into the SQL editor.

### Testing the API without a browser

`SUPABASE_SECRET_KEY` (in `.env.local`, never read by `src/`) lets a local script create a throwaway user through the auth admin API, sign in with the password grant, and build the `sb-<ref>-auth-token` cookie the way `@supabase/ssr` does (`"base64-"` + base64url JSON, chunked at 3180 chars into `.0`, `.1`…). With that cookie every route can be exercised end to end against `npm run dev`, including extracting text back out of the generated PDFs with `unpdf`. Skip the tailor/analyze/extract-profile bodies that would reach a model — test their guards only.

### Unit tests: node:test, explicit files, no `@/` in tested modules

`npm test` runs `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/atsMatch.test.ts tests/companyMatch.test.ts` — Node's own runner with type stripping, zero dependencies. Three things bite: (1) the file list must be explicit — a directory or glob argument silently reports `tests 0` and passes; add every new suite to the script; (2) imports inside `tests/` need the `.ts` extension (`tsconfig` has `allowImportingTsExtensions` for this; legal because `noEmit` is on); (3) Node resolves no `@/` alias, so a module under test must import nothing through it — `lib/atsMatch.ts` and `lib/companyMatch.ts` are import-free on purpose. The warning flag silences the "module type not specified" reparse notice for a package without `"type"`.

### A 15k-character filter can't ride in a PostgREST URL

`.eq("job_description", jd)` puts the value in the query string, and a real JD blows the gateway's URL/header limits. Exact-match lookups on long text go through an RPC with the value in the POST body — `find_applications_by_jd` is SECURITY INVOKER so RLS still applies (plus an explicit `user_id = auth.uid()`). Same reason the research route posts URLs rather than filtering on them.

### Turbopack's CSS parser rejects `::highlight()`

A `::highlight(name) { … }` rule in `globals.css` makes `next build` print "Parsing CSS source code failed" as a warning. The claim-check highlight rule is therefore injected at runtime from `app/page.tsx` (a `<style>` element, created only when `CSS.highlights` exists). Keep it that way until Turbopack's parser learns the pseudo-element.

### `lib/claims.ts` imports `./atsMatch.ts` with the extension

Node's test runner needs the `.ts` extension on a relative import (`allowImportingTsExtensions` makes it legal), and Turbopack resolves the explicit path fine in `next build`. Keep tested modules importing each other only this way — an `@/` alias breaks `npm test`.

### Test Postgres permissions via PostgREST, not the SQL editor

`SET LOCAL ROLE authenticated` in the Supabase SQL editor does NOT replicate how PostgREST enforces the role. Column-level REVOKE tests run there will show the wrong result. The only authoritative test is a real browser request using the app's session cookie. Use DevTools → console with `createBrowserClient()` and attempt the operation directly.

---

## What "done" means

A change is done when it is **verified in the browser, the Word download, and the PDF download** — not just when it compiles.

Checklist:
- [ ] The preview renders correctly in the browser (check Experience job headers, project bullets, contact info)
- [ ] The Word download opens in Word/LibreOffice and formatting matches: bold job headers with date right-aligned, bullet points, section headings in navy
- [ ] The PDF download has a **real, selectable, extractable text layer** — never just "looks right." Confirm by selecting/copying text in a PDF viewer, or by extracting text back out programmatically (`unpdf`, already a dependency). This is non-negotiable: an earlier version of this app shipped a PDF pipeline that looked correct on screen but was actually a JPEG with no text layer, invisible to every ATS — see "PDF must have a real text layer" above.
- [ ] Inline edits (name, experience text, etc.) made in the contentEditable preview are preserved in both the Word and PDF downloads
- [ ] No content from one user bleeds into another user's output (profile fields, CV text)
- [ ] UI changes were looked at in the running app and compared against the reference / neighbouring screens (see *UI & frontend rules*) — not just compiled
- [ ] New env vars are documented under *Commands* and added to Vercel; new SQL is in `supabase/migrations/` and `supabase/schema.md` is updated
- [ ] Type check passes (`npm run typecheck`, and `npm run build` before a deploy)

TypeScript compiling and ESLint passing are necessary but not sufficient. Feature correctness means verifying the actual output — browser + Word + PDF. For the PDF specifically, "looks right on screen" is not sufficient either — extract the text and check it, every time.
