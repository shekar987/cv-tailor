# Tailoring prompts — what they actually do (Brief 3, step 1)

Read from `src/prompts/steps.ts`, `src/prompts/rules.ts` and `src/app/api/tailor/route.ts` on 2026-09-17, before any prompt change. Every model call goes through `callLLM` on the default model (Claude Haiku 4.5); `ABSOLUTE_RULES` (nine honesty rules) and, since Brief 2, the rendered claims registry are injected into every step that writes about the candidate.

## The pipeline

| Step | When | Receives | Produces | Length / tone constraints | Where the model is free to write |
|---|---|---|---|---|---|
| **Step 0 — JD analysis** (`JD_ANALYZER_PROMPT`) | Once, reused from the pre-check when the user came through it | The **full JD** text | JSON: role, company, seniority, role type, location, required skills (10), nice-to-have (8), top 15 keywords, culture signals, domain sentence, tone signal, `hard_gates` | None beyond JSON shape | Everything after this step sees this JSON, **not the JD** |
| **Company research** (`COMPANY_RESEARCH_PROMPT`) | Wave 1, skipped when real Stage 3 research is bound to the company | The analysis JSON only | JSON: what the company does, 3 hooks, values, cautions | "Do NOT fabricate specific facts" | Synthesises from the analysis "plus reasonable general knowledge" — this is the one step allowed to bring outside knowledge |
| **Summary** (`summaryPrompt`) | Wave 1 | **Full master CV** (system) + analysis JSON (user) | 3 plain-text lines | Exactly 3 lines, each with one concrete evidence item; no "proficient/expert" unless production; filler words banned; never what is being studied | Free phrasing; must be varied; keyword-rich |
| **Skills** (`skillsPrompt`) | Wave 1 | Full master CV + analysis JSON | 2 lines (technical: Functional Competencies / Technical Tools) or 1 flat line | Verbatim-only rule with a self-check; no inference from descriptions; adjacent skill for a missing one, never the missing skill | Ordering and grouping only — content must be verbatim |
| **Experience** (`experiencePrompt`) | Wave 1 | Full master CV + analysis JSON + **adaptive length budget** (`lib/contentBudget.ts`: 5/4/3 bullets per role only when the CV overflows two pages) | Plain text: `Role | Employer | Dates` headers + `•` bullets | Two printed lines per bullet; banned-phrase list; vary structure and length; keep exact JD keywords the candidate has; bold quantified wins; employer/title/dates immutable; experience only (no projects) | **Rewrites every bullet** from the CV's content ("rephrase, reorder, emphasize"); reorders bullets within a role so the most JD-relevant come first; role order stays as in the CV |
| **Projects** (`projectsPrompt`) | Wave 1, when the profile has projects | Full master CV + project names by index + analysis JSON + budget | JSON `{ "0": [bullets], … }` | 2–3 bullets per project (2 when ≥3 projects); What + How + Result; quantify only where the CV does | Rewrites bullets per project from that project's own text (rule 7) |
| **Pool projects** (`poolProjectsPrompt`) | Instead of Projects, when a project pool is saved | CV (context only) + the pool + analysis JSON | JSON: exactly 2 selected projects with name/date/tech verbatim + bullets | Same as Projects | **Selection** (which 2) + rewritten bullets |
| **Cover letter** (`coverLetterPrompt`) | Wave 2 | Full master CV (system) + `{ analysis, research }` (user) | Plain text ≤ 400 words | One em-dash max; no list-of-achievements sentences; two short sentences; banned phrases; no dramatic opening; no date/placeholder; tone from `tone_signals` | Free prose, bounded by rules 1–9 and the registry |
| **Scoring annotation** (`atsScoringPrompt(bandBlock)`) | Wave 2 | The settled score from `lib/visibilityVerdict` (band, counts, present/absent terms, in the system prompt) + the four tailored sections | JSON hits/misses annotations + edits | Membership, counts, band and verdict are computed **before** the call and the model is told they are settled; `reconcileAtsScore` keeps only annotations that prefix-match a given term and edits that carry no praise below "ready" (bounded to 2 / 4 / 2 per band) | Annotation wording and the edits only — never the verdict (the old `overall_assessment` praised 3/15 as "strong" in production) |
| **Post-generation, deterministic** | After wave 1 / after wave 2 | The finished text | `applyFormatRules` (lib/formatRules: Technical Tools cut to the 15 most JD-relevant terms, summary cut to 3 sentences — the prompt's "3 lines" and the bounded tools list are enforced here, not trusted), `reconcileAtsScore`, `checkClaims` (figures vs CV/pool, learning skills), `normalizeExperienceOutput` (bullet markers), refusal guard | — | — |

Two facts worth stating plainly:

1. **No writing step sees the job description.** They see Step 0's JSON: skill lists, keywords, a one-line domain sentence and a tone word. "JD-driven ordering" therefore means "keyword-list-driven ordering". A bullet's relevance to what the posting actually emphasises (say, incident response) is inferred from the presence of those words in the keyword lists.
2. **Every step sees the whole master CV verbatim**, not a summary. That is what makes the honesty rules enforceable — but it also means each bullet is a fresh rewrite by the model, bounded by rules, not a selection from the CV's own sentences. The brief's distinction ("re-ordering and re-weighting evidence, not generating claims") is only partly true of this pipeline: facts are bounded (and, since Brief 2, figures and learning skills are checked deterministically), phrasing is generated.

## Against the brief's standards

| Standard | Today | Verdict |
|---|---|---|
| Bullets lead with the outcome, not the technology | "Lead with the action and the concrete result" — action-first, outcome second | **Partly.** Prompt says action, not outcome; no check |
| Every bullet carries evidence (number, scale, named system) or is cut | Summary lines must; experience bullets are asked to keep "the real metric" but a bullet without one is allowed | **No** |
| Ordering is JD-driven | Bullets within a role: yes, from the keyword lists. Roles: CV order. Projects: index order (pool: relevance) | **Partly** — and only via the analysis JSON |
| No adjective inflation | Banned list: at scale, production-grade, mission-critical, end-to-end, hands-on, leveraging, robust, seamless (+ letter/email lists). "Expert", "cutting-edge", "world-class", "innovative", "dynamic", "passionate", "results-driven" are not banned | **Partly** |
| Length discipline, page estimate shown before download | Adaptive bullet budget + `cvDensity` layout; **no page estimate in the UI**, no hard cap on generation | **Partly** |
| No duplicated content across sections | Experience is told to exclude projects; nothing checks the output for a project or education entry appearing twice | **No** |
| One positioning per CV | The headline is the profile's tagline, verbatim from the user's CV ("Full Stack Engineer \| AI Engineer" is the user's own text); nothing picks one per JD | **No** (Part 3, variants) |

## What this means for the rest of Brief 3

- **Cheap and deterministic first**: a page estimate from the same numbers `cvDensity` already uses; a duplicate-content check across sections; an "evidence per bullet" check (number, scale word or a named system from the CV) run with `checkClaims`; a wider inflation ban list. All testable offline, none touching a prompt's contract.
- **Prompt wording**: outcome-first bullet order; the wider ban list; "cut a bullet that carries no evidence". Small, measurable with the harness.
- **The harness before any of that**: ten JD+CV pairs, asserting the four properties the brief names. Needs paid runs to populate (one tailor each, ~8 model calls); the assertions themselves are free and reuse `checkClaims`, `matchAtsKeywords` and the page estimate.
- **Variants** (Part 3) are the one item that changes the product's shape: a stored set of ordering-and-emphasis rules per role family, applied to one master CV, selected per JD. Last, as the brief orders.
