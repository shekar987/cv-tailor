/**
 * JH-7: Take static screenshots of the outreach-check result at desktop
 * (1280px) and mobile (375px) using an inline HTML page (no live server
 * or auth required).
 *
 * Usage:
 *   PLAYWRIGHT_PATH=msedge node scripts/jh7-screenshot-static.mjs
 */

import { pathToFileURL } from "node:url";

const playwrightPath =
  process.env.PLAYWRIGHT_PATH ||
  "C:/Users/shekar/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

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

// Fictional demo result (matches what the real API returns for the demo text)
const DEMO_RESULT = {
  ok: false,
  blocks: [
    {
      code: "automated_recipient",
      phrase: "noreply@workablemail.com",
      fix: "This address belongs to an automated system. Find a named contact to email instead.",
    },
    {
      code: "availability_claim",
      phrase: "I am available immediately for full-time employment",
      fix: "Remove availability claims from outreach text — state them on the application form instead.",
    },
  ],
  warns: [
    {
      code: "unsupported_number",
      phrase: "150",
      fix: 'Check "150" is in your main CV before sending — it was not found there.',
    },
    {
      code: "unsupported_number",
      phrase: "60",
      fix: 'Check "60" is in your main CV before sending — it was not found there.',
    },
  ],
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>JH-7: Outreach check — POST /api/check/outreach</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111;color:#e2e8f0;font:14px/1.6 system-ui,sans-serif;padding:20px}
h1{font-size:18px;font-weight:600;margin-bottom:4px;color:#f8fafc}
.sub{font-size:12px;color:#94a3b8;margin-bottom:20px}
.card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:12px}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-bottom:8px}
.block{background:#450a0a;border-color:#7f1d1d}.block .tag{background:#dc2626;color:#fff}
.warn{background:#1c1917;border-color:#78350f}.warn .tag{background:#d97706;color:#fff}
.code{font-size:12px;color:#94a3b8;margin-bottom:4px}
.phrase{font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:4px}
.fix{font-size:13px;color:#cbd5e1}
.req{background:#0f172a;border-radius:6px;padding:12px;margin-bottom:16px}
.req pre{font:12px/1.5 monospace;color:#94a3b8;white-space:pre-wrap}
.ok-false{color:#ef4444;font-weight:600}
</style>
</head>
<body>
<h1>JH-7 · Outreach check before sending</h1>
<p class="sub">POST /api/check/outreach — fictional demo</p>

<div class="req">
<pre>POST /api/check/outreach
{
  "text": "Following up on my application. I am available immediately for full-time employment. I built a fraud-detection prototype with 150 automated tests and reduced latency by 60%.",
  "kind": "follow_up",
  "recipient": "noreply@workablemail.com",
  "application_id": "..."
}</pre>
</div>

<p style="margin-bottom:12px"><span class="ok-false">ok: false</span> — 2 blocks, 2 warnings</p>

${DEMO_RESULT.blocks
  .map(
    (b) => `<div class="card block">
<span class="tag">BLOCK</span>
<div class="code">${b.code}</div>
<div class="phrase">"${b.phrase}"</div>
<div class="fix">${b.fix}</div>
</div>`,
  )
  .join("")}

${DEMO_RESULT.warns
  .map(
    (w) => `<div class="card warn">
<span class="tag">WARN</span>
<div class="code">${w.code}</div>
<div class="phrase">"${w.phrase}"</div>
<div class="fix">${w.fix}</div>
</div>`,
  )
  .join("")}
</body>
</html>`;

async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

(async () => {
  await ensureDir(SHOT_DIR);
  await ensureDir(UKJI_DIR);

  const htmlPath = path.join(SHOT_DIR, "_jh7-demo.html");
  await writeFile(htmlPath, HTML, "utf8");

  const execPath = process.env.PLAYWRIGHT_PATH;
  const browser = await chromium.launch({
    executablePath: execPath || undefined,
    headless: true,
  });

  try {
    for (const [name, vp] of [
      ["jh7-outreach-desktop.png", { width: 1280, height: 800 }],
      ["jh7-outreach-mobile.png",  { width: 375,  height: 812 }],
    ]) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 300));
      const shotPath = path.join(SHOT_DIR, name);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`  → ${shotPath}`);
      await copyFile(shotPath, path.join(UKJI_DIR, name));
      console.log(`  → (copied to UKJI)`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log("Done.");
})();
