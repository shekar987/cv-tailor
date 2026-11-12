// Chunk 22 (12 Nov 2026) on the real routes and database: the lite list (filters, the
// escaping of q, speed on ~1,190 rows), Idempotency-Key, the duplicate-line rule, Ready to
// submit rows without a date, one-call logging with real files, and "Logged by". Two
// throwaway users, removed at the end with every file they stored; made-up companies;
// no model call. Whatever needs migration 20261112120000 says SKIP until it is applied,
// and checks the 503 / fallback instead.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-fast-tracker.mjs      (reads .env.local; SMOKE_BASE to override)
import fs from "node:fs";
import { jsPDF } from "jspdf";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const json = (body) => JSON.stringify(body);
const SEED_ROWS = Number(process.env.SEED_ROWS || 1190);

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const skipped = (name) => { skip++; console.log(`SKIP ${name} (migration 20261112120000 not applied)`); };
const londonDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function pdfBytes(lines) {
  const doc = new jsPDF();
  lines.forEach((l, i) => doc.text(l, 20, 20 + i * 8));
  return new Uint8Array(doc.output("arraybuffer"));
}
const CV_PDF = pdfBytes(["Alex Tester", "alex.tester@example.com", "Software Engineer at Northwind Apps", "Built REST APIs in Python and PostgreSQL for 40,000 users.", "Wrote tests with pytest; shipped weekly."]);
const LETTER_TXT = new TextEncoder().encode("Dear Hiring Team,\n\nI am applying for the Graduate Engineer role at Smoke Sage Ltd. I built REST APIs in Python.\n\nKind regards,\nAlex Tester\n");

const users = [];
async function newUser(tag) {
  const email = `fast-tracker-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
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
  const form = async (path, fields, files = {}, headers = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.bytes], { type: f.type }), f.name);
    const res = await fetch(BASE + path, { method: "POST", headers: { cookie, ...headers }, body: fd });
    return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
  };
  const raw = (path) => fetch(BASE + path, { headers: { cookie } });
  return { id: created.id, call, form, raw };
}

// Every object under a user's folder, through the Storage admin API (two levels: <user>/<application>/<file>).
async function storedFiles(userId) {
  const list = async (prefix) => (await (await fetch(`${SB}/storage/v1/object/list/application-cvs`, { method: "POST", headers: admin, body: json({ prefix, limit: 1000, offset: 0 }) })).json()) ?? [];
  const out = [];
  for (const folder of await list(`${userId}/`)) {
    for (const f of await list(`${userId}/${folder.name}/`)) if (f.id) out.push(`${userId}/${folder.name}/${f.name}`);
  }
  return out;
}

try {
  const a = await newUser("a");
  const b = await newUser("b");
  const detail = async (id) => (await a.call(`/api/applications?id=${id}`)).body.application;

  // A tracker the size of the owner's: made-up companies, notes and JDs of realistic length.
  // Stored keys (lib/tracker STATUSES); the API answers them in its own spelling.
  const statuses = ["applied", "applied", "applied", "rejected", "saved", "screening", "withdrawn", "ghosted", "interview"];
  const seed = [];
  for (let i = 0; i < SEED_ROWS; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + (i % 310) * 86_400_000).toISOString().slice(0, 10);
    seed.push({
      user_id: a.id, company_name: i % 97 === 0 ? `Elwood Technologies ${i}` : `Smoke Co ${i}`, role: i % 5 === 0 ? "Data Engineer" : "Software Engineer",
      status: statuses[i % statuses.length], date_applied: day, followup_date: i % 7 === 0 ? day : null, source: "manual",
      notes: `Applied via the board. ${"Note text. ".repeat(30)}`, job_description: `About the role. ${"Requirements and duties. ".repeat(40)}`,
    });
  }
  for (let i = 0; i < seed.length; i += 500) {
    const res = await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=minimal" }, body: json(seed.slice(i, i + 500)) });
    if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  }
  const elwoodSeeded = seed.filter((r) => r.company_name.startsWith("Elwood")).length;

  // ── Step 1: the lite list ────────────────────────────────────────────────────
  const lite = await a.call("/api/applications?lite=1");
  const first = lite.body.applications ?? [];
  check("lite: the newest 200 by default, and says there is more", lite.status === 200 && first.length === 200 && lite.body.more === true, `${first.length} rows`);
  check("lite: seven fields a row, no notes, no version", first.every((r) => Object.keys(r).sort().join() === "company_name,date_applied,followup_date,id,role,status,updated_at_minute" && /:00Z$/.test(r.updated_at_minute)));
  const elwood = await a.call("/api/applications?lite=1&q=elwood");
  check("lite: q finds the company, any case", elwood.status === 200 && elwood.body.applications.length === elwoodSeeded && elwood.body.applications.every((r) => /^Elwood/.test(r.company_name)), `${elwood.body.applications?.length} of ${elwoodSeeded}`);
  check("lite: q searches the role too", (await a.call("/api/applications?lite=1&q=data%20eng&limit=2000")).body.applications.length === seed.filter((r) => r.role === "Data Engineer").length);
  const since = await a.call("/api/applications?lite=1&since=2026-10-01&limit=2000");
  check("lite: since keeps the dates on or after it", since.body.applications.length === seed.filter((r) => r.date_applied >= "2026-10-01").length && since.body.applications.every((r) => r.date_applied >= "2026-10-01"));
  const st = await a.call("/api/applications?lite=1&status=Screening,interview&limit=2000");
  check("lite: status is a comma list in either spelling", st.body.applications.length === seed.filter((r) => ["screening", "interview"].includes(r.status)).length && st.body.applications.every((r) => ["Screening", "Interview"].includes(r.status)));
  const due = await a.call("/api/applications?lite=1&due_by=2026-06-30&limit=2000");
  const dueExpected = seed.filter((r) => r.followup_date && r.followup_date <= "2026-06-30" && !["rejected", "withdrawn", "ghosted"].includes(r.status)).length;
  check("lite: due_by leaves Rejected, Withdrawn and Ghosted out", due.body.applications.length === dueExpected && due.body.applications.every((r) => !["Rejected", "Withdrawn", "Ghosted"].includes(r.status)), `${due.body.applications.length} vs ${dueExpected}`);
  const all = await a.call("/api/applications?lite=1&limit=5000");
  check("lite: limit is capped at 2000 and reads past PostgREST's 1000", all.body.applications.length === SEED_ROWS && all.body.more === false, `${all.body.applications.length}`);
  check("lite: a small limit says more", (await a.call("/api/applications?lite=1&limit=5")).body.more === true);
  for (const bad of ["since=2026-13-01", "status=Hired", "limit=0", "due_by=soon"]) check(`lite: ${bad} is a 400`, (await a.call(`/api/applications?lite=1&${bad}`)).status === 400);
  check("lite: another user sees none of it", ((await b.call("/api/applications?lite=1&limit=2000")).body.applications ?? []).length === 0);

  // q is text, never filter syntax: names with PostgREST's and LIKE's special characters.
  const odd = ["Smith, Jones & Co (UK)", 'Quote "Labs"', "50%_Off Ltd", "Back\\slash Ltd", "5000 Off Ltd", "50XOff Ltd"];
  for (const company_name of odd) await a.call("/api/applications", "POST", { company_name, role: "Engineer", date_applied: "2026-11-01" });
  for (const [q, want] of [["Smith, Jones & Co (UK)", ["Smith, Jones & Co (UK)"]], ['Quote "Labs"', ['Quote "Labs"']], ["50%_Off", ["50%_Off Ltd"]], ["Back\\slash", ["Back\\slash Ltd"]], ["(UK)", ["Smith, Jones & Co (UK)"]]]) {
    const got = (await a.call(`/api/applications?lite=1&q=${encodeURIComponent(q)}`)).body.applications?.map((r) => r.company_name);
    check(`lite: q ${JSON.stringify(q)} is literal`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  }

  // Speed: the reason for the lite list. Warm the route, then five of each.
  for (let i = 0; i < 2; i++) await a.call("/api/applications?lite=1&q=elwood");
  const time = async (path) => { const t = performance.now(); await a.call(path); return performance.now() - t; };
  const liteMs = [], fullMs = [];
  for (let i = 0; i < 5; i++) { liteMs.push(await time("/api/applications?lite=1&q=elwood")); fullMs.push(await time("/api/applications")); }
  console.log(`  lite q=elwood median ${median(liteMs).toFixed(0)} ms; full list median ${median(fullMs).toFixed(0)} ms (${SEED_ROWS} rows)`);
  check("lite: q=elwood answers in under 300 ms", median(liteMs) < 300, `${median(liteMs).toFixed(0)} ms`);
  const full = await a.call("/api/applications");
  check("the full list is unchanged for the page and the sweeps", full.status === 200 && full.body.applications.length === SEED_ROWS + odd.length && full.body.applications.some((r) => typeof r.notes_preview === "string"));

  // ── Step 2: writes that run once ─────────────────────────────────────────────
  const nid = (await a.call("/api/applications", "POST", { company_name: "Smoke Twice Ltd", role: "Engineer", date_applied: "2026-11-04", notes: "Applied 4 Nov." })).body.id;
  const once = await a.call("/api/applications", "PATCH", { id: nid, append_note: "T+7 follow-up sent" });
  const again = await a.call("/api/applications", "PATCH", { id: nid, append_note: "  T+7   follow-up sent " });
  const lines = (await detail(nid)).notes.split("\n").filter((l) => l.endsWith("T+7 follow-up sent"));
  check("the same append twice: skipped the second time, on the row once", once.status === 200 && !once.body.skipped && again.status === 200 && again.body.skipped === "duplicate_note" && lines.length === 1, JSON.stringify(again.body).slice(0, 100));
  check("the skip answers the notes and their version from one read", typeof again.body.updated_at === "string" && again.body.notes === (await detail(nid)).notes);
  const viaPut = await a.call("/api/applications", "PUT", { id: nid, status: "Screening", append_note: "T+7 follow-up sent" });
  const afterPut = await detail(nid);
  check("PUT: the status lands, the repeated line does not", viaPut.status === 200 && viaPut.body.skipped === "duplicate_note" && afterPut.status === "Screening" && afterPut.notes.split("\n").filter((l) => l.endsWith("T+7 follow-up sent")).length === 1);
  check("a different line still lands", !(await a.call("/api/applications", "PATCH", { id: nid, append_note: "Screening call booked" })).body.skipped);

  check("Idempotency-Key: a malformed key is a 400", (await a.call("/api/applications", "POST", { company_name: "Smoke Key Ltd", role: "Engineer", date_applied: "2026-11-05" }, { "Idempotency-Key": "has spaces" })).status === 400);
  const key = crypto.randomUUID();
  const k1 = await a.call("/api/applications", "POST", { company_name: "Smoke Key Ltd", role: "Engineer", date_applied: "2026-11-05" }, { "Idempotency-Key": key });
  const k2 = await a.call("/api/applications", "POST", { role: "Engineer", company_name: "Smoke Key Ltd", date_applied: "2026-11-05" }, { "Idempotency-Key": key });
  const keyRows = (await a.call("/api/applications?lite=1&q=smoke%20key")).body.applications;
  if (k1.body.idempotencyWarning) {
    check("Idempotency-Key without the table: the write runs and says the key was not kept", k1.status === 200 && /20261112120000/.test(k1.body.idempotencyWarning));
    skipped("Idempotency-Key replay");
  } else {
    check("Idempotency-Key: the second POST replays the first answer", k1.status === 200 && k2.status === 200 && k2.body.id === k1.body.id && k2.headers.get("idempotent-replayed") === "true");
    check("Idempotency-Key: one row, not two", keyRows.length === 1, `${keyRows.length}`);
    const reused = await a.call("/api/applications", "POST", { company_name: "Smoke Other Ltd", role: "Engineer", date_applied: "2026-11-05" }, { "Idempotency-Key": key });
    check("Idempotency-Key: the key on other work is a 422, nothing written", reused.status === 422 && reused.body.error === "idempotency_key_reused" && (await a.call("/api/applications?lite=1&q=smoke%20other")).body.applications.length === 0);
    const pkey = crypto.randomUUID();
    const p1 = await a.call("/api/applications", "PUT", { id: nid, append_note: "Recruiter replied" }, { "Idempotency-Key": pkey });
    const p2 = await a.call("/api/applications", "PUT", { id: nid, append_note: "Recruiter replied" }, { "Idempotency-Key": pkey });
    check("Idempotency-Key: a PUT replays, the line is on the row once", p1.status === 200 && p2.headers.get("idempotent-replayed") === "true" && (await detail(nid)).notes.split("\n").filter((l) => l.endsWith("Recruiter replied")).length === 1);
    check("Idempotency-Key: keys are per user", (await b.call("/api/applications", "POST", { company_name: "Smoke B Ltd", role: "Engineer", date_applied: "2026-11-05" }, { "Idempotency-Key": key })).status === 200);
  }

  // ── Step 3: Ready to submit without a date ───────────────────────────────────
  check("a sent row still needs its date", (await a.call("/api/applications", "POST", { company_name: "Smoke Undated Ltd", role: "Engineer", status: "Applied" })).status === 400);
  const parked = await a.call("/api/applications", "POST", { company_name: "Smoke Sage Parked", role: "Graduate Engineer", status: "Ready to submit", logged_by: "Claude sweep" });
  if (parked.status === 503) {
    check("an undated Ready to submit row names the migration", parked.body.errorType === "needs_migration" && /20261112120000/.test(parked.body.error));
    skipped("Ready to submit without a date");
  } else {
    check("a Ready to submit row is saved with no date", parked.status === 200 && (await detail(parked.body.id)).date_applied === null);
    const fullParked = (await a.call("/api/applications")).body.applications.find((r) => r.id === parked.body.id);
    check("the full list keeps the key, as null", fullParked && "date_applied" in fullParked && fullParked.date_applied === null);
    const unsent = (await a.call("/api/applications", "POST", { company_name: "Smoke Role Closed", role: "Engineer", status: "Ready to submit" })).body.id;
    const closed = await a.call("/api/applications", "PUT", { id: unsent, status: "Withdrawn" });
    check("a parked row withdrawn before it was sent gets no made-up date", closed.status === 200 && !closed.body.date_applied && (await detail(unsent)).date_applied === null);
    check("a set date can't be cleared on a sent row", (await a.call("/api/applications", "PUT", { id: nid, date_applied: null })).body.error?.includes("can't be cleared"));
    const liteParked = (await a.call("/api/applications?lite=1&q=smoke%20sage%20parked")).body.applications[0];
    check("lite shows it undated, Ready to submit", liteParked?.date_applied === null && liteParked?.status === "Ready to submit");
    const moved = await a.call("/api/applications", "PUT", { id: parked.body.id, status: "Applied" });
    check("moving it to Applied dates it today", moved.status === 200 && moved.body.date_applied === londonDay(Date.now()) && (await detail(parked.body.id)).date_applied === londonDay(Date.now()), JSON.stringify(moved.body).slice(0, 120));
    check("a sent row's date can't be cleared", (await a.call("/api/applications", "PUT", { id: parked.body.id, date_applied: null })).status === 400);
    // The page's paging across undated rows: every to-submit row once, none lost.
    for (let i = 0; i < 7; i++) await a.call("/api/applications", "POST", { company_name: `Smoke Undated ${i}`, role: "Engineer", status: "Ready to submit" });
    const seen = [];
    let cursor = null;
    for (let n = 0; n < 50; n++) {
      const page = await a.call(`/api/applications?stage=to_submit&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...page.body.applications.map((r) => r.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    const toSubmit = (await a.call("/api/applications?lite=1&status=Ready%20to%20submit&limit=2000")).body.applications.map((r) => r.id);
    check("paging walks undated and dated to-submit rows, each once", seen.length === toSubmit.length && new Set(seen).size === seen.length && toSubmit.every((id) => seen.includes(id)), `${seen.length} paged, ${toSubmit.length} rows`);
  }

  // ── Step 4: one-call logging ─────────────────────────────────────────────────
  const cvFile = { bytes: CV_PDF, type: "application/pdf", name: "Alex Tester CV.pdf" };
  const letterFile = { bytes: LETTER_TXT, type: "text/plain", name: "Cover letter.txt" };
  const logged = await a.form("/api/applications/log", { company_name: "Smoke Sage Ltd", role: "Graduate Engineer", date_applied: "2026-11-11", job_description: "Graduate Engineer at Smoke Sage. Python and PostgreSQL.", append_note: "Applied on the careers site", logged_by: "Claude sweep" }, { cv: cvFile });
  check("log: one call makes the row with its CV", logged.status === 200 && typeof logged.body.id === "string" && logged.body.sentCv?.fileName === "Alex Tester CV.pdf" && logged.body.sentCoverLetter === null, JSON.stringify(logged.body).slice(0, 160));
  const row = await detail(logged.body.id);
  check("log: the row holds the JD, the stamped note, the CV and its text", row.job_description?.startsWith("Graduate Engineer") && /^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} Applied on the careers site$/.test(row.notes) && row.sent_cv?.fileName === "Alex Tester CV.pdf" && /REST APIs/.test(row.sent_cv?.text ?? ""));
  const download = await a.raw(`/api/applications/cv?id=${logged.body.id}`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  check("log: the stored CV downloads byte for byte", download.status === 200 && bytes.length === CV_PDF.length && bytes.every((v, i) => v === CV_PDF[i]));
  const listRow = (await a.call("/api/applications")).body.applications.find((r) => r.id === logged.body.id);
  check("log: the list marks the CV and who logged it", listRow?.sent_cv_name === "Alex Tester CV.pdf" && listRow?.logged_by === "Claude sweep" && listRow?.status === "Applied");
  check("log: another user can't read the file", (await b.raw(`/api/applications/cv?id=${logged.body.id}`)).status === 404);

  const dup = await a.form("/api/applications/log", { company_name: "Smoke Sage Ltd.", role: "Graduate Engineer - London", date_applied: "2026-11-12" }, { cv: cvFile });
  check("log: the same company and role within 90 days is a 409 naming the row", dup.status === 409 && dup.body.error === "duplicate" && dup.body.existing?.id === logged.body.id && dup.body.existing?.has_sent_cv === true, JSON.stringify(dup.body).slice(0, 160));
  const forced = await a.form("/api/applications/log", { company_name: "Smoke Sage Ltd", role: "Graduate Engineer", date_applied: "2026-11-12", force: "1" });
  check("log: force=1 logs it again", forced.status === 200 && forced.body.id !== logged.body.id);
  const defaultBy = (await a.call("/api/applications")).body.applications.find((r) => r.id === forced.body.id);
  check("log: an unnamed logger is 'assistant'", defaultBy?.logged_by === "assistant");
  const nameOnPage = (await a.call("/api/applications")).body.applications.find((r) => r.company_name === "Smoke Key Ltd");
  check("POST: a row with no logged_by records none", nameOnPage && nameOnPage.logged_by === undefined);

  for (const [name, fields, files] of [
    ["an unknown field", { company_name: "Smoke Bad Ltd", role: "Engineer", date_applied: "2026-11-12", company: "x" }, {}],
    ["cv sent as text", { company_name: "Smoke Bad Ltd", role: "Engineer", date_applied: "2026-11-12", cv: "my cv" }, {}],
    ["a file that is not a document", { company_name: "Smoke Bad Ltd", role: "Engineer", date_applied: "2026-11-12" }, { cv: { bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]), type: "application/octet-stream", name: "cv.exe" } }],
    ["an empty file", { company_name: "Smoke Bad Ltd", role: "Engineer", date_applied: "2026-11-12" }, { cv: { bytes: new Uint8Array(), type: "application/pdf", name: "cv.pdf" } }],
    ["a tailored source", { company_name: "Smoke Bad Ltd", role: "Engineer", date_applied: "2026-11-12", source: "tailored" }, {}],
    ["no date on a sent row", { company_name: "Smoke Bad Ltd", role: "Engineer", status: "Applied" }, {}],
  ]) {
    const res = await a.form("/api/applications/log", fields, files);
    check(`log: ${name} is a 400 and saves nothing`, res.status === 400 && (await a.call("/api/applications?lite=1&q=smoke%20bad")).body.applications.length === 0, `${res.status} ${JSON.stringify(res.body).slice(0, 100)}`);
  }

  const withLetter = await a.form("/api/applications/log", { company_name: "Smoke Letter Ltd", role: "Backend Engineer", date_applied: "2026-11-12" }, { cv: cvFile, cover_letter: letterFile });
  if (withLetter.status === 503) {
    check("log: a cover letter names the migration, and nothing is left behind", withLetter.body.errorType === "needs_migration" && /20261112120000/.test(withLetter.body.error) && (await a.call("/api/applications?lite=1&q=smoke%20letter")).body.applications.length === 0);
    skipped("log with a cover letter");
  } else {
    check("log: the cover letter is stored beside the CV", withLetter.status === 200 && withLetter.body.sentCoverLetter?.fileName === "Cover letter.txt" && withLetter.body.sentCv?.fileName === "Alex Tester CV.pdf");
    const letter = await a.raw(`/api/applications/cv?id=${withLetter.body.id}&doc=cover_letter`);
    check("log: the letter downloads, and its text is kept", letter.status === 200 && (await letter.text()).startsWith("Dear Hiring Team") && /Graduate Engineer role/.test((await detail(withLetter.body.id)).sent_cover_letter?.text ?? ""));
  }

  const lkey = crypto.randomUUID();
  const l1 = await a.form("/api/applications/log", { company_name: "Smoke Retry Ltd", role: "Engineer", date_applied: "2026-11-12" }, { cv: cvFile }, { "Idempotency-Key": lkey });
  const l2 = await a.form("/api/applications/log", { role: "Engineer", company_name: "Smoke Retry Ltd", date_applied: "2026-11-12" }, { cv: cvFile }, { "Idempotency-Key": lkey });
  const retried = (await a.call("/api/applications?lite=1&q=smoke%20retry")).body.applications;
  check("log: a retry never makes a second row (replayed, or a 409 naming the first)", l1.status === 200 && retried.length === 1 && ((l2.status === 200 && l2.body.id === l1.body.id) || (l2.status === 409 && l2.body.existing?.id === l1.body.id)), `${l2.status}`);

  // Deleting a row takes its files with it.
  const before = await storedFiles(a.id);
  const target = withLetter.status === 200 ? withLetter.body.id : logged.body.id;
  const own = before.filter((p) => p.includes(`/${target}/`));
  await a.call(`/api/applications?id=${target}`, "DELETE");
  const after = await storedFiles(a.id);
  check("delete: the row's stored files go with it", own.length >= 1 && own.every((p) => !after.includes(p)), `${own.length} file(s)`);
} catch (err) {
  fail++;
  console.log("FAIL harness:", err?.message ?? err);
} finally {
  for (const id of users) {
    const files = await storedFiles(id).catch(() => []);
    if (files.length) await fetch(`${SB}/storage/v1/object/application-cvs`, { method: "DELETE", headers: admin, body: json({ prefixes: files }) }).catch(() => undefined);
    await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin }).catch(() => undefined);
  }
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exitCode = fail ? 1 : 0;
}
