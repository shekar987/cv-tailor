// The Screening and Interview pages in a real browser (Edge), with a throwaway account. The
// applications API is stood in for in memory, holding the real lib/closing rule, so this runs
// before migration 20261104130000 is applied; scripts/smoke-sweep-contract.mjs and
// scripts/smoke-closed.mjs hold the real route to the same rule on the real database.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-closed.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIRMATION_MESSAGE, mergePendingOutcome, needsConfirmation, normalizePendingOutcome } from "../src/lib/closing.ts";
import { apiStatus, normalizeStatus, stagesAfterMove } from "../src/lib/tracker.ts";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "closed-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

// ── Made-up rows in the shape of the real data: 25 that reached screening ─────
let n = 0;
const row = (company, status, stages, more = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  company_name: company,
  role: `${company} role`,
  status,
  stages_reached: stages,
  date_applied: "2026-10-10",
  created_at: `2026-10-10T09:${String(n % 60).padStart(2, "0")}:00Z`,
  updated_at: `2026-10-${String((n % 20) + 10)}T09:00:00Z`,
  followup_date: null,
  source: "manual",
  ...more,
});
const SCREENED = ["applied", "screening"];
const pendingFrom = (outcome, source) => ({ pending_outcome: { outcome, date: "2026-11-02", source } });
const rows = [
  ...["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"].map((c) => row(c, "screening", SCREENED)),
  row("HasTest", "screening", SCREENED),
  row("ShellCo", "screening", SCREENED, pendingFrom("rejected", "gmail")),
  row("AecomCo", "screening", SCREENED, pendingFrom("rejected", "sweep")),
  row("FoxCo", "screening", SCREENED, pendingFrom("rejected", "sweep")),
  row("HidCo", "screening", SCREENED, pendingFrom("withdrawn", "sweep")),
  row("Juliet", "screening", SCREENED, { updated_at: "2026-11-01T09:00:00Z", followup_date: "2026-11-20" }),
  row("Kilo", "screening", SCREENED),
  row("Lima", "screening", SCREENED, { referral: true }),
  ...["Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"].map((c) => row(c, "interview", ["applied", "interview"])),
  ...Array.from({ length: 30 }, (_, i) => row(`Plain${i}`, "applied", ["applied"])),
  row("Gone", "rejected", ["applied", "rejected"]),
  row("Unsent", "saved", ["saved"]),
];
const byName = (name) => rows.find((r) => r.company_name === name);
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const event = (app, kind, days) => ({ id: `e-${app.id}-${kind}`, application_id: app.id, kind, title: `${kind} for ${app.company_name}`, stage_label: null, starts_at: future(days), ends_at: null, due_at: null, date_only: false, timezone: "Europe/London", location_or_link: null, contact_name: null, prep_notes: null, offered_slots: null, status: "scheduled", source: "manual", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
const openEvents = [event(byName("Kilo"), "screening_call", 2), event(byName("HasTest"), "assessment", 3)];
const puts = [];
const patches = [];
let refused = 0;

async function standIn(ctx) {
  await ctx.route(/\/api\/actions(\?.*)?$/, (r) => r.fulfill({ json: { events: openEvents, closedByConfirmation: [], applications: [], availability: [] } }));
  await ctx.route(/\/api\/events(\?.*)?$/, (r) => r.fulfill({ json: { events: [...openEvents, event(byName("Bravo"), "video", -5)] } }));
  await ctx.route(/\/api\/applications\/[^/]+\/pending-outcome$/, async (r) => {
    const id = r.request().url().split("/").at(-2);
    const target = rows.find((x) => x.id === id);
    const body = r.request().postDataJSON();
    patches.push({ id, body });
    if (body.dismiss) target.pending_outcome = { ...normalizePendingOutcome(target.pending_outcome), dismissed: true };
    else target.pending_outcome = mergePendingOutcome(target.pending_outcome, normalizePendingOutcome(body)).value;
    await r.fulfill({ json: { ok: true, status: apiStatus(target.status), pending_outcome: target.pending_outcome } });
  });
  await ctx.route(/\/api\/applications(\?.*)?$/, async (r) => {
    const req = r.request();
    if (req.method() === "GET") {
      await r.fulfill({ json: { applications: rows.map((x) => ({ ...x, status: apiStatus(x.status) })) } });
      return;
    }
    if (req.method() !== "PUT") return r.fallback();
    const body = req.postDataJSON();
    puts.push(body);
    const target = rows.find((x) => x.id === body.id);
    if (body.status && needsConfirmation(target, body.status, body.confirmed_by_user === true)) {
      refused++;
      await r.fulfill({ status: 409, json: { error: CONFIRMATION_MESSAGE, errorType: "needs_confirmation" } });
      return;
    }
    for (const key of ["closed_at", "close_reason", "lesson", "pending_outcome", "followup_date"]) if (key in body) target[key] = body[key];
    if (body.status) {
      const status = normalizeStatus(body.status);
      target.stages_reached = stagesAfterMove(target.stages_reached, status);
      target.status = status;
    }
    await r.fulfill({ json: { ok: true } });
  });
}

const email = `closed-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  // The owner's view: only an unlimited account compares CV styles.
  await fetch(`${SB}/rest/v1/profiles?id=eq.${created.id}`, { method: "PATCH", headers: { ...admin, Prefer: "return=minimal" }, body: JSON.stringify({ is_unlimited: true }) });
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  await standIn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(m.text()); });

  const open = async (tab = "screening") => {
    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    await page.locator(`[data-stage-tab="${tab}"]`).click({ timeout: 30000 });
    await page.waitForTimeout(150);
  };
  const summary = () => page.locator("[data-stage-summary]").innerText();
  const live = () => page.locator("[data-stage-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-row")));
  const bannerOf = (company) => page.locator(`[data-pending-row="${company}"] [data-pending-banner]`);
  const details = page.locator("[data-closed-section]");

  // ── The page ─────────────────────────────────────────────────────────────
  await open();
  check("the H1 is the stage", (await page.locator("h1").innerText()) === "Screening", await page.locator("h1").innerText());
  check("the summary counts every row that reached screening", (await summary()) === "Your CV reached screening 25 times · 16 live · 0 closed", await summary());
  let names = await live();
  check("a row whose test overtook it is under Assessment, not here", !names.includes("HasTest") && names.length === 16, names.join());
  check("the row with the next event comes first", names[0] === "Kilo", names.join());
  check("then the pending outcomes", names.slice(1, 5).sort().join() === "AecomCo,FoxCo,HidCo,ShellCo", names.join());
  check("then the rest by last update", names[5] === "Juliet", names.join());
  check("the banner reads as the brief writes it", /^Rejected on 2 Nov \(from Gmail\)\./.test(await bannerOf("ShellCo").innerText()), await bannerOf("ShellCo").innerText());
  await page.screenshot({ path: path.join(SHOTS, "screening.png"), fullPage: false });

  // ── Closed is folded, a real disclosure, and remembered ──────────────────
  check("the Closed section is a real <details>", (await details.evaluate((e) => e.tagName)) === "DETAILS");
  check("folded by default", (await details.evaluate((e) => e.open)) === false);
  check("it says how many", /^Closed after screening \(0\)$/.test((await page.locator("[data-closed-summary]").innerText()).trim()));

  // ── Dismiss ──────────────────────────────────────────────────────────────
  await bannerOf("HidCo").locator("[data-pending-dismiss]").click();
  await page.waitForTimeout(200);
  check("Not true sends a dismissal, not a move", patches.at(-1)?.body.dismiss === true && !puts.some((p) => p.id === byName("HidCo").id));
  check("the banner goes", (await bannerOf("HidCo").count()) === 0);
  check("the row stays Live", (await live()).includes("HidCo"));
  await open();
  check("and it stays gone after a reload", (await bannerOf("HidCo").count()) === 0);
  await page.evaluate(async (id) => fetch(`/api/applications/${id}/pending-outcome`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "withdrawn", date: "2026-11-02", source: "sweep" }) }), byName("HidCo").id);
  check("a later sweep of the same outcome leaves it dismissed", byName("HidCo").pending_outcome.dismissed === true);

  // ── The dialog: only it sends the user's word ────────────────────────────
  const dialog = page.locator("[data-close-dialog]");
  await bannerOf("ShellCo").locator("[data-pending-move]").click();
  check("the banner opens the dialog", await dialog.isVisible());
  check("the reason comes from the outcome", (await dialog.locator("[data-close-reason]").inputValue()) === "rejected");
  check("the date comes from the outcome", (await dialog.locator("[data-close-date]").inputValue()) === "2026-11-02");
  check("focus is inside it", await dialog.evaluate((d) => d.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  check("Escape cancels", (await dialog.count()) === 0 && !puts.some((p) => p.id === byName("ShellCo").id));
  await bannerOf("ShellCo").locator("[data-pending-move]").click();
  await dialog.locator("[data-close-lesson]").fill("asked for 3+ years");
  await page.screenshot({ path: path.join(SHOTS, "dialog.png"), fullPage: false });
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(250);
  const sent = puts.at(-1);
  check("the dialog sends confirmed_by_user", sent?.confirmed_by_user === true && sent.id === byName("ShellCo").id && sent.close_reason === "rejected" && sent.lesson === "asked for 3+ years" && /^2026-11-02/.test(sent.closed_at), JSON.stringify(sent).slice(0, 220));
  check("the row leaves Live", !(await live()).includes("ShellCo"));
  check("the summary follows", (await summary()) === "Your CV reached screening 25 times · 15 live · 1 closed", await summary());
  const toast = page.locator("[data-toast]");
  check("the toast offers Undo", /Moved to Closed/.test(await toast.innerText()) && (await toast.locator("[data-toast-undo]").count()) === 1);

  await page.locator("[data-closed-summary]").click();
  await page.waitForTimeout(100);
  const closedRow = page.locator('[data-closed-row="ShellCo"]');
  check("the closed row says how far it got", (await closedRow.locator("[data-closed-chip]").innerText()) === "Screening call");
  check("and how it ended", (await closedRow.locator("[data-closed-result]").innerText()) === "Rejected 2 Nov", await closedRow.locator("[data-closed-result]").innerText());
  check("and the lesson", (await closedRow.locator("[data-closed-lesson]").inputValue()) === "asked for 3+ years");
  await page.screenshot({ path: path.join(SHOTS, "closed.png"), fullPage: false });

  // ── Undo, within ten seconds and not after ───────────────────────────────
  await toast.locator("[data-toast-undo]").click();
  await page.waitForTimeout(250);
  check("Undo restores the status", byName("ShellCo").status === "screening" && !byName("ShellCo").closed_at);
  check("Undo brings the banner back", (await bannerOf("ShellCo").count()) === 1);
  check("and the lesson goes back", !byName("ShellCo").lesson, JSON.stringify(byName("ShellCo").lesson));
  check("the stage history drops the ending", byName("ShellCo").stages_reached.join() === "applied,screening", byName("ShellCo").stages_reached.join());
  check("the row is Live again", (await live()).includes("ShellCo") && /16 live · 0 closed/.test(await summary()), await summary());

  // ── The ⋯ menu, the stage select, Reopen ─────────────────────────────────
  const menuOf = (company) => page.locator(`[data-stage-row="${company}"] [data-row-menu]`);
  await menuOf("Juliet").click();
  await page.locator('[data-menu-item="move-closed"]').click();
  check("the ⋯ menu opens the dialog too", await dialog.isVisible());
  check("with no outcome reported, today's date", (await dialog.locator("[data-close-date]").inputValue()) === new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }));
  await dialog.locator("[data-close-reason]").selectOption("role_closed");
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(250);
  check("a role that closed sits with Withdrawn", byName("Juliet").status === "withdrawn" && byName("Juliet").close_reason === "role_closed");
  const juliet = page.locator('[data-closed-row="Juliet"]');
  check("and reads as what it was", /^Role closed /.test(await juliet.locator("[data-closed-result]").innerText()));
  await juliet.locator("[data-closed-lesson]").fill("headcount frozen");
  await juliet.locator("[data-closed-lesson]").blur();
  await page.waitForTimeout(200);
  check("a lesson edits in place", byName("Juliet").lesson === "headcount frozen" && puts.at(-1).lesson === "headcount frozen" && !("status" in puts.at(-1)));
  check("a lesson stops at 140", (await juliet.locator("[data-closed-lesson]").getAttribute("maxlength")) === "140");
  await juliet.locator("[data-row-menu]").click();
  await page.locator('[data-menu-item="reopen"]').click();
  await page.waitForTimeout(250);
  check("Reopen clears closed_at", !byName("Juliet").closed_at && byName("Juliet").status === "screening", JSON.stringify([byName("Juliet").closed_at, byName("Juliet").status]));
  check("and it is back in Live", (await live()).includes("Juliet"));

  const puttingBefore = puts.length;
  await page.locator('[data-stage-row="Alpha"] [data-stage-status]').selectOption("rejected");
  check("the stage select asks first", await dialog.isVisible());
  check("and sends nothing yet", puts.length === puttingBefore);
  await dialog.locator("[data-close-cancel]").click();
  check("Cancel leaves the row where it was", byName("Alpha").status === "screening" && (await page.locator('[data-stage-row="Alpha"] [data-stage-status]').inputValue()) === "screening");

  // Close one for the checks below, on a row whose event says more than its stage.
  await page.locator('[data-stage-row="Bravo"] [data-stage-status]').selectOption("ghosted");
  check("a chosen ending fills the reason", (await dialog.locator("[data-close-reason]").inputValue()) === "ghosted");
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(400);
  check("an event says more than the stage", (await page.locator('[data-closed-row="Bravo"] [data-closed-chip]').innerText()) === "Video");

  // ── The fold is remembered ───────────────────────────────────────────────
  await open();
  check("open stays open after a reload", (await details.evaluate((e) => e.open)) === true);
  await page.locator("[data-closed-summary]").click();
  await page.waitForTimeout(100);
  await open();
  check("folded stays folded", (await details.evaluate((e) => e.open)) === false);

  // ── An application that never got that far moves as before ───────────────
  await open("applied");
  const plain = byName("Plain0");
  await page.locator(`[data-stage-row="Plain0"] [data-stage-status]`).selectOption("rejected");
  await page.waitForTimeout(250);
  check("no dialog below screening", (await dialog.count()) === 0);
  check("and no flag sent", plain.status === "rejected" && puts.at(-1).confirmed_by_user === undefined);
  check("nothing ever tripped the guard", refused === 0, String(refused));

  // ── Interview: the identical pattern ─────────────────────────────────────
  await open("interview");
  check("the Interview page has its own title", (await page.locator("h1").innerText()) === "Interview");
  check("and its own summary", (await summary()) === "Reached interview 8 times · 8 live · 0 closed", await summary());
  check("and its own Closed section", /^Closed after interview \(0\)$/.test((await page.locator("[data-closed-summary]").innerText()).trim()));

  // ── Wins ─────────────────────────────────────────────────────────────────
  await page.locator('[data-stage-tab="wins"]').click();
  await page.waitForTimeout(150);
  const countOf = async (step) => (await page.locator(`[data-wins-step="${step}"] [data-wins-count]`).innerText()).trim();
  const submitted = rows.filter((r) => r.stages_reached.some((s) => s !== "saved")).length;
  check("the funnel counts by stages_reached", (await countOf("applied")) === String(submitted) && (await countOf("screening")) === "25" && (await countOf("interview")) === "8" && (await countOf("offer")) === "0", `${await countOf("applied")} ${await countOf("screening")} ${await countOf("interview")} ${await countOf("offer")}`);
  check("each step says its conversion", /32%/.test(await page.locator('[data-wins-step="interview"] [data-wins-rate]').innerText()));
  check("every row that ever got there is listed", (await page.locator("[data-wins-row]").count()) === 25);
  check("a closed one says how it ended", /Ghosted \d/.test(await page.locator('[data-wins-row="Bravo"]').innerText()), await page.locator('[data-wins-row="Bravo"]').innerText());
  check("a live one says Live", /Live/.test(await page.locator('[data-wins-row="Alpha"]').innerText()));
  check("grouped by source", (await page.locator('[data-wins-group="By source"] [data-wins-group-row]').count()) >= 2);
  check("a referral is its own source", (await page.locator('[data-wins-group-row="Referral"]').count()) === 1);
  check("a small group shows a count, not a rate", /1 of 1.*Too few/s.test(await page.locator('[data-wins-group-row="Referral"]').innerText()), await page.locator('[data-wins-group-row="Referral"]').innerText());
  check("grouped by CV style for the owner", (await page.locator('[data-wins-group="By CV style"]').count()) === 1);
  check("no Export on a page that lists no filtered rows", (await page.locator("[data-apps-export]").count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "wins.png"), fullPage: true });

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));

  // ── What's next: the same rule, the same dialog, on the real route ───────
  const real = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await real.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const planPage = await real.newPage();
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;
  const realRow = await (await fetch(`${BASE}/api/applications`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ company_name: "Waiting Co", role: "Engineer", status: "Interview", date_applied: "2026-10-01" }) })).json();
  await planPage.goto(`${BASE}/app/next`, { waitUntil: "load" });
  const waiting = planPage.locator('[data-waiting="Waiting Co"], [data-waiting-id="' + realRow.id + '"]').first();
  await waiting.waitFor({ timeout: 30000 });
  await waiting.locator("[data-waiting-reject]").click();
  check("What's next asks in the same dialog", await planPage.locator("[data-close-dialog]").isVisible());
  check("with the reason it was asked for", (await planPage.locator("[data-close-reason]").inputValue()) === "rejected");
  await planPage.locator("[data-close-cancel]").click();
  const stillThere = (await (await fetch(`${BASE}/api/applications`, { headers: { cookie } })).json()).applications.find((r) => r.id === realRow.id);
  check("Cancel moves nothing on the real row", stillThere.status === "Interview", stillThere.status);
  await real.close();

  // ── The ten-second toast, on a phone ─────────────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/London", hasTouch: true });
  await phone.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  await standIn(phone);
  const small = await phone.newPage();
  await small.goto(`${BASE}/applications`, { waitUntil: "load" });
  await small.locator('[data-stage-tab="screening"]').click({ timeout: 30000 });
  await small.waitForTimeout(200);
  const sideways = () => small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll at 390 on Live", (await sideways()) <= 0, `${await sideways()}px`);
  await small.locator('[data-pending-row="FoxCo"] [data-pending-move]').click();
  await small.locator("[data-close-submit]").click();
  await small.waitForTimeout(300);
  const started = Date.now();
  const smallToast = small.locator("[data-toast]");
  check("the toast shows on a phone", await smallToast.isVisible());
  await small.waitForTimeout(8500);
  check("still there past the usual eight seconds", await smallToast.isVisible(), `${Date.now() - started} ms`);
  await small.waitForTimeout(2200);
  check("gone after ten", (await smallToast.count()) === 0, `${Date.now() - started} ms`);
  await small.locator("[data-closed-summary]").click();
  await small.waitForTimeout(150);
  check("no sideways scroll at 390 with Closed open", (await sideways()) <= 0, `${await sideways()}px`);
  await small.screenshot({ path: path.join(SHOTS, "phone-closed.png"), fullPage: true });
  await small.locator('[data-stage-tab="wins"]').click();
  await small.waitForTimeout(200);
  check("no sideways scroll at 390 on Wins", (await sideways()) <= 0, `${await sideways()}px`);
  await small.screenshot({ path: path.join(SHOTS, "phone-wins.png"), fullPage: false });
  console.log(`Screens in ${SHOTS}`);
} catch (err) {
  check("ran to the end", false, err.message.slice(0, 400));
} finally {
  if (browser) await browser.close().catch(() => {});
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("throwaway user removed:", del.ok);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
