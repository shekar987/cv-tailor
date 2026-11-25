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
- **Chunk 35 — browser core: the read-only observer (21 Nov 2026).** Playwright
  added to the worker (`agent/browser/`): a persistent-profile Chromium session
  (`session.py`, launched in `%LOCALAPPDATA%\Jobhuntz\agent-profile`, headed by
  default, no stealth / no UA spoofing — guardrail 2) and a **read-only page
  observer** (`observer.py`) that lists every form control (inputs, selects,
  textareas, file inputs, buttons, in-form links), reaching into child frames
  such as a Greenhouse embed, as a numbered Pydantic model (`index`, `role`,
  `label`, `name`, `type`, `required`, `options[]`, `value`, `visible`,
  `frame_path`, a stable id→name→data-*→XPath `selector`). It flags a sign-in
  wall (`login_wall`) and a reCAPTCHA/hCaptcha (`captcha`) and stops
  (`needs_human`) — it never types or submits. The dry-run runner (`runner.py`)
  opens the URL, may click one same-domain "Apply" button to reveal a form,
  observes, logs an `observed` event carrying the field list (jsonb, via
  `log_event` — no storage round-trip), uploads a full-page screenshot and ends
  `dry_run_done`. The screenshot goes to a private bucket `agent-artifacts` via
  a signed upload URL minted by an edge function (`supabase/functions/
  agent-artifact-sign`) that validates the device token with
  `agent_artifact_target` — so no service-role key ever reaches the PC; without
  it configured the field list still works and only the screenshot is skipped.
  The `/agent` page gained a screenshot thumbnail and a "Fields" drawer
  (`FieldsDrawer.tsx`) rendering the observer JSON. Migration
  `20261121120000_agent_artifacts.sql`. No form filling or submission yet.
- **Chunk 36 — form filling (planned).** Fill the observed fields from the
  user's saved answers and CV, honouring the sensitive-question guardrails, and
  submit only in submit mode behind the daily cap.

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
- 2026-11-25 — Chunk 35 built on branch `chunk-35-browser-core` (from main).
  The read-only browser observer: `agent/browser/session.py` (persistent-profile
  Chromium) + `observer.py` (numbered field list, iframe reach, login-wall /
  captcha flags) + `runner.py` (dry-run: open → observe → screenshot → report),
  wired into the worker's claim loop in place of the placeholder; the screenshot
  uploader + `agent-artifact-sign` edge function + migration
  `20261121120000_agent_artifacts.sql`; the `/agent` thumbnail + Fields drawer
  (`FieldsDrawer.tsx`) + the GET route attaching the observer payload and a
  signed screenshot URL. Tests: `uv run pytest` 81/81 (observer pure logic +
  real-browser fixtures: Greenhouse form/embed, Lever, login wall, reCAPTCHA;
  artifacts; the runner end to end on a local static server), `npm test`
  1414/1414 (added `fieldsDrawer`). Screenshot `08-agent-observer-greenhouse.png`
  generated from the real Agent page with real observer output. Pending for
  Shekar: `uv run playwright install chromium` on the PC; apply migration
  `20261121120000` and deploy the `agent-artifact-sign` edge function (set its
  `AGENT_SUPABASE_URL` / `AGENT_SERVICE_ROLE_KEY` secrets) + set the worker's
  `ARTIFACT_SIGN_URL`, if you want the screenshot upload (the field list works
  without it); then queue a real Greenhouse URL in dry-run and confirm the Agent
  page shows the fields + screenshot within 60s. Form filling is Chunk 36.
