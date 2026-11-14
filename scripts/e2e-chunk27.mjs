// Chunk 27 on /applications in a real browser (Edge), on the real routes and database, with a
// throwaway account removed at the end. No model call.
//
// On a phone (390 x 844): "+ Add application", "Log outcome", the search box and the stage tabs
// come straight after the title and are on screen without scrolling; no tab is clipped or off
// the edge; what is due sits in one "Today (n)" section, folded, that still names the soonest
// thing due and opens on a tap. On a desktop (1280) the same section is open. On both: the
// new wording (the follow-ups card, the fix card, "Rejected / closed" on the tab and in
// Insights), the tab a new visit opens on (decided from the counts, never the last one used),
// and "Log outcome" ending a screened application, and one a sweep had reported, in ONE click
// and ONE request.
//
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node scripts/e2e-chunk27.mjs
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "chunk27-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const DAY = 86_400_000;
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const day = (n) => londonDay(Date.now() + n * DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (iso) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const stored = async (id, columns) => (await (await fetch(`${SB}/rest/v1/applications?id=eq.${id}&select=${columns}`, { headers: admin })).json())[0];
const flat = (s) => s.replace(/\s+/g, " ").trim();

const email = `chunk27-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const row = (company_name, role, status, extra = {}) => ({
    user_id: created.id, company_name, role, status, date_applied: day(-14), followup_date: null, source: "manual", notes: null, pending_outcome: null, next_deadline: null, deadline_note: null, ...extra,
  });
  const overdue = day(-5);
  // Every company is made up. The two "per width" rows are ended by that width's run.
  const perWidth = (tag) => [
    row(`Ardenmoor ${tag}`, "Technology Graduate", "interview", { notes: "Interview on 5 Nov" }),
    row(`Marlowe Finch ${tag}`, "Analyst Developer", "screening", { pending_outcome: { outcome: "rejected", date: day(-1), source: "gmail" } }),
  ];
  const shared = [
    row("Harbourline Bank", "Backend Engineer", "interview"),
    row("Wrenfield Insurance", "Software Engineer", "interview"),
    row("Cobalt Studios", "Software Engineer", "interview"),
    row("Kestrel Energy", "Graduate Developer", "screening"),
    row("Tidewell", "Backend Developer", "applied"),
    row("Penrose & Hale", "Technology Graduate", "applied"),
    row("Quillstone", "Graduate Software Engineer", "applied", { date_applied: day(-7) }),
    row("Made Up Late Follow Up", "Software Engineer", "applied", { followup_date: overdue }),
    row("Made Up Later Test", "Software Engineer", "applied", { next_deadline: new Date(Date.now() + 30 * 3_600_000).toISOString(), deadline_note: "Complete the coding test" }),
    row("Made Up Sooner Test", "Software Engineer", "applied", { next_deadline: new Date(Date.now() + 5 * 3_600_000).toISOString(), deadline_note: "Send the screening answers" }),
    row("Not Sent Yet", "Junior Developer", "saved"),
    row("Oakridge Bank", "Data Engineer", "rejected", { date_applied: day(-60) }),
    row("Fernhill Labs", "Software Engineer", "rejected", { date_applied: day(-50) }),
    row("Larkspur Digital", "Web Developer", "rejected", { date_applied: day(-40) }),
    row("Silverbeck", "Platform Engineer", "ghosted", { date_applied: day(-70) }),
    row("Northmere", "Software Engineer", "withdrawn", { date_applied: day(-30) }),
  ];
  const seeded = await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=representation" }, body: JSON.stringify([...perWidth("D"), ...perWidth("M"), ...shared]) });
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.status} ${await seeded.text()}`);
  const all = await seeded.json();
  const idOf = (company) => all.find((r) => r.company_name === company)?.id;

  browser = await chromium.launch({ channel: "msedge" });
  for (const [tag, viewport] of [["M", { width: 390, height: 844 }], ["D", { width: 1280, height: 1000 }]]) {
    const w = viewport.width;
    const phone = w < 500;
    // The phone runs first and ends its two screened applications, so the wide run starts with two fewer live.
    const closedCount = phone ? 5 : 7, toFix = phone ? 8 : 6;
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London", ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const open = async () => {
      await page.goto(`${BASE}/applications`, { waitUntil: "load" });
      await page.locator("[data-apps-outcome]").waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector("[data-today-count]") && document.querySelector('[data-stage-tab][aria-selected="true"]'), null, { timeout: 30000 });
    };
    await open();
    const box = async (selector) => page.locator(selector).first().boundingBox();
    const selectedTab = () => page.locator('[data-stage-tab][aria-selected="true"]').getAttribute("data-stage-tab");

    // ── The tab a visit opens on ───────────────────────────────────────────
    check(`${w}: the page opens on Interview, the furthest stage that holds anything`, (await selectedTab()) === "interview", await selectedTab());
    await page.locator('[data-stage-tab="applied"]').click();
    check(`${w}: a tab can be chosen`, (await selectedTab()) === "applied");
    await open();
    check(`${w}: a reload opens on the default again, not the tab used last`, (await selectedTab()) === "interview", await selectedTab());
    const storedTab = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /tab/i.test(k) && !/closed/i.test(k)));
    check(`${w}: no tab is remembered in the browser`, storedTab.length === 0, storedTab.join());

    // ── The top of the page ────────────────────────────────────────────────
    const add = await box("[data-apps-add]"), outcome = await box("[data-apps-outcome]"), search = await box("[data-apps-search]"), tabs = await box("[data-stage-tabs]"), today = await box("[data-today-toggle]"), title = await box("h1");
    const onScreen = (b) => !!b && b.x >= 0 && b.x + b.width <= w + 1 && b.y >= 0 && b.y + b.height <= viewport.height;
    check(`${w}: "+ Add application" and "Log outcome" are on screen, side by side`, onScreen(add) && onScreen(outcome) && Math.abs(add.y - outcome.y) < 4, `${Math.round(add?.y)} / ${Math.round(outcome?.y)}`);
    check(`${w}: the search box and every tab are on screen without scrolling`, onScreen(search) && onScreen(tabs), `search ${Math.round(search?.y)}, tabs end ${Math.round((tabs?.y ?? 0) + (tabs?.height ?? 0))} of ${viewport.height}`);
    const tabBoxes = await page.locator("[data-stage-tab]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { name: e.textContent.replace(/\s+/g, " ").trim(), left: r.left, right: r.right, cut: e.scrollWidth > e.clientWidth + 1 }; }));
    const clipped = tabBoxes.filter((t) => t.left < 0 || t.right > w + 1 || t.cut);
    check(`${w}: no tab is clipped or off the edge`, tabBoxes.length >= 6 && clipped.length === 0, clipped.map((t) => t.name).join() || tabBoxes.map((t) => t.name).join(" | "));
    const rowScroll = await page.locator("[data-stage-tabs]").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, left: el.scrollLeft }));
    check(`${w}: the tab row does not scroll sideways`, rowScroll.scroll <= rowScroll.client + 1 && rowScroll.left === 0, JSON.stringify(rowScroll));
    check(`${w}: the first tab reads "To submit 1" in full, and the last stage tab "Rejected / closed ${closedCount}"`, tabBoxes[0]?.name === "To submit 1" && tabBoxes.some((t) => t.name === `Rejected / closed ${closedCount}`), tabBoxes.map((t) => t.name).join(" | "));
    check(`${w}: the page does not scroll sideways`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= w + 1);
    if (phone) {
      check(`${w}: the order is title, buttons, search, tabs, then Today`, title.y < add.y && add.y < search.y && search.y < tabs.y && tabs.y < today.y, [title, add, search, tabs, today].map((b) => Math.round(b.y)).join(" < "));
      const order = await page.evaluate(() => {
        const at = (s) => document.querySelector(s);
        const before = (a, b) => !!(at(a).compareDocumentPosition(at(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
        return before("[data-apps-add]", "[data-apps-search]") && before("[data-apps-search]", "[data-stage-tabs]") && before("[data-stage-tabs]", "[data-today-toggle]");
      });
      check(`${w}: and the reading order is the same as the order on screen`, order);
      check(`${w}: Export moved down beside the filters`, (await page.locator(".appsTools--more [data-apps-export]").count()) === 1 && (await page.locator(".pageHeadActions [data-apps-export]").count()) === 0);
      const targets = await page.locator("[data-stage-tab], [data-today-toggle], [data-apps-add], [data-apps-outcome]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      check(`${w}: every tab and button is at least 44px tall`, targets.every((h) => h >= 44), targets.join());
    } else {
      check(`${w}: on a wide screen Today stays above the tabs, and Export beside the buttons`, today.y < tabs.y && (await page.locator(".pageHeadActions [data-apps-export]").count()) === 1);
    }

    // ── Today (n) ──────────────────────────────────────────────────────────
    const fold = page.locator("[data-today]");
    const toggle = page.locator("[data-today-toggle]");
    check(`${w}: "Today" counts the two deadlines and the late follow-up`, (await fold.getAttribute("data-today-count")) === "3" && /^Today\s*3\s*(Show|Hide)$/.test(flat(await toggle.innerText())), flat(await toggle.innerText()));
    check(`${w}: it carries the warning, as an icon and a colour`, (await fold.getAttribute("data-tone")) === "red" && (await toggle.locator("svg").count()) === 1);
    if (phone) {
      check(`${w}: it is folded on a phone`, (await fold.getAttribute("data-today")) === "closed" && (await toggle.getAttribute("aria-expanded")) === "false" && !(await page.locator("[data-due-radar]").isVisible()) && !(await page.locator("[data-attention]").isVisible()));
      const hint = flat(await page.locator("[data-today-hint]").innerText());
      check(`${w}: folded, it names the soonest thing due`, /^Soonest: .* · due in [45]h · Made Up Sooner Test: Send the screening answers/.test(hint), hint);
      const firstRow = await box("[data-stage-row]");
      check(`${w}: the first application starts on the first screen`, !!firstRow && firstRow.y < viewport.height, String(Math.round(firstRow?.y ?? -1)));
      await page.screenshot({ path: path.join(SHOTS, `c27-top-folded-${w}.png`) });
      await toggle.tap();
      check(`${w}: a tap opens it`, (await toggle.getAttribute("aria-expanded")) === "true" && (await page.locator("[data-due-radar]").isVisible()) && (await page.locator("[data-attention]").isVisible()) && (await page.locator("[data-today-hint]").count()) === 0);
    } else {
      check(`${w}: it is open on a wide screen`, (await fold.getAttribute("data-today")) === "open" && (await toggle.getAttribute("aria-expanded")) === "true" && (await page.locator("[data-due-radar]").isVisible()) && (await page.locator("[data-attention]").isVisible()));
      await toggle.click();
      check(`${w}: it folds on a click, and says what is due soonest`, (await toggle.getAttribute("aria-expanded")) === "false" && !(await page.locator("[data-due-radar]").isVisible()) && /^Soonest: /.test(flat(await page.locator("[data-today-hint]").innerText())));
      await toggle.click();
    }
    const radarText = await page.locator("[data-due-radar]").innerText();
    const items = await page.locator("[data-due-item]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
    check(`${w}: inside: "Do these today", numbered, the soonest first`, /Do these today/.test(radarText) && items.length === 2 && items[0].startsWith("1.") && /Made Up Sooner Test/.test(items[0]) && items[1].startsWith("2."), items.join(" | "));

    // ── The wording ────────────────────────────────────────────────────────
    const due = page.locator('[data-attn="today"]');
    const dueText = flat(await due.innerText());
    check(`${w}: the follow-ups card reads "1 Follow-up overdue (due ${dayMonth(overdue)})"`, dueText === `1 Follow-up overdue (due ${dayMonth(overdue)})`, dueText);
    check(`${w}: and no longer splits "dated today" from overdue`, !/dated today/i.test(dueText) && (await due.locator(".attnDetail").count()) === 0);
    const fixText = flat(await page.locator('[data-attn="fix"]').innerText());
    check(`${w}: the fix card reads "${toFix} Applications missing a job description or CV"`, fixText === `${toFix} Applications missing a job description or CV`, fixText);
    await due.click();
    await page.waitForFunction(() => document.querySelectorAll("[data-stage-row]").length === 1);
    check(`${w}: the follow-ups card still filters to that application`, (await page.locator("[data-stage-row]").getAttribute("data-stage-row")) === "Made Up Late Follow Up");
    await due.click();
    await page.screenshot({ path: path.join(SHOTS, `c27-today-open-${w}.png`), fullPage: true });

    // Insights: the tile uses the tab's word and the tab's number.
    const insightsToggle = page.locator("[data-insights-toggle]");
    await insightsToggle.waitFor({ timeout: 20000 });
    if ((await insightsToggle.getAttribute("aria-expanded")) === "false") await insightsToggle.click();
    const tile = flat(await page.locator('[data-stat="open"]').innerText());
    const tabCount = flat(await page.locator('[data-stage-tab="closed"]').innerText());
    check(`${w}: the Insights tile says "${closedCount} rejected / closed", the tab's word and number`, tile.toLowerCase().includes(`${closedCount} rejected / closed (1 withdrawn, not counted) · `) && / progressed/.test(tile) && tabCount === `Rejected / closed ${closedCount}`, `${tile} | ${tabCount}`);
    const scored = flat(await page.locator('[data-stat="scored"]').innerText());
    check(`${w}: and no tile says "eligibility read" or "count in the rate only"`, !/eligibility read|count in the rate only/i.test(scored + tile), scored);

    // ── Log outcome: one click, one request, on a screened application ─────
    const puts = [];
    page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/applications/.test(r.url())) puts.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("[data-apps-outcome]").click();
    const panel = page.locator("[data-outcome-panel]");
    await panel.waitFor();
    const panelBox = await panel.boundingBox(), searchNow = await box("[data-apps-search]");
    check(`${w}: the panel opens right under the title`, !!panelBox && panelBox.y < viewport.height && (!phone || panelBox.y < searchNow.y), `${Math.round(panelBox?.y ?? -1)}`);
    if (phone) await page.screenshot({ path: path.join(SHOTS, `c27-log-outcome-open-${w}.png`), fullPage: true });

    for (const [company, was, note] of [[`Ardenmoor ${tag}`, "interview", /It reached interview\. Your click confirms the outcome and closes it\./], [`Marlowe Finch ${tag}`, "screening", /Already reported: .*Your click confirms it\./]]) {
      const id = idOf(company);
      await page.locator("[data-outcome-search]").fill(company);
      const item = page.locator(`[data-outcome-row="${id}"]`);
      await item.waitFor({ timeout: 15000 });
      check(`${w}: ${company} (${was}) says what the click will do`, note.test(flat(await item.innerText())), flat(await item.innerText()).slice(0, 140));
      puts.length = 0;
      await page.locator(`[data-outcome-mark="${id}"]`).click();
      await page.locator(`[data-outcome-done="${id}"]`).waitFor({ timeout: 15000 });
      const saved = await stored(id, "status,closed_at,close_reason,pending_outcome,notes");
      const pendingAnswered = !saved.pending_outcome || saved.pending_outcome.dismissed === true;
      check(`${w}: one click ends ${company}: Rejected, dated, nothing left to confirm`, saved.status === "rejected" && saved.closed_at?.slice(0, 10) === day(0) && saved.close_reason === "rejected" && pendingAnswered, JSON.stringify(saved).slice(0, 160));
      check(`${w}: in one request, with no second confirm`, puts.length === 1 && puts[0] === "PUT /api/applications" && (await page.locator('[role="dialog"]').count()) === 0, puts.join());
      check(`${w}: and the line is on top of its notes`, /^\d{1,2} \w{3} \d{4} \d{2}:\d{2} Outcome /.test(saved.notes ?? ""), (saved.notes ?? "").slice(0, 80));
    }
    await page.locator("[data-outcome-close]").click();
    check(`${w}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
} catch (err) {
  fail++;
  console.log("FAIL harness:", err?.message ?? err);
} finally {
  await browser?.close().catch(() => undefined);
  await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin }).catch(() => undefined);
  console.log(`\n${pass} passed, ${fail} failed (screenshots in ${SHOTS})`);
  process.exitCode = fail ? 1 : 0;
}
