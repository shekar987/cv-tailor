// Chunk 17 on /app in a real browser (Edge), on the real database, with the stand-in model
// (scripts/mock-model.mjs) and a throwaway account, removed at the end. No paid call. The
// pre-check's core-gap banner and rename lines before any credit, then a run: the Missing list
// says which gaps are a rename, and a suggestion the CV can't back needs the user's evidence.
//
//   node scripts/mock-model.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock OPENROUTER_API_KEY= GEMINI_API_KEY= npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-gap-banner.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("This script tailors: run it only against a local server with the mock model.");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "gap-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const CV = `Alex Tester
alex.tester@example.com

WORK EXPERIENCE
Software Engineer | Northgate Systems | Jan 2022 – Present
• Diagnosed and resolved production incidents across three Python services, cutting repeat tickets by 30%
• Built REST APIs in FastAPI serving 2,000 daily users
• Added structured logging and Grafana dashboards for the payments service

SKILLS
Python, FastAPI, PostgreSQL, Docker, Grafana

EDUCATION
MSc Computing`;
const analysis = {
  company_name: "Acme Networks",
  role_title: "Customer Support Engineer",
  seniority: "junior",
  required_skills: ["Troubleshooting", "DNS", "Routing", "Firewalls"],
  nice_to_have_skills: [],
  top_15_ats_keywords: ["HTTP", "Python", "Troubleshooting", "DNS"],
  key_responsibilities: [],
  tone: "plain",
};
const JD = `Customer Support Engineer at Acme Networks, London. You will resolve networking issues for customers by email and chat: DNS, routing, firewalls and IP addressing, across macOS, Windows and Linux. You will troubleshoot configuration problems, write help articles, and pass recurring issues to the product team. Permanent, hybrid in London. We are a team of twelve and we answer every customer within a day.
MOCK ANALYSIS: ${JSON.stringify(analysis)}`;

const email = `gap-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const rest = (p, opts = {}) => fetch(`${SB}/rest/v1/${p}`, { ...opts, headers: { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates", ...(opts.headers ?? {}) } });
  check("seed", (await rest("master_cvs?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, text: CV }) })).ok);
  await rest("cv_profiles?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, data: { name: "Alex Tester", email: "alex.tester@example.com", phone: "", linkedin: "", github: "", website: "", education: [], certifications: [], rightToWork: [], projects: [] } }) });
  await rest("user_settings?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, eligibility: { version: 1, yearsExperience: 2 } }) });

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/app`, { waitUntil: "load" });
  await page.locator("textarea#jd, textarea").first().fill(JD);
  await page.locator("button", { hasText: /^Tailor my CV/ }).first().click();
  const banner = page.locator("[data-gate-core-gaps]");
  await banner.waitFor({ timeout: 60000 });
  check("the core-gap banner shows before any credit", /^3 core gaps: DNS, Routing, Firewalls\. This role may not suit you\./.test(await banner.innerText()), await banner.innerText());
  const continueButton = page.locator("button", { hasText: /Continue to full tailoring|Tailor anyway/ }).first();
  check("and the button asks to tailor anyway", /Tailor anyway \(uses a credit\)/.test(await continueButton.innerText()), await continueButton.innerText());
  const rename = page.locator('[data-evidence-map] li[data-gap-class="rename"]').first();
  check("troubleshooting shows the master CV line it maps to", /Troubleshooting[\s\S]*Your CV may show it as “Diagnosed and resolved production incidents/.test(await rename.innerText()), await rename.innerText());
  check("a core gap says so", (await page.locator('[data-evidence-map] li[data-gap-class="core"]').count()) >= 3);
  await banner.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "gate-core-gaps.png"), fullPage: false });

  await continueButton.click();
  await page.locator('[role="dialog"] button', { hasText: /Tailor anyway/ }).first().click({ timeout: 6000 }).catch(() => {});
  await page.locator("button", { hasText: "Back to my CV" }).click({ timeout: 120000 });
  const needs = page.locator("[data-needs-evidence]");
  await needs.waitFor({ timeout: 30000 });
  check("a suggestion the CV can't back needs the user's evidence", /HTTP: your CV may show the work as/.test(await needs.innerText()) && !/Optimised HTTP/.test(await page.locator(".resultsRail, aside").first().innerText()), await needs.innerText());
  const missHttp = page.locator('li[data-miss-class]', { hasText: "HTTP" }).first();
  check("the Missing list says HTTP is a rename, with the CV's line", /Your CV may show this as “Built REST APIs/.test(await missHttp.innerText().catch(() => "")), await missHttp.innerText().catch(() => "(none)"));
  const missDns = page.locator('li[data-miss-class="core"]', { hasText: "DNS" }).first();
  check("and DNS is a core gap", /Core gap/.test(await missDns.innerText().catch(() => "")), await missDns.innerText().catch(() => "(none)"));
  await needs.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "result-needs-evidence.png"), fullPage: false });
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(`Screens in ${SHOTS}`);
} catch (err) {
  check("ran to the end", false, err.message.slice(0, 300));
} finally {
  await browser?.close();
  const removed = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway user removed: ${removed.ok}`);
  process.exit(fail ? 1 : 0);
}
