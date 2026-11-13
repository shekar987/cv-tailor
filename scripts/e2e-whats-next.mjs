// The plan in a real browser (Edge), on a throwaway account. The plan API is answered
// by an in-memory backend built from the REAL lib/plan rules, so it needs no database
// migration, touches no live row and calls no model. Companies and people are made up.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-whats-next.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.cwd();
const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(path.join(APP, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const { activeApplications, activeEvents, buildFunnel, readEventInput, readWindowInput } = await import(pathToFileURL(APP + "/src/lib/plan.ts").href);
const { zonedTimeToMs } = await import(pathToFileURL(APP + "/src/lib/planTime.ts").href);
const { apiStatus, normalizeStatus } = await import(pathToFileURL(APP + "/src/lib/tracker.ts").href);
const { trackerCounts } = await import(pathToFileURL(APP + "/src/lib/trackerCounts.ts").href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "whats-next-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const at = (d, t, tz = "Europe/London") => new Date(zonedTimeToMs(d, t, tz)).toISOString();

// ── The in-memory backend ────────────────────────────────────────────────────
let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
const app = (company_name, role, status, over = {}) => ({ id: uuid(), company_name, role, status, date_applied: "2026-10-20", source: "manual", created_at: "2026-10-20T10:00:00Z", followup_date: null, stages_reached: status === "applied" ? ["applied"] : ["applied", status], ...over });
const db = {
  applications: [
    app("Northwind Ratings", "Associate Software Engineer", "interview", { prep_generated_at: "2026-11-02T10:00:00Z" }),
    app("Sunbury Energy", "Software Engineer", "screening"),
    app("Ape Sales", "Forward Deployed Engineer", "interview"),
    app("Rotherham Pharma", "Software Engineer", "assessment"),
    app("Delta Advisory", "AI Engineer", "screening"),
    app("Bluebell Telecom", "Front End Engineer", "screening", { date_applied: "2026-10-27", followup_date: "2026-11-10" }),
    app("Old Silence Ltd", "Backend Engineer", "screening", { date_applied: "2026-10-01" }),
    app("Gone Ltd", "Engineer", "rejected", { stages_reached: ["applied", "screening", "rejected"] }),
    app("Applied Only Ltd", "Engineer", "applied"),
    app("Unsent Ltd", "Engineer", "saved", { stages_reached: ["saved"] }),
    app("Won Ltd", "Engineer", "accepted", { stages_reached: ["applied", "screening", "interview", "offer", "accepted"] }),
    app("Offer Ltd", "Engineer", "offer", { stages_reached: ["applied", "interview", "offer"] }),
    app("Late Ltd", "Engineer", "assessment"),
    app("Replied Ltd", "Engineer", "screening", { last_contact_from: "them", last_contact_at: at("2026-10-10", "10:00"), followup_date: "2026-11-20" }),
  ],
  events: [],
  windows: [],
};
const idOf = (name) => db.applications.find((a) => a.company_name === name).id;
const ev = (company, over) => ({ id: uuid(), application_id: company ? idOf(company) : null, timezone: "Europe/London", status: "scheduled", source: "manual", offered_slots: [], ...over });
db.events.push(
  ev("Northwind Ratings", { kind: "interview", title: "Interview call", starts_at: at("2026-11-04", "10:10"), ends_at: at("2026-11-04", "10:30"), location_or_link: "https://example.com/teams/abc", contact_name: "Sam Recruiter", prep_notes: "Have the two project stories ready." }),
  ev("Sunbury Energy", { kind: "screening_call", title: "Screening call", status: "to_book", offered_slots: [{ starts_at: at("2026-11-04", "12:00", "Europe/Paris"), ends_at: null }, { starts_at: at("2026-11-04", "13:30", "Europe/Paris"), ends_at: null }, { starts_at: at("2026-11-04", "14:30", "Europe/Paris"), ends_at: null }] }),
  ev("Ape Sales", { kind: "take_home", title: "Video interview (2 questions)", due_at: at("2026-11-05", "18:40") }),
  ev("Ape Sales", { kind: "assessment", title: "Criteria assessment (15 min)", due_at: at("2026-11-05", "18:40") }),
  ev("Rotherham Pharma", { kind: "assessment", title: "Video assessment", due_at: at("2026-11-10", "23:59"), date_only: true }),
  ev("Delta Advisory", { kind: "screening_call", title: "Screening call", status: "to_book" }),
  ev(null, { kind: "networking", title: "Networking call: Sam Contact", starts_at: at("2026-11-04", "18:00"), ends_at: at("2026-11-04", "18:30") }),
  ev("Old Silence Ltd", { kind: "follow_up", title: "Chase", status: "done", starts_at: at("2026-10-20", "10:00") }),
  ev("Late Ltd", { kind: "take_home", title: "Overdue task", due_at: at("2026-11-02", "12:00") }),
  ev("Late Ltd", { kind: "interview", title: "Call that ended", starts_at: at("2026-11-02", "15:00"), ends_at: at("2026-11-02", "15:30") }),
  ev("Gone Ltd", { kind: "interview", title: "Hidden interview", starts_at: at("2026-11-04", "15:00"), ends_at: at("2026-11-04", "16:00") }),
);
db.windows.push(
  { id: uuid(), date: "2026-11-04", start_time: "05:00:00", end_time: "09:00:00", kind: "busy", label: "Shift", timezone: "Europe/London" },
  { id: uuid(), date: "2026-11-06", start_time: "12:00:00", end_time: "16:00:00", kind: "busy", label: "Shift", timezone: "Europe/London" },
  { id: uuid(), date: "2026-11-05", start_time: "10:00:00", end_time: "15:00:00", kind: "busy", label: "Placement", timezone: "Europe/London" },
  { id: uuid(), date: "2026-11-05", start_time: "14:30:00", end_time: "20:00:00", kind: "free", label: null, timezone: "Europe/London" },
  { id: uuid(), date: "2026-11-08", start_time: "09:00:00", end_time: "20:00:00", kind: "free", label: null, timezone: "Europe/London" },
);

async function route(page) {
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/plan**", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.get("picker")) return json(r, { applications: db.applications });
    json(r, {
      applications: activeApplications(db.applications),
      events: activeEvents(db.events, db.applications),
      availability: db.windows,
      funnel: buildFunnel(db.applications),
    });
  });
  await page.route("**/api/events**", async (r) => {
    const req = r.request();
    if (req.method() === "GET") return json(r, { events: db.events });
    const body = req.postDataJSON();
    if (req.method() === "POST") {
      const read = readEventInput(body, false);
      if (read.error) return json(r, { error: read.error }, 400);
      const event = { id: uuid(), application_id: body.application_id ?? null, timezone: "Europe/London", offered_slots: [], ...read.fields };
      db.events.push(event);
      return json(r, { event });
    }
    if (req.method() === "PUT") {
      const read = readEventInput(body, true);
      if (read.error) return json(r, { error: read.error }, 400);
      const event = db.events.find((e) => e.id === body.id);
      Object.assign(event, read.fields);
      return json(r, { event });
    }
    json(r, { ok: true });
  });
  await page.route("**/api/availability**", async (r) => {
    const req = r.request();
    if (req.method() === "GET") return json(r, { windows: db.windows });
    if (req.method() === "POST") {
      const read = readWindowInput(req.postDataJSON());
      if (read.error) return json(r, { error: read.error }, 400);
      const window = { id: uuid(), timezone: "Europe/London", ...read.fields };
      db.windows.push(window);
      return json(r, { window });
    }
    const id = new URL(req.url()).searchParams.get("id");
    db.windows = db.windows.filter((w) => w.id !== id);
    json(r, { ok: true });
  });
  // The tracker's counts (Chunk 19), from the same rows the stand-in list answers.
  await page.route("**/api/applications/counts**", (r) => {
    const today = new URL(r.request().url()).searchParams.get("today") ?? "2026-11-03";
    json(r, { today, ...trackerCounts(db.applications, db.events.filter((e) => e.status === "scheduled" || e.status === "to_book"), today) });
  });
  // The list with or without a query: the full list (?all=1) and one page (?stage=…) since Chunk 19.
  await page.route(/\/api\/applications(\?.*)?$/, async (r) => {
    const req = r.request();
    if (req.method() === "GET") return json(r, { applications: db.applications.map((a) => ({ ...a, status: apiStatus(a.status) })) });
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      const row = db.applications.find((a) => a.id === body.id);
      if (body.undo_close) {
        Object.assign(row, row.undoSnapshot, { undoSnapshot: null });
        return json(r, { ok: true, restored: { status: apiStatus(row.status) } });
      }
      if (body.confirmed_by_user) row.undoSnapshot = { status: row.status, followup_date: row.followup_date ?? null, notes: row.notes ?? null };
      if (body.status) {
        row.status = normalizeStatus(body.status);
        if (!row.stages_reached.includes(row.status)) row.stages_reached.push(row.status);
      }
      if ("outcome_reason" in body) row.outcome_reason = body.outcome_reason;
      for (const k of ["last_contact_from", "last_contact_at", "followup_date", "notes"]) if (k in body) row[k] = body[k];
      // As the real route: closing a row clears its follow-up and notes it.
      if (["rejected", "withdrawn", "ghosted", "accepted"].includes(row.status) && row.followup_date && !("followup_date" in body)) {
        const line = `Follow-up ${row.followup_date} cleared when marked Rejected on 2026-11-03.`;
        row.notes = row.notes ? `${row.notes}\n${line}` : line;
        row.followup_date = null;
        return json(r, { ok: true, followupCleared: { followup_date: null, notes: row.notes } });
      }
      return json(r, { ok: true });
    }
    json(r, { ok: true });
  });
  for (const pattern of ["**/api/applications/insights", "**/api/section-order"]) await page.route(pattern, (r) => json(r, {}));
}

const email = `next-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  browser = await chromium.launch({ channel: "msedge" });

  // Signed out: the page is protected and round-trips through login.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(BASE + "/app/next", { waitUntil: "load" });
  check("signed out, /app/next goes to sign-in and comes back", anon.url().includes("/auth/login") && decodeURIComponent(anon.url()).includes("next=/app/next"), anon.url());

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London", permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // Tue 3 Nov 2026, 09:00 London. Date is fixed; timers still run.
  await page.clock.setFixedTime(new Date(zonedTimeToMs("2026-11-03", "09:00", "Europe/London")));
  await route(page);
  await page.goto(BASE + "/app/next", { waitUntil: "load" });
  await page.locator("[data-group]").first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(SHOTS, "next-desktop.png"), fullPage: true });

  // ── The plan ───────────────────────────────────────────────────────────────
  const groups = await page.locator(".planGroup").evaluateAll((els) => els.map((e) => e.dataset.group));
  check("groups appear in order", groups.join() === "overdue,needs_booking,reply_owed,tomorrow,this_week,next_week,waiting", groups.join());
  const titles = (g) => page.locator(`[data-group="${g}"] [data-event-title]`).evaluateAll((els) => els.map((e) => e.dataset.eventTitle));
  check("tomorrow lists the interview first, then the networking call", (await titles("tomorrow")).join("|") === "Interview call|Networking call: Sam Contact", (await titles("tomorrow")).join("|"));
  const overdueGroup = page.locator('[data-group="overdue"]');
  check("overdue says so in words and with an icon, not only red", /Overdue/.test(await overdueGroup.locator("h2").innerText()) && (await overdueGroup.locator("h2 svg").count()) === 1);
  check("a missed deadline counts up", /overdue/.test(await page.locator('[data-event-title="Overdue task"] [data-event-countdown]').innerText()), await page.locator('[data-event-title="Overdue task"] [data-event-countdown]').innerText());
  check("a call that has ended asks for its outcome", /ended .* ago: set the outcome/.test(await page.locator('[data-event-title="Call that ended"] [data-event-countdown]').innerText()));
  check("a booking with no slots does not claim slots were offered", /Not booked yet/.test(await page.locator('.planCard:has-text("Delta Advisory")').innerText()));
  check("a booking with slots says so", /Slots offered/.test(await page.locator('.planCard:has-text("Sunbury Energy")').innerText()));
  check("a rejected application's event is not on the plan", !(await page.locator("body").innerText()).includes("Hidden interview"));
  const card = page.locator('[data-event-title="Interview call"]');
  check("the card shows company, role and stage", /Northwind Ratings/.test(await card.innerText()) && /Associate Software Engineer/.test(await card.innerText()) && (await card.locator(".stageChip").getAttribute("data-stage")) === "interview");
  check("date, time and countdown", /Wed 4 Nov, 10:10/.test(await card.innerText()) && (await card.locator("[data-event-countdown]").innerText()) === "in 1 day", await card.locator("[data-event-countdown]").innerText());
  check("the prep pack is linked", (await card.getByRole("link", { name: "Interview pack" }).count()) === 1);
  await card.getByRole("button", { name: "Copy" }).click();
  check("the link copies in one click", (await page.evaluate(() => navigator.clipboard.readText())) === "https://example.com/teams/abc");
  const pharma = page.locator('[data-event-title="Video assessment"]');
  check("a date with no time prints no time", /Tue 10 Nov/.test(await pharma.innerText()) && !/23:59/.test(await pharma.innerText()) && (await pharma.locator("[data-event-countdown]").innerText()) === "due in 7 days", await pharma.innerText());
  check("Waiting on them lists rows with nothing booked, longest first", (await page.locator("[data-waiting]").evaluateAll((e) => e.map((x) => x.dataset.waiting))).join() === "Old Silence Ltd,Offer Ltd,Bluebell Telecom");
  check("with no contact recorded it counts from applying and says so", /Applied 33 days ago; no contact recorded/.test(await page.locator('[data-waiting="Old Silence Ltd"]').innerText()) && !/days since contact/.test(await page.locator('[data-waiting="Old Silence Ltd"]').innerText()), await page.locator('[data-waiting="Old Silence Ltd"]').innerText());
  check("the nudge does not tell a row with no record to give up", /21 days after applying: if you have heard nothing, send a follow-up/.test(await page.locator('[data-waiting="Old Silence Ltd"] [data-nudge]').innerText()));
  await page.locator('[data-waiting="Bluebell Telecom"] [data-waiting-followed]').click();
  await page.waitForFunction(() => /In touch today/.test(document.querySelector('[data-waiting="Bluebell Telecom"]')?.textContent ?? ""), null, { timeout: 8000 });
  check("Followed up today records the contact", db.applications.find((a) => a.company_name === "Bluebell Telecom").last_contact_from === "me");
  await page.locator("[data-toast-undo]").click();
  await page.waitForFunction(() => /no contact recorded/.test(document.querySelector('[data-waiting="Bluebell Telecom"]')?.textContent ?? ""), null, { timeout: 8000 });
  check("and undo clears it", db.applications.find((a) => a.company_name === "Bluebell Telecom").last_contact_at == null);
  const replied = page.locator('[data-reply-owed="Replied Ltd"]');
  check("when they spoke last it is Reply owed, not Waiting on them", (await replied.count()) === 1 && /They wrote 24 days ago/.test(await replied.innerText()) && (await replied.locator("[data-nudge]").count()) === 0, await replied.innerText());
  await replied.locator("[data-waiting-reject]").click();
  check("a row that reached screening asks first", await page.locator("[data-close-dialog]").isVisible());
  check("and nothing moved yet", db.applications.find((a) => a.company_name === "Replied Ltd").status === "screening");
  await page.locator("[data-close-submit]").click();
  await page.waitForFunction(() => !document.querySelector('[data-reply-owed="Replied Ltd"]'), null, { timeout: 8000 });
  await page.locator("[data-toast-undo]").waitFor();
  const repliedRow = db.applications.find((a) => a.company_name === "Replied Ltd");
  check("closing a row clears its follow-up and notes it", repliedRow.followup_date === null && /cleared when marked Rejected/.test(repliedRow.notes));
  await page.locator("[data-toast-undo]").click();
  await page.locator('[data-reply-owed="Replied Ltd"]').waitFor({ timeout: 8000 });
  check("undo restores the status, the follow-up and the notes", repliedRow.status === "screening" && repliedRow.followup_date === "2026-11-20" && !repliedRow.notes, JSON.stringify(repliedRow.notes));
  check("the promised follow-up date shows (lib/formatDate)", /follow-up 10 Nov 2026/.test(await page.locator('[data-waiting="Bluebell Telecom"]').innerText()));
  check("the calendar dots its event days", (await page.locator('[data-mini-calendar] [data-has-events]').count()) >= 3);
  check("the funnel lists its steps with counts", /Screening\s*\d+/.test(await page.locator("[data-funnel]").innerText()));
  check("under eight in a group says too few to judge", /not enough results yet/.test(await page.locator("[data-funnel]").innerText()));

  // ── A reminder moves nothing; a call proves its stage, and the user can say no ──
  await page.locator("[data-new-event]").click();
  await page.locator("[data-event-search]").fill("Unsent");
  await page.getByRole("button", { name: /Unsent Ltd/ }).click();
  await page.locator("#evKind").selectOption("deadline");
  await page.getByLabel("A deadline").check();
  await page.locator("[data-event-date]").fill("2026-11-20");
  await page.locator("[data-event-notime]").check();
  check("a deadline on an unsent row says it stays off the plan", /stays off your schedule until Unsent Ltd/.test(await page.locator("[data-event-hidden]").innerText()) && (await page.locator("[data-event-move]").count()) === 0);
  await page.locator("[data-event-save]").click();
  await page.locator("[data-toast]").waitFor();
  check("and saves without moving the row", db.applications.find((a) => a.company_name === "Unsent Ltd").status === "saved" && /stays off your schedule/.test(await page.locator("[data-toast]").innerText()), await page.locator("[data-toast]").innerText());
  await page.locator("[data-new-event]").click();
  await page.locator("[data-event-search]").fill("Applied Only");
  await page.getByRole("button", { name: /Applied Only Ltd/ }).click();
  await page.locator("#evKind").selectOption("interview");
  await page.locator("[data-event-date]").fill("2026-11-21");
  await page.locator("[data-event-time]").fill("10:00");
  check("an interview on an Applied row offers the move", /Move it to Interview/.test(await page.locator("[data-event-move]").innerText()));
  check("the length starts blank", (await page.locator("[data-event-duration]").inputValue()) === "");
  await page.locator("[data-event-move-toggle]").uncheck();
  check("unticked, it says it stays off the plan", (await page.locator("[data-event-hidden]").count()) === 1);
  await page.locator("[data-event-save]").click();
  await page.waitForFunction(() => !document.querySelector("[data-event-form]"), null, { timeout: 8000 });
  check("unticked, the row does not move", db.applications.find((a) => a.company_name === "Applied Only Ltd").status === "applied");
  check("a length nobody gave is not stored", db.events.find((e) => e.application_id === idOf("Applied Only Ltd")).ends_at === null);
  db.events = db.events.filter((e) => e.application_id !== idOf("Applied Only Ltd") && e.application_id !== idOf("Unsent Ltd"));

  // ── Creating an interview ──────────────────────────────────────────────────
  await page.locator("[data-new-event]").click();
  await page.locator("[data-event-form]").waitFor();
  check("focus moves into the form", await page.evaluate(() => !!document.activeElement?.closest("[data-event-form]")));
  await page.locator("[data-event-search]").fill("Delta");
  await page.getByRole("button", { name: /Delta Advisory/ }).click();
  await page.locator("#evKind").selectOption("interview");
  await page.locator("#evTitle").fill("Today's interview");
  await page.locator("[data-event-date]").fill("2026-11-03");
  await page.locator("[data-event-time]").fill("12:20");
  await page.locator("#evDuration").fill("30");
  await page.locator("[data-event-save]").click();
  await page.locator('[data-group="today"]').waitFor();
  const todays = page.locator('[data-group="today"] [data-event-title="Today\'s interview"]');
  check("a new interview appears under Today", (await todays.count()) === 1);
  check("with a live countdown", (await todays.locator("[data-event-countdown]").innerText()) === "in 3h 20m", await todays.locator("[data-event-countdown]").innerText());
  check("and a toast", /Event added/.test(await page.locator("[data-toast]").innerText()));

  // ── Rejected removes every card at once; undo brings them back ────────────
  const apeCards = page.locator('[data-event-title="Video interview (2 questions)"], [data-event-title="Criteria assessment (15 min)"]');
  check("the application has two cards first", (await apeCards.count()) === 2);
  const ape = page.locator('[data-event-title="Video interview (2 questions)"]');
  await ape.locator("[data-event-outcome]").click();
  await page.screenshot({ path: path.join(SHOTS, "next-outcome.png") });
  await ape.locator('[data-outcome="rejected"]').click();
  await page.locator("[data-close-submit]").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-event-title="Video interview (2 questions)"], [data-event-title="Criteria assessment (15 min)"]').length === 0, null, { timeout: 8000 });
  check("Rejected removes all its cards", (await apeCards.count()) === 0);
  check("the toast offers undo", /Moved to Closed/.test(await page.locator("[data-toast]").innerText()) && (await page.locator("[data-toast-undo]").count()) === 1);
  check("the row is rejected, its events kept", db.applications.find((a) => a.company_name === "Ape Sales").status === "rejected" && db.events.filter((e) => e.application_id === idOf("Ape Sales")).length === 2);
  await page.locator("[data-toast-undo]").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-event-title="Video interview (2 questions)"]').length === 1, null, { timeout: 8000 });
  check("undo brings them back", (await apeCards.count()) === 2 && db.applications.find((a) => a.company_name === "Ape Sales").status === "interview");

  // ── An outcome finishes its event ──────────────────────────────────────────
  const lateCall = page.locator('[data-event-title="Call that ended"]');
  await lateCall.locator("[data-event-outcome]").click();
  await lateCall.locator('[data-outcome="offer"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-event-title="Call that ended"]'), null, { timeout: 8000 });
  check("Offer moves the row and finishes the event", db.applications.find((a) => a.company_name === "Late Ltd").status === "offer" && db.events.find((e) => e.title === "Call that ended").status === "done");
  await page.locator("[data-toast-undo]").click();
  await page.locator('[data-event-title="Call that ended"]').waitFor({ timeout: 8000 });
  check("undo restores both", db.applications.find((a) => a.company_name === "Late Ltd").status === "assessment" && db.events.find((e) => e.title === "Call that ended").status === "scheduled");

  // ── Keyboard ───────────────────────────────────────────────────────────────
  await page.locator("h1").first().click();
  await page.keyboard.press("j");
  const selectedTitle = () => page.locator(".planCard--selected").getAttribute("data-event-title");
  const firstCard = await page.locator(".planCard").first().getAttribute("data-event-title");
  check("j selects the first", (await selectedTitle()) === firstCard, await selectedTitle());
  await page.keyboard.press("j");
  const second = await selectedTitle();
  await page.keyboard.press("k");
  check("k moves back", (await selectedTitle()) === firstCard && second !== firstCard, second);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  check("the walk reaches today's", (await selectedTitle()) === "Today's interview", await selectedTitle());
  await page.keyboard.press("d");
  await page.waitForFunction(() => document.querySelectorAll('[data-event-title="Today\'s interview"]').length === 0, null, { timeout: 8000 });
  check("d marks it done", db.events.find((e) => e.title === "Today's interview").status === "done");
  await page.keyboard.press("j");
  const afterDone = await page.locator(".planCard--selected").getAttribute("data-event-title");
  check("after d, j carries on from there, not from the top", !!afterDone && afterDone !== (await page.locator(".planCard").first().getAttribute("data-event-title")), afterDone);
  await page.locator("[data-toast-undo]").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-event-title="Today\'s interview"]').length === 1, null, { timeout: 8000 });
  check("undo reopens it", db.events.find((e) => e.title === "Today's interview").status === "scheduled");
  await page.keyboard.press("n");
  await page.locator("[data-event-form]").waitFor();
  check("n opens the form", true);
  await page.locator("#evTitle").fill("n"); // typing in a field is not a shortcut
  check("typing n in a field stays in the field", (await page.locator("#evTitle").inputValue()) === "n");
  await page.keyboard.press("Escape");
  await page.locator("[data-event-form]").waitFor({ state: "hidden" });
  check("Escape closes it", true);

  // ── Clashes ────────────────────────────────────────────────────────────────
  check("the seeded plan shows no false clash", /Nothing overlaps/.test(await page.locator("[data-conflicts]").innerText()), await page.locator("[data-conflicts]").innerText());
  await page.locator("[data-new-event]").click();
  await page.locator("[data-event-search]").fill("Delta");
  await page.getByRole("button", { name: /Delta Advisory/ }).click();
  await page.locator("[data-event-date]").fill("2026-11-06");
  await page.locator("[data-event-time]").fill("13:00");
  await page.locator("[data-event-clash]").waitFor();
  check("the form warns inside a shift", /Inside Shift \(12:00 to 16:00\)/.test(await page.locator("[data-event-clash]").innerText()));
  await page.locator("[data-event-date]").fill("2026-11-04");
  await page.locator("[data-event-time]").fill("10:20");
  await page.waitForFunction(() => /Overlaps Interview call/.test(document.querySelector("[data-event-clash]")?.textContent ?? ""), null, { timeout: 4000 });
  check("and over another event", true);
  await page.screenshot({ path: path.join(SHOTS, "next-form.png") });
  await page.locator("#evTitle").fill("Clashing call");
  await page.locator("[data-event-save]").click();
  await page.locator('[data-event-title="Clashing call"]').waitFor();
  check("a clash never blocks; the Clashes card lists it", /Overlaps (Interview|Clashing) call/.test(await page.locator("[data-conflicts]").innerText()), await page.locator("[data-conflicts]").innerText());
  db.events = db.events.filter((e) => e.title !== "Clashing call");

  // ── Booking ────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: "load" });
  await page.locator('[data-group="needs_booking"]').waitFor({ timeout: 30000 });
  const sunbury = page.locator('.planCard:has-text("Sunbury Energy")');
  await sunbury.locator("[data-suggest-replies]").click();
  const slots = await sunbury.locator("[data-slot]").evaluateAll((e) => e.map((x) => x.dataset.slot));
  check("offered CET slots show in UK time and only when free", slots.join() === "11:00,12:30,13:30", slots.join());
  await sunbury.getByRole("button", { name: "Copy reply" }).click();
  const reply = await page.evaluate(() => navigator.clipboard.readText());
  check("the reply is copied in British English", /Wednesday 4 November at 11:00/.test(reply) && /UK time/.test(reply) && /Kind regards,/.test(reply), reply.slice(0, 80));
  const delta = page.locator('[data-event-title="Screening call"]:has-text("Delta Advisory")');
  await delta.locator("[data-suggest-replies]").click();
  const deltaSlots = await delta.locator("[data-slot]").allInnerTexts();
  check("with no offered slots, free windows minus busy time, buffered", deltaSlots.length >= 1 && /Thursday 5 November, 15:30 to 20:00/.test(deltaSlots.join("|")), deltaSlots.join("|"));
  await page.screenshot({ path: path.join(SHOTS, "next-booking.png"), fullPage: true });
  await sunbury.locator('[data-slot="11:00"] [data-slot-book]').click();
  await page.locator('[data-group="tomorrow"] .planCard:has-text("Sunbury Energy")').waitFor({ timeout: 8000 });
  const booked = db.events.find((e) => e.application_id === idOf("Sunbury Energy"));
  check("Book this moves it onto the timeline", booked.status === "scheduled");
  check("and stores no length they never gave", booked.ends_at === null);
  check("and copies a one-slot reply", /I'm available on Wednesday 4 November at 11:00/.test(await page.evaluate(() => navigator.clipboard.readText())));
  check("the toast says to send it", /A reply is copied/.test(await page.locator("[data-toast]").innerText()));
  await page.locator("[data-toast-undo]").click();
  await page.locator('[data-group="needs_booking"] .planCard:has-text("Sunbury Energy")').waitFor({ timeout: 8000 });
  check("undo puts the offer back with its slots", booked.status === "to_book" && booked.offered_slots.length === 3);
  await page.locator('.planCard:has-text("Sunbury Energy") [data-suggest-replies]').click();
  await page.locator('.planCard:has-text("Sunbury Energy") [data-slot="11:00"] [data-slot-book]').click();
  await page.locator('[data-group="tomorrow"] .planCard:has-text("Sunbury Energy")').waitFor({ timeout: 8000 });
  await page.locator('.planCard:has-text("Delta Advisory") [data-event-reschedule]').first().click().catch(() => {});
  await page.locator("[data-event-form]").waitFor({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");

  // ── Week and pipeline ──────────────────────────────────────────────────────
  await page.locator('[data-view="week"]').click();
  await page.locator("[data-week-view]").waitFor();
  check("the week shows the shift and the interview on their day", /Shift/.test(await page.locator('[data-week-day="2026-11-06"]').innerText()) && /Northwind Ratings/.test(await page.locator('[data-week-day="2026-11-04"]').innerText()));
  const clash = await page.locator('[data-week-day="2026-11-05"] [data-type="deadline"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]));
  check("two deadlines at one time sit side by side", clash.length === 2 && clash[0][1] <= clash[1][0] + 1, JSON.stringify(clash));
  check("the week names the company", /Northwind Ratings/.test(await page.locator('[data-week-day="2026-11-04"]').innerText()));
  await page.screenshot({ path: path.join(SHOTS, "next-week.png"), fullPage: true });
  await page.locator("[data-window-date]").fill("2026-11-07");
  await page.locator("[data-window-start]").fill("10:00");
  await page.locator("[data-window-end]").fill("11:00");
  await page.locator("[data-window-label]").fill("Gym");
  await page.locator("[data-window-add]").click();
  await page.locator('[data-window-row]:has-text("Gym")').waitFor({ timeout: 8000 });
  check("a busy time can be added", /Gym/.test(await page.locator('[data-week-day="2026-11-07"]').innerText()));

  await page.locator('[data-view="pipeline"]').click();
  await page.locator("[data-pipe-node]").first().waitFor({ timeout: 30000 });
  const nodes = await page.locator("[data-pipe-node]").evaluateAll((e) => e.map((x) => x.dataset.pipeNode));
  check("the pipeline chart renders its nodes", ["applied", "screening", "interview", "rejected"].every((k) => nodes.includes(k)), nodes.join());
  await page.screenshot({ path: path.join(SHOTS, "next-pipeline.png"), fullPage: true });
  await page.locator('[data-pipeline] summary').click();
  check("the table holds every figure", /Not enough results yet/.test(await page.locator("[data-pipe-table]").innerText()));
  check("hover and label agree", /^Screening: \d+/.test(await page.locator('[data-pipe-node="screening"] title').textContent()) && (await page.locator(".recharts-tooltip-wrapper").count()) === 0);
  await page.locator('[data-pipe-node="screening"]').click();
  await page.waitForURL(/\/applications\?status=screening/, { timeout: 30000 });
  check("clicking a node opens that stage on the tracker", true);

  // The tracker's tabs are tested on the real API by scripts/e2e-applications.mjs.

  // ── The pipeline at a real tracker's scale ─────────────────────────────────
  const bigCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await bigCtx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const big = await bigCtx.newPage();
  const many = (n, status, stages) => Array.from({ length: n }, () => ({ status, stages_reached: stages }));
  const bigFunnel = buildFunnel([
    ...many(683, "applied", ["applied"]), ...many(263, "rejected", ["applied", "rejected"]), ...many(19, "screening", ["applied", "screening"]),
    ...many(3, "interview", ["applied", "interview"]), ...many(44, "withdrawn", ["applied", "withdrawn"]), ...many(27, "saved", ["saved"]),
  ]);
  await big.route("**/api/plan**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ applications: [], events: [], availability: [], funnel: bigFunnel }) }));
  await big.goto(BASE + "/app/next", { waitUntil: "load" });
  await big.locator('[data-view="pipeline"]').click();
  await big.locator("[data-pipe-node]").first().waitFor({ timeout: 30000 });
  await big.waitForTimeout(300);
  await big.screenshot({ path: path.join(SHOTS, "next-pipeline-big.png"), fullPage: true });
  const clipped = await big.evaluate(() => {
    const chart = document.querySelector(".pipeChart").getBoundingClientRect();
    return [...document.querySelectorAll(".pipeLabel")].filter((t) => { const r = t.getBoundingClientRect(); return r.right > chart.right + 1 || r.left < chart.left - 1; }).map((t) => t.textContent);
  });
  check("no pipeline label is cut off", clipped.length === 0, clipped.join());
  const overlapped = await big.evaluate(() => {
    const rects = [...document.querySelectorAll(".pipeLabel")].map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(rects[i].text + " / " + rects[j].text);
    }
    return hits;
  });
  check("no pipeline labels overlap", overlapped.length === 0, overlapped.join());

  // ── Phone ──────────────────────────────────────────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/London", isMobile: true, hasTouch: true });
  await phone.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const mobile = await phone.newPage();
  await mobile.clock.setFixedTime(new Date(zonedTimeToMs("2026-11-03", "09:00", "Europe/London")));
  await route(mobile);
  await mobile.goto(BASE + "/app/next", { waitUntil: "load" });
  await mobile.locator("[data-group]").first().waitFor({ timeout: 30000 });
  const overflow = async (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("phone: no sideways scroll", (await overflow(mobile)) <= 0, String(await overflow(mobile)));
  check("phone: the Next up hero shows the next event", (await mobile.locator("[data-next-hero]").isVisible()) && /Delta Advisory/.test(await mobile.locator("[data-next-hero]").innerText()), await mobile.locator("[data-next-hero]").innerText());
  await mobile.screenshot({ path: path.join(SHOTS, "next-phone.png") });
  const heroTopBefore = await mobile.locator("[data-next-hero]").evaluate((e) => e.getBoundingClientRect().top);
  await mobile.evaluate(() => window.scrollTo(0, 900));
  await mobile.waitForTimeout(200);
  const heroTopAfter = await mobile.locator("[data-next-hero]").evaluate((e) => e.getBoundingClientRect().top);
  check("phone: the hero stays on screen when scrolled", heroTopAfter >= 0 && heroTopAfter < 120, `${heroTopBefore} -> ${heroTopAfter}`);
  await mobile.screenshot({ path: path.join(SHOTS, "next-phone-scrolled.png") });
  await mobile.locator('[data-view="week"]').click();
  await mobile.locator("[data-week-view]").waitFor();
  check("phone: the week scrolls inside its frame", (await overflow(mobile)) <= 0);
  await mobile.screenshot({ path: path.join(SHOTS, "next-phone-week.png") });
  await mobile.goto(BASE + "/applications?status=interview", { waitUntil: "load" });
  await mobile.locator("[data-stage-table]").waitFor({ timeout: 30000 });
  check("phone: the stage table has no sideways scroll", (await overflow(mobile)) <= 0, String(await overflow(mobile)));
  await mobile.screenshot({ path: path.join(SHOTS, "stage-phone.png") });

  // ── Empty state ────────────────────────────────────────────────────────────
  const emptyCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await emptyCtx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const empty = await emptyCtx.newPage();
  await empty.route("**/api/plan**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ applications: [], events: [], availability: [], funnel: buildFunnel([]) }) }));
  await empty.goto(BASE + "/app/next", { waitUntil: "load" });
  await empty.locator(".emptyState").waitFor({ timeout: 30000 });
  check("an empty plan has a clear next step", /Nothing to do yet/.test(await empty.locator(".emptyState").innerText()));
  await empty.screenshot({ path: path.join(SHOTS, "next-empty.png") });

  // ── The real server, before the migration ──────────────────────────────────
  const authed = { cookie: `sb-${REF}-auth-token=${cookieValue}`, "Content-Type": "application/json" };
  const plan = await fetch(BASE + "/api/plan", { headers: authed });
  const live = plan.status === 200 ? "applied" : plan.status === 503 ? "not applied" : String(plan.status);
  console.log(`info: migration on this database: ${live}`);
  if (plan.status === 503) {
    check("the real /api/plan names the migration", (await plan.json()).errorType === "needs_migration");
    const add = await (await fetch(BASE + "/api/applications", { method: "POST", headers: authed, body: JSON.stringify({ company_name: "Fallback Ltd", role: "Engineer", date_applied: "2026-10-20" }) })).json();
    check("a new row saves on the old constraint", !!add.id, JSON.stringify(add).slice(0, 100));
    const listed = (await (await fetch(BASE + "/api/applications", { headers: authed })).json()).applications;
    check("and reads back in the API's spelling", listed[0]?.status === "Applied", listed[0]?.status);
    const put = await fetch(BASE + "/api/applications", { method: "PUT", headers: authed, body: JSON.stringify({ id: add.id, status: "rejected" }) });
    const row = (await (await fetch(`${BASE}/api/applications?id=${add.id}`, { headers: authed })).json()).application;
    check("a status with an old label writes on the old constraint", put.status === 200 && row.status === "Rejected", `${put.status} ${row.status}`);
    const ghost = await fetch(BASE + "/api/applications", { method: "PUT", headers: authed, body: JSON.stringify({ id: add.id, status: "ghosted" }) });
    check("a new status names the migration instead of a 500", ghost.status === 503 && (await ghost.json()).errorType === "needs_migration", String(ghost.status));
    const notSeen = await browser.newContext();
    await notSeen.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const m = await notSeen.newPage();
    await m.goto(BASE + "/app/next", { waitUntil: "load" });
    await m.locator("[data-needs-migration]").waitFor({ timeout: 30000 });
    check("the page says what is missing rather than failing", /20261103120000/.test(await m.locator("[data-needs-migration]").innerText()));
  }

  check("no console errors or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  check("harness ran to the end", false, err.message.slice(0, 400));
} finally {
  await browser?.close().catch(() => {});
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway user removed: ${del.ok}`);
  process.exit(fail ? 1 : 0);
}
