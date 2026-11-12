// Chunk 23's "Follow-ups due today" card on /applications in a real browser (Edge) on the
// real database, with a throwaway account removed at the end: the number is the rows due
// today or earlier (sent, live, no ending waiting), the line under it splits today from
// overdue, a click filters the list to exactly those rows, and at 1280 and 390 nothing is
// clipped or scrolls sideways. No model call.
//
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node scripts/e2e-chunk23.mjs
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "chunk23-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const DAY = 86_400_000;
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const day = (n) => londonDay(Date.now() + n * DAY);

const email = `chunk23-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const row = (company_name, status, followup_date, extra = {}) => ({ user_id: created.id, company_name, role: "Software Engineer", status, date_applied: status === "saved" ? null : day(-14), followup_date, source: "manual", pending_outcome: null, ...extra });
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(`Made Up Overdue ${i + 1}`, "applied", day(-3))),
    row("Made Up Today A", "applied", day(0)),
    row("Made Up Today B", "screening", day(0)),
    row("Made Up Rejection Waiting", "screening", day(-2), { pending_outcome: { outcome: "rejected", date: day(0), source: "gmail" } }),
    row("Made Up Not Sent", "saved", day(-3)),
    row("Made Up Ended", "rejected", day(-3)),
    row("Made Up Next Week", "applied", day(7)),
  ];
  const seeded = await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.status} ${await seeded.text()}`);
  const DUE = ["Made Up Overdue 1", "Made Up Overdue 2", "Made Up Overdue 3", "Made Up Overdue 4", "Made Up Overdue 5", "Made Up Overdue 6", "Made Up Today A", "Made Up Today B"];

  browser = await chromium.launch({ channel: "msedge" });
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London" });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    const card = page.locator('[data-attn="today"]');
    await card.waitFor({ timeout: 20000 });
    // The full list in: the data-to-fix card shows a number, not the placeholder.
    await page.waitForFunction(() => !document.querySelector(".attnPending"), null, { timeout: 20000 });
    const number = (await card.locator(".attnNumber").innerText()).trim();
    check(`${w}: the card counts the rows due today or earlier`, number === String(DUE.length), `${number}`);
    check(`${w}: and splits today from overdue`, (await card.locator(".attnDetail").innerText()).trim() === "2 dated today · 6 overdue");
    check(`${w}: its label says what it is`, (await card.locator(".attnLabel").innerText()).trim() === "Follow-ups due today");
    await card.click();
    await page.waitForFunction(() => document.querySelector('[data-attn="today"]')?.getAttribute("aria-pressed") === "true");
    const shown = (await page.locator("[data-stage-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-row")))).sort();
    check(`${w}: a click filters the list to exactly those rows`, JSON.stringify(shown) === JSON.stringify([...DUE].sort()), `${shown.length} shown`);
    const box = await card.boundingBox();
    check(`${w}: the card sits inside the page`, !!box && box.x >= 0 && box.x + box.width <= w + 1);
    check(`${w}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check(`${w}: no page errors`, errors.length === 0, errors.join(" | "));
    await page.locator("[data-attention]").screenshot({ path: path.join(SHOTS, `due-today-strip-${w}.png`) });
    await page.screenshot({ path: path.join(SHOTS, `due-today-${w}.png`) });
    await card.click();
    await page.waitForFunction(() => document.querySelector('[data-attn="today"]')?.getAttribute("aria-pressed") === "false");
    const afterClear = await page.locator("[data-stage-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-row")));
    check(`${w}: a second click clears the filter (the tab's own rows again)`, JSON.stringify([...afterClear].sort()) !== JSON.stringify([...DUE].sort()), `${afterClear.length} shown`);
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
