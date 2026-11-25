// Chunk 34: a screenshot of /agent ("Auto-apply") showing the PC worker's
// dry-run outcome and live status, in a real browser (Edge). Like Chunk 33's
// e2e-agent.mjs this does NOT touch the database — it mocks the two
// /api/agent/* GET routes with made-up data (a job the worker took to
// "Dry run done", and a device last seen moments ago so the "Worker online"
// pill shows), and uses a throwaway account only so the auth middleware lets
// the page render. The throwaway user is removed at the end. No model call.
//
//   npx next start -p 3100        (after: npm run build)
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node scripts/e2e-worker-dry-run.mjs
//
// Writes 03-worker-dry-run.png to OUT (default: the audit folder for 2026-11-19).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const OUT = process.env.OUT || path.resolve("../jobhuntz-audit/2026-11-19/screenshots/03-worker-dry-run.png");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);

const iso = (secsAgo) => new Date(Date.now() - secsAgo * 1000).toISOString();

// Fictional queue — the worker has just finished a dry run on the top job.
const JOBS = [
  { id: "1", job_url: "https://jobs.ashbyhq.com/lumen/a1b2c3d4-e5f6-4789-abcd-ef0123456789", company: "Lumen Health", role: "Software Engineer", ats: "ashby", status: "dry_run_done", mode: "dry_run", attempts: 1, last_error: null, confirmation_url: null, created_at: iso(300), last_event: { ts: iso(20), level: "info", step: "dry_run", message: "Dry run: no browser yet" } },
  { id: "2", job_url: "https://jobs.lever.co/brightwave/9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8", company: "Brightwave", role: "Full Stack Developer", ats: "lever", status: "processing", mode: "dry_run", attempts: 1, last_error: null, confirmation_url: null, created_at: iso(200), last_event: { ts: iso(3), level: "info", step: "claimed", message: "Claimed by Shekar's PC." } },
  { id: "3", job_url: "https://apply.workable.com/northgate/j/ABCDEF1234/", company: "Northgate Systems", role: "Graduate Software Engineer", ats: "workable", status: "queued", mode: "dry_run", attempts: 0, last_error: null, confirmation_url: null, created_at: iso(60), last_event: null },
  { id: "4", job_url: "https://boards.greenhouse.io/madeupco/jobs/4100001", company: "Nimbus Data", role: "Backend Engineer", ats: "greenhouse", status: "failed", mode: "dry_run", attempts: 2, last_error: "Stopped by Ctrl+C before finishing.", confirmation_url: null, created_at: iso(400), last_event: { ts: iso(120), level: "error", step: "failed", message: "Stopped by Ctrl+C before finishing." } },
];
// Device last seen 20s ago → "Worker online".
const DEVICES = [{ id: "d1", name: "Shekar's PC", last_seen_at: iso(20), revoked: false, created_at: iso(5000) }];

const email = `worker-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);

  await ctx.route("**/api/agent/jobs", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { jobs: JOBS } });
    return route.fulfill({ json: { queued: [], queuedCount: 0, duplicates: [], rejected: [] } });
  });
  await ctx.route("**/api/agent/devices", (route) => route.fulfill({ json: { devices: DEVICES } }));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/agent`, { waitUntil: "load" });
  await page.locator("[data-job-row]").first().waitFor({ timeout: 30000 });
  await page.locator("[data-worker-pill]").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("PASS wrote screenshot:", OUT);
  console.log("PASS jobs rendered:", await page.locator("[data-job-row]").count());
  console.log("PASS worker pill:", await page.locator("[data-worker-pill]").first().innerText());
} finally {
  if (browser) await browser.close();
  await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin }).catch(() => {});
}
