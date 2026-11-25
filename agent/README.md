# Jobhuntz Local Agent

A small worker that runs on **your own PC**. It claims the jobs you queue on
[jobhuntz.app/agent](https://jobhuntz.app/agent), reports progress back to the
live dashboard, and (from Chunk 35) fills in the application forms in your own
browser. **£0 per application** — no per-application fee, no subscription.

> **Chunk 34 — the skeleton.** There is **no browser automation yet**. This
> version proves the loop end to end: it claims a queued job, marks it
> `processing`, logs a timeline, waits three seconds in place of a browser, and
> marks it `dry_run_done`. The real form-filling arrives in Chunk 35.

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

   Watch the dashboard: the job moves **Queued → Claimed → Working… → Dry run
   done**, live, without a refresh, and the device shows **Worker online** with
   its last-seen time. Press **Ctrl+C** to stop; within about two minutes the
   dashboard shows **Worker offline**.

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
