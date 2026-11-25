// Chunk 33: a screenshot of /agent ("Auto-apply") with fictional data, in a real
// browser (Edge). The agent-queue migration (20261119120000) is not applied to
// the live project yet, so this does NOT seed the database — it mocks the two
// /api/agent/* GET routes with made-up jobs and a device, and uses a throwaway
// account only so the auth middleware lets the page render. The throwaway user
// is removed at the end. No model call, no database writes beyond the test user.
//
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node scripts/e2e-agent.mjs
//
// Writes 01-agent-queue.png to OUT (default: the audit folder for 2026-11-19).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const OUT = process.env.OUT || path.resolve("../jobhuntz-audit/2026-11-19/screenshots/01-agent-queue.png");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60_000).toISOString();

// Fictional queue — every made-up company and role. Covers the status range so
// the pills and the actions all show.
const JOBS = [
  { id: "1", job_url: "https://boards.greenhouse.io/madeupco/jobs/4100001", company: "Nimbus Data", role: "Backend Engineer", ats: "greenhouse", status: "submitted", mode: "submit", attempts: 1, last_error: null, confirmation_url: "https://boards.greenhouse.io/madeupco/confirmation/4100001", created_at: iso(120), last_event: { ts: iso(30), level: "info", step: "submit", message: "Application submitted — confirmation shown" } },
  { id: "2", job_url: "https://jobs.lever.co/brightwave/9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8", company: "Brightwave", role: "Full Stack Developer", ats: "lever", status: "processing", mode: "dry_run", attempts: 1, last_error: null, confirmation_url: null, created_at: iso(90), last_event: { ts: iso(2), level: "info", step: "fill", message: "Filling in work experience" } },
  { id: "3", job_url: "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/London/Platform-Engineer_R-204", company: "Acme Robotics", role: "Platform Engineer", ats: "workday", status: "needs_human", mode: "dry_run", attempts: 1, last_error: null, confirmation_url: null, created_at: iso(75), last_event: { ts: iso(10), level: "warn", step: "question", message: "Stopped for a sensitive question: right to work" } },
  { id: "4", job_url: "https://jobs.ashbyhq.com/lumen/a1b2c3d4-e5f6-4789-abcd-ef0123456789", company: "Lumen Health", role: "Software Engineer", ats: "ashby", status: "dry_run_done", mode: "dry_run", attempts: 1, last_error: null, confirmation_url: null, created_at: iso(60), last_event: { ts: iso(15), level: "info", step: "review", message: "Filled in, stopped before submit — ready for you to check" } },
  { id: "5", job_url: "https://apply.workable.com/northgate/j/ABCDEF1234/", company: "Northgate Systems", role: "Graduate Software Engineer", ats: "workable", status: "queued", mode: "dry_run", attempts: 0, last_error: null, confirmation_url: null, created_at: iso(30), last_event: null },
  { id: "6", job_url: "https://madeupco.pinpointhq.com/en/postings/5d8f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b", company: "Pinecrest Labs", role: "Junior Developer", ats: "pinpoint", status: "failed", mode: "dry_run", attempts: 2, last_error: "The form changed after loading — will retry", confirmation_url: null, created_at: iso(20), last_event: { ts: iso(18), level: "error", step: "navigate", message: "The application form didn't load in time" } },
];
const DEVICES = [{ id: "d1", name: "My PC", last_seen_at: iso(3), revoked: false, created_at: iso(300) }];

const email = `agent-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);

  // Mock the two agent GET routes with fictional data (the migration isn't live).
  await ctx.route("**/api/agent/jobs", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { jobs: JOBS } });
    return route.fulfill({ json: { queued: [], queuedCount: 0, duplicates: [], rejected: [] } });
  });
  await ctx.route("**/api/agent/devices", (route) => route.fulfill({ json: { devices: DEVICES } }));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/agent`, { waitUntil: "load" });
  await page.locator("[data-agent-jobs]").waitFor({ timeout: 30000 });
  await page.locator("[data-job-row]").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("PASS wrote screenshot:", OUT);
  console.log("PASS jobs rendered:", await page.locator("[data-job-row]").count());
} finally {
  if (browser) await browser.close();
  await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin }).catch(() => {});
}
