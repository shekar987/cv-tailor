"""Capture real observer output + a real screenshot from the Greenhouse fixture,
for the Agent-page screenshot harness (Chunk 35). Writes observer.json, page.png
and a data-URI of the PNG into scripts/.agent-observer-sample/.

    python scripts/agent_observer_sample.py

Uses the installed Playwright + Chromium. Pure read — it only loads a local HTML
fixture.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent" / "src"))

from jobhuntz_agent.browser.observer import observe_page  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

FIXTURE = (ROOT / "agent" / "tests" / "fixtures" / "greenhouse_form.html").resolve().as_uri()
OUT = ROOT / "scripts" / ".agent-observer-sample"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_context(viewport={"width": 1000, "height": 1400}).new_page()
        page.goto(FIXTURE, wait_until="domcontentloaded")
        observation = observe_page(page)
        png = page.screenshot(full_page=True)
        browser.close()

    payload = observation.to_event_payload()
    (OUT / "observer.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT / "page.png").write_bytes(png)
    (OUT / "page.datauri.txt").write_text(
        "data:image/png;base64," + base64.b64encode(png).decode("ascii"), encoding="utf-8"
    )
    print("fields:", payload["field_count"], "elements:", len(payload["elements"]))
    print("png bytes:", len(png))
    print("wrote:", OUT)


if __name__ == "__main__":
    main()
