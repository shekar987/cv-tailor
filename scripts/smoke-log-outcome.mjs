// Chunk 26 on the real routes and the real database, with two throwaway users removed at the
// end. No model call.
//
// 1. The API's refusals: /api/applications/log names the allowed `source` values and the
//    append_note limit, and no route creates or renames a row to "undefined".
// 2. "Log outcome" as the page sends it: ONE request ends the application, dates it, confirms
//    an outcome a sweep reported, and puts the line on top of the notes without replacing
//    them; Undo takes the close and its line back together; a screened row needs the word.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-log-outcome.mjs
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const json = (b) => JSON.stringify(b);

async function newUser(tag) {
  const email = `outcome-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(json(session)).toString("base64url")}`;
  const call = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { cookie, ...(typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}), ...opts.headers } });
  return { id: created.id, call };
}

const a = await newUser("a");
const b = await newUser("b");
try {
  const stored = async (id, columns) => (await (await fetch(`${SB}/rest/v1/applications?id=eq.${id}&select=${columns}`, { headers: admin })).json())[0];
  const count = async () => (await (await fetch(`${SB}/rest/v1/applications?user_id=eq.${a.id}&select=id`, { headers: admin })).json()).length;
  const log = async (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const res = await a.call("/api/applications/log", { method: "POST", body: form });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const GOOD = { company_name: "Harbourline", role: "Junior Software Engineer", date_applied: "2026-11-10" };

  // ── 1. The refusals say what would have been taken ───────────────────────
  for (const sent of ["linkedin", "aiapply"]) {
    const r = await log({ ...GOOD, source: sent });
    check(`source "${sent}" is a 400`, r.status === 400, `${r.status}`);
    check("that names the field", r.body.field === "source");
    check("and lists the allowed values", JSON.stringify(r.body.allowed) === '["manual","cold-email"]' && /"manual"/.test(r.body.error) && /"cold-email"/.test(r.body.error), r.body.error);
  }
  const long = await log({ ...GOOD, append_note: "x".repeat(612) });
  check("an append_note over the limit is a 400", long.status === 400, `${long.status}`);
  check("that states the limit and what was sent", long.body.field === "append_note" && long.body.max === 500 && long.body.length === 612 && /612 characters/.test(long.body.error) && /500/.test(long.body.error), long.body.error);
  const undef = await log({ company_name: "undefined", role: "undefined", date_applied: "2026-11-13" });
  check('company "undefined" / role "undefined" is a 400', undef.status === 400 && undef.body.field === "company_name", `${undef.status} ${undef.body.error}`);
  check("with a clear message", /nothing was saved/.test(undef.body.error ?? "") && /company_name/.test(undef.body.error ?? ""));
  const undefRole = await log({ ...GOOD, role: "undefined" });
  check('role "undefined" alone is a 400 naming role', undefRole.status === 400 && undefRole.body.field === "role", undefRole.body.error);
  const empty = await log({ company_name: "  ", role: "Engineer", date_applied: "2026-11-13" });
  check("an empty company is a 400 naming company_name", empty.status === 400 && empty.body.field === "company_name" && /required/.test(empty.body.error), empty.body.error);
  const noRole = await log({ company_name: "Harbourline", role: "", date_applied: "2026-11-13" });
  check("an empty role is a 400 naming role", noRole.status === 400 && noRole.body.field === "role", noRole.body.error);
  const viaPost = await a.call("/api/applications", { method: "POST", body: json({ company_name: "undefined", role: "undefined", date_applied: "2026-11-13" }) });
  check("POST /api/applications refuses it too", viaPost.status === 400 && (await viaPost.json()).field === "company_name");
  const cold = await a.call("/api/applications/bulk-upsert", { method: "POST", body: json([{ company_name: "undefined", role: "undefined", contact_email: "a@example.com", date_sent: "2026-11-12" }]) });
  const coldBody = await cold.json().catch(() => ({}));
  check("the cold-email route reports it and inserts nothing", cold.status === 503 || (Array.isArray(coldBody.problems) && coldBody.problems.length === 1 && (coldBody.inserted ?? []).length === 0), `${cold.status} ${json(coldBody).slice(0, 160)}`);
  check("none of that created a row", (await count()) === 0, `${await count()}`);
  const ok = await log({ ...GOOD, source: "manual", append_note: "Applied on the company site", logged_by: "Smoke test" });
  check("a good log still saves", ok.status === 200 && !!ok.body.id, `${ok.status} ${json(ok.body).slice(0, 120)}`);
  const rename = await a.call("/api/applications", { method: "PUT", body: json({ id: ok.body.id, company_name: "undefined" }) });
  check("a row can't be renamed to it", rename.status === 400 && (await rename.json()).field === "company_name");
  check("its name is unchanged", (await stored(ok.body.id, "company_name")).company_name === "Harbourline");

  // ── 2. Log outcome, as the page sends it ─────────────────────────────────
  const add = async (status, company, extra = {}) => (await (await a.call("/api/applications", { method: "POST", body: json({ company_name: company, role: "Software Engineer", status, date_applied: "2026-10-20", ...extra }) })).json()).id;
  const put = (id, body, who = a) => who.call("/api/applications", { method: "PUT", body: json({ id, ...body }) });
  const NOTE = "Outcome email 13 Nov 2026: Sadly it is not this time.";
  const outcome = (note = NOTE) => ({ status: "Rejected", close_reason: "rejected", closed_at: "2026-11-12T12:00:00.000Z", lesson: null, confirmed_by_user: true, append_note: note });

  const plain = await add("Applied", "Quillstone", { notes: "Referred by Sam\nApplied on the company site" });
  const before = await stored(plain, "notes, status");
  const done = await put(plain, outcome());
  const doneBody = await done.json();
  check("one request logs the outcome", done.status === 200, `${done.status} ${json(doneBody).slice(0, 160)}`);
  const after = await stored(plain, "status, closed_at, close_reason, notes, undo_snapshot");
  check("the status is Rejected", /^rejected$/i.test(after.status), after.status);
  check("the outcome's date is kept", after.closed_at?.slice(0, 10) === "2026-11-12" && after.close_reason === "rejected", `${after.closed_at}`);
  const lines = (after.notes ?? "").split("\n");
  check("the line is on top of the notes, stamped", lines[0].endsWith(NOTE) && /^\d{1,2} \w{3} \d{4} \d{2}:\d{2} /.test(lines[0]), lines[0]);
  check("and every earlier note is still there, unchanged", lines.slice(1).join("\n") === before.notes, json(lines.slice(1)));
  check("the answer carries the notes as stored", doneBody.notes === after.notes);
  check("the close can still be undone (its line was part of the same write)", !!after.undo_snapshot && after.undo_snapshot.note === lines[0], json(after.undo_snapshot).slice(0, 200));
  const undo = await put(plain, { undo_close: true });
  const undoBody = await undo.json();
  check("Undo restores the application", undo.status === 200, `${undo.status} ${json(undoBody).slice(0, 160)}`);
  const back = await stored(plain, "status, closed_at, close_reason, notes, undo_snapshot");
  check("it is Applied again, with no close date", /^applied$/i.test(back.status) && back.closed_at === null && back.close_reason === null, `${back.status} ${back.closed_at}`);
  check("and its notes are exactly what they were", back.notes === before.notes, json(back.notes));
  check("the answer says so", undoBody.restored?.notes === before.notes);

  // A row with no notes at all: the line is the notes, and Undo leaves none.
  const bare = await add("Applied", "Tidewell");
  check("a row with no notes takes the line", (await put(bare, outcome())).status === 200 && (await stored(bare, "notes")).notes.endsWith(NOTE));
  check("and Undo leaves it with none", (await put(bare, { undo_close: true })).status === 200 && (await stored(bare, "notes")).notes === null);

  // A screened row: never without the word, and with it in the same single request.
  const screened = await add("Interview", "Ardenmoor", { notes: "Interview on 5 Nov" });
  const noWord = await put(screened, { status: "Rejected", append_note: NOTE });
  check("an Interview row is not ended without the user's word", noWord.status === 409 && (await noWord.json()).errorType === "needs_confirmation");
  const untouched = await stored(screened, "status, notes");
  check("and nothing landed, the note included", /^interview$/i.test(untouched.status) && untouched.notes === "Interview on 5 Nov", json(untouched));
  check("with the word, the same click ends it", (await put(screened, outcome("Outcome email 13 Nov 2026: We regret to inform you that we will not be progressing your application."))).status === 200);
  const ended = await stored(screened, "status, stages_reached, notes, closed_at");
  check("it is Rejected and dated", /^rejected$/i.test(ended.status) && ended.closed_at?.slice(0, 10) === "2026-11-12");
  check("the interview stays on its record", (ended.stages_reached ?? []).includes("interview"), json(ended.stages_reached));
  check("its earlier note is under the new line", ended.notes.split("\n")[1] === "Interview on 5 Nov", json(ended.notes));

  // A line that says when to apply again saves no reapply rule with the close: Undo could not
  // take a rule back. (The same words appended on their own do save one: lib/companyRules.)
  const waitLine = "Outcome email 13 Nov 2026: We will not be progressing your application and ask that you wait at least 6 months before applying again.";
  const ruled = await add("Applied", "Rulemaker Labs");
  const ruledBody = await (await put(ruled, outcome(waitLine))).json();
  const rules = await (await a.call("/api/company-rules")).json();
  check("a close's line saves no reapply rule by itself", !ruledBody.companyRules && Array.isArray(rules.rules) && rules.rules.length === 0, `${json(ruledBody.companyRules)} ${json(rules).slice(0, 120)}`);
  check("and Undo leaves nothing of it behind", (await put(ruled, { undo_close: true })).status === 200 && (await stored(ruled, "notes")).notes === null);

  // An outcome a sweep already reported: the click confirms it.
  const reported = await add("Screening", "Marlowe Finch");
  const patched = await a.call(`/api/applications/${reported}/pending-outcome`, { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-12", source: "gmail" }) });
  check("a sweep's report is waiting on the row", patched.status === 200 && (await stored(reported, "pending_outcome")).pending_outcome?.outcome === "rejected");
  check("the click confirms it", (await put(reported, outcome())).status === 200);
  const confirmed = await stored(reported, "status, pending_outcome");
  check("the row is Rejected and the report is answered", /^rejected$/i.test(confirmed.status) && confirmed.pending_outcome?.dismissed === true, json(confirmed));

  // A follow-up was open: both lines are written, and Undo takes both back.
  const chased = await add("Applied", "Penrose & Hale", { followup_date: "2026-11-20", notes: "Mine" });
  check("an open follow-up is cleared with the close", (await put(chased, outcome())).status === 200);
  const cleared = await stored(chased, "followup_date, notes");
  check("the line is on top and the follow-up's date is kept below", cleared.followup_date === null && cleared.notes.split("\n")[0].endsWith(NOTE) && /Follow-up 2026-11-20 cleared/.test(cleared.notes) && cleared.notes.includes("Mine"), json(cleared.notes));
  check("Undo puts the follow-up back", (await put(chased, { undo_close: true })).status === 200);
  const restored = await stored(chased, "followup_date, notes, status");
  check("and takes back both lines", restored.followup_date === "2026-11-20" && restored.notes === "Mine" && /^applied$/i.test(restored.status), json(restored));

  // Notes with no room: nothing lands, the status included.
  const full = await add("Applied", "Harbour Lights");
  await fetch(`${SB}/rest/v1/applications?id=eq.${full}`, { method: "PATCH", headers: { ...admin, Prefer: "return=minimal" }, body: json({ notes: "n".repeat(9990) }) });
  const noRoom = await put(full, outcome());
  const noRoomBody = await noRoom.json();
  check("full notes refuse the whole write", noRoom.status === 400 && noRoomBody.errorType === "notes_full", `${noRoom.status} ${json(noRoomBody).slice(0, 120)}`);
  const kept = await stored(full, "status, notes, closed_at");
  check("so the application is not ended without its note", /^applied$/i.test(kept.status) && kept.notes.length === 9990 && kept.closed_at === null);

  // A note over the limit: refused whole, with the limit.
  const tooLong = await put(await add("Applied", "Long Note Ltd"), outcome("y".repeat(501)));
  const tooLongBody = await tooLong.json();
  check("a line over 500 characters is refused with the limit", tooLong.status === 400 && tooLongBody.max === 500 && tooLongBody.length === 501, json(tooLongBody).slice(0, 160));

  // Another user's row.
  const theirs = await put(plain, outcome(), b);
  check("another user can't log an outcome on it", theirs.status === 404, `${theirs.status}`);
  check("and it did not move", /^applied$/i.test((await stored(plain, "status")).status));
} catch (err) {
  fail++;
  console.log("FAIL harness:", err?.message ?? err);
} finally {
  for (const user of [a, b]) await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: admin }).catch(() => undefined);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
