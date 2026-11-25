# Jobhuntz Local Agent

A small worker that runs on **your own PC**. It claims the jobs you queue on
[jobhuntz.app/agent](https://jobhuntz.app/agent), opens each job's page in your
own browser, **reads the application form** and sends the field list and a
screenshot back to the live dashboard. **£0 per application** — no
per-application fee, no subscription.

> **Chunk 35 — the browser observer (read-only).** The worker now opens the
> page in a real Chromium browser with a **persistent profile** (so you sign in
> to each site once and stay signed in), lists every form field it can see —
> reaching into embedded forms such as a Greenhouse iframe — and takes a
> full-page screenshot. It **never types or submits anything**: it stops and
> marks a job `needs_human` if it meets a sign-in wall or a captcha. Form
> filling and real submission arrive in a later chunk.

## Safety

- **Dry run by default.** `MODE_OVERRIDE=dry_run` in your `.env` forces every
  job to a dry run — the worker never submits for real — even if a job is set
  to submit mode on the website. Leave it on until the submit flow exists.
- **Your credential is a device token, nothing more.** The worker never sees
  your password and never uses the Supabase service-role key — only the public
  (anon) key and the one-time device token. The token is stored on the server
  only as a hash; the copy you paste into `.env` is the only copy.
- **Secrets are kept out of the logs.** Every log line is JSON; the device
  token and any field named like a secret are redacted before anything is
  written.

## Requirements

- **Python 3.12+**
- **[uv](https://docs.astral.sh/uv/)** — the Python package manager used here.
  Install it once (Windows PowerShell):

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

  (macOS / Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`.) `uv` will
  fetch Python 3.12 for you if you don't have it.

## Setup — five steps

1. **Create a device token.** Open **jobhuntz.app/agent → Connect a device**,
   click the button, and copy the token it shows you once (it starts `jhd_`).

2. **Configure the worker.** In this `agent/` folder, copy the template and
   fill it in:

   ```bash
   cp .env.example .env
   ```

   Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase → Project Settings →
   API — the same public values the website uses) and paste your token into
   `DEVICE_TOKEN`. Leave `MODE_OVERRIDE=dry_run`.

3. **Install and check the connection.**

   ```bash
   uv sync
   uv run playwright install chromium   # the browser the worker drives
   uv run jobhuntz-agent check
   ```

   You should see *Supabase: reachable* and *Token: accepted ✓*. (This never
   claims a job.)

4. **Queue a job on the website.** Back on **jobhuntz.app/agent**, paste a job
   link (Greenhouse, Lever, Ashby, Workday, Pinpoint or Workable) and click
   **Add to queue**. It appears as **Queued**.

5. **Run the worker.**

   ```bash
   uv run jobhuntz-agent run
   ```

   A Chromium window opens (headed by default, so you can watch it and sign in
   when a site asks). Watch the dashboard: the job moves **Queued → Claimed →
   Working… → Dry run done**, live, without a refresh; open **Fields** on the
   row to see the screenshot and the numbered list of form fields it read. If
   the page needs a sign-in or shows a captcha, the job becomes **Needs you**
   instead — sign in once in the worker's window and retry. Press **Ctrl+C** to
   stop; within about two minutes the dashboard shows **Worker offline**.

### Browser & screenshot settings

All optional — add them to `agent/.env`:

- `BROWSER_HEADLESS=true` runs Chromium with no window (the default is headed so
  you can sign in).
- `BROWSER_CHANNEL=msedge` (or `chrome`) uses an installed browser instead of
  the Playwright-bundled Chromium; `BROWSER_EXECUTABLE_PATH` points at a
  specific binary.
- `ACTION_DELAY_MIN_MS` / `ACTION_DELAY_MAX_MS` set the polite pause between
  actions (default 400–900 ms).
- `ARTIFACT_SIGN_URL` is the deployed `agent-artifact-sign` edge function URL.
  **Without it the worker still reads every page and records the field list** —
  only the screenshot upload is skipped (noted on the job). The owner deploys
  the function once (`supabase/functions/agent-artifact-sign`) and applies
  migration `20261121120000_agent_artifacts.sql`.

   To process a single job and exit (handy for a first test), use
   `uv run jobhuntz-agent once` instead.

## Commands

| Command | What it does |
|---|---|
| `jobhuntz-agent run`   | Poll the queue forever; claim and process jobs until Ctrl+C. |
| `jobhuntz-agent check` | Print Supabase reachability and this device's name. No claim. |
| `jobhuntz-agent once`  | Claim and process at most one job, then exit. |

## Logs

Structured JSON lines are written to `agent/logs/agent-YYYY-MM-DD.log` (git-
ignored) and echoed to the console. Safe to share — secrets are redacted.

## Tests

```bash
uv run pytest
```

---

## Local tailor worker (Chunk TL-1)

The free, £0-per-run tailor: a worker on **your own PC** that reads jobs from the
Jobhuntz queue, runs an open-weight model through [Ollama](https://ollama.com),
and writes the result back. The website never calls Ollama — only this worker
does. Your CV text never leaves your machine beyond the Supabase row the website
already stored.

This is the minimal **summary** worker for TL-1 (it tailors the Professional
Summary). Later TL chunks and the Chunk 34 `/agent` project fold in the rest.

### One-time setup (TL-1)

1. **Install Ollama** and start it: <https://ollama.com> then `ollama serve`.
2. **Pull a model** (see the benchmark for which):
   ```
   ollama pull qwen2.5:7b-instruct-q4_K_M
   ```
3. **Apply the database migration** (owner, once): paste
   `supabase/migrations/20261125120000_tailor_jobs.sql` into the Supabase SQL
   editor. It depends on the Chunk 33 queue migration being applied first.
4. **Connect a device** in Jobhuntz → Auto-apply → "Connect a device", and copy
   the one-time token.
5. **(Optional) for the benchmark only:** `pip install -r agent/requirements.txt`.

### Run the tailor worker

From the repo root:

```bash
export JOBHUNTZ_SUPABASE_URL="https://<project-ref>.supabase.co"
export JOBHUNTZ_SUPABASE_KEY="sb_publishable_..."   # the publishable key (safe to ship)
export JOBHUNTZ_DEVICE_TOKEN="<the token from step 4>"
export OLLAMA_MODEL="qwen2.5:7b-instruct-q4_K_M"     # optional; this is the default
python -m agent.worker.tailor_worker
```

On Windows PowerShell use `$env:JOBHUNTZ_SUPABASE_URL = "..."` etc.

The worker polls for queued tailor jobs, runs the summary locally, and reports
`done` (or `failed`) back. In Jobhuntz, the Tailor page shows the local summary
beside the paid one with a **Local (£0)** badge, and the honesty check — every
number in the summary must appear in your master CV — runs on the website.

### Run the benchmark

With Ollama running and the candidate models pulled:

```bash
python -m agent.bench.tailor_bench
# or a subset:
python -m agent.bench.tailor_bench --models qwen2.5:7b-instruct-q4_K_M llama3.1:8b-instruct-q4_K_M
```

It tailors the summary for the 3 saved JDs in `agent/bench/jds/` from
`agent/bench/master_cv.txt`, records tokens/sec, time, peak RAM, JSON-validity
rate and the honesty rate, writes the table to
`agent/bench/results-2026-11-19.md`, and prints a recommended default.

### Layout (TL-1)

```
agent/
  worker/
    config.py          env-var config (no secret hard-coded)
    ollama_client.py   tiny Ollama HTTP client (stdlib only)
    supabase_client.py the device-token RPCs over PostgREST (stdlib only)
    tailor.py          the summary prompt + honesty number check (mirrors src/lib/tailorJobs.ts)
    tailor_worker.py   the claim → run → report loop
  bench/
    tailor_bench.py    the model benchmark
    master_cv.txt      fictional Alex Tester CV
    jds/               three saved JDs
    results-2026-11-19.md
```
