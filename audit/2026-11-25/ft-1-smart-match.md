# FT-1 Smart Match — 25 Nov 2026 audit

## What was built

- `src/lib/smartMatch.ts` — deterministic CV reordering. No AI call.
  - `parseJdKeywords(jdText)` splits the JD into required/preferred/general term lists
  - `reorderSkills(skillsText, kw)` moves matched skills to the front of each Tools line
  - `formatExperience(roles, kw)` ranks bullets by JD keyword score (required×4, preferred×2, general×1)
  - `computeCoverage(cvText, kw)` returns a 0–1 fraction and a gap list
  - `smartMatch(cvText, jdText, projects)` → `{sections, coverage, gaps, evidenceIds, isFreeMatch:true}`
- `src/app/api/tailor/smart/route.ts` — POST endpoint. Signed-in, burst-limited (20/min), no AI, no credit.
- `src/app/app/page.tsx` — "Tailor free (Smart Match)" button added to both `provider_credit` and `needs_keys` notices.
- `src/app/globals.css` — `.limitNotice__sub` helper class.
- `tests/smartMatch.test.ts` — 17 deterministic tests, 0 failures.

## Test results

- `tests/smartMatch.test.ts`: 17/17 ✔
- Full suite: 1453/1453 ✔
- `npm run typecheck`: clean
- `npm run build`: clean

## Notes

The ANY_HEADING_RE in parseJdKeywords was originally too broad — it matched
single-word tech names (Java, TypeScript, AWS) as section headings. Fixed by:
1. Only applying the catch-all heading rule when already in `mode === "general"`.
   Once inside a requirements/preferred section, all lines are treated as content.
2. 4-gram test checks per-section (not across the joined output) to avoid
   false positives at section boundaries.

## Screenshots

Live screenshots require auth. The build passes clean; the button renders in
the `provider_credit` and `needs_keys` notice blocks in `app/page.tsx`.
