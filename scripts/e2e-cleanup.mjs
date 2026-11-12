// The tracker clean-up end to end (Chunk 19), on THROWAWAY accounts with made-up rows:
// the route's guards (401 signed out, 403 for a non-owner, 400 for confirmed_by_user,
// 409 for a Screening id with nothing applied, a dry run that changes no row — every
// row's updated_at compared) and the panel in a browser (open, tick, confirm, the
// result, the database after). No model call.
//   npx next start -p 3100   (any build of this branch)
//   PLAYWRIGHT_PATH=<...>/playwright/index.mjs node scripts/e2e-cleanup.mjs   (SHOTS_DIR for screenshots)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE || "http://localhost:3100";
const SHOTS = process.env.SHOTS_DIR;
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const users = [];
const makeUser = async (owner) => {
  const email = `cleanup-${owner ? "owner" : "other"}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  users.push(u.id);
  if (owner) await fetch(`${SB}/rest/v1/profiles?id=eq.${u.id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ is_unlimited: true }) });
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  return { id: u.id, cookieValue, cookie: `sb-${REF}-auth-token=${cookieValue}` };
};
const post = async (user, body, raw) => {
  const res = await fetch(`${BASE}/api/applications/cleanup`, { method: "POST", headers: { cookie: user.cookie, "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const rowsOf = async (uid) => (await (await fetch(`${SB}/rest/v1/applications?user_id=eq.${uid}&select=id,company_name,role,status,followup_date,date_applied,notes,updated_at&order=company_name`, { headers: admin })).json());

let browser;
try {
  const owner = await makeUser(true);
  const other = await makeUser(false);
  const seed = (r) => ({ user_id: owner.id, role: "Software Engineer", status: "Applied", source: "manual", followup_date: null, notes: null, ...r });
  const seeded = await (await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=representation" }, body: JSON.stringify([
    seed({ company_name: "Made Up Cadence One", date_applied: day(-40), followup_date: day(-20), notes: "Sent via portal." }),
    seed({ company_name: "Made Up Cadence Two", date_applied: day(-50), followup_date: day(-10) }),
    seed({ company_name: "Made Up Recent", date_applied: day(-30), followup_date: day(-5) }),
    seed({ company_name: "Made Up Screened", status: "Screening", date_applied: day(-60), followup_date: day(-30) }),
    seed({ company_name: "Made Up Dup", role: "Backend Engineer (Data/Platform)", date_applied: day(-45), notes: "First log." }),
    seed({ company_name: "made up dup ", role: "Backend Engineer (Data / Platform)", status: "Withdrawn", date_applied: day(-20), notes: "Withdrew." }),
    seed({ company_name: "Made Up Draft", status: "Ready to submit", date_applied: day(-9) }),
    seed({ company_name: "Made Up Outreach", role: "Cold email: platform team", date_applied: day(-3) }),
  ]) })).json();
  const byName = Object.fromEntries(seeded.map((r) => [r.company_name.trim(), r]));
  check("seeded 8 rows", seeded.length === 8, String(seeded.length));

  // ── The route's guards ───────────────────────────────────────────────────
  check("a non-owner gets 403", (await post(other, { dryRun: true })).status === 403);
  check("signed out gets 401", (await fetch(`${BASE}/api/applications/cleanup`, { method: "POST", body: "{}" })).status === 401);
  const before = await rowsOf(owner.id);
  const dry = await post(owner, {});
  check("an empty body is a dry run", dry.status === 200 && dry.body.dryRun === true);
  const plan = dry.body.plan;
  check("Rule A lists the two old cadences only", JSON.stringify(plan.ruleA.map((a) => a.company_name).sort()) === JSON.stringify(["Made Up Cadence One", "Made Up Cadence Two"]), JSON.stringify(plan.ruleA.map((a) => a.company_name)));
  check("Rule B finds the pair across case, spacing and the slash", plan.ruleB.length === 1 && plan.ruleB[0].duplicates.length === 1 && plan.ruleB[0].duplicates[0].blocked === null);
  check("Rule C reports the stale draft and the generic role", plan.ruleC.readyToSubmit.length === 1 && plan.ruleC.genericRoles.length === 1);
  const after = await rowsOf(owner.id);
  check("the dry run changed nothing (every row's updated_at and notes)", JSON.stringify(before) === JSON.stringify(after));
  check("confirmed_by_user is refused", (await post(owner, { dryRun: false, ids: [byName["Made Up Cadence One"].id], confirmed_by_user: true })).status === 400);
  const guarded = await post(owner, { dryRun: false, ids: [byName["Made Up Cadence One"].id, byName["Made Up Screened"].id] });
  check("a Screening id makes it a 409, even listed explicitly", guarded.status === 409 && guarded.body.ids?.[0] === byName["Made Up Screened"].id, `${guarded.status} ${guarded.body.error ?? ""}`);
  check("…and nothing was applied", JSON.stringify(await rowsOf(owner.id)) === JSON.stringify(before));

  // ── The panel ────────────────────────────────────────────────────────────
  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "Europe/London" });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: owner.cookieValue, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/applications", { waitUntil: "networkidle" });
  await page.locator("[data-apps-cleanup]").click();
  await page.locator("[data-cleanup-rule='A'] [data-cleanup-item]").first().waitFor({ timeout: 20000 });
  check("the panel opens on the dry run", (await page.locator("[data-cleanup-rule='A'] [data-cleanup-item]").count()) === 2 && (await page.locator("[data-cleanup-rule='B'] [data-cleanup-item]").count()) === 1);
  if (SHOTS) await page.locator("[data-cleanup]").screenshot({ path: path.join(SHOTS, "cleanup-panel.png") });
  await page.locator(`[data-cleanup-item='${byName["Made Up Cadence One"].id}']`).check();
  const dupId = plan.ruleB[0].duplicates[0].id;
  await page.locator(`[data-cleanup-item='${dupId}']`).check();
  await page.locator("[data-cleanup-apply]").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const dialogText = await dialog.innerText();
  check("the confirm says what is irreversible", /cannot be restored/.test(dialogText) && /status stays Applied/.test(dialogText), dialogText.replace(/\s+/g, " ").slice(0, 200));
  if (SHOTS) await dialog.screenshot({ path: path.join(SHOTS, "cleanup-confirm.png") });
  await dialog.getByRole("button", { name: /Apply 2/ }).click();
  await page.locator("[data-cleanup-result]").waitFor({ timeout: 20000 });
  check("the panel reports what was applied", /Applied 2\./.test(await page.locator("[data-cleanup-result]").innerText()), await page.locator("[data-cleanup-result]").innerText());
  const end = await rowsOf(owner.id);
  const get = (name) => end.find((r) => r.company_name.trim().toLowerCase() === name.toLowerCase());
  check("Rule A: follow-up cleared, status still Applied, the note written", get("Made Up Cadence One")?.followup_date === null && get("Made Up Cadence One")?.status === "Applied" && /cadence closed/.test(get("Made Up Cadence One")?.notes ?? ""), JSON.stringify(get("Made Up Cadence One")));
  check("the unticked cadence is untouched", get("Made Up Cadence Two")?.followup_date === byName["Made Up Cadence Two"].followup_date);
  check("Rule B: one Made Up Dup row left, Withdrawn, both notes", end.filter((r) => r.company_name.trim().toLowerCase() === "made up dup").length === 1 && /withdrawn/i.test(get("Made Up Dup")?.status ?? "") && /Withdrew\.[\s\S]*First log\./.test(get("Made Up Dup")?.notes ?? ""), JSON.stringify(get("Made Up Dup")));
  check("the Screening row is untouched", JSON.stringify(get("Made Up Screened")) === JSON.stringify(before.find((r) => r.company_name === "Made Up Screened")));
  check("no page errors", errors.length === 0, errors.join(" | "));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "cleanup-after.png") });
} catch (e) {
  fail++;
  console.log("FAIL threw —", e?.message ?? e);
} finally {
  await browser?.close();
  for (const id of users) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway users removed`);
}
