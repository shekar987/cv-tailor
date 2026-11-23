// The tracker past PostgREST's 1000-row ceiling, on a seeded THROWAWAY account:
//   node scripts/smoke-tracker-paging.mjs [base url, default http://localhost:3000]
// CSV export with 1,013 rows = 1,013; insights count 1,013; the list at 2,000
// rows under 1.5 MB with no JD or full notes in it; the full text still in the
// detail read and the CSV. No model calls. Reads SUPABASE_SECRET_KEY from
// .env.local (never from src/); the account and its rows cascade away at the end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3000";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// Heavier than a real tracker's mix: every row tailored, with a JD and long notes.
const JD = "Software engineer posting used only by an automated check. ".repeat(26);
const NOTES = "Notes about this application, used only by an automated check. ".repeat(7);
const gates = { read: "apply", hard: 0, soft: 0, unknown: 2, items: [{ category: "sponsorship", verdict: "unknown", requirement: "Sponsorship is not mentioned." }], triage: { verdict: "apply", reasons: [], hits: [] } };
let seeded = 0;
async function seed(uid, upTo) {
  while (seeded < upTo) {
    const n = Math.min(500, upTo - seeded);
    // One POST is one transaction, so a batch shares created_at, and half the
    // rows share a date: only the id tie-breaker keeps the pages stable.
    const batch = Array.from({ length: n }, (_, i) => {
      const k = seeded + i + 1;
      return {
        user_id: uid, company_name: `Seedco ${String(k).padStart(4, "0")}`, role: "Software Engineer - Platform, London", status: "Applied", source: "tailored",
        cv_reference: `Alex_Morgan_Seedco_${k}_CV`, tailor_session_id: `seed-${k}`, salary: "£45,000 - £55,000", date_applied: k % 2 ? "2026-10-01" : "2026-09-01",
        job_description: JD, notes: NOTES, tailored_cv: { formatStyle: "ukji", gates },
      };
    });
    const r = await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=minimal" }, body: JSON.stringify(batch) });
    if (!r.ok) throw new Error(`seed ${r.status} ${await r.text()}`);
    seeded += n;
  }
}

const email = `paging-${Date.now()}@example.com`;
const password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
const uid = created.id;
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const get = (p) => fetch(BASE + p, { headers: { cookie } });
  const csvRows = (text) => new Set(text.match(/Seedco \d{4}/g) ?? []).size;

  await seed(uid, 1013);
  const csvRes = await get("/api/applications/export");
  const csv = await csvRes.text();
  check("CSV with 1,013 rows returns 1,013", csvRes.status === 200 && csvRows(csv) === 1013, `${csvRes.status}, ${csvRows(csv)} rows, ${(Buffer.byteLength(csv) / 1048576).toFixed(2)} MB`);
  check("the CSV keeps the full JD on every row", (csv.match(/Software engineer posting used only by an automated check\. "/g) ?? []).length === 1013);
  const filtered = await (await get("/api/applications/export?from=2026-10-01")).text();
  check("a CSV filter holds across pages", csvRows(filtered) === 507, `${csvRows(filtered)} of 507 October rows`);
  const ins = await (await get("/api/applications/insights")).json();
  check("insights count 1,013", ins.insights?.counted === 1013, String(ins.insights?.counted));

  // One page of the list (Chunk 19): ?stage=Applied&limit=50 is ≤ 50 rows with no notes
  // preview; the cursor walks every row once; no parameters is still the full list.
  const londonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const ids3 = (await (await fetch(`${SB}/rest/v1/applications?user_id=eq.${uid}&select=id&order=id&limit=3`, { headers: admin })).json()).map((r) => r.id);
  for (const id of ids3) await fetch(`${SB}/rest/v1/applications?id=eq.${id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ followup_date: londonToday }) });
  let t = Date.now();
  const pageRes = await get("/api/applications?stage=Applied&limit=50");
  const pageMs = Date.now() - t;
  const pageText = await pageRes.text();
  const page = JSON.parse(pageText);
  check("?stage=Applied&limit=50 answers 50 rows or fewer", pageRes.status === 200 && page.applications.length <= 50 && page.applications.length === 50, `${pageRes.status}, ${page.applications?.length} rows`);
  check("…with no notes_preview, and notes_more on every row with notes (its Notes box stays locked until the full text loads)", page.applications.every((r) => !("notes_preview" in r) && r.notes_more === true));
  check("…and under 80 KB", Buffer.byteLength(pageText) < 80 * 1024, `${(Buffer.byteLength(pageText) / 1024).toFixed(1)} KB in ${pageMs} ms`);
  const seen = new Set(page.applications.map((r) => r.id));
  let cursor = page.nextCursor, pages = 1;
  while (cursor && pages < 60) {
    const next = await (await get(`/api/applications?stage=Applied&limit=200&cursor=${encodeURIComponent(cursor)}`)).json();
    for (const r of next.applications ?? []) seen.add(r.id);
    cursor = next.nextCursor;
    pages++;
  }
  check("the cursor walks every Applied row exactly once", seen.size === 1013 && !cursor, `${seen.size} rows in ${pages} pages`);
  check("a cursor it never gave out is a 400", (await get("/api/applications?cursor=not-a-cursor")).status === 400);
  t = Date.now();
  const fullRes = await get("/api/applications");
  const fullMs = Date.now() - t;
  const fullText0 = await fullRes.text();
  const fullBody0 = JSON.parse(fullText0);
  const full0 = fullBody0.applications ?? [];
  check("no parameters is still the full list, previews included (the sweeps' contract)", full0.length === 1013 && full0.every((r) => typeof r.notes_preview === "string"), `${full0.length} rows, ${(Buffer.byteLength(fullText0) / 1024).toFixed(0)} KB in ${fullMs} ms`);
  check("…and it now carries total and next, and an X-Total-Count header (Chunk JH-3)", fullBody0.total === 1013 && fullBody0.next === null && fullRes.headers.get("x-total-count") === "1013", `total ${fullBody0.total}, next ${fullBody0.next}, header ${fullRes.headers.get("x-total-count")}`);
  const all1 = JSON.parse(await (await get("/api/applications?all=1")).text()).applications ?? [];
  check("?all=1 is the same list", all1.length === full0.length && all1.every((r, i) => r.id === full0[i].id && r.notes_preview === full0[i].notes_preview));

  // ── Offset paging (Chunk JH-3): limit / offset, total, next, filters ───────
  const paged = async (query) => {
    const res = await get(`/api/applications${query}`);
    return { res, body: JSON.parse(await res.text()) };
  };
  const p1 = await paged("?limit=200");
  check("?limit=200 is one page of 200 with total 1013 and next 200", p1.res.status === 200 && p1.body.applications.length === 200 && p1.body.total === 1013 && p1.body.next === 200 && p1.res.headers.get("x-total-count") === "1013", `${p1.body.applications?.length} rows, total ${p1.body.total}, next ${p1.body.next}`);
  const walked = new Set();
  const sizes = [];
  for (let off = 0; off < 1013; off += 200) {
    const page = (await paged(`?limit=200&offset=${off}`)).body;
    sizes.push(page.applications.length);
    for (const r of page.applications) walked.add(r.id);
  }
  check("the offsets walk 200/200/200/200/200/13 and every row once", sizes.join("/") === "200/200/200/200/200/13" && walked.size === 1013, `${sizes.join("/")}, ${walked.size} rows`);
  const tail = await paged("?limit=200&offset=1000");
  check("the last page has next null", tail.body.next === null && tail.body.applications.length === 13, `next ${tail.body.next}, ${tail.body.applications.length} rows`);
  const big = await paged("?limit=5000");
  check("limit=5000 is capped at 1000 (total still 1013, next 1000)", big.body.applications.length === 1000 && big.body.total === 1013 && big.body.next === 1000, `${big.body.applications.length} rows`);
  check("a bad limit/offset is a 400", (await get("/api/applications?limit=0")).status === 400 && (await get("/api/applications?offset=-1")).status === 400);

  // Filters apply before paging; status is case-insensitive (both stored spellings).
  const twoIds = (await (await fetch(`${SB}/rest/v1/applications?user_id=eq.${uid}&select=id&order=id&limit=2`, { headers: admin })).json()).map((r) => r.id);
  await fetch(`${SB}/rest/v1/applications?id=eq.${twoIds[0]}`, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "interview" }) });
  await fetch(`${SB}/rest/v1/applications?id=eq.${twoIds[1]}`, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "Interview" }) });
  const iv = await paged("?status=Interview&limit=50");
  check("?status=Interview matches rows stored as 'interview' AND 'Interview'", iv.body.total === 2 && iv.body.applications.length === 2, `total ${iv.body.total}`);
  const applied = await paged("?status=applied&limit=50");
  check("?status=applied (lower-case) matches the capitalised 'Applied' rows", applied.body.total === 1011, `total ${applied.body.total}`);
  const byCompany = await paged("?company=Seedco%200005&limit=50");
  check("a company filter narrows before paging", byCompany.body.total === 1 && byCompany.body.applications[0]?.company_name === "Seedco 0005", `total ${byCompany.body.total}`);

  // ── RLS: paging and ?all=1 never return another user's rows ────────────────
  const email2 = `paging2-${Date.now()}@example.com`;
  const password2 = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const other = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email: email2, password: password2, email_confirm: true }) })).json();
  try {
    await fetch(`${SB}/rest/v1/applications`, { method: "POST", headers: { ...admin, Prefer: "return=minimal" }, body: JSON.stringify([{ user_id: other.id, company_name: "OtherUserCo", role: "Engineer", status: "Applied", source: "manual", date_applied: "2026-10-01" }]) });
    const mine = await paged("?limit=1000");
    const all = await paged("?all=1");
    const leaked = [...mine.body.applications, ...all.body.applications].some((r) => r.company_name === "OtherUserCo");
    check("paging and ?all=1 never return another user's rows (RLS)", !leaked && mine.body.total === 1013 && all.body.total === 1013, `leaked ${leaked}, mine ${mine.body.total}, all ${all.body.total}`);
  } finally {
    await fetch(`${SB}/auth/v1/admin/users/${other.id}`, { method: "DELETE", headers: admin });
  }
  const counts = await (await get(`/api/applications/counts?today=${londonToday}`)).json();
  check("counts: every row, every tab, the follow-ups due this week", counts.total === 1013 && counts.counts?.applied === 1013 && counts.followups_due_this_week === 3, JSON.stringify({ total: counts.total, applied: counts.counts?.applied, week: counts.followups_due_this_week }));

  await seed(uid, 2000);
  const listRes = await get("/api/applications");
  const listText = await listRes.text();
  const rows = JSON.parse(listText).applications ?? [];
  const mb = Buffer.byteLength(listText) / 1048576;
  check("the list returns 2,000 rows, none repeated", listRes.status === 200 && rows.length === 2000 && new Set(rows.map((r) => r.id)).size === 2000, `${listRes.status}, ${rows.length} rows`);
  check("list payload at 2,000 rows is under 1.5 MB", mb < 1.5, `${mb.toFixed(2)} MB`);
  check("no row carries the JD or full notes", rows.every((r) => !("job_description" in r) && !("notes" in r) && r.has_job_description === true && r.notes_more === true));

  const detail = (await (await get(`/api/applications?id=${rows[0].id}`)).json()).application;
  check("the detail read has the full JD and notes", detail?.job_description === JD.trim() || detail?.job_description === JD, `${detail?.job_description?.length} chars`);
  check("…and the full notes", detail?.notes === NOTES || detail?.notes === NOTES.trim(), `${detail?.notes?.length} chars`);
  const fullCsv = await get("/api/applications/export");
  const fullText = await fullCsv.text();
  check("CSV at 2,000 rows", fullCsv.status === 200 && csvRows(fullText) === 2000, `${fullCsv.status}, ${csvRows(fullText)} rows, ${(Buffer.byteLength(fullText) / 1048576).toFixed(2)} MB`);

  // "Download everything": every row, past Vercel's 4.5 MB limit on a buffered response.
  const accountRes = await get("/api/account/export");
  const accountText = await accountRes.text();
  const account = accountRes.status === 200 ? JSON.parse(accountText) : null;
  const accountMb = Buffer.byteLength(accountText) / 1048576;
  check("Download everything has all 2,000 rows", account?.applications?.rows?.length === 2000, `${accountRes.status}, ${account?.applications?.rows?.length} rows, ${accountMb.toFixed(2)} MB`);
  check("…with the full JD and notes", account?.applications?.rows?.[0]?.notes?.length > 400 && account?.applications?.rows?.[0]?.job_description?.length > 1500);
  check("…and past 4.5 MB, so the limit was really tested", accountMb > 4.5, `${accountMb.toFixed(2)} MB`);
} catch (e) {
  failed++;
  console.log("FAIL threw —", e?.message ?? e);
} finally {
  const del = await fetch(`${SB}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: admin });
  const left = await (await fetch(`${SB}/rest/v1/applications?user_id=eq.${uid}&select=id&limit=1`, { headers: admin })).json();
  console.log(`cleanup: user deleted ${del.ok}, rows left ${left.length}`);
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exitCode = failed ? 1 : 0;
}
