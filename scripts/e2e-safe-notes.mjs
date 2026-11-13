// Chunk 21 in a real browser (Edge) on the real database with a throwaway account, removed at
// the end; the stand-in model (scripts/mock-model.mjs) for /app's pre-check, so no paid call.
// Until migration 20261110120000 is applied, the routes that need it are stood in: the list's
// deadline columns, the notes history read and the company rules API. The notes rules
// themselves (the version, the 409, the retry, the conflict) run on the real route.
//
//   node scripts/mock-model.mjs &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock OPENROUTER_API_KEY= GEMINI_API_KEY= npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-safe-notes.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("Run this only against a local server with the mock model.");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "safe-notes-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const CV = `Alex Tester
alex.tester@example.com

WORK EXPERIENCE
Software Engineer | Northgate Systems | Jan 2022 – Present
• Built REST APIs in FastAPI serving 2,000 daily users
• Added structured logging and Grafana dashboards for the payments service

SKILLS
Python, FastAPI, PostgreSQL, Docker

EDUCATION
MSc Computing`;
const jdFor = (company, role) => `${role} at ${company}, London. You will build Python services and REST APIs with FastAPI and PostgreSQL, write tests, and work with the product team on new features for our customers. Permanent, hybrid in London, a team of twelve.
MOCK ANALYSIS: ${JSON.stringify({ company_name: company, role_title: role, seniority: "junior", required_skills: ["Python", "FastAPI"], nice_to_have_skills: [], top_15_ats_keywords: ["Python", "FastAPI", "PostgreSQL"], key_responsibilities: [], tone: "plain" })}`;

const email = `safe-notes-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;
  const api = async (method, body, query = "") => {
    const res = await fetch(`${BASE}/api/applications${query}`, { method, headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const notesOf = async (id) => (await api("GET", undefined, `?id=${id}`)).body.application?.notes ?? null;
  const rest = (p, opts = {}) => fetch(`${SB}/rest/v1/${p}`, { ...opts, headers: { apikey: PUB, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates", ...(opts.headers ?? {}) } });
  await rest("master_cvs?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, text: CV }) });
  await rest("cv_profiles?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, data: { name: "Alex Tester", email: "alex.tester@example.com", phone: "", linkedin: "", github: "", website: "", education: [], certifications: [], rightToWork: [], projects: [] } }) });
  await rest("user_settings?on_conflict=user_id", { method: "POST", body: JSON.stringify({ user_id: created.id, eligibility: { version: 1, yearsExperience: 2 } }) });
  const add = async (fields) => (await api("POST", { role: "Engineer", date_applied: "2026-11-02", ...fields })).body.id;
  const greenbeam = await add({ company_name: "Greenbeam", role: "Graduate Analyst", status: "Applied", notes: "Applied on 2 Nov.\nRecruiter: Sam" });
  const northwind = await add({ company_name: "Northwind Apps", role: "Software Engineer", status: "Rejected", date_applied: "2026-07-05", notes: "Rejected. Please wait at least one year before applying again." });
  const litware = await add({ company_name: "Litware", role: "Data Analyst", status: "Applied" });
  check("seeded", !!greenbeam && !!northwind && !!litware);

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // ── Stand-ins for what needs migration 20261110120000 ──────────────────────────
  const due = Date.now() + 30 * 3_600_000;
  let deadlineOn = true;
  let donePut = null;
  await page.route(/\/api\/applications(\?.*)?$/, async (route) => {
    const req = route.request();
    // Every list read: the first page (?stage=&limit=), the full list (?all=1) and the sweeps' plain GET.
    const q = new URL(req.url()).searchParams;
    if (req.method() === "GET" && !q.has("id") && !q.has("due") && deadlineOn) {
      const res = await route.fetch();
      const body = await res.json();
      for (const r of body.applications ?? []) {
        if (r.id === litware) Object.assign(r, { next_deadline: new Date(due).toISOString(), applied_from_email: "second.inbox@example.com", deadline_note: "Complete the Litware assessment" });
      }
      return route.fulfill({ response: res, json: body });
    }
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      if ("next_deadline" in body) {
        donePut = body;
        deadlineOn = false;
        return route.fulfill({ json: { ok: true, notes: `10 Nov 2026 18:00 ${body.append_note}`, updated_at: new Date().toISOString() } });
      }
    }
    return route.continue();
  });
  await page.route(/\/api\/applications\/[^/]+\/notes-history$/, (route) =>
    route.fulfill({ json: { history: [{ id: "v1", old_notes: "Applied on 2 Nov.\nRecruiter: Sam", changed_at: "2026-11-10T09:00:00Z" }] } })
  );
  const rules = [];
  const rulePosts = [];
  await page.route(/\/api\/company-rules$/, async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      rulePosts.push(body);
      const rule = { id: `r${rules.length + 1}`, anchor_date: null, dismissed_at: null, ...body };
      rules.unshift(rule);
      return route.fulfill({ json: { ok: true, rule } });
    }
    return route.fulfill({ json: { rules } });
  });

  // ── The deadline radar ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  const radar = page.locator("[data-due-radar]");
  await radar.waitFor({ timeout: 30000 });
  check("the red strip says what is due in the next 48 hours", /Due in the next 48 hours/.test(await radar.innerText()));
  const item = radar.locator(`[data-due-id="${litware}"]`);
  check("with the action in words and the inbox it went to", (await item.locator(".dueRadar__action").innerText()) === "Complete the Litware assessment, invite went to second.inbox@example.com", await item.innerText());
  check("and when, in UK time, in hours", /· due in (29|30)h$/.test(await item.locator(".dueRadar__when").innerText()), await item.locator(".dueRadar__when").innerText());
  await page.screenshot({ path: path.join(SHOTS, "1-radar.png"), fullPage: false });
  await item.locator("[data-due-open]").click();
  const editor = page.locator("[data-deadline-editor]");
  await editor.waitFor({ timeout: 10000 });
  check("Open shows the row with its deadline fields filled", (await editor.locator("[data-applied-from]").inputValue()) === "second.inbox@example.com" && (await editor.locator("[data-deadline-note]").inputValue()) === "Complete the Litware assessment");
  await page.screenshot({ path: path.join(SHOTS, "2-deadline-editor.png"), fullPage: false });
  await item.locator("[data-due-done]").click();
  await radar.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("Done clears the deadline and notes it", donePut?.next_deadline === null && /^Done: Complete the Litware assessment, invite went to second\.inbox@example\.com \(was due /.test(donePut?.append_note ?? ""), JSON.stringify(donePut));
  check("and the strip is gone", (await page.locator("[data-due-radar]").count()) === 0);

  // ── Notes: the version, a plain save ──────────────────────────────────────────
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  await page.locator('[data-stage-tab="applied"]').click();
  const openNotes = async (company) => {
    const row = page.locator(`[data-stage-row="${company}"]`);
    await row.locator("[data-row-menu]").click();
    await row.locator('[data-menu-item="notes"]').click();
    const box = page.locator('textarea[aria-label="Notes"]');
    await box.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="Notes"]'); return t && !t.disabled; }, null, { timeout: 15000 });
    return box;
  };
  let box = await openNotes("Greenbeam");
  check("the notes open with the full text", (await box.inputValue()) === "Applied on 2 Nov.\nRecruiter: Sam");
  await box.fill("Applied on 2 Nov.\nRecruiter: Sam\nCalled Sam on Monday");
  await page.locator("button", { hasText: /^Save$/ }).first().click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Notes"]'), null, { timeout: 15000 }).catch(() => {});
  check("a save on the version read lands", (await notesOf(greenbeam)) === "Applied on 2 Nov.\nRecruiter: Sam\nCalled Sam on Monday");

  // A sweep appends while the box is open: the save stops and shows both.
  box = await openNotes("Greenbeam");
  await box.fill("Applied on 2 Nov.\nRecruiter: Sam\nCalled Sam on Monday\nMy draft line");
  const swept = await api("PUT", { id: greenbeam, append_note: "Assessment invite from the sweep" });
  check("(the sweep's append lands)", swept.status === 200);
  await page.locator("button", { hasText: /^Save$/ }).first().click();
  const conflict = page.locator("[data-notes-conflict]");
  await conflict.waitFor({ timeout: 15000 });
  check("the save is refused and shows the notes as saved now", /Assessment invite from the sweep/.test(await conflict.innerText()));
  check("the draft is still in the box", (await box.inputValue()).endsWith("My draft line"));
  const stored = await notesOf(greenbeam);
  check("and nothing of the draft was saved over the sweep's line", /Assessment invite from the sweep/.test(stored) && !/My draft line/.test(stored));
  await page.screenshot({ path: path.join(SHOTS, "3-notes-conflict.png"), fullPage: false });
  await page.locator("[data-notes-use-latest]").click();
  check("Use the saved notes puts them in the box", /Assessment invite from the sweep/.test(await box.inputValue()));
  await box.fill(`${await box.inputValue()}\nBooked the assessment`);
  await page.locator("button", { hasText: /^Save$/ }).first().click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Notes"]'), null, { timeout: 15000 }).catch(() => {});
  const merged = await notesOf(greenbeam);
  check("then saving keeps the sweep's line and the user's", /Assessment invite from the sweep/.test(merged) && merged.endsWith("Booked the assessment"));

  // Another column moves while the box is open: the save retries on its own.
  box = await openNotes("Greenbeam");
  const before = await box.inputValue();
  await box.fill(`${before}\nRetry draft`);
  check("(a salary edit elsewhere lands)", (await api("PUT", { id: greenbeam, salary: "£30k" })).status === 200);
  await page.locator("button", { hasText: /^Save$/ }).first().click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Notes"]'), null, { timeout: 15000 }).catch(() => {});
  check("a version moved by another column only: saved without asking", (await notesOf(greenbeam)).endsWith("Retry draft") && (await page.locator("[data-notes-conflict]").count()) === 0);

  // Restore previous notes.
  box = await openNotes("Greenbeam");
  await page.locator("[data-notes-history] > summary").click();
  const version = page.locator('[data-notes-version="v1"]');
  await version.waitFor({ timeout: 10000 });
  await version.locator("summary").click();
  await page.screenshot({ path: path.join(SHOTS, "4-notes-history.png"), fullPage: false });
  const puts = [];
  const onResponse = async (res) => {
    if (res.request().method() === "PUT" && /\/api\/applications$/.test(res.url())) puts.push(`${res.status()} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  };
  page.on("response", onResponse);
  await version.locator("[data-notes-restore]").click();
  await page.locator("[data-confirm-dialog]").waitFor({ timeout: 10000 });
  await page.locator("[data-confirm-ok]").click();
  await page.waitForTimeout(1500);
  page.off("response", onResponse);
  await page.screenshot({ path: path.join(SHOTS, "4b-after-restore.png"), fullPage: false });
  console.log("info: restore PUTs:", JSON.stringify(puts));
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Notes"]') || document.querySelector('textarea[aria-label="Notes"]').value === "Applied on 2 Nov.\nRecruiter: Sam", null, { timeout: 15000 }).catch(() => {});
  check("Restore puts the earlier version back", (await notesOf(greenbeam)) === "Applied on 2 Nov.\nRecruiter: Sam", JSON.stringify(await notesOf(greenbeam)));

  // ── A reapply rule from a rejection, one click ───────────────────────────────
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  await page.locator('[data-stage-tab="closed"]').click();
  await openNotes("Northwind Apps");
  const suggestion = page.locator('[data-rule-suggestion="reapply_after_days"]');
  await suggestion.waitFor({ timeout: 10000 });
  check("the notes' wait is offered as a rule", /Please wait at least one year before applying again\./.test(await suggestion.innerText()));
  await suggestion.locator("[data-rule-save]").click();
  await page.locator('[data-rule="reapply_after_days"]').waitFor({ timeout: 10000 });
  check("one click saves it for that company and row", rulePosts[0]?.company_name === "Northwind Apps" && rulePosts[0]?.value === "365" && rulePosts[0]?.application_id === northwind && rulePosts[0]?.source === "notes", JSON.stringify(rulePosts[0]));
  check("and it reads from the last application there", /Reapply after 5 Jul 2027 \(365 days\)/.test(await page.locator('[data-rule="reapply_after_days"]').innerText()), await page.locator('[data-rule="reapply_after_days"]').innerText());
  await page.screenshot({ path: path.join(SHOTS, "5-company-rule.png"), fullPage: false });

  // ── /app: the rule is a Skip before any credit ───────────────────────────────
  rules.splice(0, rules.length,
    { id: "r1", company_name: "Northwind Apps", rule_type: "reapply_after_days", value: "365", anchor_date: "2026-07-05", source_text: "wait at least one year", dismissed_at: null },
    { id: "r2", company_name: "Tailspin Lending", rule_type: "same_role_block", value: "Junior Data Platform Engineer", anchor_date: null, source_text: "4 rejections on 17 Sep", dismissed_at: null },
  );
  const precheck = async (company, role) => {
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.locator("textarea#jd, textarea").first().fill(jdFor(company, role));
    await page.locator("button", { hasText: /^Check this job/ }).first().click();
    const note = page.locator("[data-gate-company-rules]");
    await note.waitFor({ timeout: 60000 });
    return note;
  };
  let note = await precheck("Northwind Apps", "Product Engineer");
  check('a one-year wait reads "Skip: reapply after 5 Jul 2027, from …"', /^Skip: reapply after 5 Jul 2027, from "wait at least one year"\./.test(await note.innerText()), await note.innerText());
  const badge = page.locator("[data-triage]").first();
  check("the JD triage badge says Skip with the same reason", (await badge.getAttribute("data-triage")) === "skip" && /reapply after 5 Jul 2027, from "wait at least one year"/.test(await badge.innerText()), await badge.innerText());
  const go = page.locator("button", { hasText: /^Tailor my CV|Tailor anyway/ }).first();
  check("the button asks to tailor anyway", /Tailor anyway \(uses 1 tailored CV\)/.test(await go.innerText()));
  await page.screenshot({ path: path.join(SHOTS, "6-app-skip.png"), fullPage: false });
  await go.click();
  const ask = page.locator("[data-confirm-dialog]");
  await ask.waitFor({ timeout: 10000 });
  check("and asks before the credit, with the reason", /reapply after 5 Jul 2027/.test(await ask.innerText()));
  await page.locator("[data-confirm-cancel]").click();
  note = await precheck("Tailspin Lending", "Junior Data Platform Engineer");
  check("the same role again is blocked", /^Skip: same role blocked \(Junior Data Platform Engineer\), from "4 rejections on 17 Sep"\./.test(await note.innerText()), await note.innerText());

  // ── A phone ─────────────────────────────────────────────────────────────────
  deadlineOn = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  await page.locator("[data-due-radar]").waitFor({ timeout: 30000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("the strip fits a phone with no sideways scroll", overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: path.join(SHOTS, "7-radar-phone.png"), fullPage: false });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  await browser?.close();
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; screenshots in ${SHOTS}; throwaway user removed: ${del.ok}`);
  process.exit(fail ? 1 : 0);
}
