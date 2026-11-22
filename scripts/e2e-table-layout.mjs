// Chunk JH-2: the Applications spreadsheet layout in a real browser (Edge), with a
// throwaway account and the API stood in for in memory (fictional data). It checks the
// fix for Shekar's 21 Nov screenshot: the JD link must not overlap the STATUS dropdown,
// the status must be changeable from the sheet, and a long note must expand by click and
// by keyboard. At 1440px (desktop) and 390px (phone).
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs SHOTS_DIR=<...> \
//     node --disable-warning=ExperimentalWarning scripts/e2e-table-layout.mjs
//
// Screenshots: 04-applications-table-desktop.png, 05-applications-table-phone.png.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { apiStatus } from "../src/lib/tracker.ts";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "table-layout-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

// ── Fictional rows in the shape of the real list (lib/applicationRows toListRow) ──
const LONG_NOTE = "22 Nov 2026 11:05 Recruiter asked for a short covering note on relocation, right to work and notice period; replied the same day with all three and a link to the portfolio. Awaiting the hiring manager's reply before the technical screen is booked.";
const LONG_JD = "https://careers.example.com/jobs/senior-full-stack-engineer-platform-team/apply?source=linkedin&ref=weekly-digest&utm_campaign=2026-q4&gh_jid=1234567890&lever=xyz";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows = [
  { id: id(1), company_name: "Northgate Systems", role: "Senior Full Stack Engineer, Platform Team (Req 25246, London hybrid)", status: "applied", date_applied: "2026-11-10", created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-18T09:00:00Z", source: "manual", has_job_description: true, notes_preview: LONG_NOTE.slice(0, 120), notes_more: true },
  { id: id(2), company_name: "Ellipse", role: "Backend Engineer", status: "applied", date_applied: "2026-11-09", created_at: "2026-11-09T09:00:00Z", updated_at: "2026-11-09T09:00:00Z", source: "tailored", has_job_description: true, notes_preview: "", notes_more: false },
  { id: id(3), company_name: "bp", role: "Software Developer", status: "applied", date_applied: "2026-11-08", created_at: "2026-11-08T09:00:00Z", updated_at: "2026-11-08T09:00:00Z", source: "manual", has_job_description: false, notes_preview: "", notes_more: false },
];
const counts = { today: "2026-11-22", counts: { to_submit: 0, applied: 3, screening: 0, interview: 0, assessment: 0, offer: 0, won: 0, closed: 0 }, total: 3, followups_due_this_week: 0, followups_due_today: { total: 0, today: 0, earlier: 0, oldest: null }, week: { from: "2026-11-16", to: "2026-11-22" } };
const puts = [];

async function standIn(ctx) {
  await ctx.route(/\/api\/applications\/counts(\?.*)?$/, (r) => r.fulfill({ json: counts }));
  await ctx.route(/\/api\/events(\?.*)?$/, (r) => r.fulfill({ json: { events: [] } }));
  await ctx.route(/\/api\/plan(\?.*)?$/, (r) => r.fulfill({ json: { applications: [], events: [], availability: [], funnel: null } }));
  await ctx.route(/\/api\/actions(\?.*)?$/, (r) => r.fulfill({ json: { events: [], closedByConfirmation: [], applications: [], availability: [] } }));
  await ctx.route(/\/api\/applications(\?.*)?$/, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() === "GET") {
      const wantId = url.searchParams.get("id");
      if (wantId) {
        const row = rows.find((x) => x.id === wantId);
        // The detail read: the full notes and a version, so the Notes panel unlocks.
        await r.fulfill({ json: { application: { ...row, status: apiStatus(row.status), notes: row.id === id(1) ? LONG_NOTE : "", notes_version: row.updated_at, job_description: row.has_job_description ? LONG_JD : "", tailored_cv: null } } });
        return;
      }
      await r.fulfill({ json: { applications: rows.map((x) => Object.fromEntries(Object.entries({ ...x, status: apiStatus(x.status) }).filter(([, v]) => v !== null && v !== undefined))) } });
      return;
    }
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      puts.push(body);
      const target = rows.find((x) => x.id === body.id);
      if (target && body.status) target.status = body.status.toLowerCase() === "ready to submit" ? "saved" : body.status.toLowerCase();
      await r.fulfill({ json: { ok: true, updated_at: new Date().toISOString() } });
      return;
    }
    await r.fallback();
  });
}

const email = `table-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  browser = await chromium.launch({ channel: "msedge" });

  // ── Desktop, 1440px ────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  await standIn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  await page.waitForTimeout(400);
  // Open the many-column sheet ("Open as a table").
  await page.locator("[data-stage-sheet]").click({ timeout: 30000 });
  await page.waitForTimeout(300);

  const sheetRow = page.locator("tr.appsRow").first();
  const jdCell = sheetRow.locator('td[data-label="JD"]');
  const statusCell = sheetRow.locator('td[data-label="Status"]');
  const statusSelect = statusCell.locator("select");
  const jdBox = await jdCell.boundingBox();
  const statusBox = await statusCell.boundingBox();
  check("the JD cell ends before the STATUS cell begins (no overlap)", jdBox && statusBox && jdBox.x + jdBox.width <= statusBox.x + 1, jdBox && statusBox ? `JD right ${Math.round(jdBox.x + jdBox.width)}, STATUS left ${Math.round(statusBox.x)}` : "no box");
  // The JD control itself (the icon button) must not reach the status cell either.
  const jdBtnBox = await jdCell.locator("button").boundingBox();
  check("the JD icon button stays inside its column", jdBtnBox && statusBox && jdBtnBox.x + jdBtnBox.width <= statusBox.x + 1, jdBtnBox ? `JD btn right ${Math.round(jdBtnBox.x + jdBtnBox.width)}` : "no btn");
  check("the status dropdown is wide enough to tap", statusBox && statusBox.width >= 100, statusBox ? `${Math.round(statusBox.width)}px` : "no box");

  // Change a status by clicking the select (no row opened).
  await statusSelect.selectOption("interview");
  await page.waitForTimeout(250);
  check("changing the status from the sheet sends a PUT", puts.some((p) => p.id === id(1) && String(p.status).toLowerCase() === "interview"), JSON.stringify(puts.at(-1) ?? {}));

  // A long note expands by click: the Notes button opens the panel with the full text.
  const notesBtn = sheetRow.locator('td[data-label="Notes"] button');
  check("the long note is truncated in its cell (ellipsis), not spilled", await notesBtn.evaluate((el) => el.scrollWidth > el.clientWidth || getComputedStyle(el).textOverflow === "ellipsis"));
  await notesBtn.click();
  await page.waitForTimeout(400);
  const panelText = await page.locator("tr.appsDetail").first().innerText().catch(() => "");
  check("clicking the note expands the full text", panelText.includes("relocation, right to work and notice period"), panelText.slice(0, 80));
  await notesBtn.click(); // close
  await page.waitForTimeout(200);

  // And by keyboard: focus the button and press Enter.
  await notesBtn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("pressing Enter on the note expands it too", (await page.locator("tr.appsDetail").count()) > 0);
  await page.screenshot({ path: path.join(SHOTS, "04-applications-table-desktop.png"), fullPage: false });

  // ── Phone, 390px ─────────────────────────────────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 850 }, timezoneId: "Europe/London", isMobile: true });
  await phone.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  await standIn(phone);
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/applications`, { waitUntil: "load" });
  await pp.waitForTimeout(400);
  await pp.locator("[data-stage-sheet]").click({ timeout: 30000 });
  await pp.waitForTimeout(300);
  const card = pp.locator("tr.appsRow").first();
  const jdVisibleBefore = await card.locator('td[data-label="JD"]').isVisible();
  const moreBtn = card.locator("[data-row-more]");
  check("the phone card has a More button", (await moreBtn.count()) === 1);
  check("JD/CV/notes are folded away before More is pressed", jdVisibleBefore === false);
  check("Company, Role and Status stay on the card", (await card.locator('td[data-label="Company Name"]').isVisible()) && (await card.locator('td[data-label="Status"]').isVisible()));
  if (await moreBtn.count()) {
    await moreBtn.click();
    await pp.waitForTimeout(200);
    check("More reveals the folded fields", await card.locator('td[data-label="Notes"]').isVisible());
  }
  // Nothing runs off the right edge of the phone.
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll on the phone", overflow <= 1, `${overflow}px`);
  await pp.screenshot({ path: path.join(SHOTS, "05-applications-table-phone.png"), fullPage: false });

  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`\nScreenshots in ${SHOTS}`);
} finally {
  await browser?.close();
  await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin }).catch(() => {});
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
