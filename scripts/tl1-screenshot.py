"""One-off: screenshot the Local Tailor "Local (£0)" comparison (Chunk TL-1).

Drives the dev-only /dev/tl1-preview page (static, no auth / DB / Ollama) with
Playwright + the system Edge/Chromium and saves:
  - 2026-11-19/screenshots/02-local-summary.png  (desktop, the Done-when shot)
  - 2026-11-24/screenshots/tl1-local-badge-desktop.png
  - 2026-11-24/screenshots/tl1-local-badge-mobile.png

Run: python scripts/tl1-screenshot.py  (dev server must be on BASE below).
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
URL = BASE + "/dev/tl1-preview"
ROOT = Path(__file__).resolve().parents[2] / "jobhuntz-audit"
D1119 = ROOT / "2026-11-19" / "screenshots"
D1124 = ROOT / "2026-11-24" / "screenshots"
for d in (D1119, D1124):
    d.mkdir(parents=True, exist_ok=True)


def shoot(page, path, clip_selector=None):
    el = page.query_selector("[data-local-tailor]")
    if clip_selector and el:
        el.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=True)
    print("saved", path)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")
    # Desktop
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("[data-local-badge]", timeout=15000)
    assert page.query_selector("[data-local-badge]").inner_text().strip() == "Local (£0)"
    page.screenshot(path=str(D1119 / "02-local-summary.png"), full_page=True)
    print("saved", D1119 / "02-local-summary.png")
    el = page.query_selector("[data-local-tailor]")
    el.screenshot(path=str(D1124 / "tl1-local-badge-desktop.png"))
    print("saved", D1124 / "tl1-local-badge-desktop.png")
    ctx.close()
    # Mobile
    ctxm = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pm = ctxm.new_page()
    pm.goto(URL, wait_until="networkidle")
    pm.wait_for_selector("[data-local-badge]", timeout=15000)
    pm.screenshot(path=str(D1124 / "tl1-local-badge-mobile.png"), full_page=True)
    print("saved", D1124 / "tl1-local-badge-mobile.png")
    ctxm.close()
    browser.close()
print("done")
