# Jobhuntz — Local Tailor roadmap (progress log)

The full roadmap narrative was not checked into the repo (it lived in the
planning docs). This file is the **progress log** the TL chunks append to. If
the full roadmap is restored later, keep this log at the bottom of it.

## Progress log

- **TL-1** — local tailor part 1 (model pick + benchmark). **Not built yet.**
  The 23 Nov 2026 run hit the Claude weekly limit; no `tl-1-*` branch, no
  `agent/bench/results-*.md`, no default model picked. TL-2 was built from
  `main` (it needs no TL-1 code).
- **TL-2 built on branch tl-2-master-profile** (25 Nov 2026). The master
  profile is now structured JSON: `src/lib/profile/schema.ts` (types +
  normaliser + JSON Schema export, no zod — house style), `import.ts`
  (rule-based importer, no LLM, `unmapped[]` for anything it can't place),
  `validate.ts` (the four validation rules + `findMetric`/`findBullet` hooks
  for TL-6). Stored migration-free under `cv_profiles.data.structured`
  (`getStructuredProfile`/`saveStructuredProfile` in `lib/cvStore`). Editor at
  `/profile` ("Your profile facts"), linked from My CV. Fixtures in
  `fixtures/` (fictional Alex Tester CV + imported profile). Tests in
  `tests/structuredProfile.test.ts`. Build 6 (worker RPC) deferred to the
  TL-1R / Chunk 34 chain; Build 4 kept migration-free per the planner's note.
