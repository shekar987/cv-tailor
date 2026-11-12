// Chunk 24 in a real browser (Edge), on the real database, with the stand-in model
// (scripts/mock-model.mjs) and throwaway accounts, removed at the end. No paid call:
// /api/extract-profile is answered by the test with a fixed profile, every other route is real.
//
//   1. A brand-new account (signed in through the login form) lands on What's next and sees
//      one first step, "Upload your CV"; no calendar, Clashes, Pipeline or 3 Nov caveat; the
//      banner on other pages; Eligibility "Not set" (the walkthrough's Step 0.1).
//   2. Upload → Save (1 click) → right to work, an explicit choice (2) → "Paste your first job"
//      (3) → the Tailor box with the CV saved, at 1280 and at 390. Only the right-to-work
//      answer is stored: the licences box Customise prefills from the CV is not.
//   3. A real tailor through the mock: the usage chip moves (3 → 2), the score card shows the
//      master CV's figure before tailoring; after "Applied — save to tracker" the CV, the letter
//      and the form answers stay; the CV downloads and a form answer copies; a reload keeps
//      "Saved to tracker"; "Start a new job" clears.
//   4. The tracker opens on the saved row; its CV is one click away (the row's CV button, and
//      the "Just saved" line's).
//   5. The spreadsheet at 390: a Company field with two Missing badges never draws over Role.
//
//   node scripts/mock-model.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock OPENROUTER_API_KEY= GEMINI_API_KEY= npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-first-run.mjs
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
const { extractText, getDocumentProxy } = await import(pathToFileURL(path.resolve("node_modules/unpdf/dist/index.mjs")).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "first-run-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const CV = `Alex Tester
London · alex.tester@example.com · 07700 900123

PROFILE
Software engineer building backend services in Python.

WORK EXPERIENCE
Software Engineer | Northwind Labs | Jul 2024 – Present
• Built REST services in Python and FastAPI, cutting checkout response times by 25%
• Optimised PostgreSQL queries with indexing and caching, improving read times by 30%
Junior Developer | Brightwater Software | Sep 2022 – Jun 2024
• Shipped a React dashboard used daily by 40 support staff

SKILLS
Python, FastAPI, PostgreSQL, React, Git

EDUCATION
BSc Computer Science — University of Leeds — 2:1 (2022)

CERTIFICATIONS
AWS Certified Cloud Practitioner`;
const PROFILE = {
  name: "Alex Tester", tagline: "Software Engineer", location: "London", phone: "07700 900123", email: "alex.tester@example.com",
  linkedin: "", github: "", website: "",
  education: [{ degree: "BSc Computer Science", dates: "2019 – 2022", institution: "University of Leeds", note: "2:1" }],
  certifications: ["AWS Certified Cloud Practitioner"], projects: [], rightToWork: [], extraSections: [],
};
const analysis = {
  company_name: "Marlow Freight", role_title: "Junior Backend Engineer", seniority: "junior",
  required_skills: ["Python", "FastAPI"], nice_to_have_skills: [],
  top_15_ats_keywords: ["Python", "FastAPI", "PostgreSQL", "automated tests", "Computer Science", "Kubernetes"],
  key_responsibilities: [], tone: "plain", hard_gates: [],
};
const JD = `Junior Backend Engineer at Marlow Freight, London (hybrid). Permanent, full time.
Marlow Freight moves parcels for UK online retailers. You will build Python services with FastAPI on PostgreSQL, write automated tests, and learn to run services on Kubernetes with the platform team. A Computer Science degree or similar experience is welcome.
We are a team of twelve and we answer every application within a week.
MOCK ANALYSIS: ${JSON.stringify(analysis)}`;

const accounts = [];
async function newAccount(tag) {
  const email = `first-run-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!created.id) throw new Error(`could not create ${tag}: ${JSON.stringify(created).slice(0, 200)}`);
  const acc = { id: created.id, email, password };
  accounts.push(acc);
  return acc;
}
async function cookieFor(acc) {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email: acc.email, password: acc.password }) })).json();
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
}
const adminRest = async (p, opts = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...opts, headers: { ...admin, Prefer: "return=representation", ...(opts.headers ?? {}) } });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null };
};

let browser;
const consoleErrors = [];
async function openContext(width, acc, { signedIn = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1000 },
    timezoneId: "Europe/London",
    acceptDownloads: true,
    ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  if (signedIn) await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: await cookieFor(acc), url: BASE }]);
  // The one stand-in: extraction would be a model call; the stub answers what the real route does.
  await ctx.route(/\/api\/extract-profile(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, skills: [] }) }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(m.text())) consoleErrors.push(`${width}: ${m.text()}`); });
  return { ctx, page };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const filledButtons = (page) =>
  page.locator("main .cta:not(.secondary):not(.ghost):not(.danger)").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));

try {
  browser = await chromium.launch({ channel: "msedge" });

  // ── 1 + 2: first run, at 1280 (answers right to work) and at 390 (skips it) ─────────────
  const firstRun = {};
  for (const width of [1280, 390]) {
    const acc = await newAccount(width === 1280 ? "desk" : "phone");
    firstRun[width] = acc;
    const { ctx, page } = await openContext(width, acc, { signedIn: false });
    await page.goto(`${BASE}/auth/login`, { waitUntil: "load" });
    await page.locator('input[type="email"]').fill(acc.email);
    await page.locator("#password").fill(acc.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/next/, { timeout: 60000 });
    const guide = page.locator("[data-first-run]");
    await guide.waitFor({ timeout: 60000 });
    check(`${width}: sign-in lands on What's next with the first step current`, (await guide.getAttribute("data-first-run-step")) === "cv");
    check(`${width}: the one filled button is "Upload your CV"`, JSON.stringify(await filledButtons(page)) === JSON.stringify(["Upload your CV"]), JSON.stringify(await filledButtons(page)));
    check(`${width}: no "New event" or "Add an interview or deadline" button`, (await page.locator("[data-new-event]").count()) === 0 && (await page.getByText("Add an interview or deadline").count()) === 0);
    check(`${width}: no empty calendar, Clashes or Pipeline`, (await page.locator("[data-mini-calendar], [data-conflicts], [data-funnel]").count()) === 0);
    check(`${width}: no 3 Nov caveat for a new account`, (await page.locator("[data-funnel-caveat]").count()) === 0);
    check(`${width}: an interview can still be added from the guide`, (await page.locator("[data-first-run-add-event]").count()) === 1);
    check(`${width}: nothing overflows`, await noOverflow(page));
    await page.screenshot({ path: path.join(SHOTS, `next-new-${width}.png`), fullPage: true });

    // Any other page: the one first step.
    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    const banner = page.locator("[data-first-run-banner]");
    await banner.waitFor({ timeout: 30000 }).catch(() => {});
    check(`${width}: Applications says "Start here: upload your CV"`, (await banner.count()) === 1 && /Start here: upload your CV/.test(await banner.innerText()));

    // Step 1: Upload your CV, from What's next.
    await page.goto(`${BASE}/app/next`, { waitUntil: "load" });
    await page.locator("[data-first-run-cv]").click();
    await page.waitForURL(/\/customize/, { timeout: 30000 });
    // textContent: a phone hides a folded section's summary line, which is still what it says.
    const eligSummary = (await page.locator("#eligibility").textContent().catch(() => "")) ?? "";
    check(`${width}: Eligibility starts "Not set" (nothing defaulted)`, /Not set/.test(eligSummary), eligSummary.slice(0, 80));
    const file = path.join(SHOTS, `cv-${width}.txt`);
    fs.writeFileSync(file, CV);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.locator("[role=status].uploadNotice, .uploadNotice").first().waitFor({ timeout: 30000 });
    // From here, every click counts.
    let clicks = 0;
    const click = async (locator) => { clicks++; await locator.click(); };
    await click(page.locator("button", { hasText: /^Save master CV$/ }));
    const rtwChoice = page.locator('[data-first-run-rtw="time_limited"]');
    await rtwChoice.waitFor({ timeout: 60000 });
    check(`${width}: after the save, the next step is right to work`, (await page.locator("[data-first-run]").getAttribute("data-first-run-step")) === "rtw");
    check(`${width}: three answers, none chosen for you`, (await page.locator("[data-first-run-rtw]").count()) === 3);
    await page.screenshot({ path: path.join(SHOTS, `customize-guide-${width}.png`), fullPage: true });
    if (width === 1280) {
      await click(rtwChoice);
      await page.locator('[data-first-run-rtw-answer="time_limited"]').waitFor({ timeout: 30000 });
      check(`${width}: the answer shows as given`, /Time-limited visa/.test(await page.locator("[data-first-run-rtw-answer]").innerText()));
      await click(page.locator("[data-first-run-job]", { hasText: "Paste your first job" }));
    } else {
      await click(page.locator("[data-first-run-job]", { hasText: "Skip to your first job" }));
    }
    await page.waitForURL(/\/app$/, { timeout: 30000 });
    await page.locator("#jd").waitFor({ timeout: 60000 });
    check(`${width}: the Tailor box, with the CV saved, in ${clicks} clicks after the upload (at most 3)`, clicks <= 3 && (await page.locator("#jd").isVisible()));
    const stored = await adminRest(`user_settings?user_id=eq.${acc.id}&select=eligibility`);
    const elig = stored.body?.[0]?.eligibility ?? null;
    if (width === 1280) {
      check(`${width}: only the right-to-work answer is stored`, elig?.rightToWork?.status === "time_limited" && Array.isArray(elig.licences) && elig.licences.length === 0 && elig.availability?.status === "unknown" && elig.yearsExperience === null, JSON.stringify(elig).slice(0, 200));
    } else {
      check(`${width}: skipping stores no answer`, !elig || elig.rightToWork?.status !== "full" && elig.rightToWork?.status !== "time_limited" && elig.rightToWork?.status !== "needs_sponsorship", JSON.stringify(elig).slice(0, 120));
    }
    const cvRow = await adminRest(`master_cvs?user_id=eq.${acc.id}&select=text`);
    check(`${width}: the CV is saved`, /Northwind Labs/.test(cvRow.body?.[0]?.text ?? ""));
    check(`${width}: nothing overflows on Tailor`, await noOverflow(page));
    await ctx.close();
  }

  // ── 3 + 4: a tailor, the save, the tracker (the 1280 account) ───────────────────────────
  {
    const acc = firstRun[1280];
    const { ctx, page } = await openContext(1280, acc);
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.locator("#jd").waitFor({ timeout: 60000 });
    await page.locator(".usageRow").waitFor({ timeout: 30000 });
    const usageBefore = await page.locator(".usageRow").innerText();
    await page.locator("#jd").fill(JD);
    await page.locator("button", { hasText: /^Tailor my CV/ }).first().click();
    const cont = page.locator("button", { hasText: /Continue to full tailoring|Tailor anyway/ }).first();
    await cont.waitFor({ timeout: 60000 });
    const preCheckNote = await page.locator(".gateNote", { hasText: /counted the same way/ }).first().innerText().catch(() => "");
    check("the pre-check says it is the same measure as the score", /same \d+ terms, counted the same way as the search-visibility score/.test(preCheckNote), preCheckNote.slice(0, 160));
    await cont.click();
    await page.locator('[role="dialog"] button', { hasText: /Tailor anyway/ }).first().click({ timeout: 4000 }).catch(() => {});
    await page.locator("[data-game-done]").click({ timeout: 180000 });
    await page.locator(".cvDoc").first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /2 of 3/.test(document.querySelector(".usageRow")?.textContent ?? ""), null, { timeout: 15000, polling: 250 }).catch(() => {});
    const usageAfter = await page.locator(".usageRow").innerText();
    check("the usage chip moves after a real tailor (3 of 3 → 2 of 3)", /Free tailors today:\s*3 of 3/.test(usageBefore) && /Free tailors today:\s*2 of 3/.test(usageAfter), `${usageBefore} → ${usageAfter}`);
    const before = page.locator("[data-score-before]");
    check("the score card shows the master CV's figure before tailoring", (await before.count()) === 1 && /^Before tailoring: \d+\/6 in your master CV\./.test(await before.innerText()), await before.innerText().catch(() => ""));
    check("…and names what moved", /Computer Science/.test(await before.innerText().catch(() => "")), await before.innerText().catch(() => ""));

    // Applied — save to tracker.
    await page.locator("button[data-applied]").first().click();
    await page.locator("[data-send-anyway]").click({ timeout: 4000 }).catch(() => {});
    const savedLink = page.locator("a[data-applied-link]");
    await savedLink.waitFor({ timeout: 30000 });
    const href = await savedLink.getAttribute("href");
    const savedId = /saved=([0-9a-f-]+)/.exec(href ?? "")?.[1] ?? "";
    check('"Saved to tracker" links to that application', /Saved to tracker/.test(await savedLink.innerText()) && !!savedId, href ?? "");
    check('"Start a new job" is offered beside it', (await page.locator("[data-new-job]").count()) === 1);
    check("the CV, the letter and the form answers are still on screen", (await page.locator(".cvDoc").count()) >= 1 && (await page.locator("[data-answer-key]").count()) >= 1 && (await page.locator("[data-applied-cleared]").count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, "app-saved-1280.png"), fullPage: true });

    // The CV still downloads, and its text is real.
    await page.locator(".dlBtn").first().click();
    const dl = page.waitForEvent("download", { timeout: 30000 });
    await page.locator(".dlItem", { hasText: /PDF/ }).first().click();
    const download = await dl;
    const pdfPath = path.join(SHOTS, "saved-cv.pdf");
    await download.saveAs(pdfPath);
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
    check("after saving, the CV downloads as a PDF with its text", bytes.length > 1000 && /Alex Tester/.test(text) && /Northwind Labs/.test(text), `${bytes.length} bytes`);

    // A form answer still copies.
    const answerKey = await page.locator("[data-copy-answer]").first().getAttribute("data-copy-answer");
    const answerText = await page.locator(`[data-answer-key="${answerKey}"] .formAnswers__a`).first().innerText();
    await page.locator("[data-copy-answer]").first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    check("after saving, a form answer copies", !!answerText && clip === answerText, `${answerKey}: ${clip}`);
    check("the form answers come from the right-to-work answer given", /No/.test(await page.locator('[data-answer-key="sponsorship"]').innerText().catch(() => "")));
    // Typing in the form-question box is not an edit of the document; typing in the CV is.
    check("nothing says the CV changed before it did", (await page.locator("[data-changed-since-saved]").count()) === 0);
    await page.locator(".cvDoc .cvJobHeader").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await page.locator("[data-changed-since-saved]").waitFor({ timeout: 5000 }).catch(() => {});
    check("an edit after the save says the tracker keeps the saved version", (await page.locator("[data-changed-since-saved]").count()) === 1);

    // A reload keeps the result and its saved state.
    await page.reload({ waitUntil: "load" });
    await page.locator("a[data-applied-link]").waitFor({ timeout: 60000 }).catch(() => {});
    check("a reload keeps the result as saved", (await page.locator("a[data-applied-link]").count()) === 1 && (await page.locator(".cvDoc").count()) >= 1);

    // 4: the tracker opens on it, the CV one click away.
    await page.locator("a[data-applied-link]").click();
    await page.waitForURL(/\/applications/, { timeout: 30000 });
    const strip = page.locator(`[data-just-saved="${savedId}"]`);
    await strip.waitFor({ timeout: 60000 });
    check('"Just saved: Marlow Freight" at the top', /Just saved:\s*Marlow Freight/.test(await strip.innerText()), await strip.innerText());
    check("the ?saved= link is read once and leaves the address", !/saved=/.test(page.url()), page.url());
    await page.locator('[role="tab"][aria-selected="true"]').first().waitFor({ timeout: 30000 });
    const openTab = await page.locator('[role="tab"][aria-selected="true"]').first().innerText();
    check("the tracker opens on the tab that holds it", /Applied/.test(openTab), openTab);
    const row = page.locator('[data-stage-row="Marlow Freight"]');
    await row.waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, "tracker-open-1280.png") });
    await row.locator('[data-row-doc="cv"]').click();
    const panel = page.locator(`[data-panel-row="${savedId}"]`);
    await panel.locator(".cvDoc").first().waitFor({ timeout: 30000 });
    check("its CV in one click from the row", (await panel.locator(".cvDoc").first().isVisible()) && /Northwind Labs/.test(await panel.locator(".cvDoc").first().innerText()));
    await row.locator('[data-row-doc="letter"]').click();
    const letter = panel.locator('[data-panel-doc="letter"]');
    await letter.waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const inView = await letter.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    check("its letter in one click, scrolled to", inView);
    await page.screenshot({ path: path.join(SHOTS, "tracker-saved-1280.png"), fullPage: false });

    // From the nav instead: the "Just saved" line's CV.
    const page2 = await ctx.newPage();
    await page2.goto(`${BASE}/applications`, { waitUntil: "load" });
    const strip2 = page2.locator(`[data-just-saved="${savedId}"]`);
    await strip2.waitFor({ timeout: 60000 });
    await strip2.locator('[data-just-saved-doc="cv"]').click();
    await page2.locator(`[data-panel-row="${savedId}"] .cvDoc`).first().waitFor({ timeout: 30000 });
    check("from the nav, the \"Just saved\" line's CV is one click", await page2.locator(`[data-panel-row="${savedId}"] .cvDoc`).first().isVisible());
    await page2.locator("[data-just-saved-dismiss]").click();
    check("the line closes when dismissed", (await page2.locator("[data-just-saved]").count()) === 0);
    await page2.close();

    // Start a new job.
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.locator("[data-new-job]").click({ timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector(".cvDoc"), null, { timeout: 15000, polling: 250 });
    check('"Start a new job" clears the result and the box', (await page.locator("#jd").inputValue()) === "" && (await page.evaluate(() => document.activeElement?.id)) === "jd");
    await page.reload({ waitUntil: "load" });
    await page.locator("#jd").waitFor({ timeout: 60000 });
    check("…and it stays cleared", (await page.locator(".cvDoc").count()) === 0 && (await page.locator("#jd").inputValue()) === "");
    await ctx.close();

    // The same row on a phone: its CV and Letter buttons, one tap to the CV.
    const phone = await openContext(390, acc);
    await phone.page.goto(`${BASE}/applications`, { waitUntil: "load" });
    const phoneRow = phone.page.locator('[data-stage-row="Marlow Freight"]');
    await phoneRow.waitFor({ timeout: 60000 });
    check("390: the row shows CV and Letter", (await phoneRow.locator('[data-row-doc="cv"]').isVisible()) && (await phoneRow.locator('[data-row-doc="letter"]').isVisible()));
    await phone.page.screenshot({ path: path.join(SHOTS, "tracker-row-390.png") });
    await phoneRow.locator('[data-row-doc="cv"]').click();
    await phone.page.locator(`[data-panel-row] .cvDoc`).first().waitFor({ timeout: 30000 });
    check("390: its CV in one tap", await phone.page.locator(`[data-panel-row] .cvDoc`).first().isVisible());
    check("390: nothing overflows on Applications", await noOverflow(phone.page));
    await phone.ctx.close();
  }

  // ── 5: the spreadsheet at 390; an account with rows and no CV ───────────────────────────
  {
    const acc = await newAccount("sheet");
    const rows = [
      { user_id: acc.id, company_name: "Kestrel Energy", role: "Software Engineer", status: "screening", date_applied: "2026-10-28", source: "manual", notes: "Recruiter call booked." },
      { user_id: acc.id, company_name: "Oakridge Bank", role: "Backend Engineer", status: "applied", date_applied: "2026-11-03", source: "manual", notes: null },
    ];
    const ins = await adminRest("applications", { method: "POST", body: JSON.stringify(rows) });
    check("seed rows", ins.ok, String(ins.status));
    const { ctx, page } = await openContext(390, acc);
    await page.goto(`${BASE}/app/next`, { waitUntil: "load" });
    await page.locator("[data-first-run-banner]").waitFor({ timeout: 60000 }).catch(() => {});
    check("rows but no CV: What's next shows the one first step, the plan stays", (await page.locator("[data-first-run-banner]").count()) === 1 && (await page.locator("[data-first-run]").count()) === 0 && (await page.locator("[data-funnel]").count()) === 1);
    check("no 3 Nov caveat for an account made after it", (await page.locator("[data-funnel-caveat]").count()) === 0);

    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    await page.locator("button", { hasText: /Open as spreadsheet/ }).click({ timeout: 60000 });
    await page.locator("[role=tab]", { hasText: /^All/ }).click({ timeout: 15000 }).catch(() => {});
    const card = page.locator("tr.appsRow", { hasText: "Kestrel Energy" });
    await card.waitFor({ timeout: 30000 });
    // Where the Company field's content ends (a cell's own box never overlaps the next; what it
    // holds can spill out of it), against where the Role field's content starts.
    // Two measures. The words: where the Company field's text ends against where Role's starts
    // (what the walkthrough saw). The tap areas: every box the Company field holds, against the
    // top of the Role field (an inline link reaches its 44px with negative margins).
    const measure = () => card.evaluate((tr) => {
      const company = tr.querySelector('td[data-label="Company Name"]');
      const role = tr.querySelector('td[data-label="Role"]');
      const textRects = (el) => {
        const out = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          out.push(...range.getClientRects());
        }
        return out.filter((r) => r.width > 0 && r.height > 0);
      };
      const companyBottom = Math.max(...textRects(company).map((r) => r.bottom));
      const roleTop = Math.min(...textRects(role).map((r) => r.top));
      const tapBottom = Math.max(...[...company.querySelectorAll("button, a, select")].map((e) => e.getBoundingClientRect().bottom));
      const roleFieldTop = role.getBoundingClientRect().top;
      const dot = tr.querySelector(".appsGateDot").getBoundingClientRect();
      const missing = tr.querySelectorAll("[data-missing]").length;
      return { companyBottom, roleTop, tapBottom, roleFieldTop, dotWidth: dot.width, missing };
    });
    const m = await measure();
    check("the row carries both Missing badges", m.missing === 2, String(m.missing));
    check("its Company field's words end above its Role field's", m.companyBottom <= m.roleTop + 0.5, JSON.stringify(m));
    check("its tap areas stay out of the Role field", m.tapBottom <= m.roleFieldTop + 0.5, JSON.stringify(m));
    check("the gate is a dot, not a bar", m.dotWidth <= 10, String(m.dotWidth));
    check("the gate says its word on a phone", /Not checked|Clear|Knockout|Long shot/.test(await card.locator(".appsGateLabel").innerText().catch(() => "")));
    await card.screenshot({ path: path.join(SHOTS, "sheet-card-390.png") });
    // The check catches the old rule: put the desktop row height back and it fails.
    await page.addStyleTag({ content: ".appsTable td { height: 44px !important; }" });
    const old = await measure();
    check("(self-check) the old fixed height would overlap", old.companyBottom > old.roleTop + 0.5, JSON.stringify(old));
    await ctx.close();
  }

  check("no page errors", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
} finally {
  await browser?.close().catch(() => {});
  for (const acc of accounts) {
    await fetch(`${SB}/rest/v1/applications?user_id=eq.${acc.id}`, { method: "DELETE", headers: admin }).catch(() => {});
    await fetch(`${SB}/auth/v1/admin/users/${acc.id}`, { method: "DELETE", headers: admin }).catch(() => {});
  }
  console.log(`\n${pass} passed, ${fail} failed. Screenshots in ${SHOTS}`);
  process.exitCode = fail ? 1 : 0;
}
