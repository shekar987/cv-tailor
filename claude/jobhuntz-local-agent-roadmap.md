# Jobhuntz Local Agent — roadmap

**Goal:** our own free, unlimited browser agent that runs on the user's own PC
and applies to jobs queued from jobhuntz.app. The headline difference from
AIApply-style paid tools: **£0 per application, runs on your PC** — the user's
own login and browser, no per-application fee, no monthly subscription.

The website cannot drive external application sites itself (CORS, SSRF guards,
terms of service, and it is not the user's logged-in browser). A worker on the
user's own machine does that. The website's job is to be the queue and the
live dashboard; the worker claims jobs, fills forms, and reports back.

## Honesty & safety rules (carried from the main product)

- Nothing is invented. The worker fills forms only from the user's own saved
  answers and CV; where it has no answer, it stops and asks.
- **Sensitive questions are never auto-answered** — right to work, sponsorship,
  visa, salary, equal-opportunities/diversity, criminal record, date of birth,
  home address, and any "in your own words / without AI" free-text box. The
  worker marks the job `needs_human` and waits. (`lib/agent/guardrails`.)
- **LinkedIn is blocked** — its terms forbid automated applications and Easy
  Apply is too volatile to drive safely. LinkedIn URLs are rejected at queue
  time with a friendly message. (`LINKEDIN_BLOCKED`.)
- **Dry run is the default.** A job only submits for real when the user switches
  it to submit mode, behind a confirm. A per-user daily submit cap (default 15)
  limits real submissions.

## Architecture

- **Queue** (`apply_jobs`), **timeline** (`apply_events`), **devices**
  (`agent_devices`) in Supabase. RLS: a user sees and writes only their own.
- The **worker** has no Supabase session and never holds the secret key. It is
  issued a device token once, and acts only through four SECURITY DEFINER RPCs
  that validate that token: `claim_next_job`, `heartbeat`, `update_job_status`,
  `log_event`.
- The **website** (`/agent`) writes jobs and shows them live via Supabase
  realtime on `apply_jobs` / `apply_events`.

## Chunks

- **Chunk 33 — apply queue foundations (19 Nov 2026).** The bridge: the three
  tables, RLS, the four device-token RPCs, the daily submit cap, ATS detection
  (`lib/agent/ats`) and guardrail constants (`lib/agent/guardrails`), the
  `/api/agent/jobs` and `/api/agent/devices` routes, and the `/agent` page
  (paste URLs → validate + detect ATS → queue; live table; cancel/retry/switch
  to submit; connect-a-device token shown once). No browser automation yet.
  Migration `20261119120000_agent_queue.sql`.
- **Chunk 34 — the PC worker skeleton (19 Nov 2026).** The worker itself,
  built in Python (`agent/`, uv + httpx + pydantic v2 + structlog). It signs in
  with the device token, polls `claim_next_job` with backoff, marks a claimed
  job `processing`, heartbeats on a background thread, and — with no browser
  yet — does a 3-second placeholder and marks it `dry_run_done`, reporting every
  step to the live dashboard. `MODE_OVERRIDE=dry_run` is enforced in code (it
  wins over a submit-mode row); an empty or revoked token is refused at start.
  CLI: `jobhuntz-agent run | check | once`. The `/agent` page gained a
  worker-online / "Worker offline" pill from `agent_devices.last_seen_at`
  (`lib/agent/deviceStatus`). No Playwright — that is Chunk 35.
- **Chunk 35 — browser automation (planned).** Add Playwright to the worker and
  drive the ATS forms per adapter (Greenhouse, Lever, Ashby, Workday, Pinpoint,
  Workable), honouring the guardrails, taking a screenshot, and submitting only
  in submit mode behind the daily cap.

## Progress log

- 2026-11-19 — Chunk 33 built on branch `chunk-33-agent-queue`: migration,
  shared ATS/guardrail libs + tests, queue/device API routes, `/agent` page.
  Pending: apply the migration to the live project by hand (not done here); the
  `/agent` link is live in the nav. **Chunk 33 merged** once the branch lands on
  main.
- 2026-11-25 — Chunk 34 built on branch `chunk-34-worker-skeleton` (from main,
  with Chunk 33 merged and its migration applied). The Python worker in
  `agent/` with the claim → `processing` → `dry_run_done` loop, heartbeat,
  backoff, dry-run safety override, token refusal, JSON logs with redaction,
  and the `run`/`check`/`once` CLI; pytest suite (34 tests) against a fake
  Supabase; the `/agent` worker-online / offline pill. `npm test` 1408/1408,
  `uv run pytest` 34/34. Pending for Shekar: install `uv` on the PC (it isn't
  installed), then run the worker against the live queue to confirm the loop
  end to end; browser automation is Chunk 35.
