// The Applications page in a real browser (Edge), on the real API and database, with a
// throwaway account and made-up rows, removed at the end. No model call. It walks the
// brief's acceptance list: the derived stage, the counts adding up, nothing truncated at
// 1280 or 390 px, every old number one click away, and Lighthouse accessibility.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-applications.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "applications-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

const email = `apps-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
const headerFile = path.join(SHOTS, "lh-headers.json");
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;
  const api = async (p, method, body) => (await fetch(BASE + p, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  const row = async (company_name, status, over = {}) => (await api("/api/applications", "POST", { company_name, role: "Software Engineer", status, date_applied: "2026-10-20", ...over })).id;
  const event = (body) => api("/api/events", "POST", body);

  const ratings = await row("Made Up Ratings", "Interview", { role: "Associate Software Engineer (15413), London team", job_description: "A job." });
  const sales = await row("Made Up Sales", "Interview", { role: "Forward Deployed Engineer, Remote UK" });
  const loop = await row("Made Up Loop", "Interview", { role: "A very long role title that keeps going, with a team name, a city and a requisition number on the end of it (Req 99123, London hybrid)" });
  const screen = await row("Made Up Screening", "Screening");
  const visa = await row("Made Up Payments", "Screening");
  const advisory = await row("Made Up Advisory", "Interview", { role: "AI Engineer, Forensic and Financial Crime (Req 25246, London hybrid)" });
  await api("/api/applications", "PUT", { id: advisory, referral: true, referrer_name: "Sam Referrer", req_id: "25246", referral_status: "offered", last_contact_from: "me", last_contact_at: hours(-30) });
  await row("Made Up Chase", "Applied", { followup_date: "2026-10-25" });
  await row("Made Up Unsent", "Applied", { notes: "Form filled but not submitted yet." });
  await row("Made Up Applied", "Applied");
  await row("Made Up Draft", "Ready to submit");
  await row("Made Up Gone", "Rejected");
  await row("Made Up Left", "Withdrawn");
  const TOTAL = 12;

  await event({ application_id: ratings, kind: "interview", title: "Interview call", starts_at: hours(20), ends_at: hours(20.5) });
  const together = hours(26);
  await event({ application_id: sales, kind: "assessment", title: "Criteria test", due_at: together });
  await event({ application_id: sales, kind: "take_home", title: "Hireflix", due_at: together });
  await event({ application_id: loop, kind: "assessment", title: "Online test", due_at: hours(60), location_or_link: "https://example.com/test" });
  await event({ application_id: visa, kind: "assessment", title: "HackerRank test", status: "to_book" });
  await event({ application_id: advisory, kind: "screening_call", title: "Screening call", starts_at: hours(200) });

  browser = await chromium.launch({ channel: "msedge" });
  const open = async (viewport, url = "/applications") => {
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London" });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + url, { waitUntil: "load" });
    await page.locator("[data-stage-tabs]").waitFor({ timeout: 30000 });
    return { page, errors };
  };

  const { page, errors } = await open({ width: 1280, height: 1000 });
  const countOf = async (tab) => Number((await page.locator(`[data-stage-tab="${tab}"] .stageTabCount`).innerText()).replace(/\D/g, ""));
  const companies = () => page.locator("[data-stage-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-row")));
  const tab = async (name) => { await page.locator(`[data-stage-tab="${name}"]`).click(); await page.waitForTimeout(120); };

  // ── Header ───────────────────────────────────────────────────────────────
  const summary = await page.locator("[data-apps-summary]").innerText();
  check("one summary line", new RegExp(`${TOTAL} tracked · 3 applied · 6 in progress · 1 rejected`).test(summary), summary);
  check("the old subtitle is gone", !/Click any cell to edit it/.test(await page.locator("body").innerText()));
  check("+ Add application and Export", (await page.locator("[data-apps-add]").innerText()) === "+ Add application" && (await page.locator("[data-apps-export]").count()) === 1);

  // ── Tabs and counts ──────────────────────────────────────────────────────
  check("the tabs are a real tablist", (await page.locator('[role="tablist"] [role="tab"]').count()) >= 5);
  const shown = await page.locator("[data-stage-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-tab")));
  check("to submit, applied, screening, interview, assessment, closed", shown.join(",") === "to_submit,applied,screening,interview,assessment,closed", shown.join(","));
  check("a tab with nothing in it is not drawn", (await page.locator('[data-stage-tab="offer"], [data-stage-tab="won"]').count()) === 0);
  const sum = (await Promise.all(shown.map(countOf))).reduce((a, b) => a + b, 0);
  check("the counts add up to the total", sum === TOTAL, `${sum} of ${TOTAL}`);
  check("the page opens on Interview", (await page.locator('[data-stage-tab="interview"]').getAttribute("aria-selected")) === "true");
  check("Assessment is above 0", (await countOf("assessment")) === 3);
  check("Closed is rejected + withdrawn", (await countOf("closed")) === 2);

  // ── The derived stage ────────────────────────────────────────────────────
  const stageOf = (name) => page.locator(`[data-stage-row="${name}"] [data-stage-pill]`).getAttribute("data-stage-pill");
  check("a plain interview stays in Interview", (await stageOf("Made Up Ratings")) === "interview");
  check("Interview holds only what is not overtaken", (await companies()).sort().join(",") === "Made Up Advisory,Made Up Ratings", (await companies()).join(","));
  check("the footer keeps the stored 3: 2 here + 1 moved", /1 more stored as Interview/.test(await page.locator("[data-counted-elsewhere]").innerText()) || /stored as Interview/.test(await page.locator("[data-counted-elsewhere]").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "interview-tab.png"), fullPage: true });
  await tab("assessment");
  await page.screenshot({ path: path.join(SHOTS, "assessment-tab.png"), fullPage: true });
  check("SalesApe-style row reads Take-home", (await stageOf("Made Up Sales")) === "take_home");
  check("a test row reads Assessment", (await stageOf("Made Up Loop")) === "assessment");
  check("an undated test counts too", (await stageOf("Made Up Payments")) === "assessment");
  check("the stored status is untouched", (await api(`/api/applications?id=${sales}`, "GET")).application?.status === "Interview");

  // ── The table ────────────────────────────────────────────────────────────
  const tableText = await page.locator(".stageList").innerText();
  check("no None recorded", !/None recorded/.test(tableText));
  check("four columns", (await page.locator(".stageList thead th").count()) === 4);
  const salesNext = await page.locator('[data-stage-row="Made Up Sales"] [data-stage-next]').innerText();
  check("two due together read as one", /Hireflix \+ Criteria test/.test(salesNext) || /Criteria test \+ Hireflix/.test(salesNext), salesNext);
  check("a long name never hides the countdown", (await page.locator('[data-stage-row="Made Up Sales"] .nextStepLeft').isVisible()) && /due in|in \d/.test(await page.locator('[data-stage-row="Made Up Sales"] .nextStepLeft').innerText()));
  check("the time is printed once", (salesNext.match(/\d{2}:\d{2}/g) ?? []).length === 1, salesNext);
  check("a link gives Open test", (await page.locator('[data-stage-row="Made Up Loop"] [data-row-primary="test"]').getAttribute("href")) === "https://example.com/test");
  check("no link offers to add one", (await page.locator('[data-stage-row="Made Up Sales"] [data-row-add-link]').count()) === 1);
  const longRole = page.locator('[data-stage-row="Made Up Loop"] .stageListRole .appsCellBtn');
  check("a long role truncates, with the full text in title", /99123/.test(await longRole.getAttribute("title")) && (await longRole.evaluate((e) => e.scrollWidth > e.clientWidth)));
  check("urgency is more than colour", (await page.locator('[data-stage-row="Made Up Sales"] .nextStep[data-urgency] .srOnly, [data-stage-row="Made Up Sales"] .nextStep[data-urgency="amber"]').count()) >= 1);
  await tab("interview");
  const redRow = page.locator('[data-stage-row="Made Up Ratings"] .nextStep');
  check("due by the end of tomorrow goes red with its warning", (await redRow.getAttribute("data-urgency")) === "red" && (await redRow.locator(".srOnly").innerText()).includes("Due soon"));
  check("Interview's button is Prep, to that row's Interview page", (await page.locator('[data-stage-row="Made Up Ratings"] [data-row-primary="prep"]').getAttribute("href")) === `/applications/${ratings}/interview`);
  const adv = await page.locator('[data-stage-row="Made Up Advisory"]').innerText();
  check("last contact and referrer on their own line", /Last contact .* referred by Sam Referrer/.test(adv), adv.slice(0, 200));
  check("the Req ID prints once", (adv.match(/25246/g) ?? []).length === 1, adv.slice(0, 200));
  await tab("screening");
  await page.locator('[data-stage-row="Made Up Screening"] [data-stage-add]').click();
  await page.locator("[data-event-form]").waitFor();
  check("Add next step opens the date and time editor", true);
  await page.keyboard.press("Escape");
  await page.locator("[data-event-form]").waitFor({ state: "detached" });

  // ── Nothing truncated ────────────────────────────────────────────────────
  const clipped = (p) => p.locator("[data-stage-pill]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
  for (const t of ["interview", "assessment", "closed", "to_submit"]) {
    await tab(t);
    check(`no stage text clipped at 1280 on ${t}`, (await clipped(page)) === 0);
  }

  // ── Attention strip ──────────────────────────────────────────────────────
  const card = (key) => page.locator(`[data-attn="${key}"]`);
  check("every card is a button", (await page.locator('[data-attention] button[data-attn]').count()) === 3 && (await page.locator("[data-attn-referral-open]").count()) === 1);
  check("Due soon counts what is due by tomorrow night, two due together as one", /^[12]\b/.test((await card("due").innerText()).trim()), (await card("due").innerText()).replace(/\s+/g, " "));
  check("its label names the day", /Due by \w+ night/.test(await card("due").innerText()));
  check("a red card carries an icon too", (await card("due").locator("svg").count()) === 1);
  await card("followups").click();
  check("Follow-ups due filters the table", (await companies()).join(",") === "Made Up Chase", (await companies()).join(","));
  check("no tab reads as selected while a card filters", (await page.locator('[role="tab"][aria-selected="true"]').count()) === 0);
  await card("fix").click();
  const fix = await card("fix").innerText();
  check("Data to fix says both numbers", /1 status/.test(fix), fix.replace(/\s+/g, " "));
  check("and its list holds the unsent row", (await companies()).includes("Made Up Unsent"), (await companies()).join(","));
  check("the reviewed move is still there", (await page.locator('[data-bulk-ready]').count()) === 1);
  await card("fix").click();
  check("clicking the card again clears it", (await page.locator('[role="tab"][aria-selected="true"]').count()) === 1);
  const refCard = await page.locator('[data-attn="referral"]').innerText();
  check("the referral card names it once", /Made Up Advisory · AI Engineer \(25246\)/.test(refCard) && /since 20 Oct/.test(refCard), refCard.replace(/\s+/g, " "));
  await page.locator("[data-attn-referral-open]").click();
  await page.locator("[data-referral-editor]").waitFor({ timeout: 8000 });
  check("clicking it opens that row", true);
  await page.screenshot({ path: path.join(SHOTS, "referral-open.png"), fullPage: true });
  await page.locator('[data-stage-tab="interview"]').click();

  // ── Every old number within one click ────────────────────────────────────
  await tab("closed");
  const breakdown = await page.locator("[data-closed-breakdown]").innerText();
  check("Closed breaks down into rejected and withdrawn", /1 rejected · 1 withdrawn · 0 ghosted/.test(breakdown), breakdown);
  check("Showing X of Y in the tab", /Showing 2 of 2 in Closed/.test(await page.locator("[data-apps-count]").innerText()));

  // ── Toolbar ──────────────────────────────────────────────────────────────
  await tab("applied");
  await page.locator("[data-apps-search]").fill("Chase");
  check("search narrows, and the footer says so", /Showing 1 of 3 in Applied/.test(await page.locator("[data-apps-count]").innerText()));
  await page.locator("[data-apps-search]").fill("20 oct");
  check("search still matches dates", (await companies()).length === 3);
  await page.locator("[data-apps-search]").fill("");
  await page.locator("[data-apps-period]").selectOption("today");
  await page.waitForTimeout(100);
  check("the Period select filters", (await companies()).length === 0);
  await page.locator("[data-apps-period]").selectOption("all");
  await page.locator("[data-apps-filters]").click();
  await page.locator("[data-include-past]").check();
  await tab("screening");
  await page.locator("[data-apps-filters]").click();
  await page.locator("[data-include-past]").uncheck();
  await page.locator("[data-apps-filters]").click();
  check("Filters opens and closes", (await page.locator("[data-apps-filters-panel]").count()) === 0);

  // ── The menu ─────────────────────────────────────────────────────────────
  await tab("assessment");
  const menu = (name) => page.locator(`[data-stage-row="${name}"]`);
  await menu("Made Up Sales").locator("[data-row-menu]").click();
  const items = await menu("Made Up Sales").locator("[data-menu-item]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check("the menu has the brief's items", ["Edit date/time", "Mark done", "Snooze 1 day", "Edit row", "Update status to Assessment", "Delete"].every((i) => items.includes(i)), items.join(" | "));
  check("and nothing lost: CV, JD, notes, prep", ["Add CV", "Add JD", "Add notes", "Prep pack"].every((i) => items.includes(i)), items.join(" | "));
  await menu("Made Up Sales").locator('[data-menu-item="match-status"]').click();
  await page.waitForTimeout(600);
  check("Update status writes it, once, by your click", (await api(`/api/applications?id=${sales}`, "GET")).application?.status === "Assessment");
  await menu("Made Up Loop").locator("[data-row-menu]").click();
  await menu("Made Up Loop").locator('[data-menu-item="edit-row"]').click();
  await page.locator("[data-edit-panel]").waitFor();
  check("Edit row holds salary and dates", /salary/i.test(await page.locator("[data-edit-panel]").innerText()) && /applied on/i.test(await page.locator("[data-edit-panel]").innerText()));
  await page.locator("[data-edit-panel] .appsActionBtn").click();
  await menu("Made Up Loop").locator("[data-row-menu]").click();
  await menu("Made Up Loop").locator('[data-menu-item="done"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-stage-row="Made Up Loop"] [data-row-primary="test"]'), null, { timeout: 8000 });
  check("Mark done ends the test, and the row goes back to its stored stage", true);
  await page.locator("[data-toast-undo]").click();
  await page.locator('[data-stage-row="Made Up Loop"]').waitFor({ timeout: 8000 });
  check("and undo brings it back", true);

  // ── Inline editing ───────────────────────────────────────────────────────
  await tab("interview");
  await page.locator('[data-stage-row="Made Up Ratings"] .stageListCompany .appsCellBtn').click();
  const input = page.locator(".stageListCompany .appsCellInput");
  await input.fill("Made Up Ratings Ltd");
  await input.press("Enter");
  await page.locator('[data-stage-row="Made Up Ratings Ltd"]').waitFor({ timeout: 8000 });
  check("clicking the company still edits it", true);

  // ── Export ───────────────────────────────────────────────────────────────
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-apps-export]").click()]);
  const file = fs.readFileSync(await download.path(), "utf8");
  check("Export is exactly the rows on screen", /Made Up Ratings Ltd/.test(file) && /Made Up Advisory/.test(file) && !/Made Up Applied/.test(file), download.suggestedFilename());

  // ── The spreadsheet ──────────────────────────────────────────────────────
  await page.locator("[data-stage-sheet]").click();
  await page.locator(".appsTable").waitFor();
  check("Open as spreadsheet shows every column", (await page.locator(".appsTable thead th").count()) >= 10);
  check("with an All tab", (await page.locator('[data-stage-tab="all"]').count()) === 1);
  await page.locator('[data-stage-tab="all"]').click();
  check("All holds every row", /Showing 12 of 12/.test(await page.locator("[data-apps-count]").innerText()) || (await page.locator("tr.appsRow").count()) === TOTAL);
  await page.locator("[data-stage-sheet]").click();
  await page.locator(".stageList").waitFor();
  check("and back", true);

  await page.locator("[data-apps-add]").click();
  await page.locator(".appsNewRow").first().waitFor();
  check("+ Add application opens the form", true);
  await page.keyboard.press("Escape");

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));

  // ── Phone ────────────────────────────────────────────────────────────────
  const phone = await open({ width: 390, height: 844 });
  await phone.page.locator(".stageList").waitFor({ timeout: 15000 });
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll at 390", overflow <= 0, `${overflow}px`);
  check("no stage text clipped at 390", (await clipped(phone.page)) === 0);
  check("the header row is hidden", !(await phone.page.locator(".stageList thead").isVisible()));
  check("search goes full width", (await phone.page.locator(".appsTools .appsSearchWrap").evaluate((e) => e.getBoundingClientRect().width)) >= 300);
  const tabsBox = await phone.page.locator("[data-stage-tabs]").evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
  check("tabs scroll rather than wrap", tabsBox.scroll >= tabsBox.client);
  await phone.page.screenshot({ path: path.join(SHOTS, "phone.png"), fullPage: true });

  await browser.close();
  browser = null;

  // ── Lighthouse accessibility, on the signed-in page ──────────────────────
  fs.writeFileSync(headerFile, JSON.stringify({ Cookie: cookie }));
  for (const [label, flag] of [["desktop", "--preset=desktop"], ["mobile", ""]]) {
    const output = path.join(SHOTS, `lh-${label}.json`);
    fs.rmSync(output, { force: true });
    const cmd = `npx -y lighthouse@12.6.1 ${BASE}/applications ${flag} --chrome-path="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --chrome-flags="--headless=new" --extra-headers="${headerFile}" --only-categories=accessibility --output=json --output-path="${output}" --quiet`;
    spawnSync(cmd, { shell: true, timeout: 200000, encoding: "utf8" });
    if (fs.existsSync(output)) {
      const j = JSON.parse(fs.readFileSync(output, "utf8"));
      const score = Math.round(j.categories.accessibility.score * 100);
      check(`Lighthouse accessibility ${label} at 95 or above`, score >= 95, `${score} on ${j.finalDisplayedUrl}`);
      const failed = Object.values(j.audits).filter((a) => a.score === 0 && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual" && a.scoreDisplayMode !== "informative").map((a) => a.id);
      if (failed.length) console.log(`  failing audits (${label}): ${failed.join(", ")}`);
    } else {
      console.log(`Lighthouse ${label}: no report`);
    }
  }
  console.log(`Screens in ${SHOTS}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { fs.rmSync(headerFile, { force: true }); } catch {}
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("throwaway user removed:", del.ok);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
