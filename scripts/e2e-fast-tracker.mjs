// Chunk 22 in a real browser (Edge) on the real database, with a throwaway account removed at
// the end (and every file it stored): an application logged in ONE call to
// /api/applications/log with a PDF shows that CV under "CV you sent", carries the
// "Logged by Claude sweep" badge, and offers the cover letter line; a row made on the page
// carries no badge; a phone shows it all without sideways scroll. No model call.
//
//   npx next start -p 3100
//   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs node --disable-warning=ExperimentalWarning scripts/e2e-fast-tracker.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
if (!process.env.PLAYWRIGHT_PATH) throw new Error("Set PLAYWRIGHT_PATH to a playwright index.mjs (it is not a dependency of this project).");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "fast-tracker-shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const doc = new jsPDF();
["Alex Tester", "alex.tester@example.com", "Software Engineer at Northwind Apps", "Built REST APIs in Python for 40,000 users."].forEach((l, i) => doc.text(l, 20, 20 + i * 8));
const CV_PDF = new Uint8Array(doc.output("arraybuffer"));

const email = `fast-tracker-e2e-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
let browser;
// Set when the 1280 pass stores the letter (after the migration); the 390 pass then opens the same row.
let letterStored = false;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;

  // The sweep's one call: the row, its JD, a note and the CV it sent.
  const fd = new FormData();
  for (const [k, v] of Object.entries({ company_name: "Made Up Sage", role: "Graduate Engineer", date_applied: "2026-11-11", job_description: "Graduate Engineer at Made Up Sage. Python and PostgreSQL.", append_note: "Applied on the careers site", logged_by: "Claude sweep" })) fd.append(k, v);
  fd.append("cv", new Blob([CV_PDF], { type: "application/pdf" }), "Alex Tester CV.pdf");
  const logged = await (await fetch(`${BASE}/api/applications/log`, { method: "POST", headers: { cookie }, body: fd })).json();
  check("one call logs the row with its CV", typeof logged.id === "string" && logged.sentCv?.fileName === "Alex Tester CV.pdf", JSON.stringify(logged).slice(0, 120));
  // A row made on the page says it was the user's own.
  await fetch(`${BASE}/api/applications`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ company_name: "Made Up Mine", role: "Software Engineer", date_applied: "2026-11-10", source: "manual", logged_by: "you" }) });

  browser = await chromium.launch({ channel: "msedge" });
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport, timezoneId: "Europe/London" });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: cookieValue, url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/applications`, { waitUntil: "load" });
    await page.locator('[data-stage-tab="applied"]').click();
    const row = page.locator('[data-stage-row="Made Up Sage"]');
    await row.waitFor({ timeout: 20000 });
    const badge = row.locator("[data-logged-by]");
    await badge.waitFor({ timeout: 15000 });
    const w = viewport.width;
    check(`${w}: the logged row says who logged it`, (await badge.innerText()).trim() === "Logged by Claude sweep" && (await badge.getAttribute("data-logged-by")) === "Claude sweep");
    check(`${w}: a row made on the page carries no badge`, (await page.locator('[data-stage-row="Made Up Mine"] [data-logged-by]').count()) === 0);
    await row.locator("[data-row-menu]").click();
    await row.locator('[data-menu-item="cv"]').click();
    const name = page.locator("[data-sent-cv-name]");
    await name.waitFor({ timeout: 15000 });
    check(`${w}: the panel shows the CV you sent`, (await name.innerText()).trim() === "Alex Tester CV.pdf" && /CV you sent/i.test(await page.locator(".appsPanelTitle").first().innerText()));
    const textOk = await page.locator("[data-sent-cv-text]").evaluate((el) => /REST APIs/.test(el.textContent ?? "")).catch(() => false);
    check(`${w}: with the text read from it`, textOk);
    if (letterStored) check(`${w}: and the cover letter stored at 1280`, (await page.locator("[data-sent-letter-name]").innerText().catch(() => "")).trim() === "Cover letter.txt");
    else check(`${w}: and a line for the cover letter sent with it`, (await page.locator('[data-sent-letter="none"]').count()) === 1 && (await page.locator("[data-sent-letter-upload]").count()) === 1);
    check(`${w}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check(`${w}: no page errors`, errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: path.join(SHOTS, `fast-tracker-${w}.png`) });
    if (w === 1280) {
      // The letter through the page: stored, or the migration named.
      await page.locator("[data-sent-letter-input]").setInputFiles({ name: "Cover letter.txt", mimeType: "text/plain", buffer: Buffer.from("Dear Hiring Team,\n\nI am applying for the Graduate Engineer role.\n\nKind regards,\nAlex Tester\n") });
      await page.waitForFunction(() => document.querySelector("[data-sent-letter-name]") || document.querySelector(".sentCv .uploadError"), null, { timeout: 15000 });
      const stored = await page.locator("[data-sent-letter-name]").count();
      letterStored = stored > 0;
      if (stored) check("1280: the cover letter uploads beside the CV", (await page.locator("[data-sent-letter-name]").innerText()).trim() === "Cover letter.txt");
      else check("1280: before the migration the letter upload names it", /20261112120000/.test(await page.locator(".sentCv .uploadError").innerText()));
      await page.screenshot({ path: path.join(SHOTS, "fast-tracker-letter.png") });
    }
    await ctx.close();
  }
} catch (err) {
  fail++;
  console.log("FAIL harness:", err?.message ?? err);
} finally {
  await browser?.close().catch(() => undefined);
  // Every file the account stored, then the account (its rows go with it).
  const list = async (prefix) => (await (await fetch(`${SB}/storage/v1/object/list/application-cvs`, { method: "POST", headers: admin, body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) })).json()) ?? [];
  const files = [];
  for (const folder of await list(`${created.id}/`).catch(() => [])) for (const f of await list(`${created.id}/${folder.name}/`)) if (f.id) files.push(`${created.id}/${folder.name}/${f.name}`);
  if (files.length) await fetch(`${SB}/storage/v1/object/application-cvs`, { method: "DELETE", headers: admin, body: JSON.stringify({ prefixes: files }) }).catch(() => undefined);
  await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin }).catch(() => undefined);
  console.log(`\n${pass} passed, ${fail} failed (screenshots in ${SHOTS})`);
  process.exitCode = fail ? 1 : 0;
}
