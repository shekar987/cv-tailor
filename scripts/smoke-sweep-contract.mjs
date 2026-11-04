// The tracker API as the owner's sweeps use it, on the real database, whichever
// spelling a row is stored in: GET /api/applications, POST /api/applications, partial
// PUT with { id, status, notes, job_description }, and POST /api/applications/cv with
// { id, file }. They read and write these exact strings, and migration 20261103130000
// must not change what they see. One throwaway user, removed at the end; no model call.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-sweep-contract.mjs      (reads .env.local; SMOKE_BASE to override)
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const SWEEP_STATUSES = ["Applied", "Screening", "Interview", "Rejected", "Withdrawn", "Ready to submit"];

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const json = (body) => JSON.stringify(body);

const email = `sweep-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
try {
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const call = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { cookie, ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}) } });
  const detail = async (id) => (await (await call(`/api/applications?id=${id}`)).json()).application;
  const list = async () => (await (await call("/api/applications")).json()).applications;

  // POST: every status they write comes back exactly, from the list and the detail read.
  const ids = {};
  for (const status of SWEEP_STATUSES) {
    const res = await call("/api/applications", { method: "POST", body: json({ company_name: `Sweep ${status}`, role: "Engineer", status, date_applied: "2026-10-20" }) });
    const body = await res.json();
    check(`POST with "${status}" saves`, res.status === 200 && !!body.id, json(body).slice(0, 120));
    ids[status] = body.id;
    check(`detail reads "${status}" back exactly`, (await detail(body.id)).status === status);
  }
  const rows = await list();
  for (const status of SWEEP_STATUSES) {
    check(`list reads "${status}" back exactly`, rows.find((r) => r.id === ids[status])?.status === status, rows.find((r) => r.id === ids[status])?.status);
  }
  const noStatus = await (await call("/api/applications", { method: "POST", body: json({ company_name: "Sweep default", role: "Engineer", date_applied: "2026-10-20" }) })).json();
  check(`a POST with no status reads "Applied"`, (await detail(noStatus.id)).status === "Applied");

  // Partial PUT, moving one row through every string, with the sweeps' other fields.
  const id = ids.Applied;
  for (const status of SWEEP_STATUSES) {
    const res = await call("/api/applications", { method: "PUT", body: json({ id, status, notes: `Moved to ${status}`, job_description: `JD while ${status}` }) });
    const row = await detail(id);
    check(`PUT to "${status}" reads back exactly`, res.status === 200 && row.status === status && row.job_description === `JD while ${status}` && (row.notes ?? "").includes(`Moved to ${status}`), `${res.status} ${row.status}`);
    const listed = (await list()).find((r) => r.id === id);
    check(`list agrees on "${status}"`, listed.status === status, listed.status);
  }
  const statusOnly = await call("/api/applications", { method: "PUT", body: json({ id, status: "Screening" }) });
  check("a PUT of status alone works", statusOnly.status === 200 && (await detail(id)).status === "Screening");
  const notesOnly = await call("/api/applications", { method: "PUT", body: json({ id, notes: "Only notes" }) });
  check("a PUT of notes alone leaves the status", notesOnly.status === 200 && (await detail(id)).status === "Screening");
  check("an unknown status is still refused", (await call("/api/applications", { method: "PUT", body: json({ id, status: "Pending" }) })).status === 400);

  // Closing a row words its note as before.
  await call("/api/applications", { method: "PUT", body: json({ id, followup_date: "2026-11-20" }) });
  const closed = await (await call("/api/applications", { method: "PUT", body: json({ id, status: "Rejected" }) })).json();
  check('closing clears the follow-up with the same note', closed.followupCleared?.followup_date === null && /Follow-up 2026-11-20 cleared when marked Rejected on /.test(closed.followupCleared?.notes ?? ""), json(closed).slice(0, 160));

  // POST /api/applications/cv, as multipart { id, file }.
  const form = new FormData();
  form.append("id", ids.Interview);
  form.append("file", new File(["Alex Tester\nSoftware engineer. Built web apps in TypeScript and Python for four years.\n"], "alex_cv.txt", { type: "text/plain" }));
  const upload = await call("/api/applications/cv", { method: "POST", body: form });
  check("POST /api/applications/cv works", upload.status === 200, String(upload.status));
  check("the list shows the uploaded file", (await list()).find((r) => r.id === ids.Interview)?.sent_cv_name === "alex_cv.txt");
  check("uploading leaves the status alone", (await detail(ids.Interview)).status === "Interview");

  // Whichever spelling a row is stored in, it reads the same: this is what migration 2 changes.
  const stored = async (rowId) => (await (await fetch(`${SB}/rest/v1/applications?id=eq.${rowId}&select=status`, { headers: admin })).json())[0]?.status;
  console.log(`info: stored spelling for "Screening" on this database: ${await stored(ids.Screening)}`);
  for (const [oldLabel, key] of [["Applied", "applied"], ["Screening", "screening"], ["Interview", "interview"], ["Rejected", "rejected"], ["Withdrawn", "withdrawn"], ["Ready to submit", "saved"]]) {
    const rowId = ids[oldLabel];
    const asOld = await fetch(`${SB}/rest/v1/applications?id=eq.${rowId}`, { method: "PATCH", headers: { ...admin, Prefer: "return=minimal" }, body: json({ status: oldLabel }) });
    check(`stored as "${oldLabel}" reads "${oldLabel}"`, asOld.ok && (await detail(rowId)).status === oldLabel);
    const asKey = await fetch(`${SB}/rest/v1/applications?id=eq.${rowId}`, { method: "PATCH", headers: { ...admin, Prefer: "return=minimal" }, body: json({ status: key }) });
    if (!asKey.ok) {
      console.log(`info: "${key}" not storable yet (migration 1 not applied), skipped`);
      continue;
    }
    check(`stored as "${key}" still reads "${oldLabel}"`, (await detail(rowId)).status === oldLabel && (await list()).find((r) => r.id === rowId)?.status === oldLabel);
  }
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  const del = await fetch(`${SB}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: admin });
  console.log(`\n${pass} passed, ${fail} failed; throwaway user removed: ${del.ok}`);
  process.exit(fail ? 1 : 0);
}
