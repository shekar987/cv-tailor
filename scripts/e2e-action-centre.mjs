// The Action Centre in a real browser (Edge), on the real API and database, with a
// throwaway account and made-up rows, removed at the end. No model call.
//
//   npm run build && npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-action-centre.mjs
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
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "action-centre-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

const email = `action-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;
  const api = async (p, method, body) => (await fetch(BASE + p, { method, headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

  const row = async (company_name, status) => (await api("/api/applications", "POST", { company_name, role: "Software Engineer", status, date_applied: "2026-10-20" })).id;
  const screening = await row("Made Up Screening Ltd", "Screening");
  const applied = await row("Made Up Applied Ltd", "Applied");
  await api("/api/events", "POST", { application_id: screening, kind: "deadline", title: "Green task", due_at: hours(200) });
  await api("/api/events", "POST", { application_id: screening, kind: "assessment", title: "Red task", due_at: hours(10) });
  await api("/api/events", "POST", { application_id: applied, kind: "assessment", title: "Amber task", due_at: hours(48) });

  browser = await chromium.launch({ channel: "msedge" });
  const open = async (viewport, url = "/app/actions") => {
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London" });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + url, { waitUntil: "load" });
    return { page, errors };
  };

  const anon = await (await browser.newContext()).newPage();
  await anon.goto(BASE + "/app/actions", { waitUntil: "load" });
  check("signed out, it goes to sign-in and comes back", anon.url().includes("/auth/login") && decodeURIComponent(anon.url()).includes("next=/app/actions"), anon.url());

  const { page, errors } = await open({ width: 1280, height: 1000 });
  await page.locator("[data-action-list]").waitFor({ timeout: 30000 });
  check("Actions is first in the nav", (await page.locator("#appBarNav a").first().innerText()).trim() === "Actions");
  check("and marked as the current page", (await page.locator("#appBarNav a").first().getAttribute("aria-current")) === "page");
  const order = await page.locator("[data-action-title]").evaluateAll((els) => els.map((e) => e.getAttribute("data-action-title")));
  check("deadline order", order.join(",") === "Red task,Amber task,Green task", order.join(","));
  const states = await page.locator("[data-action-urgency]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-action-urgency")}:${e.textContent.trim()}`));
  check("red, amber and green, each with its words", states.join("|") === "red:Under 24 hours|amber:Under 3 days|green:More than 3 days", states.join("|"));
  check("every card has a countdown", (await page.locator("[data-action-countdown]").count()) === 3);
  check("an event on an Applied row is here", order.includes("Amber task"));
  check("snooze is off inside 24 hours", await page.locator('[data-action-title="Red task"] [data-action-snooze]').isDisabled());
  await page.screenshot({ path: path.join(SHOTS, "actions-desktop.png"), fullPage: true });

  // Quick add: paste, read, edit, save.
  await page.locator("[data-quick-add-open]").click();
  await page.locator("[data-quick-add-text]").fill("Hello. Please complete your online assessment at https://example.com/test by Sunday, 8 November 2026 at 23:59 GMT. Good luck.");
  const read = await page.locator("[data-quick-add-read]").innerText();
  check("the date is read as you paste", /8 Nov/.test(read) && /23:59/.test(read), read);
  await page.screenshot({ path: path.join(SHOTS, "quick-add.png"), fullPage: true });
  await page.locator("[data-quick-add-next]").click();
  await page.locator("[data-event-form]").waitFor();
  check("the form opens with the date to edit", (await page.locator("#evDate").inputValue()) === "2026-11-08" && (await page.locator("#evTime").inputValue()) === "23:59");
  check("and the link", (await page.locator("#evLink").inputValue()) === "https://example.com/test");
  await page.locator("[data-event-search]").fill("Made Up Screening");
  await page.locator(".planPickerItem").first().click();
  await page.locator("#evTitle").fill("Pasted test");
  await page.locator("#evTime").fill("22:00");
  await page.locator("[data-event-save]").click();
  await page.locator('[data-action-title="Pasted test"]').waitFor({ timeout: 15000 });
  const pasted = await page.locator('[data-action-title="Pasted test"]').innerText();
  check("it is saved with the edited time", /22:00/.test(pasted), pasted.slice(0, 160));
  check("with a countdown", (await page.locator('[data-action-title="Pasted test"] [data-action-countdown]').innerText()).length > 0);
  check("and Open link", (await page.locator('[data-action-title="Pasted test"] [data-action-open]').getAttribute("href")) === "https://example.com/test");

  // Mark done: gone, and undo brings it back.
  await page.locator('[data-action-title="Pasted test"] [data-action-done]').click();
  await page.locator('[data-action-title="Pasted test"]').waitFor({ state: "detached", timeout: 8000 });
  check("mark done and it disappears", (await page.locator('[data-action-title="Pasted test"]').count()) === 0);
  await page.locator("[data-toast-undo]").click();
  await page.locator('[data-action-title="Pasted test"]').waitFor({ timeout: 8000 });
  check("undo brings it back", true);
  await page.reload({ waitUntil: "load" });
  await page.locator('[data-action-title="Pasted test"]').waitFor({ timeout: 15000 });
  check("and it survives a reload", true);

  // A pasted confirmation offers to close, not to add.
  await page.locator("[data-quick-add-open]").click();
  await page.locator("[data-quick-add-text]").fill("Your response has been recorded.");
  await page.locator("[data-quick-add-confirmation]").waitFor();
  check("a pasted confirmation reads as one", true);
  await page.locator("[data-quick-add-open]").click();

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));

  // The tracker shows the next event per row. An open test puts the row under Assessment.
  const sheet = await open({ width: 1280, height: 1000 }, "/applications?status=assessment");
  await sheet.page.locator('[data-stage-row="Made Up Screening Ltd"] [data-stage-next]', { hasText: "Red task" }).waitFor({ timeout: 30000 }).catch(() => {});
  const next = await sheet.page.locator('[data-stage-row="Made Up Screening Ltd"] [data-stage-next]').innerText();
  check("the tracker shows the row's next event", /Red task/.test(next), next);
  await sheet.page.screenshot({ path: path.join(SHOTS, "screening-tab.png") });

  // Phone.
  const phone = await open({ width: 390, height: 844 });
  await phone.page.locator("[data-action-list]").waitFor({ timeout: 30000 });
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll on a phone", overflow <= 0, `${overflow}px`);
  await phone.page.screenshot({ path: path.join(SHOTS, "actions-phone.png"), fullPage: true });
  console.log(`Screens in ${SHOTS}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log("throwaway user removed:", del.ok);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
