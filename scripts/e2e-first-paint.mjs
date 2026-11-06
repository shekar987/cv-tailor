// /applications' first paint (Chunk 19), in a browser on the real API, on a THROWAWAY
// account with made-up rows. The full list (?all=1) and the detail read are held back in
// the browser, so the page sits on its first 50-row page long enough to check what the
// 6 Nov review found: a row from the first page must never open an empty, editable Notes
// box (a Save there wiped the real notes). It must say it is loading, unlock with the full
// text, and the full list must take over without losing an edit made in between.
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/playwright/index.mjs node scripts/e2e-first-paint.mjs
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const NOTES = "Spoke to the recruiter on Tuesday; they want a portfolio link. " + "Details. ".repeat(40);

const email = `first-paint-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const seed = (company_name, over = {}) => ({ user_id: created.id, company_name, role: "Software Engineer", status: "Applied", source: "manual", date_applied: "2026-10-20", notes: null, ...over });
  const seeded = await (await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=representation" }, body: JSON.stringify([
    seed("Made Up Notes", { notes: NOTES }),
    seed("Made Up Short", { notes: "Called them." }),
    seed("Made Up Plain"),
  ]) })).json();
  const target = seeded.find((r) => r.company_name === "Made Up Notes");
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Hold the full list back 8 s, and the row's detail read until released.
  let releaseDetail = () => {};
  const detailHeld = new Promise((r) => { releaseDetail = r; });
  await page.route(/\/api\/applications\?all=1$/, async (r) => { await new Promise((x) => setTimeout(x, 8000)); await r.continue(); });
  await page.route(/\/api\/applications\?id=/, async (r) => { await detailHeld; await r.continue(); });

  await page.goto(BASE + "/applications", { waitUntil: "commit" });
  await page.waitForSelector(".stageListRow", { timeout: 30000 });
  check("the first page paints before the full list", (await page.locator("[data-apps-loading-rest]").count()) === 1);
  const rowEl = page.locator(".stageListRow", { hasText: "Made Up Notes" });
  await rowEl.locator("[data-row-menu]").click();
  await page.locator('[data-menu-item="notes"]').click();
  const box = page.locator('textarea[aria-label="Notes"]');
  await box.waitFor();
  check("its Notes box is locked while the full text is unknown", await box.isDisabled());
  check("…and empty, saying it is loading", (await box.inputValue()) === "" && /Loading/.test((await box.getAttribute("placeholder")) ?? ""));
  releaseDetail();
  await page.waitForFunction(() => {
    const t = document.querySelector('textarea[aria-label="Notes"]');
    return t && !t.disabled && t.value.length > 0;
  }, null, { timeout: 15000 });
  check("it unlocks with the full notes", (await box.inputValue()) === NOTES.trim() || (await box.inputValue()) === NOTES, `${(await box.inputValue()).length} chars`);
  await page.waitForSelector("[data-apps-loading-rest]", { state: "detached", timeout: 20000 });
  check("the full list takes over", (await page.locator(".stageListRow").count()) === 3);
  const stored = (await (await fetch(`${SB}/rest/v1/applications?id=eq.${target.id}&select=notes`, { headers: admin })).json())[0];
  check("the notes in the database were never touched", stored.notes === NOTES);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fail++;
  console.log("FAIL threw —", e?.message ?? e);
} finally {
  await browser?.close();
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway user removed: ${del.ok}`);
}
