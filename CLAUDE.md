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

> **This is Next.js 16, not 13/14.** APIs, conventions, and file structure differ from training data. Read `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.

---

## Architecture / folder structure

```
src/
  app/
    page.tsx                  ← Landing page (Server Component)
    app/
      page.tsx                ← Main tool UI (Client Component — "use client")
    CvPreview.tsx             ← In-browser CV preview + download logic
    CoverLetterPreview.tsx    ← In-browser cover letter preview + download
    api/
      tailor/route.ts         ← Main AI pipeline (2-wave parallel Claude calls)
      download/route.ts       ← Generates CV Word .docx from DOM-extracted content
      download-cover/route.ts ← Generates cover letter Word .docx
      extract-profile/route.ts← Extracts structured profile (name/contact/edu/projects) from CV text
      analyze/route.ts        ← (standalone JD analysis endpoint)
  lib/
    claude.ts                 ← callClaude() wrapper — all AI calls go through here
    cvStore.ts                ← localStorage: MasterCV + Profile types + CRUD helpers
    rateLimit.ts              ← In-memory IP rate limiter (10 req/hr per IP)
  prompts/
    rules.ts                  ← ABSOLUTE_RULES constant (the honesty contract)
    steps.ts                  ← All prompt templates (summaryPrompt, skillsPrompt, etc.)
    masterCV.ts               ← Hardcoded owner CV — DEV FALLBACK ONLY, never for production
```

### Routes

- `/` — landing page
- `/app` — the tool itself

---

## Data flow

1. User pastes master CV → `saveMasterCV()` writes to `localStorage`
2. `POST /api/extract-profile` parses the CV and extracts a `Profile` object → also saved to `localStorage`
3. User pastes JD → clicks "Tailor my CV"
4. Client sends `{ jobDescription, cvText, projectNames }` to `POST /api/tailor`
5. Server runs the 2-wave AI pipeline (see below) and returns `{ summary, skills, experience, projects, coverLetter, atsScore, analysis, research }`
6. Results render in `CvPreview` and `CoverLetterPreview` (both are `contentEditable` — user can edit inline)
7. Download: `CvPreview.downloadWord()` walks the live DOM to capture any inline edits, converts to `@@JOB@@` markers for the experience section, then POSTs to `/api/download` which builds the `.docx` file

**CV text is never stored server-side.** It lives in the user's browser and is sent per-request. This is the multi-user design — no accounts, no server-side CV storage.

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
```

That's the only required env var. No database, no auth service, no other secrets.

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

### In-memory rate limiter

`lib/rateLimit.ts` uses a `Map` in server memory. It resets on server restart and is not shared across Vercel serverless instances. It stops casual abuse but is not robust against distributed or cross-instance spamming. Don't treat it as a hard security boundary.

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
