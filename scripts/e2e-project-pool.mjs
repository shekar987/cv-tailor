// The project pool on Customize and the tailor page, in a real browser (Edge), on the real
// database, with a throwaway account and made-up projects, removed at the end. No model call.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-project-pool.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "pool-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const POOL = `Hailo — Ride-Hailing Platform | 2025
Personal portfolio project modelled on a real-world brief | Tech: React, Node.js
Live: https://hailo-new.example.com | GitHub: https://github.com/alex/hailo-new
- Built the booking flow

Parcel Tracker | Jan 2024 – Present
Tech: Python, AWS
- Tracks parcels across carriers

Notes App
Tech: Java, Spring
- Wrote a notes app

Budget Bot | Mar 2023
Tech: Go
- Sorted bank statements`;
const CV = `Alex Tester
alex.tester@example.com

WORK EXPERIENCE
Software Engineer | Acme | Jan 2024 – Present
• Built the service

Junior Engineer | Bravo | Jan 2022 – Dec 2023
• Wrote the tests

EDUCATION
MSc Computing`;

const email = `pool-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const rest = (p, opts = {}) => fetch(`${SB}/rest/v1/${p}`, { ...opts, headers: { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates", ...(opts.headers ?? {}) } });
  const prefs = async () => (await (await rest(`user_settings?select=preferences&user_id=eq.${created.id}`)).json())[0]?.preferences ?? {};
  const poolRow = async () => (await (await rest(`master_cvs?select=text,projects_pool&user_id=eq.${created.id}`)).json())[0];

  check("seed", (await rest("master_cvs?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, text: CV, projects_pool: POOL }) })).ok);
  await rest("cv_profiles?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, data: { name: "Alex Tester", email: "alex.tester@example.com", phone: "", linkedin: "", github: "", website: "", education: [], certifications: [], rightToWork: [], projects: [] } }) });
  await rest("user_settings?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, preferences: { version: 1, projectLinks: { hailo: { github: "https://github.com/alex/hailo-old", live: "https://hailo-old.example.com" } } } }) });

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A save cut off by this script navigating away reports "Failed to fetch"; that is the script, not the page.
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(m.text()); });

  const openPool = async () => {
    await page.goto(`${BASE}/customize`, { waitUntil: "load" });
    await page.locator("#advanced").waitFor({ timeout: 30000 });
    if ((await page.locator("[data-pool-editor]").count()) === 0 || !(await page.locator("[data-pool-editor]").isVisible())) {
      await page.locator("#advanced button").first().click();
    }
    await page.locator("[data-pool-editor]").waitFor({ timeout: 8000 });
  };

  // ── First load: the review screen ────────────────────────────────────────
  await openPool();
  const review = await page.locator("[data-pool-review]").innerText();
  check("We found 4 projects, check them", /We found 4 projects, check them/.test(review), review);
  check("each reads into a card", (await page.locator("[data-pool-card]").count()) === 4);
  check("the old text is still the source until you confirm", (await poolRow()).projects_pool === POOL);
  check("the stored cards are still empty", ((await prefs()).projectCards ?? []).length === 0);
  check("the label came through", (await page.locator('[data-pool-card="card-1"] [data-pool-label]').inputValue()) === "Personal portfolio project modelled on a real-world brief");
  check("Ongoing came through", await page.locator('[data-pool-card="card-2"] [data-pool-ongoing]').isChecked());
  check("a card with no dates says so", (await page.locator('[data-pool-card="card-3"] [data-pool-no-dates]').count()) === 1);
  check("Auto shows the number it means", /Auto \(3\)/.test(await page.locator('[data-pool-count-choice="auto"]').innerText()), await page.locator('[data-pool-count-choice="auto"]').innerText());
  check("links are pulled from Project links", /hailo-old/.test(await page.locator('[data-pool-card="card-1"] [data-pool-links]').innerText()));
  await page.screenshot({ path: path.join(SHOTS, "review.png"), fullPage: false });

  // Confirm.
  await page.locator("[data-pool-save]").click();
  await page.locator("[data-pool-saved]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const saved = await prefs();
  check("Confirm stores the cards", saved.projectCards?.length === 4, String(saved.projectCards?.length));
  check("and keeps the original text to look back at", saved.poolTextBeforeCards === POOL);
  const regenerated = (await poolRow()).projects_pool;
  check("the pool text now comes from the cards, with nothing lost", ["booking flow", "Tracks parcels", "notes app", "bank statements", "hailo-new"].every((w) => regenerated.includes(w)), regenerated.slice(0, 160));

  // Settings and pins.
  await page.locator('[data-pool-count-choice="2"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-pool-order-choice="date"]').click();
  await page.waitForTimeout(600);
  const s = (await prefs()).projectPoolSettings;
  check("count and order save at once", s?.count === 2 && s?.order === "date", JSON.stringify(s));
  for (const n of [1, 2, 4]) await page.locator(`[data-pool-card="card-${n}"] [data-pool-pin]`).check();
  check("pins past the number warn", (await page.locator("[data-pool-pin-warning]").innerText()) === "You pinned 3 but chose 2.");
  await page.locator(`[data-pool-card="card-4"] [data-pool-pin]`).uncheck();
  await page.locator('[data-pool-card="card-2"] [data-pool-pin]').uncheck();
  check("the warning goes when they fit", (await page.locator("[data-pool-pin-warning]").count()) === 0);
  await page.locator('[data-pool-card="card-3"] [data-pool-start]').fill("Feb 2022");
  check("adding a date clears the hint", (await page.locator('[data-pool-card="card-3"] [data-pool-no-dates]').count()) === 0);
  await page.locator("[data-pool-save]").click();
  await page.waitForFunction(() => document.querySelector("[data-pool-saved]")?.textContent?.includes("Saved 4"), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const after = await prefs();
  check("a pin saves", after.projectCards.find((c) => c.id === "card-1").pinned === true);
  check("the original text is not overwritten by later saves", after.poolTextBeforeCards === POOL);
  await page.screenshot({ path: path.join(SHOTS, "cards.png"), fullPage: true });

  // ── The link conflict ────────────────────────────────────────────────────
  const choice = page.locator('[data-project-links="hailo"] [data-link-choice]');
  await page.locator("#project-links").scrollIntoViewIfNeeded();
  if (!(await choice.isVisible().catch(() => false))) await page.locator("#project-links button").first().click();
  await choice.waitFor({ timeout: 8000 });
  const options = await choice.innerText();
  check("one clear choice between the two", /Which link is correct\?/.test(options) && /hailo-old\.example\.com \+ alex\/hailo-old/.test(options) && /hailo-new\.example\.com \+ alex\/hailo-new/.test(options), options.replace(/\s+/g, " "));
  await choice.locator("[data-link-choice-cv]").check();
  await page.locator("[data-save-links]").click();
  await page.waitForTimeout(1500);
  check("the chosen links are what is saved", !(await prefs()).projectLinks?.hailo, JSON.stringify((await prefs()).projectLinks));
  await page.screenshot({ path: path.join(SHOTS, "links.png") });

  // ── The tailor page ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/app`, { waitUntil: "load" });
  await page.locator("[data-pool-run]").waitFor({ timeout: 30000 });
  check("the tailor page says what it will use", /Projects: 2 · Newest first/.test(await page.locator("[data-pool-run]").innerText()), await page.locator("[data-pool-run]").innerText());
  await page.locator("[data-pool-run-edit]").click();
  await page.locator("[data-pool-run-count]").selectOption("auto");
  check("one run can differ", /Auto \(3\)/.test(await page.locator("[data-pool-run]").innerText()), await page.locator("[data-pool-run]").innerText());
  check("without touching the defaults", (await prefs()).projectPoolSettings.count === 2);

  // ── Replacing the CV keeps everything ────────────────────────────────────
  await openPool();
  await page.locator("button", { hasText: /^Replace$/ }).first().click();
  check("replacing says the pool is kept", /Your project pool is kept/.test(await page.locator("body").innerText()));
  await page.locator("button", { hasText: "Yes, replace" }).click();
  await page.waitForTimeout(1200);
  const row = await poolRow();
  check("the CV is gone", row?.text === "", JSON.stringify(row?.text));
  check("the pool survives a master CV replacement", /booking flow/.test(row?.projects_pool ?? ""));
  const kept = await prefs();
  check("the settings survive it", kept.projectPoolSettings?.count === 2 && kept.projectPoolSettings?.order === "date");
  check("the cards and pins survive it", kept.projectCards?.length === 4 && kept.projectCards.find((c) => c.id === "card-1").pinned === true);
  await page.reload({ waitUntil: "load" });
  await page.locator("textarea").first().waitFor({ timeout: 15000 });
  await page.locator("textarea").first().fill(CV);
  await page.locator("button", { hasText: /Save/ }).first().click();
  await page.waitForTimeout(2500);
  check("a new CV goes in beside the kept pool", (await poolRow()).text.includes("Alex Tester") && /booking flow/.test((await poolRow()).projects_pool));

  // ── Removing the pool asks, and Keep is the default ──────────────────────
  await openPool();
  await page.locator("[data-pool-remove-all]").click();
  check("removing asks first, with Keep pool focused", await page.locator("[data-pool-keep]").evaluate((e) => e === document.activeElement));
  await page.locator("[data-pool-keep]").click();
  check("Keep pool keeps it", /booking flow/.test((await poolRow()).projects_pool));
  await page.locator("[data-pool-remove-all]").click();
  await page.locator("[data-pool-remove-confirm]").click();
  await page.waitForTimeout(1000);
  check("Delete it removes the pool and its cards", (await poolRow()).projects_pool === null && ((await prefs()).projectCards ?? []).length === 0);

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));

  // ── Phone ────────────────────────────────────────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/London" });
  await phone.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  await rest("master_cvs?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, text: CV, projects_pool: POOL }) });
  const small = await phone.newPage();
  await small.goto(`${BASE}/customize`, { waitUntil: "load" });
  await small.locator("#advanced").waitFor({ timeout: 30000 });
  if (!(await small.locator("[data-pool-editor]").isVisible().catch(() => false))) await small.locator("#advanced button").first().click();
  await small.locator("[data-pool-card]").first().waitFor({ timeout: 8000 });
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll on a phone", overflow <= 0, `${overflow}px`);
  await small.screenshot({ path: path.join(SHOTS, "phone.png"), fullPage: false });
  console.log(`Screens in ${SHOTS}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("throwaway user removed:", del.ok);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
