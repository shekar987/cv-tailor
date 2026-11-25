# Jobhuntz — Local Tailor roadmap (progress log)

The full roadmap narrative was not checked into the repo (it lived in the
planning docs). This file is the **progress log** the TL chunks append to. If
the full roadmap is restored later, keep this log at the bottom of it.

## Progress log

- **TL-1 merged** (branch `tl-1-local-provider`, 25 Nov 2026). Local tailor
  part 1: a provider abstraction (`src/lib/llm/` — `generate` /
  `generateJSON(schema)` / `embed`; `RemoteProvider` wraps the existing
  `callLLM`, new `local-ollama` provider uses Ollama's `format` JSON mode), a
  sibling `tailor_jobs` queue (migration `20261125120000_tailor_jobs.sql`,
  input/output JSON, device-token worker RPCs reusing Chunk 33's
  `agent_resolve_device`; `agent_queue.sql` untouched), `/api/tailor-jobs`
  (enqueue a summary job + poll — the website never calls Ollama), the first
  local task (3-line Professional Summary with the rule-4 number-honesty check
  in `lib/tailorJobs`), a "Local (£0)" comparison on `/app`
  (`LocalTailorPanel` / `LocalSummaryCompare`) beside the paid result, a
  Settings "Tailoring engine" toggle + £-saved counter
  (`preferences.tailoringEngine`), the Python worker stub + `tailor_bench.py`
  + `agent/bench/results-2026-11-19.md`, and tests (`llmProvider`,
  `tailorJobs`). Default model: `qwen2.5:7b-instruct-q4_K_M` (reasons in the
  bench doc; table is PROJECTED — the build PC has no Ollama and no GPU, so
  re-run `python -m agent.bench.tailor_bench` on a machine with the models
  pulled to overwrite it with measured numbers). Screenshot:
  `jobhuntz-audit/2026-11-19/screenshots/02-local-summary.png`. Default
  tailoring engine stays Premium until TL-16.
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
