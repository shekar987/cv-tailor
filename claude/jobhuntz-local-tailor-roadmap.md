# Jobhuntz — Local Tailor roadmap (progress log)

The full roadmap narrative was not checked into the repo (it lived in the
planning docs). This file is the **progress log** the TL chunks append to. If
the full roadmap is restored later, keep this log at the bottom of it.

## Progress log

- **FT-1 built on branch ft-1-smart-match** (25 Nov 2026). Smart Match: free, deterministic CV reordering with no AI call. `src/lib/smartMatch.ts` scores each bullet by JD keyword matches (required×4, preferred×2, general×1 via `matchAtsKeywords`), reorders skills lines so matched items come first, selects the top 2 projects by relevance, and returns `{sections, coverage, gaps, evidenceIds, isFreeMatch:true}`. `/api/tailor/smart` exposes it as a signed-in, burst-limited (20/min) POST with no credit spent. The `/app` `provider_credit` and `needs_keys` notices gain a "Tailor free (Smart Match)" button. 17/17 new tests in `tests/smartMatch.test.ts`; 1453/1453 full suite; typecheck and build clean. Java≠JavaScript protection inherited from `matchAtsKeywords`. Key fix: `parseJdKeywords` only applies the catch-all heading rule while already in general mode, so single-word tech names inside a Requirements section are never mistaken for section headings.

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

- **TL-3 never built** (25 Nov 2026). The chunk was skipped in the sprint plan.

- **TL-4 built on branch tl-4-retrieval** (25 Nov 2026). Retrieval and selection
  with local embeddings. `agent/worker/retrieval.py`: `EmbeddingCache`
  (SQLite, stdlib), `cosine_sim`, `rule_score`, `SelectBullet` NamedTuple,
  `RetrievalEngine.select_bullets` — blends cosine×0.7 + rule×0.3 when Ollama
  `nomic-embed-text` available, pure rule-score fallback when absent (the build
  PC has no Ollama and no GPU). `src/lib/tailorJobs.ts` gains `TailorJobKind =
  "summary" | "select"` and the `SelectResult` type. `src/lib/smartMatch.ts`
  gains `WorkerSelection` / `WorkerBulletScore` types, `coveredBy:
  Record<string,string>` on `SmartMatchResult`, and an optional
  `workerSelection` parameter — when provided it re-sorts evidenceIds by worker
  scores and builds coveredBy from covered_requirement annotations. The
  `/api/tailor/smart` route forwards `coveredBy` in its response. `/app`
  `app/page.tsx` shows a "Requirement coverage" card inline when `coveredBy` or
  `gaps` are present on a free-match result (no new panel). The TL-1 worker's
  `run_one` now dispatches to `_run_select` for `kind="select"` jobs.
  `agent/bench/tailor_bench.py` gains `bench_selection()` callable with
  `--selection` flag; marks output PROJECTED when no Ollama. Tests: 31/31 Python
  (`agent/tests/test_retrieval.py`); 1490/1490 TypeScript suite
  (`tests/selection.test.ts` + full suite); typecheck clean. Java / Kubernetes
  terms in fictional CVs that lack them score < 0.3 coverage (no false
  coverage).
