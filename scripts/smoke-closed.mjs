// Closing a row on the real route and the real database, between two throwaway users: the
// guard, the pending outcome, the confirmed close, Undo, Reopen, and that no user reaches
// another's row. No model call. Before migration 20261104130000 it checks what the route does
// without the columns, and says SKIP for what needs them.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-closed.mjs
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://localhost:3100";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const REF = new URL(SB).hostname.split(".")[0];
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0, fail = 0, skipped = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const json = (b) => JSON.stringify(b);

async function newUser(tag) {
  const email = `closed-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(json(session)).toString("base64url")}`;
  const call = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { cookie, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  return { id: created.id, call };
}

const a = await newUser("a");
const b = await newUser("b");
try {
  const add = async (status, company = "Northwind") => (await (await a.call("/api/applications", { method: "POST", body: json({ company_name: company, role: "Engineer", status, date_applied: "2026-10-20" }) })).json()).id;
  const read = async (id) => (await (await a.call("/api/applications")).json()).applications.find((r) => r.id === id);
  const put = (id, body) => a.call("/api/applications", { method: "PUT", body: json({ id, ...body }) });
  const pendingUrl = (id) => `/api/applications/${id}/pending-outcome`;

  // ── The guard needs no migration ─────────────────────────────────────────
  const id = await add("Screening");
  const refused = await put(id, { status: "Rejected" });
  check("409 without confirmation", refused.status === 409);
  check("with the brief's message", (await refused.json()).error === "Needs the user's confirmation; set pending_outcome instead.");
  check("the row did not move", (await read(id)).status === "Screening");
  const faked = await put(id, { status: "Rejected", confirmed_by_user: "true" });
  check('the string "true" is not confirmation', faked.status === 409);
  check("interview is held too", (await put(await add("Interview"), { status: "Withdrawn" })).status === 409);
  check("assessment is held too", (await put(await add("Assessment"), { status: "Rejected" })).status === 409);

  // No way round it in two writes, and no writing the close directly.
  const backTry = await put(id, { status: "Applied" });
  check("moving it below screening needs the user", backTry.status === 409 && (await backTry.json()).errorType === "needs_move_back_confirmation");
  check("Ready to submit too", (await put(id, { status: "Ready to submit" })).status === 409);
  check("the closing word is not that word", (await put(id, { status: "Applied", confirmed_by_user: true })).status === 409);
  check("so the next ending is still refused", (await put(id, { status: "Rejected" })).status === 409);
  let row0 = await read(id);
  check("and the proof is intact", row0.status === "Screening" && row0.stages_reached.includes("screening"), JSON.stringify(row0.stages_reached));
  check("closed_at alone is refused", (await put(id, { closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" })).status === 400);
  check("closed_at with an open status is refused", (await put(id, { status: "Screening", closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" })).status === 409);
  check("even with the word", (await put(id, { status: "Screening", closed_at: "2026-11-02T12:00:00.000Z", confirmed_by_user: true })).status === 409);
  check("close_reason alone is refused", (await put(id, { close_reason: "rejected" })).status === 400);
  check("an outcome through the PUT is refused, so the merge rule holds", (await put(id, { pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "sweep" } })).status === 400);
  row0 = await read(id);
  check("none of that moved it", row0.status === "Screening" && !row0.closed_at);
  const corrected = await add("Screening", "Corrected");
  const correct = await put(corrected, { status: "Applied", confirmed_move_back: true });
  check("the user can still correct a mistake", correct.status === 200 && (await read(corrected)).status === "Applied");
  const never = await add("Applied");
  check("an application that never got that far moves freely", (await put(never, { status: "Rejected" })).status === 200 && (await read(never)).status === "Rejected");

  // ── What needs the migration ─────────────────────────────────────────────
  const probe = await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-02", source: "gmail" }) });
  if (probe.status === 503) {
    const body = await probe.json();
    check("before the migration, the outcome route names the file", body.errorType === "needs_migration" && /20261104130000/.test(body.error));
    check("a lesson alone names the file", (await put(id, { lesson: "wanted 3+ yrs" })).status === 503);
    check("an ordinary move still saves without the columns", (await put(id, { status: "Interview" })).status === 200 && (await put(id, { status: "Screening" })).status === 200);
    await put(id, { followup_date: "2026-11-20" });
    const closeTry = await put(id, { status: "Rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "asked for 3+ years" });
    const closeBody = await closeTry.json();
    check("the user's own close still moves the status", closeTry.status === 200 && (await read(id)).status === "Rejected", `${closeTry.status} ${json(closeBody).slice(0, 160)}`);
    check("and says what it could not keep", /20261104130000/.test(closeBody.warning ?? ""), closeBody.warning);
    check("the stage history keeps how far it got", (await read(id)).stages_reached.join() === "screening,rejected", (await read(id)).stages_reached.join());
    check("the follow-up clears as before", closeBody.followupCleared?.followup_date === null);
    const undoTry = await put(id, { status: "screening", closed_at: null, close_reason: null, lesson: null, pending_outcome: null, followup_date: "2026-11-20", notes: null });
    const undone = await read(id);
    check("Undo works without the columns", undoTry.status === 200 && undone.status === "Screening" && undone.followup_date === "2026-11-20" && undone.stages_reached.join() === "screening", `${undoTry.status} ${json(undone).slice(0, 200)}`);
    skipped = 1;
    console.log("SKIP the rest: migration 20261104130000 is not applied yet.");
  } else {
    // ── Pending outcome ────────────────────────────────────────────────────
    const recorded = await probe.json();
    check("a sweep records an outcome", probe.status === 200 && recorded.pending_outcome?.outcome === "rejected", json(recorded).slice(0, 160));
    let row = await read(id);
    check("pending_outcome leaves the status unchanged", row.status === "Screening" && row.pending_outcome?.source === "gmail");
    check("nothing closes", !row.closed_at);
    check("a bad outcome is refused", (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "interview", date: "2026-11-02" }) })).status === 400);
    check("a bad date is refused", (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2 Nov" }) })).status === 400);
    check("the same route can't move a status", (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-02", status: "Rejected" }) })).status === 200 && (await read(id)).status === "Screening");

    await a.call(pendingUrl(id), { method: "PATCH", body: json({ dismiss: true }) });
    check("Not true is kept", (await read(id)).pending_outcome?.dismissed === true);
    const again = await (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-02", source: "sweep" }) })).json();
    check("the sweep finding it again stays dismissed", again.ignored === "dismissed" && (await read(id)).pending_outcome?.dismissed === true);
    const newer = await (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-05", source: "gmail" }) })).json();
    check("a new date is new news", !newer.ignored && !(await read(id)).pending_outcome?.dismissed);

    // ── The confirmed close ────────────────────────────────────────────────
    await put(id, { followup_date: "2026-11-20" });
    const closed = await put(id, { status: "rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "asked for 3+ years", pending_outcome: null });
    const closedBody = await closed.json();
    row = await read(id);
    check("confirmed, it closes", closed.status === 200 && row.status === "Rejected" && row.closed_at?.startsWith("2026-11-02") && row.close_reason === "rejected" && row.lesson === "asked for 3+ years", json(row).slice(0, 240));
    check("the pending outcome is kept as dismissed", row.pending_outcome?.dismissed === true && row.pending_outcome?.date === "2026-11-05", json(row.pending_outcome));
    check("the answer says what it took, for Undo", closedBody.closedFrom?.pending_outcome?.date === "2026-11-05" && !closedBody.closedFrom?.pending_outcome?.dismissed, json(closedBody.closedFrom));
    const late = await (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-09", source: "sweep" }) })).json();
    check("a sweep reporting on a closed row changes nothing", late.ignored === "closed" && (await read(id)).pending_outcome?.date === "2026-11-05", json(late).slice(0, 160));
    check("stages_reached keeps how far it got", row.stages_reached.includes("screening") && row.stages_reached.includes("rejected"), row.stages_reached.join());
    check("the follow-up clears as before", closedBody.followupCleared?.followup_date === null);

    const bare = await add("Interview", "Bare");
    check("a confirmation alone still dates the close", (await put(bare, { status: "Rejected", confirmed_by_user: true })).status === 200 && !!(await read(bare)).closed_at && (await read(bare)).close_reason === "rejected");
    check("an unknown reason is refused", (await put(await add("Screening", "Odd"), { status: "Rejected", confirmed_by_user: true, close_reason: "because" })).status === 400);
    check("a lesson over 140 is refused", (await put(id, { lesson: "x".repeat(141) })).status === 400);
    check("a lesson edits alone", (await put(id, { lesson: "wanted 3+ yrs" })).status === 200 && (await read(id)).lesson === "wanted 3+ yrs" && (await read(id)).status === "Rejected");
    check("a sweep's write of the same status moves nothing and lands", (await put(id, { status: "Rejected", notes: "Sweep note" })).status === 200);

    // ── Replacing a close, and undoing that ────────────────────────────────
    const replaced = await put(id, { status: "Withdrawn", confirmed_by_user: true, closed_at: "2026-11-03T12:00:00.000Z", close_reason: "role_closed" });
    check("another ending needs the word too", (await put(id, { status: "Ghosted" })).status === 409 && replaced.status === 200);
    const undoBack = await put(id, { status: "rejected", closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", confirmed_by_user: true });
    row = await read(id);
    check("Undo of that restores the earlier close", undoBack.status === 200 && row.status === "Rejected" && row.closed_at?.startsWith("2026-11-02") && row.close_reason === "rejected", json(row).slice(0, 200));

    // ── Undo and Reopen ────────────────────────────────────────────────────
    const undone = await put(id, { status: "screening", closed_at: null, close_reason: null, lesson: null, pending_outcome: { outcome: "rejected", date: "2026-11-05", source: "gmail" } });
    row = await read(id);
    check("Undo restores the status and clears closed_at", undone.status === 200 && row.status === "Screening" && !row.closed_at && !row.close_reason && row.pending_outcome?.outcome === "rejected", json(row).slice(0, 220));
    check("the ending leaves the stage history", !row.stages_reached.includes("rejected") && row.stages_reached.includes("screening"), row.stages_reached.join());
    await put(bare, { status: "interview" });
    row = await read(bare);
    check("moving back to an open stage reopens the row, whoever moved it", row.status === "Interview" && !row.closed_at && !row.close_reason);
    check("after a Reopen it is guarded again", (await put(bare, { status: "Rejected" })).status === 409);
  }

  // ── One user's rows are their own ────────────────────────────────────────
  const other = await b.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-02", source: "gmail" }) });
  check("another user can't record on this row", other.status === 404 || other.status === 503, String(other.status));
  check("another user can't close it", (await b.call("/api/applications", { method: "PUT", body: json({ id, status: "Rejected", confirmed_by_user: true }) })).status === 404);
  check("signed out, the route refuses", (await fetch(BASE + pendingUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json({ dismiss: true }) })).status === 401);
  check("a malformed id is not found", (await a.call(pendingUrl("not-a-uuid"), { method: "PATCH", body: json({ dismiss: true }) })).status === 404);
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  const removed = await Promise.all([a, b].map((u) => fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin })));
  console.log(`\n${pass} passed, ${fail} failed${skipped ? ", the rest skipped until the migration" : ""}; throwaway users removed: ${removed.every((r) => r.ok)}`);
  process.exit(fail ? 1 : 0);
}
