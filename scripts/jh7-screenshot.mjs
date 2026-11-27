/**
 * JH-7 screenshot script.
 * Takes a desktop (1280px) and mobile (375px) screenshot showing the
 * POST /api/check/outreach result in the browser console.
 *
 * Usage:
 *   PLAYWRIGHT_PATH=msedge node scripts/jh7-screenshot.mjs
 *
 * Requires the dev server on :3000 and a signed-in session.
 * Screenshots → RTS\jobhuntz-audit\2026-11-26\screenshots\jh7-*.png
 *   (and copied to UKJI\jobhuntz-audit\2026-11-26\)
 */

import { chromium } from "playwright";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3000";

// Outreach texts for the demo (fictional, all matching the check's rules)
const DEMO_TEXT =
  "Following up on my application for the Software Engineer role. " +
  "I built a fraud-detection prototype with 150 automated tests and reduced latency by 60%.";

const API_CALL = `
(async () => {
  const r = await fetch('/api/check/outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: ${JSON.stringify(DEMO_TEXT)},
      kind: 'follow_up',
      recipient: 'noreply@workablemail.com',
    }),
  });
  const j = await r.json();
  console.log('JH-7 outreach check result:');
  console.log(JSON.stringify(j, null, 2));
  return j;
})();
`;

const SHOT_DIR = path.resolve(
  __dir,
  "..",
  "..",
  "..",
  "RTS",
  "jobhuntz-audit",
  "2026-11-26",
  "screenshots",
);
const UKJI_DIR = path.resolve(
  __dir,
  "..",
  "..",
  "..",
  "UKJI",
  "jobhuntz-audit",
  "2026-11-26",
);

async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

async function shoot(browser, viewport, outName) {
  const context = await browser.newContext({
    viewport,
    // Open DevTools console so the result is visible
  });
  const page = await context.newPage();

  // Navigate to /app (requires sign-in; the browser's existing session is used
  // when PLAYWRIGHT_PATH points to Edge — the user stays signed in)
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 15000 });

  // Run the API call in the page's console context
  const result = await page.evaluate(API_CALL);
  console.log(`[${outName}] result:`, JSON.stringify(result));

  // Open DevTools console (best-effort — not all browsers expose it)
  // Instead, inject the result into the page as a visible overlay
  await page.evaluate((r) => {
    const el = document.createElement("pre");
    el.style.cssText = [
      "position:fixed",
      "top:16px",
      "left:16px",
      "right:16px",
      "background:#1a1a1a",
      "color:#e2e8f0",
      "padding:16px",
      "border-radius:8px",
      "font:13px/1.5 monospace",
      "z-index:99999",
      "white-space:pre-wrap",
      "word-break:break-all",
      "max-height:80vh",
      "overflow:auto",
      "border:1px solid #374151",
    ].join(";");
    el.setAttribute("data-jh7-result", "1");
    el.textContent =
      "POST /api/check/outreach\n\n" + JSON.stringify(r, null, 2);
    document.body.appendChild(el);
  }, result);

  // Brief pause so the overlay renders
  await new Promise((res) => setTimeout(res, 500));

  const shotPath = path.join(SHOT_DIR, outName);
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log(`  → ${shotPath}`);
  await context.close();
  return shotPath;
}

(async () => {
  await ensureDir(SHOT_DIR);
  await ensureDir(UKJI_DIR);

  const execPath = process.env.PLAYWRIGHT_PATH;
  const browser = await chromium.launch({
    executablePath: execPath || undefined,
    headless: true,
  });

  try {
    const desktop = await shoot(
      browser,
      { width: 1280, height: 800 },
      "jh7-outreach-desktop.png",
    );
    const mobile = await shoot(
      browser,
      { width: 375, height: 812 },
      "jh7-outreach-mobile.png",
    );

    // Copy to UKJI mirror
    await copyFile(desktop, path.join(UKJI_DIR, "jh7-outreach-desktop.png"));
    await copyFile(mobile, path.join(UKJI_DIR, "jh7-outreach-mobile.png"));
    console.log("Copied to UKJI mirror.");
  } finally {
    await browser.close();
  }

  console.log("Done.");
})();
