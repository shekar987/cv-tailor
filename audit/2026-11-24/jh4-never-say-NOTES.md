# JH-4 — never-say guard: verification notes (24 Nov 2026)

Saved here under `cv-tailor\audit\2026-11-24\` because the chunk's target path
`RTS\jobhuntz-audit\...` is outside this session's sandbox (the sandbox is `cv-tailor` only).

## Screenshots: NOT captured — environment cannot, and the ban applies

The chunk's "Done when" asks for a new-user browser walkthrough at 375 px and 1280 px, with
`jh4-never-say-mobile.png` / `jh4-never-say-desktop.png`. I could not produce these:

- **No browser automation in this sandbox.** `PLAYWRIGHT_PATH` is unset in `.env.local`, and
  neither `playwright`, `playwright-core` nor `puppeteer` is installed. The repo's e2e scripts
  all drive an **external** Edge via `PLAYWRIGHT_PATH`. Installing a browser stack
  (`npx playwright install`, ~100 MB) is not something I should do unattended on an overnight run.
- **A real tailor needs a model call**, which the run's rules forbid (no paid APIs). The free
  stand-in `scripts/mock-model.mjs` exists, but a full fresh-account → upload CV → set never-say
  → tailor → screenshot flow still needs the browser harness above.

**For Shekar to finish the walkthrough** (a few minutes, with the Playwright harness configured):
sign in with a fresh account, add `Java` to *My CV → Skill levels → "Wording your CV must never
say"*, tailor against a JD that lists Java as optional. Expect: no "Java" anywhere on the CV, and
the result page shows `Removed because you asked us never to say it: Java (Headline).` (or
`(Skills)` / both). The one-line notice is `[data-retired-notice]` on `/app`.

## What WAS verified (automated, no paid API)

- `npm test` — full suite **1370 pass, 0 fail**, incl. the new `tests/neverSayGuard.test.ts` (14
  tests): a never-say item removed from Skills, Headline, Summary, a bullet and the cover letter;
  whole-phrase + case-insensitive ("Java" ≠ "JavaScript", "OpenAI API" ≠ "OpenAI-compatible");
  the user's rule wins even where the master CV/registry names the skill; empty list = no-op; no
  dangling comma / empty group heading / empty Headline slot; the located notice copy.
- `npm run typecheck` — clean.
- `npm run build` — exit 0.
- `npm run lint` — 17 problems, the documented baseline (no regression).
- Timing test `tests/jdFromUrl.test.ts` "hostile pages … linear time" — passed 3 runs in a row;
  all 8 hostile cases ratio 4.8–10.8× (threshold 30), ~3× margin, load-invariant.

## Step 0 finding (the key correction)

The chunk's premise — "a rule that lives only in the prompt is a request, not a guarantee" — is
**stale for the current code**. The "Wording your CV must never say" list IS `lib/retiredClaims`,
and it is **already enforced in code** (`applyRetired`) on the headline, summary, skills,
experience, project bullets and the letter, on every tailoring path (UI, API, fallback at
`route.ts` ~1573), and it is injected into **no prompt**. So the sweep's fix (adding "OpenAI API"
and "Java" to the list) already prevents these on future tailors.

Why they reached the CVs on 23–24 Nov (with file/line): at tailoring time the list did **not yet**
hold them, so only `lib/factGuard` `dropUnbackedTools` guarded, and it kept both —
- `OpenAI API`: `factGuard.ts:83` `SKILLS_LIST_ONLY_TOOLS` + `:87 listNames` keep it when the
  skills list / claims registry names it (it did);
- `Java`: `factGuard.ts:104` `mentions(master, "Java")` keeps it when the master CV names it (the
  CodSoft internship does);
- the **Headline** is never touched by `factGuard` at all (`guardFacts` processes only summary and
  skills), so "Java" in the header had no guard until the never-say list caught it.

Because the never-say list already does the removal, I did **not** add a duplicate `neverSay.ts`
removal module (it would duplicate `retiredClaims` and violate the repo's anti-duplication rule).
Instead I filled the two genuine gaps: the Headline removal was silently dropped from the report
(`route.ts:653`), and the notice did not say *where*. See the final summary for details and the one
open design question (prose: remove-the-sentence vs report-only).
