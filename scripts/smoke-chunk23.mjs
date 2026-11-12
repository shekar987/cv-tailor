// Chunk 23 (12 Nov 2026) on the real routes and database: A) the 409 that names append_note
// first; B) POST /api/applications/jd-from-url on live public postings (Greenhouse, Lever,
// Ashby, SmartRecruiters, Gem, Teamtailor — each found through its board's public list, so a
// closed posting never breaks the run), saved to a row, the jd_exists guard, the SSRF guard;
// C) POST /api/applications/bulk moving 15 rows in one request, every old line kept, a
// replay and a repeat writing nothing, the closing rule per row; D) "Follow-ups due today"
// from /counts and the lite list's due_by agreeing. Two throwaway users, removed at the end;
// made-up companies; no model call. Reading the boards costs nothing.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-chunk23.mjs             (reads .env.local; SMOKE_BASE to point elsewhere)
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const json = (body) => JSON.stringify(body);

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const DAY = 86_400_000;
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const TODAY = londonDay(Date.now());
const day = (n) => londonDay(Date.now() + n * DAY);
const STAMPED = /^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} /;

const users = [];
async function newUser(tag) {
  const email = `chunk23-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
  users.push(created.id);
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const call = async (path, method = "GET", body, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: json(body) } : {}) });
    const text = await res.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return { id: created.id, call };
}
async function seed(rows) {
  const keys = ["user_id", "company_name", "role", "status", "date_applied", "followup_date", "source", "notes", "job_description", "pending_outcome"];
  const res = await fetch(`${SB}/rest/v1/applications?select=id,company_name`, { method: "POST", headers: { ...admin, Prefer: "return=representation" }, body: json(rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])))) });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  return Object.fromEntries((await res.json()).map((r) => [r.company_name, r.id]));
}

// A live public posting on each board, found through the board's own public list.
async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
const DISCOVER = {
  Greenhouse: async () => `https://job-boards.greenhouse.io/monzo/jobs/${(await getJson("https://boards-api.greenhouse.io/v1/boards/monzo/jobs")).jobs[0].id}`,
  Lever: async () => (await getJson("https://api.lever.co/v0/postings/spotify?mode=json&limit=1"))[0].hostedUrl,
  Ashby: async () => (await getJson("https://api.ashbyhq.com/posting-api/job-board/linear")).jobs[0].jobUrl,
  SmartRecruiters: async () => `https://jobs.smartrecruiters.com/BoschGroup/${(await getJson("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=1")).content[0].id}`,
  Gem: async () => (await getJson("https://api.gem.com/job_board/v0/nominal/job_posts/"))[0].absolute_url,
  Teamtailor: async () => {
    const html = await (await fetch("https://career.teamtailor.com/jobs", { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    return /href="(https:\/\/career\.teamtailor\.com\/jobs\/\d+[^"]*)"/.exec(html)[1];
  },
};

try {
  const a = await newUser("a");
  const b = await newUser("b");
  const detail = async (id) => (await a.call(`/api/applications?id=${id}`)).body.application;

  // ── Seed: the follow-up block of 12 Nov in miniature ─────────────────────────
  const OLD = Array.from({ length: 40 }, (_, i) => `0${(i % 9) + 1} Nov 2026 09:${String(i).padStart(2, "0")} Line ${i + 1}: chased the recruiter, "no news" — O'Brien`).join("\n");
  const rows = [];
  for (let i = 1; i <= 15; i++) rows.push({ user_id: a.id, company_name: `Smoke Bulk ${String(i).padStart(2, "0")}`, role: "Software Engineer", status: i % 2 ? "Applied" : "applied", date_applied: day(-10), followup_date: day(-3), source: "manual", notes: OLD });
  rows.push(
    { user_id: a.id, company_name: "Smoke Today", role: "Engineer", status: "applied", date_applied: day(-7), followup_date: TODAY, source: "manual" },
    { user_id: a.id, company_name: "Smoke Screened", role: "Engineer", status: "screening", date_applied: day(-20), followup_date: day(-2), source: "manual" },
    { user_id: a.id, company_name: "Smoke Pending", role: "Engineer", status: "screening", date_applied: day(-20), followup_date: day(-2), source: "manual", pending_outcome: { outcome: "rejected", date: TODAY, source: "gmail" } },
    { user_id: a.id, company_name: "Smoke Unsent", role: "Engineer", status: "saved", date_applied: null, followup_date: day(-3), source: "manual" },
    { user_id: a.id, company_name: "Smoke Rejected", role: "Engineer", status: "rejected", date_applied: day(-30), followup_date: day(-3), source: "manual" },
    { user_id: a.id, company_name: "Smoke Tomorrow", role: "Engineer", status: "applied", date_applied: day(-6), followup_date: day(1), source: "manual" },
    { user_id: a.id, company_name: "Smoke End 1", role: "Engineer", status: "applied", date_applied: day(-40), followup_date: day(-5), source: "manual", notes: "Applied on the board." },
    { user_id: a.id, company_name: "Smoke End 2", role: "Engineer", status: "applied", date_applied: day(-40), followup_date: day(-5), source: "manual" },
    { user_id: a.id, company_name: "Smoke JD Empty", role: "Engineer", status: "applied", date_applied: day(-1), source: "manual" },
    { user_id: a.id, company_name: "Smoke JD Summary", role: "Engineer", status: "applied", date_applied: day(-1), source: "manual", job_description: "Hand summary: Python, AWS, 2+ years." },
  );
  const ids = await seed(rows);
  const theirs = await seed([{ user_id: b.id, company_name: "Smoke Theirs", role: "Engineer", status: "applied", date_applied: day(-5), followup_date: day(-1), source: "manual" }]);
  const bulkIds = Array.from({ length: 15 }, (_, i) => ids[`Smoke Bulk ${String(i + 1).padStart(2, "0")}`]);

  // ── D: "Follow-ups due today", the counter and the sweep's list agree ────────
  const dueNames = [...Array.from({ length: 15 }, (_, i) => `Smoke Bulk ${String(i + 1).padStart(2, "0")}`), "Smoke Today", "Smoke Screened", "Smoke End 1", "Smoke End 2"];
  const counts = await a.call(`/api/applications/counts?today=${TODAY}`);
  check("D: /counts says due today: today or earlier, sent, live, no ending waiting", counts.status === 200 && counts.body.followups_due_today?.total === dueNames.length && counts.body.followups_due_today?.today === 1, JSON.stringify(counts.body.followups_due_today));
  const due = await a.call(`/api/applications?lite=1&due_by=${TODAY}&limit=2000`);
  const dueGot = (due.body.applications ?? []).map((r) => r.company_name).sort();
  check("D: the lite list's due_by returns exactly those rows (no Ready to submit, no Rejected, no pending rejection, not tomorrow's)", due.status === 200 && json(dueGot) === json([...dueNames].sort()), `${dueGot.length} rows`);

  // ── A: a notes write without a version names append_note first ──────────────
  const noVersion = await a.call("/api/applications", "PUT", { id: ids["Smoke Today"], notes: "Follow-up sent\nold notes" });
  check("A: a notes write without if_updated_at is 409 stale_notes, and nothing lands", noVersion.status === 409 && noVersion.body.error === "stale_notes" && !(await detail(ids["Smoke Today"])).notes);
  check("A: the message names append_note first, with an example", /^To add a line, send append_note instead of notes: PUT \/api\/applications \{"id": "<id>", "append_note": "Follow-up sent"\}/.test(noVersion.body.message ?? "") && noVersion.body.hint?.use === "append_note", (noVersion.body.message ?? "").slice(0, 80));
  const stale = await a.call("/api/applications", "PUT", { id: ids["Smoke Today"], notes: "x", if_updated_at: "2026-01-01T00:00:00Z" });
  check("A: a stale version says the same, append_note first", stale.status === 409 && /^To add a line, send append_note/.test(stale.body.message ?? ""));

  // ── C: fifteen rows in one request ───────────────────────────────────────────
  const key = crypto.randomUUID();
  const body = { ids: bulkIds, followup_date: day(7), append_line: "Follow-up sent" };
  const t0 = performance.now();
  const moved = await a.call("/api/applications/bulk", "POST", body, { "Idempotency-Key": key });
  const ms = performance.now() - t0;
  check("C: bulk moves 15 rows in one request", moved.status === 200 && moved.body.updated === 15 && moved.body.failed === 0 && moved.body.ok === true, `${moved.status} ${moved.body.updated}/15 in ${ms.toFixed(0)} ms`);
  check("C: every row answers ok with its new version", (moved.body.results ?? []).length === 15 && moved.body.results.every((r) => r.ok && r.status === 200 && typeof r.updated_at === "string" && !("notes" in r)));
  const after = await Promise.all(bulkIds.map(detail));
  check("C: each row has the new follow-up date", after.every((r) => r.followup_date === day(7)));
  check("C: each row has one stamped 'Follow-up sent' on top and every old line kept, in order", after.every((r) => { const [top, ...rest] = r.notes.split("\n"); return STAMPED.test(top) && top.endsWith(" Follow-up sent") && rest.join("\n") === OLD; }));
  const replay = await a.call("/api/applications/bulk", "POST", body, { "Idempotency-Key": key });
  check("C: the same request with the same key is replayed, not run", replay.status === 200 && replay.headers.get("idempotent-replayed") === "true" && replay.body.updated === 15);
  const again = await a.call("/api/applications/bulk", "POST", body, { "Idempotency-Key": crypto.randomUUID() });
  const afterAgain = await Promise.all(bulkIds.map(detail));
  check("C: run again within ten minutes, the line is a repeat: skipped on every row", again.status === 200 && again.body.results.every((r) => r.ok && r.skipped === "duplicate_note"));
  check("C: and still one 'Follow-up sent' on each row", afterAgain.every((r) => r.notes.split("\n").filter((l) => l.endsWith(" Follow-up sent")).length === 1));

  const ending = await a.call("/api/applications/bulk", "POST", { ids: [ids["Smoke Screened"], ids["Smoke Pending"], Object.values(theirs)[0], "00000000-0000-4000-8000-000000000000"], status: "Rejected" }, { "Idempotency-Key": crypto.randomUUID() });
  const byId = Object.fromEntries((ending.body.results ?? []).map((r) => [r.id, r]));
  check("C: a screened row is never ended in bulk: 409, with where to record it instead", byId[ids["Smoke Screened"]]?.status === 409 && byId[ids["Smoke Screened"]]?.errorType === "needs_confirmation" && /pending-outcome/.test(byId[ids["Smoke Screened"]]?.pendingOutcomeUrl ?? ""));
  check("C: another user's row and a missing one are 404, and nothing else stops", byId[Object.values(theirs)[0]]?.status === 404 && byId["00000000-0000-4000-8000-000000000000"]?.status === 404 && ending.body.updated === 0 && ending.body.ok === false);
  check("C: the screened row is untouched", (await detail(ids["Smoke Screened"])).status === "Screening");
  const theirsAfter = await fetch(`${SB}/rest/v1/applications?id=eq.${Object.values(theirs)[0]}&select=status,notes`, { headers: admin }).then((r) => r.json());
  check("C: the other user's row is untouched", theirsAfter[0]?.status === "applied" && !theirsAfter[0]?.notes);

  const ghosted = await a.call("/api/applications/bulk", "POST", { ids: [ids["Smoke End 1"], ids["Smoke End 2"]], status: "Ghosted" }, { "Idempotency-Key": crypto.randomUUID() });
  const end1 = await detail(ids["Smoke End 1"]);
  check("C: ending applied rows in bulk clears their follow-up and says so in the notes", ghosted.body.updated === 2 && ghosted.body.results.every((r) => r.followupCleared === true) && end1.status === "Ghosted" && end1.followup_date === null && /cleared when marked/.test(end1.notes) && end1.notes.includes("Applied on the board."));
  for (const [label, bad, re] of [
    ["an unknown field", { ids: bulkIds.slice(0, 1), followup: day(3) }, /Unknown field "followup"/],
    ["a notes write", { ids: bulkIds.slice(0, 1), notes: "x" }, /append_line/],
    ["101 ids", { ids: Array.from({ length: 101 }, () => crypto.randomUUID()), append_line: "x" }, /At most 100/],
    ["a bad date", { ids: bulkIds.slice(0, 1), followup_date: "next week" }, /followup_date must be a date/],
  ]) {
    const r = await a.call("/api/applications/bulk", "POST", bad);
    check(`C: ${label} is a 400 before any row`, r.status === 400 && re.test(r.body.error ?? ""), r.body.error);
  }
  const countsAfter = await a.call(`/api/applications/counts?today=${TODAY}`);
  check("D: after the move, due today is the two rows left (today's and the screened one)", countsAfter.body.followups_due_today?.total === 2, json(countsAfter.body.followups_due_today));

  // ── B: job links read server side ────────────────────────────────────────────
  const texts = {};
  for (const [board, find] of Object.entries(DISCOVER)) {
    let url;
    try { url = await find(); } catch (e) { check(`B: ${board}: a live posting to read`, false, e.message); continue; }
    const r = await a.call("/api/applications/jd-from-url", "POST", { url });
    texts[board] = r.body;
    check(`B: ${board}: the posting in full, over 1,000 characters, from the board`, r.status === 200 && r.body.ok && r.body.saved === false && r.body.chars > 1000 && r.body.via === "board" && r.body.description.length === r.body.chars, `${r.status} ${r.body.chars ?? r.body.error} chars · ${url}`);
  }
  const plain = await a.call("/api/applications/jd-from-url", "POST", { url: "https://example.com/" });
  check("B: a page with no posting is no_description, never a guess", plain.status === 422 && plain.body.errorType === "no_description", plain.body.error);
  for (const local of ["http://127.0.0.1:3100/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd"]) {
    const r = await a.call("/api/applications/jd-from-url", "POST", { url: local });
    check(`B: ${local} is never fetched`, (r.status === 422 || r.status === 400) && !r.body.ok, `${r.status} ${r.body.errorType}`);
  }

  const gemUrl = await DISCOVER.Gem();
  const jdKey = crypto.randomUUID();
  const saved = await a.call("/api/applications/jd-from-url", "POST", { id: ids["Smoke JD Empty"], url: gemUrl }, { "Idempotency-Key": jdKey });
  const savedRow = await detail(ids["Smoke JD Empty"]);
  check("B: with an id, the text is saved on the row, and the answer leaves the text out", saved.status === 200 && saved.body.saved === true && typeof saved.body.updated_at === "string" && !("description" in saved.body) && savedRow.job_description?.length === saved.body.chars && saved.body.chars > 1000, `${saved.status} ${saved.body.chars ?? saved.body.error}`);
  check("B: saving runs the row's JD triage, as any JD edit", saved.body.gates !== undefined || !!savedRow.tailored_cv?.gates?.triage);
  const savedReplay = await a.call("/api/applications/jd-from-url", "POST", { id: ids["Smoke JD Empty"], url: gemUrl }, { "Idempotency-Key": jdKey });
  check("B: replayed with its key", savedReplay.headers.get("idempotent-replayed") === "true" && savedReplay.body.saved === true);
  const same = await a.call("/api/applications/jd-from-url", "POST", { id: ids["Smoke JD Empty"], url: gemUrl });
  check("B: the same text again changes nothing", same.status === 200 && same.body.unchanged === true && same.body.saved === false);
  const exists = await a.call("/api/applications/jd-from-url", "POST", { id: ids["Smoke JD Summary"], url: gemUrl });
  check("B: a row with a different JD keeps it unless replace: true (409 jd_exists)", exists.status === 409 && exists.body.errorType === "jd_exists" && exists.body.existing_chars === 36 && (await detail(ids["Smoke JD Summary"])).job_description === "Hand summary: Python, AWS, 2+ years.", exists.body.message);
  const replaced = await a.call("/api/applications/jd-from-url", "POST", { id: ids["Smoke JD Summary"], url: gemUrl, replace: true });
  check("B: replace: true replaces the hand summary with the posting", replaced.status === 200 && replaced.body.saved === true && replaced.body.replaced_chars === 36 && (await detail(ids["Smoke JD Summary"])).job_description.length === replaced.body.chars);
  const notMine = await a.call("/api/applications/jd-from-url", "POST", { id: Object.values(theirs)[0], url: gemUrl });
  check("B: another user's row is 404 and is never written", notMine.status === 404);
  const badField = await a.call("/api/applications/jd-from-url", "POST", { url: gemUrl, job_id: "x" });
  check("B: an unknown field is a 400", badField.status === 400);
} catch (err) {
  fail++;
  console.log("FAIL harness:", err?.message ?? err);
} finally {
  for (const id of users) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin }).catch(() => undefined);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
