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
import { MOVE_BACK_RECORDED, REOPEN_RECORDED, UNDO_EXPIRED, decideClosingWrite, dismissPending, dismissalMatches, isEnding, mergePendingOutcome, normalizePendingOutcome, normalizeUndoSnapshot, removedStageNote, undoIsLive, undoWrite } from "../src/lib/closing.ts";
import { apiStatus, followupClearedNote, normalizeStatus, stagesAfterMove } from "../src/lib/tracker.ts";

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
  row("Uniform", "screening", SCREENED, { followup_date: "2026-11-21" }),
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
let failNextLesson = false;
let warnNextClose = false;

const removals = [];
async function standIn(ctx) {
  await ctx.route(/\/api\/actions(\?.*)?$/, (r) => r.fulfill({ json: { events: openEvents, closedByConfirmation: [], applications: [], availability: [] } }));
  await ctx.route(/\/api\/events(\?.*)?$/, (r) => r.fulfill({ json: { events: [...openEvents, event(byName("Bravo"), "video", -5)] } }));
  await ctx.route(/\/api\/applications\/[^/]+\/pending-outcome$/, async (r) => {
    const id = r.request().url().split("/").at(-2);
    const target = rows.find((x) => x.id === id);
    const body = r.request().postDataJSON();
    patches.push({ id, body });
    const shown = normalizePendingOutcome(target.pending_outcome);
    if (body.dismiss && shown && !dismissalMatches(shown, body)) {
      await r.fulfill({ json: { ok: true, status: apiStatus(target.status), pending_outcome: shown, ignored: "changed" } });
      return;
    }
    if (body.dismiss) target.pending_outcome = dismissPending(shown, new Date().toISOString().slice(0, 10));
    else if (!isEnding(target.status) || body.outcome === "reopen") target.pending_outcome = mergePendingOutcome(target.pending_outcome, normalizePendingOutcome(body)).value;
    await r.fulfill({ json: { ok: true, status: apiStatus(target.status), pending_outcome: target.pending_outcome } });
  });
  await ctx.route(/\/api\/applications\/[^/]+\/remove-stage$/, async (r) => {
    const target = rows.find((x) => x.id === r.request().url().split("/").at(-2));
    const body = r.request().postDataJSON();
    removals.push({ id: target.id, body });
    target.stages_reached = target.stages_reached.filter((s) => s !== body.stage);
    target.notes = removedStageNote(body.stage, new Date()) + (target.notes ? `\n${target.notes}` : "");
    await r.fulfill({ json: { ok: true, notes: target.notes, stages_reached: target.stages_reached } });
  });
  await ctx.route(/\/api\/applications(\?.*)?$/, async (r) => {
    const req = r.request();
    if (req.method() === "GET") {
      // As lib/applicationRows toListRow: no null keys.
      await r.fulfill({ json: { applications: rows.map((x) => Object.fromEntries(Object.entries({ ...x, status: apiStatus(x.status) }).filter(([k, v]) => k !== "undo_snapshot" && v !== null && v !== undefined))) } });
      return;
    }
    if (req.method() !== "PUT") return r.fallback();
    const body = req.postDataJSON();
    puts.push(body);
    const target = rows.find((x) => x.id === body.id);
    if (body.undo_close) {
      const snapshot = normalizeUndoSnapshot(target.undo_snapshot);
      if (!snapshot || !undoIsLive(snapshot, Date.now())) {
        await r.fulfill({ status: 409, json: { error: UNDO_EXPIRED, errorType: "undo_expired" } });
        return;
      }
      Object.assign(target, undoWrite(snapshot, target));
      target.stages_reached = stagesAfterMove(target.stages_reached, target.status);
      await r.fulfill({ json: { ok: true, restored: { status: apiStatus(target.status), stages_reached: target.stages_reached, closed_at: target.closed_at, close_reason: target.close_reason, lesson: target.lesson, pending_outcome: target.pending_outcome, followup_date: target.followup_date ?? null, notes: target.notes ?? null } } });
      return;
    }
    if (failNextLesson && "lesson" in body) {
      failNextLesson = false;
      await r.fulfill({ status: 500, json: { error: "Could not save that application" } });
      return;
    }
    const write = {};
    for (const key of ["closed_at", "close_reason", "lesson", "pending_outcome", "followup_date", "notes"]) if (key in body) write[key] = body[key];
    if (body.status) write.status = normalizeStatus(body.status);
    const decision = decideClosingWrite(target, write, { confirmed: body.confirmed_by_user === true, confirmedMoveBack: body.confirmed_move_back === true, confirmedReopen: body.confirmed_reopen === true }, new Date().toISOString());
    if ("refuse" in decision) {
      refused++;
      const { status, ...refusal } = decision.refuse;
      await r.fulfill({ status, json: refusal });
      return;
    }
    if ("ask" in decision) {
      const merged = mergePendingOutcome(target.pending_outcome, decision.ask);
      target.pending_outcome = merged.value;
      await r.fulfill({ status: 202, json: { ok: true, applied: false, message: decision.ask.outcome === "reopen" ? REOPEN_RECORDED : MOVE_BACK_RECORDED, status: apiStatus(target.status), pending_outcome: merged.value, ...(merged.ignored ? { ignored: "dismissed" } : {}) } });
      return;
    }
    // As the route: an ending clears an open follow-up and notes it.
    let followupCleared;
    if (isEnding(write.status) && target.followup_date && !("followup_date" in write)) {
      const line = followupClearedNote(target.followup_date, write.status, "2026-11-04");
      target.notes = target.notes ? `${target.notes}\n${line}` : line;
      target.followup_date = null;
      followupCleared = { followup_date: null, notes: target.notes };
    }
    const { status, ...rest } = decision.fields;
    Object.assign(target, rest);
    // As the trigger: a write that sets no snapshot of its own clears the one there.
    if (!("undo_snapshot" in rest)) target.undo_snapshot = null;
    if (status) {
      target.stages_reached = stagesAfterMove(target.stages_reached, status);
      target.status = status;
    }
    const warning = warnNextClose && isEnding(write.status) ? "The status is saved, but the date, reason and lesson are not: run migration 20261104130000." : undefined;
    if (warning) warnNextClose = false;
    await r.fulfill({ json: { ok: true, ...(followupCleared ? { followupCleared } : {}), ...(warning ? { warning } : {}) } });
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
  check("the H1 stays Applications; the selected tab is the stage", (await page.locator("h1").innerText()) === "Applications" && (await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-stage-tab")) === "screening", await page.locator("h1").innerText());
  check("the summary counts every row that reached screening", (await summary()) === "Your CV reached screening 26 times · 17 live · 0 closed", await summary());
  let names = await live();
  check("a row whose test overtook it is under Assessment, not here", !names.includes("HasTest") && names.length === 17, names.join());
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
  check("the summary follows", (await summary()) === "Your CV reached screening 26 times · 16 live · 1 closed", await summary());
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
  check("the history is not edited", byName("ShellCo").stages_reached.join() === "applied,screening,rejected", byName("ShellCo").stages_reached.join());
  check("the row is Live again", (await live()).includes("ShellCo") && /17 live · 0 closed/.test(await summary()), await summary());

  // Undo of a close that cleared a follow-up: the date and the note both go back.
  await page.locator('[data-stage-row="Uniform"] [data-row-menu]').click();
  await page.locator('[data-menu-item="move-closed"]').click();
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(250);
  check("a close clears the follow-up and notes it", byName("Uniform").followup_date === null && /cleared when marked/.test(byName("Uniform").notes ?? ""), JSON.stringify([byName("Uniform").followup_date, byName("Uniform").notes]));
  await toast.locator("[data-toast-undo]").click();
  await page.waitForTimeout(250);
  check("Undo restores both", byName("Uniform").followup_date === "2026-11-21" && !byName("Uniform").notes && byName("Uniform").status === "screening", JSON.stringify([byName("Uniform").followup_date, byName("Uniform").notes]));

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
  failNextLesson = true;
  await juliet.locator("[data-closed-lesson]").fill("headcount frozen until spring");
  await juliet.locator("[data-closed-lesson]").blur();
  await page.waitForTimeout(250);
  check("a lesson that fails to save keeps what was typed", (await juliet.locator("[data-closed-lesson]").inputValue()) === "headcount frozen until spring");
  await juliet.locator("[data-closed-lesson]").focus();
  await juliet.locator("[data-closed-lesson]").blur();
  await page.waitForTimeout(250);
  check("and saves on the next try", byName("Juliet").lesson === "headcount frozen until spring", byName("Juliet").lesson);
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

  // ── Replacing a close, from the Closed tab ───────────────────────────────
  const closedAtBefore = byName("Bravo").closed_at;
  await open("closed");
  await page.locator('[data-stage-row="Bravo"] [data-stage-status]').selectOption("withdrawn");
  check("another ending asks too", await dialog.isVisible());
  await dialog.locator("[data-close-reason]").selectOption("withdrawn");
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(250);
  check("the close is replaced", byName("Bravo").status === "withdrawn");
  check("a closed row shows no banner", (await page.locator('[data-pending-row="Bravo"]').count()) === 0);
  const refusedBefore = refused;
  await page.locator("[data-toast-undo]").click();
  await page.waitForTimeout(250);
  check("Undo restores the earlier close", byName("Bravo").status === "ghosted" && byName("Bravo").closed_at === closedAtBefore, JSON.stringify([byName("Bravo").status, byName("Bravo").closed_at, closedAtBefore]));
  check("without tripping the guard", refused === refusedBefore, String(refused));

  // A move back to an open stage reopens it at once, with no reload.
  await page.locator('[data-stage-row="Bravo"] [data-stage-status]').selectOption("screening");
  await page.waitForTimeout(250);
  check("back at Screening it is open again", byName("Bravo").status === "screening" && !byName("Bravo").closed_at);
  await page.locator('[data-stage-tab="screening"]').click();
  await page.waitForTimeout(150);
  check("in Live straight away", (await live()).includes("Bravo") && (await page.locator('[data-closed-row="Bravo"]').count()) === 0);
  await page.locator('[data-stage-row="Bravo"] [data-stage-status]').selectOption("ghosted");
  await dialog.locator("[data-close-submit]").click();
  await page.waitForTimeout(300);

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
  check("the Interview tab is selected under the same title", (await page.locator("h1").innerText()) === "Applications" && (await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-stage-tab")) === "interview");
  check("and its own summary", (await summary()) === "Reached interview 8 times · 8 live · 0 closed", await summary());
  check("and its own Closed section", /^Closed after interview \(0\)$/.test((await page.locator("[data-closed-summary]").innerText()).trim()));

  // ── Wins ─────────────────────────────────────────────────────────────────
  await page.locator('[data-stage-tab="wins"]').click();
  await page.waitForTimeout(150);
  const countOf = async (step) => (await page.locator(`[data-wins-step="${step}"] [data-wins-count]`).innerText()).trim();
  const submitted = rows.filter((r) => r.stages_reached.some((s) => s !== "saved")).length;
  check("the funnel counts by stages_reached", (await countOf("applied")) === String(submitted) && (await countOf("screening")) === "26" && (await countOf("interview")) === "8" && (await countOf("offer")) === "0", `${await countOf("applied")} ${await countOf("screening")} ${await countOf("interview")} ${await countOf("offer")}`);
  check("each step says its conversion", /30.8%/.test(await page.locator('[data-wins-step="interview"] [data-wins-rate]').innerText()));
  check("every row that ever got there is listed", (await page.locator("[data-wins-row]").count()) === 26);
  check("a closed one says how it ended", /Ghosted \d/.test(await page.locator('[data-wins-row="Bravo"]').innerText()), await page.locator('[data-wins-row="Bravo"]').innerText());
  check("a live one says Live", /Live/.test(await page.locator('[data-wins-row="Alpha"]').innerText()));
  check("grouped by source", (await page.locator('[data-wins-group="By source"] [data-wins-group-row]').count()) >= 2);
  check("a referral is its own source", (await page.locator('[data-wins-group-row="Referral"]').count()) === 1);
  check("a small group shows a count, not a rate", /1 of 1.*Too few/s.test(await page.locator('[data-wins-group-row="Referral"]').innerText()), await page.locator('[data-wins-group-row="Referral"]').innerText());
  check("grouped by CV style for the owner", (await page.locator('[data-wins-group="By CV style"]').count()) === 1);
  check("no Export on a page that lists no filtered rows", (await page.locator("[data-apps-export]").count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "wins.png"), fullPage: true });

  // ── Add application from Wins ────────────────────────────────────────────
  await page.locator("[data-apps-add]").click();
  await page.waitForTimeout(150);
  check("+ Add application leaves Wins for the form", (await page.locator("[data-wins]").count()) === 0 && (await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-stage-tab")) !== "wins");
  await page.reload({ waitUntil: "load" });

  // ── A close the server could only half save says so ───────────────────────
  await open();
  warnNextClose = true;
  await page.locator('[data-stage-row="Delta"] [data-row-menu]').click();
  await page.locator('[data-menu-item="move-closed"]').click();
  await page.locator("[data-close-submit]").click();
  await page.waitForTimeout(300);
  check("the warning reaches the user", /run migration 20261104130000/.test(await page.locator(".limitNotice").first().innerText()), await page.locator(".limitNotice").first().innerText().catch(() => ""));
  await page.locator("[data-toast-undo]").click();
  await page.waitForTimeout(250);

  // ── A sweep moved the row since this page loaded ─────────────────────────
  await open("applied");
  const staleRow = byName("Plain1");
  staleRow.status = "screening";
  staleRow.stages_reached = ["applied", "screening"];
  await page.locator('[data-stage-row="Plain1"] [data-stage-status]').selectOption("rejected");
  await page.waitForTimeout(300);
  check("a stale page gets the dialog, not a raw refusal", await page.locator("[data-close-dialog]").isVisible());
  await page.locator("[data-close-cancel]").click();
  staleRow.status = "applied";
  staleRow.stages_reached = ["applied"];
  refused = 0;

  // ── Moving a row below screening asks, and keeps the proof until it is said ──
  await open();
  const beforeBack = puts.length;
  await page.locator('[data-stage-row="Charlie"] [data-stage-status]').selectOption("applied");
  const ask = page.locator("[data-confirm-dialog]");
  await ask.waitFor({ timeout: 5000 });
  check("moving a screened row back asks first", /stays on its record/.test(await ask.innerText()), (await ask.innerText()).slice(0, 160));
  check("and sends nothing yet", puts.length === beforeBack);
  await page.locator("[data-confirm-cancel]").click();
  await page.waitForTimeout(150);
  check("Cancel leaves it", byName("Charlie").status === "screening");
  check("and the select shows where it still is", (await page.locator('[data-stage-row="Charlie"] [data-stage-status]').inputValue()) === "screening");
  await page.locator('[data-stage-row="Charlie"] [data-stage-status]').selectOption("applied");
  await ask.waitFor({ timeout: 5000 });
  await page.locator("[data-confirm-ok], [data-confirm-dialog] button.cta:not(.secondary)").first().click();
  await page.waitForTimeout(250);
  check("confirmed, it moves, with its own word", byName("Charlie").status === "applied" && puts.at(-1).confirmed_move_back === true && puts.at(-1).confirmed_by_user === undefined, JSON.stringify(puts.at(-1)).slice(0, 180));
  check("and the count does not drop", /reached screening 26 times/.test(await summary()) && byName("Charlie").stages_reached.includes("screening"), await summary());

  // ── A sweep writing an open status on a closed row asks instead ──────────
  const bravo = byName("Bravo");
  const sweepPut = (status, notes) => page.evaluate(async ([id, st, n]) => {
    const res = await fetch("/api/applications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: st, ...(n ? { notes: n } : {}) }) });
    return { status: res.status, body: await res.json() };
  }, [bravo.id, status, notes]);
  const bravoClosedAt = bravo.closed_at;
  const bravoStatus = bravo.status;
  const asked = await sweepPut("Interview", "Invite the sweep found");
  check("a sweep's open status answers 202", asked.status === 202 && asked.body.pending_outcome?.outcome === "reopen", JSON.stringify(asked).slice(0, 200));
  check("and doesn't reopen it", bravo.status === bravoStatus && bravo.closed_at === bravoClosedAt && !bravo.stages_reached.includes("interview"));
  check("nor writes anything else: it may be the wrong row", !bravo.notes);
  await open();
  const reopenNotice = page.locator("[data-reopen-notice]");
  check("a notice says so, wherever you are", /New activity on 1 application/.test(await reopenNotice.innerText()), await reopenNotice.innerText());
  check("the folded section says so too", /1 with new activity/.test(await page.locator("[data-closed-summary]").innerText()), await page.locator("[data-closed-summary]").innerText());
  await page.locator("[data-reopen-show]").click();
  await page.waitForTimeout(150);
  const reopenBanner = page.locator('[data-pending-row="Bravo"] [data-pending-banner="reopen"]');
  check("the banner asks, as you wrote it", /^New activity from Bravo — Reopen\?/.test(await reopenBanner.innerText()), await reopenBanner.innerText());
  check("and quotes what the report said, to judge the match by", (await reopenBanner.locator("[data-pending-note]").innerText()) === "Invite the sweep found");
  check("only the rows asking are listed", (await page.locator("[data-stage-row]").count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "reopen.png"), fullPage: false });
  await reopenBanner.locator("[data-pending-dismiss]").click();
  await page.waitForTimeout(200);
  check("Not true holds", bravo.pending_outcome.dismissed === true && (await page.locator("[data-reopen-notice]").count()) === 0);
  const repeat = await sweepPut("Interview");
  check("against the next sweep too", repeat.body.ignored === "dismissed" && bravo.pending_outcome.dismissed === true, JSON.stringify(repeat.body).slice(0, 180));
  await sweepPut("Offer");
  await open();
  await page.locator("[data-reopen-show]").click();
  await page.waitForTimeout(150);
  check("a different stage asks again", bravo.pending_outcome.status === "offer" && (await page.locator('[data-pending-row="Bravo"] [data-pending-reopen]').count()) === 1);
  await page.locator('[data-pending-row="Bravo"] [data-pending-reopen]').click();
  await page.waitForTimeout(250);
  check("Reopen moves it where the report asked", bravo.status === "offer" && !bravo.closed_at && !bravo.close_reason, JSON.stringify([bravo.status, bravo.closed_at]));
  check("and sends the user's word", puts.at(-1).confirmed_reopen === true && puts.at(-1).confirmed_by_user === undefined, JSON.stringify(puts.at(-1)).slice(0, 180));
  check("the question is answered", !bravo.pending_outcome);
  await page.reload({ waitUntil: "load" });

  // ── A sweep stepping a live Interview row back asks, in the same pattern ──
  const mike = byName("Mike");
  const stepPut = (id, status, notes) => page.evaluate(async ([rowId, st, n]) => {
    const res = await fetch("/api/applications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rowId, status: st, ...(n ? { notes: n } : {}) }) });
    return { status: res.status, body: await res.json() };
  }, [id, status, notes]);
  const stepAsked = await stepPut(mike.id, "Screening", "Recruiter call booked");
  check("a sweep's step back answers 202", stepAsked.status === 202 && stepAsked.body.applied === false && stepAsked.body.pending_outcome?.outcome === "move_back", JSON.stringify(stepAsked).slice(0, 200));
  check("and doesn't move it", mike.status === "interview" && !mike.notes);
  await open("interview");
  const stepBanner = page.locator('[data-pending-row="Mike"] [data-pending-banner="move_back"]');
  check("the banner asks, as Reopen does", /^New activity from Mike — Move back to Screening\?/.test(await stepBanner.innerText()), await stepBanner.innerText());
  check("and quotes the report", (await stepBanner.locator("[data-pending-note]").innerText()) === "Recruiter call booked");
  await page.screenshot({ path: path.join(SHOTS, "move-back.png"), fullPage: false });
  await page.locator('[data-stage-row="Mike"] [data-row-menu]').click();
  await page.locator('[data-menu-item="move-closed"]').click();
  check("Move to Closed isn't pre-filled by a question", (await page.locator("[data-close-reason]").inputValue()) === "rejected");
  await page.locator("[data-close-cancel]").click();
  await stepBanner.locator("[data-pending-move-back]").click();
  await page.waitForTimeout(250);
  check("Move back moves it", mike.status === "screening", mike.status);
  check("on the user's word", puts.at(-1).confirmed_move_back === true && puts.at(-1).confirmed_by_user === undefined, JSON.stringify(puts.at(-1)).slice(0, 160));
  check("the question is answered", !mike.pending_outcome);
  check("the interview stays on its record", mike.stages_reached.includes("interview"), mike.stages_reached.join());
  const nov = byName("November");
  await stepPut(nov.id, "Screening");
  await open("interview");
  await page.locator('[data-pending-row="November"] [data-pending-dismiss]').click();
  await page.waitForTimeout(200);
  check("Not true leaves it where it is", nov.status === "interview" && nov.pending_outcome.dismissed === true);
  check("and holds against the next run", (await stepPut(nov.id, "Screening")).body.pending_outcome?.dismissed === true && nov.status === "interview");

  // A banner on a stale page: a sweep's rejection has replaced the question it shows.
  const oscar = byName("Oscar");
  const papa = byName("Papa");
  await stepPut(oscar.id, "Screening");
  await stepPut(papa.id, "Screening");
  await open("interview");
  const reported = { outcome: "rejected", date: "2026-11-02", source: "gmail" };
  oscar.pending_outcome = { ...reported };
  papa.pending_outcome = { ...reported };
  await page.locator('[data-pending-row="Oscar"] [data-pending-dismiss]').click();
  await page.waitForTimeout(200);
  check("Not true on it buries nothing", oscar.pending_outcome.outcome === "rejected" && !oscar.pending_outcome.dismissed, JSON.stringify(oscar.pending_outcome));
  check("and the row now shows the rejection", /^Rejected on 2 Nov/.test(await page.locator('[data-pending-row="Oscar"] [data-pending-banner]').innerText()));
  await page.locator('[data-pending-row="Papa"] [data-pending-move-back]').click();
  await page.waitForTimeout(250);
  check("Move back on it moves the row and keeps the rejection", papa.status === "screening" && papa.pending_outcome?.outcome === "rejected" && !papa.pending_outcome?.dismissed, JSON.stringify([papa.status, papa.pending_outcome]));

  // The event form's tick is the user's word, in either direction, and says only what happened.
  const romeo = byName("Romeo");
  romeo.status = "accepted";
  romeo.stages_reached = ["applied", "interview", "offer", "accepted"];
  await open("won");
  await page.locator('[data-stage-row="Romeo"] [data-row-menu]').click();
  await page.locator('[data-menu-item="add-step"]').click();
  await page.locator("[data-event-form]").waitFor();
  check("the form offers the move", (await page.locator("[data-event-move-toggle]").isChecked()) === true);
  await page.locator("[data-event-date]").fill("2026-12-01");
  await page.locator("[data-event-time]").fill("10:00");
  await page.locator("[data-event-save]").click();
  await page.locator("[data-event-form]").waitFor({ state: "detached", timeout: 8000 });
  check("a move back from the form lands", romeo.status === "interview" && puts.at(-1).confirmed_move_back === true, JSON.stringify([romeo.status, puts.at(-1)]).slice(0, 200));
  check("and plants no question", !romeo.pending_outcome, JSON.stringify(romeo.pending_outcome));

  // ── Remove a stage picked by mistake: Mike never reached interview after all ──
  const interviewCount = async () => Number((await summary()).match(/Reached interview (\d+)/)?.[1]);
  await open("interview");
  const interviewBefore = await interviewCount();
  await open("screening");
  await page.locator('[data-stage-row="Mike"] [data-row-menu]').click();
  await page.screenshot({ path: path.join(SHOTS, "remove-stage-menu.png"), fullPage: false });
  await page.locator('[data-menu-item="remove-interview"]').click();
  const removeAsk = page.locator("[data-confirm-dialog]");
  await removeAsk.waitFor({ timeout: 5000 });
  const removeText = await removeAsk.innerText();
  check("it asks first, quoting the note", /Removed 'interview' on \d+ \w+ — picked by mistake/.test(removeText), removeText.slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, "remove-stage-confirm.png"), fullPage: false });
  check("and sends nothing yet", removals.length === 0);
  await page.locator("[data-confirm-cancel]").click();
  await page.waitForTimeout(150);
  check("Cancel leaves it", mike.stages_reached.includes("interview") && removals.length === 0);
  await page.locator('[data-stage-row="Mike"] [data-row-menu]').click();
  await page.locator('[data-menu-item="remove-interview"]').click();
  await removeAsk.waitFor({ timeout: 5000 });
  await page.locator("[data-confirm-ok]").click();
  await page.waitForTimeout(250);
  check("confirmed, it goes", !mike.stages_reached.includes("interview"), mike.stages_reached.join());
  check("sent as the user's word", removals[0]?.body.confirmed_by_user === true && removals[0]?.body.stage === "interview", JSON.stringify(removals[0]));
  check("the row's notes say so", /^Removed 'interview' on \d+ \w+ — picked by mistake/.test(mike.notes ?? ""), mike.notes);
  check("the menu no longer offers it", await (async () => { await page.locator('[data-stage-row="Mike"] [data-row-menu]').click(); const n = await page.locator('[data-menu-item="remove-interview"]').count(); await page.keyboard.press("Escape"); return n === 0; })());
  await open("interview");
  check("it comes off the count, and the note says why", (await interviewCount()) === interviewBefore - 1, `${interviewBefore} then ${await interviewCount()}`);

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
  const realRead0 = async () => (await (await fetch(`${BASE}/api/applications`, { headers: { cookie } })).json()).applications.find((r) => r.id === realRow.id);
  const stillThere = await realRead0();
  check("Cancel moves nothing on the real row", stillThere.status === "Interview", stillThere.status);
  // And through: the real PUT, with or without the closing columns.
  await waiting.locator("[data-waiting-reject]").click();
  await planPage.locator("[data-close-lesson]").fill("wanted 3+ yrs");
  const realPut = planPage.waitForResponse((r) => r.url().endsWith("/api/applications") && r.request().method() === "PUT", { timeout: 30000 });
  await planPage.locator("[data-close-submit]").click();
  const realBody = await (await realPut).json();
  await planPage.locator("[data-toast-undo]").waitFor({ timeout: 15000 });
  if (realBody.warning) {
    console.log("SKIP the real close's columns and its Undo: migration 20261105120000 is not on this database yet");
    check("What's next shows the warning", (await planPage.locator('[role="alert"]').allInnerTexts()).some((t) => /2026110(4130000|5120000)/.test(t)));
  } else {
    check("the real row stores the close", /^\d{4}-\d{2}-\d{2}/.test((await realRead0()).closed_at ?? "") && (await realRead0()).lesson === "wanted 3+ yrs", JSON.stringify(await realRead0()).slice(0, 200));
  }
  const realRead = async () => (await (await fetch(`${BASE}/api/applications`, { headers: { cookie } })).json()).applications.find((r) => r.id === realRow.id);
  check("the real route takes the user's word", (await realRead()).status === "Rejected", (await realRead()).status);
  check("the toast says it moved", /Moved to Closed/.test(await planPage.locator("[data-toast]").innerText()));
  if (!realBody.warning) {
    await planPage.locator("[data-toast-undo]").click();
    await waiting.waitFor({ timeout: 15000 });
    const backAgain = await realRead();
    check("Undo puts the real row back", backAgain.status === "Interview" && !backAgain.closed_at && !backAgain.lesson, JSON.stringify([backAgain.status, backAgain.closed_at, backAgain.lesson]));
    check("and its history keeps what happened", backAgain.stages_reached.join() === "interview,rejected", backAgain.stages_reached.join());
  }
  // The real route, from a real browser: not refused as a script. Before migration 20261105130000
  // it says which file; after, it refuses this stage for what it is, and a real removal runs in smoke-closed.
  const fromBrowser = await planPage.evaluate(async (id) => {
    const res = await fetch(`/api/applications/${id}/remove-stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "offer", confirmed_by_user: true }) });
    return res.status;
  }, realRow.id);
  check("the real route takes the page's request", fromBrowser === 409 || fromBrowser === 503, String(fromBrowser));
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
