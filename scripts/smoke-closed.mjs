// Closing a row on the real route and the real database, between two throwaway users: the
// guard, the pending outcome, a confirmed close, Undo from the stored snapshot, Reopen, the
// reopen request, the append-only history, and that no user reaches another's row. No model
// call. Needs migrations 20261104130000 and 20261105120000.
//
//   npm run build && npx next start -p 3100
//   node scripts/smoke-closed.mjs
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
  const email = `closed-${tag}-${Date.now()}@example.com`, password = `Pw-${Math.random().toString(36).slice(2)}-A1!`;
  const created = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: json({ email, password, email_confirm: true }) })).json();
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUB, "Content-Type": "application/json" }, body: json({ email, password }) })).json();
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(json(session)).toString("base64url")}`;
  const call = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { cookie, ...(opts.body ? { "Content-Type": "application/json" } : {}), ...opts.headers } });
  return { id: created.id, token: session.access_token, call };
}

const a = await newUser("a");
const b = await newUser("b");
try {
  const add = async (status, company = "Northwind") => (await (await a.call("/api/applications", { method: "POST", body: json({ company_name: company, role: "Engineer", status, date_applied: "2026-10-20" }) })).json()).id;
  const read = async (id) => (await (await a.call("/api/applications")).json()).applications.find((r) => r.id === id);
  // A notes replace carries the version it read (lib/notesWrite, Chunk 21), like the page.
  const versionOf = async (id) => (await (await a.call(`/api/applications?id=${id}`)).json()).application?.updated_at;
  const put = async (id, body) => a.call("/api/applications", { method: "PUT", body: json({ id, ...body, ...("notes" in body && !("if_updated_at" in body) ? { if_updated_at: await versionOf(id) } : {}) }) });
  const pendingUrl = (id) => `/api/applications/${id}/pending-outcome`;
  const patchOutcome = async (id, body) => (await a.call(pendingUrl(id), { method: "PATCH", body: json(body) })).json();
  const stored = async (id, columns) => (await (await fetch(`${SB}/rest/v1/applications?id=eq.${id}&select=${columns}`, { headers: admin })).json())[0];

  // ── The guard ────────────────────────────────────────────────────────────
  const id = await add("Screening");
  const refused = await put(id, { status: "Rejected" });
  check("409 without confirmation", refused.status === 409);
  check("with the brief's message", (await refused.json()).error === "Needs the user's confirmation; set pending_outcome instead.");
  check("the row did not move", (await read(id)).status === "Screening");
  check('the string "true" is not confirmation', (await put(id, { status: "Rejected", confirmed_by_user: "true" })).status === 409);
  check("interview is held too", (await put(await add("Interview"), { status: "Withdrawn" })).status === 409);
  check("assessment is held too", (await put(await add("Assessment"), { status: "Rejected" })).status === 409);

  const backTry = await put(id, { status: "Applied" });
  check("moving it below screening needs the user", backTry.status === 409 && (await backTry.json()).errorType === "needs_move_back_confirmation");
  check("Ready to submit too", (await put(id, { status: "Ready to submit" })).status === 409);
  check("the closing word is not that word", (await put(id, { status: "Applied", confirmed_by_user: true })).status === 409);
  check("closed_at alone is refused", (await put(id, { closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" })).status === 400);
  check("closed_at with an open status is refused", (await put(id, { status: "Screening", closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" })).status === 409);
  check("even with the word", (await put(id, { status: "Screening", closed_at: "2026-11-02T12:00:00.000Z", confirmed_by_user: true })).status === 409);
  check("close_reason alone is refused", (await put(id, { close_reason: "rejected" })).status === 400);
  check("an outcome through the PUT is refused, so the merge rule holds", (await put(id, { pending_outcome: { outcome: "rejected", date: "2026-11-02", source: "sweep" } })).status === 400);
  const row0 = await read(id);
  check("none of that moved it", row0.status === "Screening" && !row0.closed_at);
  const never = await add("Applied");
  check("an application that never got that far moves freely", (await put(never, { status: "Rejected" })).status === 200 && (await read(never)).status === "Rejected");

  // ── The history only grows ───────────────────────────────────────────────
  const hist = await add("Interview", "History");
  check("Screening on an Interview row, on the user's word, saves", (await put(hist, { status: "Screening", confirmed_move_back: true })).status === 200 && (await read(hist)).status === "Screening");
  check("and the interview stays on its record", (await read(hist)).stages_reached.includes("interview"), (await read(hist)).stages_reached.join());
  const direct = await fetch(`${SB}/rest/v1/applications?id=eq.${hist}`, { method: "PATCH", headers: { apikey: PUB, Authorization: `Bearer ${a.token}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: json({ stages_reached: [] }) });
  check("a direct write can't shrink it either", direct.ok && (await read(hist)).stages_reached.includes("interview"), `${direct.status} ${(await read(hist)).stages_reached.join()}`);
  const corrected = await add("Screening", "Corrected");
  check("moving back on the user's word saves", (await put(corrected, { status: "Applied", confirmed_move_back: true })).status === 200 && (await read(corrected)).status === "Applied");
  const movedBack = await read(corrected);
  check("the proof stays", movedBack.stages_reached.includes("screening"), movedBack.stages_reached.join());
  check("so ending it still needs the word: no two writes around the rule", (await put(corrected, { status: "Rejected" })).status === 409);

  // ── Pending outcome ──────────────────────────────────────────────────────
  const recorded = await patchOutcome(id, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  check("a sweep records an outcome", recorded.pending_outcome?.outcome === "rejected", json(recorded).slice(0, 160));
  let row = await read(id);
  check("pending_outcome leaves the status unchanged", row.status === "Screening" && row.pending_outcome?.source === "gmail");
  check("nothing closes", !row.closed_at);
  check("a bad outcome is refused", (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "interview", date: "2026-11-02" }) })).status === 400);
  check("a bad date is refused", (await a.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2 Nov" }) })).status === 400);
  await patchOutcome(id, { dismiss: true });
  check("Not true is kept", (await read(id)).pending_outcome?.dismissed === true);
  const again = await patchOutcome(id, { outcome: "rejected", date: "2026-11-02", source: "sweep" });
  check("the sweep finding it again stays dismissed", again.ignored === "dismissed" && (await read(id)).pending_outcome?.dismissed === true);
  const newer = await patchOutcome(id, { outcome: "rejected", date: "2026-11-05", source: "gmail" });
  check("a new date is new news", !newer.ignored && !(await read(id)).pending_outcome?.dismissed);
  check("a reopen on a live row means nothing", (await patchOutcome(id, { outcome: "reopen", date: "2026-11-05", source: "gmail" })).ignored === "live");

  // ── The confirmed close, on the real columns ─────────────────────────────
  await put(id, { followup_date: "2026-11-20", notes: "Before the close" });
  const closed = await put(id, { status: "rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "asked for 3+ years", pending_outcome: null });
  const closedBody = await closed.json();
  row = await read(id);
  check("confirmed, it closes", closed.status === 200 && row.status === "Rejected" && row.closed_at?.startsWith("2026-11-02") && row.close_reason === "rejected" && row.lesson === "asked for 3+ years", json(row).slice(0, 240));
  check("the pending outcome is kept as dismissed", row.pending_outcome?.dismissed === true && row.pending_outcome?.date === "2026-11-05", json(row.pending_outcome));
  check("the history keeps how far it got", row.stages_reached.includes("screening") && row.stages_reached.includes("rejected"), row.stages_reached.join());
  check("the follow-up clears as before", closedBody.followupCleared?.followup_date === null);
  const snap = (await stored(id, "undo_snapshot")).undo_snapshot;
  check("a snapshot is stored", snap?.status === "screening" && snap?.closed_at === null && snap?.followup_date === "2026-11-20" && snap?.pending_outcome?.date === "2026-11-05", json(snap));
  const late = await patchOutcome(id, { outcome: "rejected", date: "2026-11-09", source: "sweep" });
  check("a sweep reporting an ending on a closed row changes nothing", late.ignored === "closed" && (await read(id)).pending_outcome?.date === "2026-11-05", json(late).slice(0, 160));

  // That PATCH was the next change, so close again for a live snapshot.
  await put(id, { status: "screening", confirmed_reopen: true });
  await put(id, { followup_date: "2026-11-20" });
  await patchOutcome(id, { outcome: "rejected", date: "2026-11-06", source: "gmail" });
  await put(id, { status: "rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "this time it was the visa" });

  // ── Undo, from the snapshot ──────────────────────────────────────────────
  const undoRes = await put(id, { undo_close: true });
  const undoBody = await undoRes.json();
  row = await read(id);
  check("Undo restores the status and clears closed_at", undoRes.status === 200 && row.status === "Screening" && !row.closed_at && !row.close_reason, `${undoRes.status} ${json(row).slice(0, 220)}`);
  check("and the outcome it took", row.pending_outcome?.date === "2026-11-06" && !row.pending_outcome?.dismissed, json(row.pending_outcome));
  check("and the lesson it had", row.lesson === "asked for 3+ years", row.lesson);
  check("and the follow-up", row.followup_date === "2026-11-20", row.followup_date);
  check("and the notes, with the cleared line gone", !/cleared when marked/.test((await stored(id, "notes")).notes ?? ""), (await stored(id, "notes")).notes);
  check("it answers what it restored", undoBody.restored?.status === "Screening", json(undoBody.restored).slice(0, 180));
  check("the history is not edited", row.stages_reached.includes("rejected") && row.stages_reached.includes("screening"), row.stages_reached.join());
  check("the snapshot is gone", (await stored(id, "undo_snapshot")).undo_snapshot === null);
  const twice = await put(id, { undo_close: true });
  check("Undo works once", twice.status === 409 && (await twice.json()).errorType === "undo_expired");

  // Expired by time.
  const old = await add("Screening", "Old undo");
  await put(old, { status: "Rejected", confirmed_by_user: true });
  const oldSnap = (await stored(old, "undo_snapshot")).undo_snapshot;
  await fetch(`${SB}/rest/v1/applications?id=eq.${old}`, { method: "PATCH", headers: { ...admin, Prefer: "return=minimal" }, body: json({ undo_snapshot: { ...oldSnap, at: new Date(Date.now() - 60000).toISOString() } }) });
  const expired = await put(old, { undo_close: true });
  check("past its time, Undo is refused", expired.status === 409 && (await expired.json()).errorType === "undo_expired");
  check("and the row stays closed", (await read(old)).status === "Rejected");

  // Cleared by the next change, whoever makes it.
  const nextChange = await add("Screening", "Next change");
  await put(nextChange, { status: "Rejected", confirmed_by_user: true });
  check("a snapshot is there", !!(await stored(nextChange, "undo_snapshot")).undo_snapshot);
  await put(nextChange, { lesson: "wanted 3+ yrs" });
  check("the next change clears it", (await stored(nextChange, "undo_snapshot")).undo_snapshot === null);
  check("so Undo no longer applies", (await put(nextChange, { undo_close: true })).status === 409);
  check("a lesson edits alone", (await read(nextChange)).lesson === "wanted 3+ yrs" && (await read(nextChange)).status === "Rejected");

  // Replacing a close, and undoing that.
  const replace = await add("Screening", "Replace");
  await put(replace, { status: "Rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected", lesson: "first" });
  check("another ending needs the word too", (await put(replace, { status: "Ghosted" })).status === 409);
  await put(replace, { status: "Withdrawn", confirmed_by_user: true, closed_at: "2026-11-03T12:00:00.000Z", close_reason: "role_closed", lesson: "second" });
  const undoReplace = await put(replace, { undo_close: true });
  row = await read(replace);
  check("Undo restores the earlier close", undoReplace.status === 200 && row.status === "Rejected" && row.closed_at?.startsWith("2026-11-02") && row.close_reason === "rejected" && row.lesson === "first", json(row).slice(0, 220));

  // What's next closes without having read the lesson: an absent one must not wipe it.
  const kept = await add("Screening", "Kept lesson");
  await put(kept, { lesson: "keep this" });
  await put(kept, { status: "Rejected", confirmed_by_user: true });
  check("a close that sends no lesson keeps the stored one", (await read(kept)).lesson === "keep this");
  check("a same-status write can't wipe a close", (await put(kept, { status: "Rejected", closed_at: null, close_reason: null })).status === 409 && !!(await read(kept)).closed_at);
  check("a sweep's write of the same status moves nothing and lands", (await put(kept, { status: "Rejected", notes: "Sweep note" })).status === 200 && (await stored(kept, "notes")).notes === "Sweep note");
  const first = await patchOutcome(kept, { outcome: "rejected", date: "2026-11-09", source: "sweep" });
  check("a first report on a closed row is remembered as answered", first.ignored === "closed" && (await read(kept)).pending_outcome?.dismissed === true, json(first).slice(0, 160));

  // ── An open status on a closed row asks instead ──────────────────────────
  const closedRow = await add("Screening", "Closed row");
  await put(closedRow, { notes: "Mine" });
  await put(closedRow, { status: "Rejected", confirmed_by_user: true, closed_at: "2026-11-02T12:00:00.000Z", close_reason: "rejected" });
  const notesBefore = (await stored(closedRow, "notes")).notes;
  const asked = await put(closedRow, { status: "Interview", notes: "Mine\nInvite for 12 Nov 14:00", job_description: "Sweep JD" });
  const askedBody = await asked.json();
  row = await read(closedRow);
  check("a sweep's open status answers 202", asked.status === 202, String(asked.status));
  check("and doesn't reopen it", row.status === "Rejected" && row.closed_at?.startsWith("2026-11-02") && !row.stages_reached.includes("interview"), json(row).slice(0, 200));
  check("nothing else in that write lands: it may be the wrong row", (await stored(closedRow, "notes")).notes === notesBefore && !(await stored(closedRow, "job_description")).job_description);
  check("it records the question", row.pending_outcome?.outcome === "reopen" && row.pending_outcome?.status === "interview" && row.pending_outcome?.source === "sweep", json(row.pending_outcome));
  check("with what the report added, for the user to judge the match by", row.pending_outcome?.note === "Invite for 12 Nov 14:00", row.pending_outcome?.note);
  check("and says so, in words and in a field", /nothing was written/.test(askedBody.message ?? "") && askedBody.applied === false, askedBody.message);
  check("the close's memory stays behind the question", row.pending_outcome?.earlier === undefined || row.pending_outcome.earlier.dismissed === true, json(row.pending_outcome?.earlier));
  await patchOutcome(closedRow, { dismiss: true });
  const askedAgain = await (await put(closedRow, { status: "Interview" })).json();
  check("Not true holds against the same report", askedAgain.ignored === "dismissed" && (await read(closedRow)).pending_outcome?.dismissed === true, json(askedAgain).slice(0, 180));
  const lower = await (await put(closedRow, { status: "Screening" })).json();
  check("a lower stage stays quiet", lower.ignored === "dismissed" && /already said/.test(lower.message ?? ""), json(lower).slice(0, 180));
  const further = await (await put(closedRow, { status: "Offer" })).json();
  check("a stage further on asks again", !further.ignored && (await read(closedRow)).pending_outcome?.status === "offer" && !(await read(closedRow)).pending_outcome?.dismissed);
  const planted = await patchOutcome(closedRow, { outcome: "reopen", date: "2026-11-06", source: "gmail", status: "offer", dismissed: true, earlier: { outcome: "rejected", date: "2026-01-01", source: "x" } });
  check("a report can't plant a dismissal or a memory", !planted.pending_outcome?.dismissed && planted.pending_outcome?.earlier?.date !== "2026-01-01", json(planted).slice(0, 200));
  const viaRoute = await patchOutcome(closedRow, { outcome: "reopen", date: "2026-11-07", source: "gmail", status: "offer", note: "Second round invite" });
  check("the outcome route can ask too", viaRoute.pending_outcome?.outcome === "reopen" && viaRoute.pending_outcome?.source === "gmail" && (await read(closedRow)).status === "Rejected", json(viaRoute).slice(0, 180));
  const reopened = await put(closedRow, { status: "interview", closed_at: null, close_reason: null, confirmed_reopen: true });
  const reopenedBody = await reopened.json();
  row = await read(closedRow);
  check("on the user's word it reopens", reopened.status === 200 && row.status === "Interview" && !row.closed_at && !row.close_reason, json(row).slice(0, 200));
  check("the question is answered", !row.pending_outcome || row.pending_outcome.outcome !== "reopen", json(row.pending_outcome));
  check("the row takes the report's words", (await stored(closedRow, "notes")).notes === "Mine\nSecond round invite" && reopenedBody.reportNotes === "Mine\nSecond round invite", (await stored(closedRow, "notes")).notes);
  check("after a Reopen it is guarded again", (await put(closedRow, { status: "Rejected" })).status === 409);

  // The close's memory, through a question and its answer.
  const memory = await add("Screening", "Memory");
  await patchOutcome(memory, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  await put(memory, { status: "Rejected", confirmed_by_user: true });
  await put(memory, { status: "Interview" });
  check("a question keeps the close's memory", (await read(memory)).pending_outcome?.earlier?.date === "2026-11-02", json((await read(memory)).pending_outcome));
  await put(memory, { status: "interview", closed_at: null, close_reason: null, confirmed_reopen: true });
  check("the answer restores it", (await read(memory)).pending_outcome?.outcome === "rejected" && (await read(memory)).pending_outcome?.dismissed === true, json((await read(memory)).pending_outcome));
  const sameEmail = await patchOutcome(memory, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  check("so the same email after a Reopen raises no banner", sameEmail.ignored === "dismissed" && (await read(memory)).pending_outcome?.dismissed === true, json(sameEmail).slice(0, 180));

  // A row below screening has nothing to move back from.
  const submit = await add("Screening", "Submit");
  await put(submit, { status: "Ready to submit", confirmed_move_back: true });
  check("Submit on a row moved back to unsent saves", (await put(submit, { status: "Applied" })).status === 200 && (await read(submit)).status === "Applied");
  check("Ready to submit from there still needs the user", (await put(submit, { status: "Ready to submit" })).status === 409 && (await read(submit)).status === "Applied");

  // Notes too full to take the report's words: nothing is cut, and the user is told.
  const full = await add("Screening", "Full");
  await put(full, { notes: "x".repeat(9995) });
  await put(full, { status: "Rejected", confirmed_by_user: true });
  await patchOutcome(full, { outcome: "reopen", date: "2026-11-05", source: "gmail", status: "interview", note: "Invite for 12 Nov" });
  const fullBody = await (await put(full, { status: "interview", closed_at: null, close_reason: null, confirmed_reopen: true })).json();
  check("full notes: the Reopen saves and says what it left out", /notes are full.*Invite for 12 Nov/.test(fullBody.warning ?? "") && (await read(full)).status === "Interview", json(fullBody).slice(0, 200));
  check("and never cuts them", (await stored(full, "notes")).notes.length === 9995);

  // ── A sweep stepping a live row back asks too ────────────────────────────
  const live = await add("Interview", "Step back");
  await put(live, { notes: "Mine" });
  const back = await put(live, { status: "Screening", notes: "Mine\nRecruiter call booked" });
  const backBody = await back.json();
  row = await read(live);
  check("a step back answers 202", back.status === 202 && backBody.applied === false && /needs the user's word/.test(backBody.message ?? ""), json(backBody).slice(0, 200));
  check("the row stays where it stands, notes included", row.status === "Interview" && (await stored(live, "notes")).notes === "Mine", row.status);
  check("the question quotes the report", row.pending_outcome?.outcome === "move_back" && row.pending_outcome?.status === "screening" && row.pending_outcome?.note === "Recruiter call booked", json(row.pending_outcome));
  check("a sweep rewriting the same status still lands, and the question stands", (await put(live, { status: "Interview", notes: "Mine\nSweep line" })).status === 200 && (await read(live)).pending_outcome?.outcome === "move_back");
  await patchOutcome(live, { dismiss: true });
  check("Not true holds against the next run", (await (await put(live, { status: "Screening" })).json()).ignored === "dismissed" && (await read(live)).status === "Interview");
  const offerRow = await add("Offer", "Further back");
  const askOffer = await patchOutcome(offerRow, { outcome: "move_back", date: "2026-11-05", source: "gmail", status: "interview", note: "Second round" });
  check("the outcome route can ask too", askOffer.pending_outcome?.outcome === "move_back" && (await read(offerRow)).status === "Offer", json(askOffer).slice(0, 180));
  check("but only for a real step back", (await patchOutcome(live, { outcome: "move_back", date: "2026-11-05", source: "gmail", status: "offer" })).ignored === "not_a_step_back");
  const yes = await put(offerRow, { status: "interview", pending_outcome: null, confirmed_move_back: true });
  row = await read(offerRow);
  check("the user's word moves it and answers the question", yes.status === 200 && row.status === "Interview" && !row.pending_outcome, json(row).slice(0, 200));
  check("the row takes those words", (await stored(offerRow, "notes")).notes === "Second round");
  check("the history keeps the offer", row.stages_reached.includes("offer"), row.stages_reached.join());
  const waiting = await add("Interview", "Rejection waiting");
  await patchOutcome(waiting, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  const heldBack = await (await put(waiting, { status: "Screening" })).json();
  check("a rejection still waiting isn't pushed out by a question", heldBack.ignored === "pending" && (await read(waiting)).pending_outcome?.outcome === "rejected", json(heldBack).slice(0, 180));

  // A banner on a stale page answers what it was showing, not what has replaced it.
  const stale = await add("Interview", "Stale banner");
  await put(stale, { status: "Screening" });
  await patchOutcome(stale, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  const notTrue = await patchOutcome(stale, { dismiss: true, outcome: "move_back", date: "2026-11-05" });
  row = await read(stale);
  check("Not true on a replaced question dismisses nothing", notTrue.ignored === "changed" && row.pending_outcome?.outcome === "rejected" && !row.pending_outcome?.dismissed, json(row.pending_outcome));
  const moveAnyway = await put(stale, { status: "Screening", pending_outcome: null, confirmed_move_back: true });
  row = await read(stale);
  check("Move back on one moves the row and leaves the rejection", moveAnyway.status === 200 && row.status === "Screening" && row.pending_outcome?.outcome === "rejected" && !row.pending_outcome?.dismissed, json(row).slice(0, 220));
  const noted = await add("Interview", "Question then close");
  await put(noted, { status: "Screening" });
  await put(noted, { status: "Rejected", confirmed_by_user: true });
  await patchOutcome(noted, { outcome: "rejected", date: "2026-11-02", source: "gmail" });
  check("a report on a closed row is remembered behind a question", (await read(noted)).pending_outcome?.earlier?.date === "2026-11-02", json((await read(noted)).pending_outcome));

  // ── Remove a stage picked by mistake ─────────────────────────────────────
  const removeUrl = (rowId) => `/api/applications/${rowId}/remove-stage`;
  const remove = (rowId, body, user = a, headers = { "sec-fetch-site": "same-origin" }) => user.call(removeUrl(rowId), { method: "POST", headers, body: json(body) });
  const picked = await add("Interview", "Mis-pick");
  await put(picked, { status: "Screening", confirmed_move_back: true });
  check("a sweep's API call is refused", (await remove(picked, { stage: "interview", confirmed_by_user: true }, a, {})).status === 403);
  check("a page from elsewhere is refused", (await remove(picked, { stage: "interview", confirmed_by_user: true }, a, { "sec-fetch-site": "cross-site" })).status === 403);
  check("signed out, refused", (await fetch(BASE + removeUrl(picked), { method: "POST", headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" }, body: json({ stage: "interview", confirmed_by_user: true }) })).status === 401);
  check("it needs the user's confirmation", (await remove(picked, { stage: "interview" })).status === 409);
  check('the string "true" is not confirmation', (await remove(picked, { stage: "interview", confirmed_by_user: "true" })).status === 409);
  check("not where it stands now", (await remove(picked, { stage: "screening", confirmed_by_user: true })).status === 409);
  check("not a stage it never reached", (await remove(picked, { stage: "offer", confirmed_by_user: true })).status === 409);
  check("not one that isn't a counted stage", (await remove(picked, { stage: "applied", confirmed_by_user: true })).status === 409);
  check("another user can't", (await remove(picked, { stage: "interview", confirmed_by_user: true }, b)).status === 404);
  check("a PUT can't shrink it", (await put(picked, { stages_reached: ["applied"] })).status < 500 && (await read(picked)).stages_reached.includes("interview"));
  const planCount = async () => (await (await a.call("/api/plan")).json()).funnel?.nodes?.find((n) => n.key === "interview")?.count;
  const countBefore = await planCount();
  const removed = await remove(picked, { stage: "interview", confirmed_by_user: true });
  if (removed.status === 503) {
    console.log("SKIP removing a stage on the real database: migration 20261105130000 is not applied yet");
    check("until then it says which file", /20261105130000/.test((await removed.json()).error ?? ""));
    check("and the row is untouched", (await read(picked)).stages_reached.includes("interview"));
  } else {
    const removedBody = await removed.json();
    row = await read(picked);
    const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
    check("on the user's word it goes", removed.status === 200 && !row.stages_reached.includes("interview") && removedBody.stages_reached.join() === row.stages_reached.join(), json(removedBody).slice(0, 200));
    check("only that stage", row.stages_reached.join() === "screening", row.stages_reached.join());
    check("with the dated note, in the owner's words", (await stored(picked, "notes")).notes === `Removed 'interview' on ${day} — picked by mistake`, (await stored(picked, "notes")).notes);
    check("where it stands is unchanged", row.status === "Screening");
    check("it comes off the count", typeof countBefore === "number" && (await planCount()) === countBefore - 1, `${countBefore} then ${await planCount()}`);
    check("once only", (await remove(picked, { stage: "interview", confirmed_by_user: true })).status === 409);
    const direct = await fetch(`${SB}/rest/v1/applications?id=eq.${hist}`, { method: "PATCH", headers: { apikey: PUB, Authorization: `Bearer ${a.token}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: json({ stages_reached: [] }) });
    check("a direct write still can't shrink a list", direct.ok && (await read(hist)).stages_reached.includes("interview"), (await read(hist)).stages_reached.join());
    const fullNotes = await add("Interview", "Full notes");
    await put(fullNotes, { status: "Screening", confirmed_move_back: true, notes: "x".repeat(9990) });
    const tooFull = await remove(fullNotes, { stage: "interview", confirmed_by_user: true });
    check("notes too full for the line: the stage stays", tooFull.status === 409 && (await tooFull.json()).errorType === "notes_full" && (await read(fullNotes)).stages_reached.includes("interview"));
    const snapshotRow = await add("Screening", "Snapshot");
    await put(snapshotRow, { status: "Interview" });
    await put(snapshotRow, { status: "Rejected", confirmed_by_user: true });
    await remove(snapshotRow, { stage: "interview", confirmed_by_user: true });
    check("it counts as the next change: Undo no longer applies", (await put(snapshotRow, { undo_close: true })).status === 409);
  }

  // ── One user's rows are their own ────────────────────────────────────────
  const other = await b.call(pendingUrl(id), { method: "PATCH", body: json({ outcome: "rejected", date: "2026-11-02", source: "gmail" }) });
  check("another user can't record on this row", other.status === 404, String(other.status));
  const otherUser = (body) => b.call("/api/applications", { method: "PUT", body: json({ id, ...body }) });
  check("another user can't close it", (await otherUser({ status: "Rejected", confirmed_by_user: true })).status === 404);
  check("another user can't undo on it", (await otherUser({ undo_close: true })).status === 404);
  check("signed out, the route refuses", (await fetch(BASE + pendingUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json({ dismiss: true }) })).status === 401);
  check("a malformed id is not found", (await a.call(pendingUrl("not-a-uuid"), { method: "PATCH", body: json({ dismiss: true }) })).status === 404);
} catch (err) {
  check("ran to the end", false, err.message);
} finally {
  const removed = await Promise.all([a, b].map((u) => fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin })));
  console.log(`\n${pass} passed, ${fail} failed; throwaway users removed: ${removed.every((r) => r.ok)}`);
  process.exit(fail ? 1 : 0);
}
