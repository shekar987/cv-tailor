// Chunk JH-1 in a real browser (Edge), on the real API and database, a throwaway account,
// made-up rows, removed at the end. No model call. It captures the Done-when screenshots
// (the Interviews & deadlines panel + Today's follow-ups) and checks the booked-interview-
// on-a-wrong-stage-row case the panel exists for.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs \
//   SHOTS_DIR="C:\\Users\\shekar\\Desktop\\shekar\\RTS\\jobhuntz-audit\\2026-11-22\\screenshots" \
//   node --disable-warning=ExperimentalWarning scripts/e2e-followups-interviews.mjs
//
// The two files it writes: 03-followups-interviews-desktop.png and -phone.png.
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "followups-interviews-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const days = (n) => { const d = new Date(Date.now() + n * 86_400_000); return d.toISOString(); };
const dayOnly = (n) => days(n).slice(0, 10);

const email = `jh1-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;
  const api = async (p, method, body) => (await fetch(BASE + p, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  const row = async (company_name, status, over = {}) => (await api("/api/applications", "POST", { company_name, role: "Software Engineer", status, date_applied: dayOnly(-40), ...over })).id;
  const event = (body) => api("/api/events", "POST", { move_stage: false, ...body });

  // The bp case: a booked interview, but the row was marked Rejected (all three bp rows were).
  const bp = await row("bp", "Rejected", { role: "Graduate Software Engineer" });
  await event({ application_id: bp, kind: "interview", title: "First-round interview", starts_at: days(3) });
  // Accenture and Ellipse: an interview and a booking, rows left behind at Applied.
  const accenture = await row("Accenture", "Applied", { role: "Technology Analyst" });
  await event({ application_id: accenture, kind: "interview", title: "HR interview", starts_at: days(1) });
  const ellipse = await row("Ellipse", "Applied", { role: "Backend Engineer" });
  await event({ application_id: ellipse, kind: "interview", title: "Book your interview", status: "to_book" });
  // A Google online assessment due Sunday, on an Applied row.
  const google = await row("Greenfield Labs", "Applied", { role: "Software Engineer" });
  await event({ application_id: google, kind: "assessment", title: "Online assessment", due_at: days(2) + "", date_only: false });

  // A follow-up backlog: ATS-only Applied rows chased long ago, plus one warm Interview row
  // so Today's follow-ups leads with what matters.
  for (let i = 0; i < 18; i++) await row(`Backlog Co ${i}`, "Applied", { followup_date: dayOnly(-5 - i) });
  await row("Warm Interview Co", "Interview", { followup_date: dayOnly(-2), last_contact_from: "them", last_contact_at: days(-3) });

  browser = await chromium.launch({ channel: "msedge" });
  const open = async (viewport) => {
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London" });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/applications", { waitUntil: "load" });
    await page.locator("[data-stage-tabs]").waitFor({ timeout: 30000 });
    // The panel and the radar wait for the full list; give it a moment to land.
    await page.locator("[data-interviews-panel]").waitFor({ timeout: 30000 });
    return page;
  };

  const page = await open({ width: 1280, height: 1200 });
  // JH-5: at most 3 items by default, with "Show all (4)" for the rest, so the table is not
  // pushed below the fold. The bp interview is among the soonest, so it still shows up front.
  const defaultItems = await page.locator("[data-interview-item]").count();
  check("the panel shows at most 3 items by default (JH-5)", defaultItems === 3, String(defaultItems));
  check("'Show all (4)' reveals the rest", /Show all \(4\)/.test(await page.locator("[data-show-all]").innerText()));
  const bpItem = page.locator(`[data-interviews-panel] li`, { hasText: "bp" }).first();
  check("the bp interview shows even though its row is Rejected", await bpItem.isVisible());
  check("it offers Move to Interview", /Move to Interview/.test(await bpItem.innerText()), (await bpItem.innerText()).replace(/\n/g, " "));
  check("each item's main action links to the prep pack", (await page.locator("[data-interview-item] a.interviewsPanel__main[href*='/prep']").count()) === 3);
  await page.screenshot({ path: path.join(SHOTS, "03-followups-interviews-desktop.png"), fullPage: true });
  // Show all, then the undated booking (Ellipse) appears, last.
  await page.locator("[data-show-all]").click();
  await page.waitForTimeout(150);
  check("after Show all, all 4 items show", (await page.locator("[data-interview-item]").count()) === 4);
  check("an undated booking reads 'Not booked yet'", /Not booked yet/.test(await page.locator("[data-interviews-panel]").innerText()));
  // "Add to calendar" sits behind each item's "More" disclosure now.
  const firstMore = page.locator("[data-interview-item] details.interviewsPanel__more summary").first();
  check("each item has a keyboard-reachable 'More'", await firstMore.isVisible());
  await firstMore.click();
  check("'More' reveals Add to calendar", (await page.locator("[data-add-to-calendar]").first().isVisible()));

  // Today's follow-ups: the attention card, the priority order and the bulk close offer.
  await page.locator('[data-attn="today"]').click();
  await page.waitForTimeout(200);
  check("the bulk 'Close as No reply' offer appears", (await page.locator("[data-close-no-response]").count()) === 1);
  const firstRow = await page.locator("[data-stage-row]").first().getAttribute("data-stage-row");
  check("the warm interview follow-up leads Today's list", firstRow === "Warm Interview Co", String(firstRow));

  const phone = await open({ width: 390, height: 1400 });
  await phone.screenshot({ path: path.join(SHOTS, "03-followups-interviews-phone.png"), fullPage: true });
  check("the panel is on screen on a phone too", await phone.locator("[data-interviews-panel]").isVisible());

  console.log(`\n${pass} passed, ${fail} failed. Screenshots in ${SHOTS}`);
} finally {
  if (browser) await browser.close();
  if (created?.id) await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
}
process.exit(fail ? 1 : 0);
