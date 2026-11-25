"""Generate the Chunk 35 Agent-page screenshot (08-agent-observer-greenhouse.png)
with Playwright + the installed Chromium — the cross-platform twin of
scripts/e2e-agent-observer.mjs for when Node Playwright / Edge is not set up.

It drives a RUNNING Jobhuntz server (dev or `next start`), signs in as a
throwaway account so the page renders, mocks the /api/agent/* GET routes with a
fictional dry-run Greenhouse job whose observer payload + screenshot come from
scripts/.agent-observer-sample/ (run agent_observer_sample.py first), opens the
job's "Fields" drawer, and screenshots the page. No database writes beyond the
throwaway user, which is removed at the end.

    python scripts/agent_observer_sample.py
    npm run dev           # or: npx next start -p 3100  (set BASE below)
    python scripts/agent_observer_shot.py
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "scripts" / ".agent-observer-sample"
BASE = os.environ.get("SMOKE_BASE", "http://localhost:3000")
OUT = Path(
    os.environ.get("OUT", str(ROOT.parent / "jobhuntz-audit" / "2026-11-23" / "screenshots" / "08-agent-observer-greenhouse.png"))
)


def env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" in line and line[:1].isalpha():
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def wait_for_server(url: str, timeout_s: int = 180) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            httpx.get(url, timeout=5, follow_redirects=False)
            return
        except Exception:
            time.sleep(1)
    raise SystemExit(f"Server at {url} did not come up within {timeout_s}s")


def main() -> None:
    observer = json.loads((SAMPLE / "observer.json").read_text(encoding="utf-8"))
    screenshot_url = (SAMPLE / "page.datauri.txt").read_text(encoding="utf-8").strip()

    e = env()
    sb = e["NEXT_PUBLIC_SUPABASE_URL"]
    pub = e["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
    secret = e["SUPABASE_SECRET_KEY"]
    ref = urlparse(sb).hostname.split(".")[0]
    admin = {"apikey": secret, "Authorization": f"Bearer {secret}", "Content-Type": "application/json"}

    wait_for_server(BASE)

    email = f"agent-obs-{int(time.time())}@example.com"
    password = f"Pw-{secrets.token_hex(6)}-A1!"
    created = httpx.post(f"{sb}/auth/v1/admin/users", headers=admin, json={"email": email, "password": password, "email_confirm": True}, timeout=30).json()
    user_id = created.get("id")

    try:
        session = httpx.post(
            f"{sb}/auth/v1/token?grant_type=password",
            headers={"apikey": pub, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=30,
        ).json()
        cookie_value = "base64-" + base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip("=")

        job = {
            "id": "obs1",
            "job_url": "https://boards.greenhouse.io/acmerobotics/jobs/4100777",
            "company": "Acme Robotics",
            "role": "Software Engineer",
            "ats": "greenhouse",
            "status": "dry_run_done",
            "mode": "dry_run",
            "attempts": 1,
            "last_error": None,
            "confirmation_url": None,
            "screenshot_path": "u/obs1/page.png",
            "screenshot_url": screenshot_url,
            "observer": observer,
            "created_at": "2026-11-23T10:00:00Z",
            "last_event": {"ts": "2026-11-23T10:01:00Z", "level": "info", "step": "observed", "message": f"Read the application form: {observer['field_count']} fields."},
        }
        devices = [{"id": "d1", "name": "My PC", "last_seen_at": "2026-11-23T10:01:30Z", "revoked": False, "created_at": "2026-11-20T09:00:00Z"}]

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1280, "height": 1800}, timezone_id="Europe/London")
            ctx.add_cookies([{"name": f"sb-{ref}-auth-token", "value": cookie_value, "url": BASE}])

            def jobs_route(route):
                if route.request.method == "GET":
                    route.fulfill(json={"jobs": [job]})
                else:
                    route.fulfill(json={"queued": [], "queuedCount": 0, "duplicates": [], "rejected": []})

            ctx.route("**/api/agent/jobs", jobs_route)
            ctx.route("**/api/agent/devices", lambda r: r.fulfill(json={"devices": devices}))

            page = ctx.new_page()
            page.goto(f"{BASE}/agent", wait_until="load", timeout=120_000)
            page.locator("[data-job-row]").first.wait_for(timeout=60_000)
            page.locator("[data-fields-toggle]").first.click()
            page.locator("[data-fields-row]").wait_for(timeout=30_000)
            page.wait_for_timeout(600)

            OUT.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(OUT), full_page=True)
            shown = page.locator("[data-fields-drawer] [data-field-index]").count()
            browser.close()
        print("PASS wrote screenshot:", OUT)
        print("PASS fields shown:", shown)
    finally:
        if user_id:
            httpx.delete(f"{sb}/auth/v1/admin/users/{user_id}", headers=admin, timeout=30)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL:", exc)
        sys.exit(1)
