// Chunk 26's "Log outcome" on /applications in a real browser (Edge) on the real routes and
// database, with a throwaway account removed at the end. No model call.
//
// Pasting a rejection email finds the right application and one click ends it (a screened
// one too, and one a sweep had already reported), dated, with one line added on top of its
// notes and nothing replaced; Undo takes the close and the line back; an application that is
// already rejected is shown and not changed; an email that does not say is the user's to
// judge; the search box is the other way in. Also the new labels: the "Rejected / closed"
// tab, "Do these today" (numbered, soonest first) and the fix card. At 1280 and 390.
//
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node scripts/e2e-log-outcome.mjs
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "chunk26-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const DAY = 86_400_000;
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const day = (n) => londonDay(Date.now() + n * DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const fixture = (name) => fs.readFileSync(`tests/fixtures/outcome-emails/${name}.txt`, "utf8");
const stored = async (id, columns) => (await (await fetch(`${SB}/rest/v1/applications?id=eq.${id}&select=${columns}`, { headers: admin })).json())[0];

const email = `chunk26-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const row = (company_name, role, status, extra = {}) => ({
    user_id: created.id, company_name, role, status, date_applied: day(-14), followup_date: null, source: "manual", notes: null, pending_outcome: null, next_deadline: null, deadline_note: null, ...extra,
  });
  // Every company is made up. Two sets, one per screen width, since each run ends its rows.
  const seedFor = (tag) => [
    row(`Harbourline ${tag}`, "Junior Software Engineer", "applied", { notes: "Referred by Sam\nApplied on the company site" }),
    row(`Quillstone ${tag}`, "Graduate Software Engineer", "applied", { date_applied: day(-7) }),
    row(`Quillstone ${tag}`, "Data Engineer", "rejected", { date_applied: day(-90) }),
    row(`Ardenmoor ${tag}`, "Technology Consulting Graduate Programme", "interview", { notes: "Interview on 5 Nov" }),
    row(`Marlowe Finch ${tag}`, "Analyst Developer", "screening", { pending_outcome: { outcome: "rejected", date: day(-1), source: "gmail" } }),
    row(`Tidewell ${tag}`, "Backend Developer", "applied"),
    row(`Penrose & Hale ${tag}`, "Technology Graduate", "applied"),
  ];
  const shared = [
    row("Made Up Follow Up A", "Software Engineer", "applied", { followup_date: day(0) }),
    row("Made Up Follow Up B", "Software Engineer", "applied", { followup_date: day(-2) }),
    row("Made Up Later Test", "Software Engineer", "applied", { next_deadline: new Date(Date.now() + 30 * 3_600_000).toISOString(), deadline_note: "Complete the coding test" }),
    row("Made Up Sooner Test", "Software Engineer", "applied", { next_deadline: new Date(Date.now() + 5 * 3_600_000).toISOString(), deadline_note: "Send the screening answers" }),
  ];
  const seeded = await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=representation" }, body: JSON.stringify([...seedFor("D"), ...seedFor("M"), ...shared]) });
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.status} ${await seeded.text()}`);
  const all = await seeded.json();
  const idOf = (company, role) => all.find((r) => r.company_name === company && (!role || r.role === role))?.id;

  browser = await chromium.launch({ channel: "msedge" });
  for (const [tag, viewport] of [["D", { width: 1280, height: 1000 }], ["M", { width: 390, height: 844 }]]) {
    const w = viewport.width;
    // Each fixture names a made-up company; this run's rows carry the tag after the name.
    const mail = (name, company) => fixture(name).replaceAll(company, `${company} ${tag}`);
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London", ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    await page.locator("[data-apps-outcome]").waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector(".attnPending"), null, { timeout: 30000 });

    // ── The labels ─────────────────────────────────────────────────────────
    const closedTab = page.locator('[data-stage-tab="closed"]');
    check(`${w}: the tab that holds rejections says so, with its count`, /^Rejected \/ closed\s+\d+$/.test((await closedTab.innerText()).replace(/\s+/g, " ").trim()), await closedTab.innerText());
    const radar = page.locator("[data-due-radar]");
    await radar.waitFor({ timeout: 20000 });
    const radarText = await radar.innerText();
    check(`${w}: the red strip is titled "Do these today"`, /Do these today/.test(radarText) && /Due in the next 48 hours/.test(radarText), radarText.slice(0, 80));
    const items = await radar.locator("[data-due-item]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
    check(`${w}: its items are numbered, the soonest first`, items.length >= 2 && items[0].startsWith("1.") && /Made Up Sooner Test/.test(items[0]) && items[1].startsWith("2."), items.slice(0, 2).join(" | "));
    check(`${w}: it is an ordered list`, (await radar.locator("ol > li").count()) === items.length);
    const fix = (await page.locator('[data-attn="fix"] .attnLabel').innerText()).trim();
    check(`${w}: the fix card says what is wrong in plain words`, fix === "Applications with no job description or CV", fix);
    const outcomeBtn = page.locator("[data-apps-outcome]");
    check(`${w}: "Log outcome" sits beside "+ Add application", outlined`, (await outcomeBtn.innerText()).trim() === "Log outcome" && /secondary/.test(await outcomeBtn.getAttribute("class")) && (await page.locator("[data-apps-add]").count()) > 0);
    const a = await outcomeBtn.boundingBox(), b = await page.locator("[data-apps-add]").first().boundingBox();
    check(`${w}: both buttons are on screen`, !!a && !!b && a.x >= 0 && a.x + a.width <= w + 1 && b.x + b.width <= w + 1, `${Math.round(a?.x ?? -1)}+${Math.round(a?.width ?? 0)}`);

    // ── Paste, one click ───────────────────────────────────────────────────
    await outcomeBtn.click();
    const panel = page.locator("[data-outcome-panel]");
    await panel.waitFor();
    check(`${w}: the panel opens with the email box focused`, await page.evaluate(() => document.activeElement?.id === "outcome-email"));
    await page.screenshot({ path: path.join(SHOTS, `outcome-1-open-${w}.png`) });

    const harbour = idOf(`Harbourline ${tag}`);
    const t0 = Date.now();
    await page.locator("[data-outcome-text]").fill(mail("direct", "Harbourline"));
    await page.locator("[data-outcome-matches]").waitFor();
    check(`${w}: the email reads as a rejection, quoting the words that say so`, (await page.locator("[data-outcome-read]").getAttribute("data-outcome-read")) === "rejected" && /won't be taking it forward/.test(await page.locator("[data-outcome-read]").innerText()));
    const firstRow = page.locator("[data-outcome-row]").first();
    check(`${w}: the right application is first`, (await firstRow.getAttribute("data-outcome-row")) === harbour, await firstRow.innerText());
    const mark = page.locator(`[data-outcome-mark="${harbour}"]`);
    check(`${w}: its button says what it does, and is the filled one`, (await mark.innerText()).trim() === "Mark as rejected" && !/secondary/.test(await mark.getAttribute("class")));
    const noteLine = await page.locator("[data-outcome-note]").innerText();
    check(`${w}: the line for the notes is shown before the click`, noteLine.includes(`Outcome email ${shortDate(day(0))}: We had a lot of strong applicants`) && /other notes stay/.test(noteLine), noteLine.slice(0, 140));
    await page.screenshot({ path: path.join(SHOTS, `outcome-2-matched-${w}.png`) });
    await mark.click();
    await page.locator("[data-outcome-done]").waitFor({ timeout: 15000 });
    const seconds = (Date.now() - t0) / 1000;
    check(`${w}: focus moves to what was saved`, await page.evaluate(() => document.activeElement?.hasAttribute("data-outcome-done") ?? false));
    check(`${w}: pasted and saved with one click, in under 10 seconds`, seconds < 10, `${seconds.toFixed(1)}s`);
    const saved = await stored(harbour, "status, closed_at, close_reason, notes");
    check(`${w}: the application is Rejected, dated today`, saved.status === "rejected" && saved.closed_at?.slice(0, 10) === day(0) && saved.close_reason === "rejected", JSON.stringify(saved).slice(0, 120));
    const lines = saved.notes.split("\n");
    check(`${w}: the line is on top of its notes`, /Outcome email .*won't be taking it forward this time\.$/.test(lines[0]), lines[0]);
    check(`${w}: and the notes it had are unchanged`, lines.slice(1).join("\n") === "Referred by Sam\nApplied on the company site", JSON.stringify(lines.slice(1)));
    const doneText = await page.locator("[data-outcome-done]").innerText();
    check(`${w}: the panel says what was saved`, new RegExp(`Saved\\. Harbourline ${tag}`).test(doneText) && /is now Rejected/.test(doneText) && /other notes are unchanged/.test(doneText), doneText.slice(0, 160));
    const next = page.locator("[data-outcome-next]");
    check(`${w}: and gives one next step`, (await next.getAttribute("data-outcome-next")) === "due" && /2 things are due in the next 48 hours\./.test(await next.innerText()), await next.innerText());
    await page.screenshot({ path: path.join(SHOTS, `outcome-3-saved-${w}.png`) });

    // ── Undo; and a row already rejected is shown, not changed ─────────────
    const quillNew = idOf(`Quillstone ${tag}`, "Graduate Software Engineer"), quillOld = idOf(`Quillstone ${tag}`, "Data Engineer");
    await page.locator("[data-outcome-text]").fill(mail("ashby", "Quillstone"));
    await page.locator(`[data-outcome-row="${quillOld}"]`).waitFor();
    const order = await page.locator("[data-outcome-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-outcome-row")));
    check(`${w}: two applications at one company: the open one first`, JSON.stringify(order) === JSON.stringify([quillNew, quillOld]), order.join());
    check(`${w}: the one already rejected is shown with no button`, (await page.locator(`[data-outcome-mark="${quillOld}"]`).count()) === 0 && /Already rejected.*Nothing to change\./.test(await page.locator(`[data-outcome-row="${quillOld}"]`).innerText()));
    check(`${w}: the date comes from the email's own Date line`, (await page.locator("[data-outcome-date]").inputValue()) === "2026-11-12");
    await page.locator(`[data-outcome-mark="${quillNew}"]`).click();
    await page.locator(`[data-outcome-done="${quillNew}"]`).waitFor({ timeout: 15000 });
    check(`${w}: it is saved with the email's date`, (await stored(quillNew, "status, closed_at")).closed_at?.slice(0, 10) === "2026-11-12");
    const oldAfter = await stored(quillOld, "status, notes, closed_at");
    check(`${w}: the rejected one was not touched`, oldAfter.status === "rejected" && oldAfter.notes === null && oldAfter.closed_at === null);
    await page.locator("[data-toast-undo]").click();
    await page.locator('[data-outcome-done="undone"]').waitFor({ timeout: 15000 });
    const undone = await stored(quillNew, "status, closed_at, notes");
    check(`${w}: Undo puts it back, and takes the line out of its notes`, undone.status === "applied" && undone.closed_at === null && undone.notes === null, JSON.stringify(undone));
    check(`${w}: the panel says it was undone`, /That was undone/.test(await page.locator("[data-outcome-done]").innerText()));

    // ── A screened application, and one a sweep had reported ───────────────
    const arden = idOf(`Ardenmoor ${tag}`);
    await page.locator("[data-outcome-text]").fill(mail("corporate", "Ardenmoor"));
    await page.locator(`[data-outcome-row="${arden}"]`).waitFor();
    check(`${w}: an Interview application says the click closes it`, /It reached interview\. Your click confirms the outcome and closes it\./.test(await page.locator(`[data-outcome-row="${arden}"]`).innerText()));
    await page.locator(`[data-outcome-mark="${arden}"]`).click();
    await page.locator(`[data-outcome-done="${arden}"]`).waitFor({ timeout: 15000 });
    const ardenRow = await stored(arden, "status, stages_reached, notes, closed_at");
    check(`${w}: the same single click ends a screened application`, ardenRow.status === "rejected" && ardenRow.closed_at?.slice(0, 10) === "2026-11-13" && ardenRow.stages_reached.includes("interview"), JSON.stringify(ardenRow).slice(0, 160));
    check(`${w}: its note is added above the one it had`, /Outcome email 13 Nov 2026: We regret to inform you/.test(ardenRow.notes.split("\n")[0]) && ardenRow.notes.split("\n")[1] === "Interview on 5 Nov");

    const marlowe = idOf(`Marlowe Finch ${tag}`);
    await page.locator("[data-outcome-text]").fill(mail("aiapply", "Marlowe Finch"));
    await page.locator(`[data-outcome-row="${marlowe}"]`).waitFor();
    check(`${w}: an outcome a sweep reported is named, and the click confirms it`, /Already reported: .*Your click confirms it\./.test(await page.locator(`[data-outcome-row="${marlowe}"]`).innerText()), await page.locator(`[data-outcome-row="${marlowe}"]`).innerText());
    await page.locator(`[data-outcome-mark="${marlowe}"]`).click();
    await page.locator(`[data-outcome-done="${marlowe}"]`).waitFor({ timeout: 15000 });
    const marloweRow = await stored(marlowe, "status, pending_outcome");
    check(`${w}: it is Rejected and the report is answered`, marloweRow.status === "rejected" && marloweRow.pending_outcome?.dismissed === true, JSON.stringify(marloweRow));

    // ── An email that does not say; and the search box ─────────────────────
    const tidewell = idOf(`Tidewell ${tag}`);
    await page.locator("[data-outcome-text]").fill(`Hi Alex,\n\nThanks for applying for Backend Developer at Tidewell ${tag}. We have received your application and will be in touch.`);
    await page.locator(`[data-outcome-row="${tidewell}"]`).waitFor();
    check(`${w}: an email with no outcome says so`, (await page.locator("[data-outcome-read]").getAttribute("data-outcome-read")) === "unknown" && /could not tell the outcome/.test(await page.locator("[data-outcome-read]").innerText()));
    const held = page.locator(`[data-outcome-mark="${tidewell}"]`);
    check(`${w}: and nothing can be clicked until the user chooses`, (await held.isDisabled()) && (await held.innerText()).trim() === "Choose the outcome first");
    check(`${w}: nothing was written`, (await stored(tidewell, "status")).status === "applied");
    await page.locator("[data-outcome-text]").fill("Hi Alex,\n\nWe would like to invite you to a first interview for the Backend Developer role. Please book a slot.");
    check(`${w}: an invitation is not read as a rejection`, (await page.locator("[data-outcome-read]").getAttribute("data-outcome-read")) === "invitation");
    // The wording that ended a live application in the first version's review: an acknowledgement.
    await page.locator("[data-outcome-text]").fill(`Hi Alex,\n\nYour application for Backend Developer at Tidewell ${tag} has been received. If you have not heard from us within 14 days, please assume that you have been unsuccessful on this occasion.\n\nThe Tidewell ${tag} Team`);
    await page.locator(`[data-outcome-row="${tidewell}"]`).waitFor();
    check(`${w}: "if you have not heard… assume you have been unsuccessful" is not a rejection`, (await page.locator("[data-outcome-read]").getAttribute("data-outcome-read")) === "unknown" && (await page.locator(`[data-outcome-mark="${tidewell}"]`).isDisabled()));
    // An email that names the company once is listed, but its button is not the filled one.
    await page.locator("[data-outcome-text]").fill(`Hi Alex,\n\nThank you for applying to Tidewell ${tag}. Unfortunately we will not be progressing your application.\n\nBest,\nSam`);
    await page.locator(`[data-outcome-row="${tidewell}"]`).waitFor();
    check(`${w}: one sign of the company is listed but not filled`, /secondary/.test(await page.locator(`[data-outcome-mark="${tidewell}"]`).getAttribute("class")) && /Check the company and role before you click/.test(await page.locator("#outcome-list-title").innerText()));

    await page.locator("[data-outcome-text]").fill("");
    await page.locator("[data-outcome-search]").fill(`penrose ${tag.toLowerCase()}`);
    const penrose = idOf(`Penrose & Hale ${tag}`);
    await page.locator(`[data-outcome-row="${penrose}"]`).waitFor();
    // ("d" is also a letter of "Graduate", so the other width's row may be listed too.)
    const results = await page.locator("[data-outcome-row]").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    check(`${w}: the search box finds the application, and only that company`, results.length >= 1 && results.every((t) => t.includes("Penrose & Hale")), results.join(" | ").slice(0, 120));
    await page.locator("[data-outcome-reason]").selectOption("ghosted");
    check(`${w}: another outcome can be chosen`, (await page.locator(`[data-outcome-mark="${penrose}"]`).innerText()).trim() === "Mark as no reply");
    await page.locator("[data-outcome-words]").fill("Chased twice, no answer");
    await page.locator(`[data-outcome-mark="${penrose}"]`).click();
    await page.locator(`[data-outcome-done="${penrose}"]`).waitFor({ timeout: 15000 });
    const penroseRow = await stored(penrose, "status, notes, close_reason");
    check(`${w}: it is saved as No reply with the user's own note`, penroseRow.status === "ghosted" && penroseRow.close_reason === "ghosted" && penroseRow.notes.endsWith(`Outcome ${shortDate(day(0))}: No reply. Chased twice, no answer`), JSON.stringify(penroseRow));

    // ── Layout ─────────────────────────────────────────────────────────────
    await page.locator("[data-outcome-text]").fill(mail("teamtailor", "Tidewell"));
    await page.locator(`[data-outcome-row="${tidewell}"]`).waitFor();
    const box = await panel.boundingBox();
    check(`${w}: the panel sits inside the page`, !!box && box.x >= 0 && box.x + box.width <= w + 1, `${Math.round(box?.x ?? -1)}+${Math.round(box?.width ?? 0)}`);
    check(`${w}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const small = await panel.locator("button, input, select, textarea, a.cta").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 36).map((e) => `${e.tagName} ${e.textContent?.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}`));
    check(`${w}: every control in the panel is at least 36px tall`, small.length === 0, small.join(" | "));
    await page.screenshot({ path: path.join(SHOTS, `outcome-4-teamtailor-${w}.png`), fullPage: false });
    await panel.screenshot({ path: path.join(SHOTS, `outcome-panel-${w}.png`) });

    // ── The next step's button, and the tab's count ────────────────────────
    await page.locator(`[data-outcome-mark="${tidewell}"]`).click();
    await page.locator(`[data-outcome-done="${tidewell}"]`).waitFor({ timeout: 15000 });
    await page.locator("[data-outcome-next-action]").click();
    await page.waitForFunction(() => !document.querySelector("[data-outcome-panel]"));
    const shown = await page.locator("[data-stage-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-row")).sort());
    check(`${w}: "Show them" closes the panel and lists what is due`, JSON.stringify(shown) === JSON.stringify(["Made Up Later Test", "Made Up Sooner Test"]), shown.join());
    await page.locator("[data-apps-outcome]").click();
    await page.locator("[data-outcome-close]").click();
    check(`${w}: Close gives the focus back to the button`, await page.evaluate(() => document.activeElement?.hasAttribute("data-apps-outcome") ?? false));
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
