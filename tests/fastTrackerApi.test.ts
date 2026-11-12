// Chunk 22 (12 Nov 2026): the lite list's filters, the list cursor across undated rows,
// Idempotency-Key's state machine on an in-memory store, the duplicate-line rule, the
// date applied rule and "Logged by". The routes' own behaviour on the real database is
// scripts/smoke-fast-tracker.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LITE_LIMIT_DEFAULT, LITE_LIMIT_MAX, afterCursor, decodeCursor, encodeCursor, liteSearchFilter, minuteOf, readLiteQuery, storedInList, toLiteRow,
} from "../src/lib/applicationRows.ts";
import {
  IN_PROGRESS_STALE_MS, IDEMPOTENCY_TTL_MS, canonicalJsonBody, classifyRecord, fingerprint, readIdempotencyKey, runIdempotent,
  type IdempotencyRecord, type IdempotencyStore, type StoredResponse,
} from "../src/lib/idempotency.ts";
import { isRecentDuplicate, sameVersion, stampNoteLine } from "../src/lib/notesWrite.ts";
import { DATE_REQUIRED, followupTooEarly, loggedByBadge, readLoggedBy, resolveSentDate, validateEditable } from "../src/lib/applicationFields.ts";

const q = (s: string) => readLiteQuery(new URLSearchParams(s));

// ── The lite list ──────────────────────────────────────────────────────────

test("lite: no filters is the newest 200", () => {
  assert.deepEqual(q("lite=1"), { query: { q: null, since: null, statuses: null, dueBy: null, limit: LITE_LIMIT_DEFAULT } });
});

test("lite: every filter is read and checked", () => {
  assert.deepEqual(q("lite=1&q=%20elwood%20%20labs&since=2026-11-01&status=Applied,%20screening,Ready%20to%20submit&due_by=2026-11-14&limit=50"), {
    query: { q: "elwood labs", since: "2026-11-01", statuses: ["applied", "screening", "saved"], dueBy: "2026-11-14", limit: 50 },
  });
  assert.equal((q("limit=99999") as { query: { limit: number } }).query.limit, LITE_LIMIT_MAX);
  for (const bad of ["since=2026-02-30", "since=yesterday", "due_by=14/11/2026", "status=Applied,Hired", "limit=0", "limit=1.5", `q=${"x".repeat(101)}`]) {
    assert.ok("error" in q(bad), bad);
  }
});

test("lite: the search is a quoted, escaped ilike on company or role", () => {
  assert.equal(liteSearchFilter("elwood"), 'company_name.ilike."*elwood*",role.ilike."*elwood*"');
  // LIKE's own wildcards are literal; PostgREST's quote and backslash are escaped.
  assert.equal(liteSearchFilter('50%_Off "Labs"'), 'company_name.ilike."*50\\\\%\\\\_Off \\"Labs\\"*",role.ilike."*50\\\\%\\\\_Off \\"Labs\\"*"');
  assert.equal(liteSearchFilter("Smith, Jones (UK)"), 'company_name.ilike."*Smith, Jones (UK)*",role.ilike."*Smith, Jones (UK)*"');
});

test("lite: due_by leaves closed rows out in every stored spelling (Ghosted never had an old one)", () => {
  assert.equal(storedInList(["rejected", "withdrawn", "ghosted"]), '("rejected","Rejected","withdrawn","Withdrawn","ghosted")');
});

test("lite: a row carries seven fields and never a version", () => {
  const updatedAt = "2026-11-12T14:05:33.123456+00:00";
  const row = toLiteRow({ id: "r1", company_name: "Elwood", role: "Engineer", status: "saved", date_applied: null, followup_date: null, updated_at: updatedAt, notes: "secret" });
  assert.deepEqual(row, { id: "r1", company_name: "Elwood", role: "Engineer", status: "Ready to submit", date_applied: null, followup_date: null, updated_at_minute: "2026-11-12T14:05:00Z" });
  assert.equal(sameVersion(updatedAt, row.updated_at_minute as string), false, "the minute is not accepted as if_updated_at");
  assert.equal(minuteOf("nonsense"), null);
});

// ── The list cursor across undated rows ───────────────────────────────────

test("cursor: an undated row's position round-trips and continues into the dated rows", () => {
  const row = { date_applied: null, created_at: "2026-11-12T09:00:00.5+00:00", id: "aaaaaaaa-0000-4000-8000-000000000001" };
  const text = encodeCursor(row);
  assert.equal(text, "|2026-11-12T09:00:00.5+00:00|aaaaaaaa-0000-4000-8000-000000000001");
  const c = decodeCursor(text as string);
  assert.deepEqual(c, { d: "", c: row.created_at, i: row.id });
  assert.equal(
    afterCursor(c!),
    'and(date_applied.is.null,created_at.lt."2026-11-12T09:00:00.5+00:00"),and(date_applied.is.null,created_at.eq."2026-11-12T09:00:00.5+00:00",id.gt.aaaaaaaa-0000-4000-8000-000000000001),date_applied.not.is.null'
  );
  // A dated cursor is unchanged.
  const dated = decodeCursor("2026-11-01|2026-11-01T10:00:00Z|aaaaaaaa-0000-4000-8000-000000000001")!;
  assert.equal(afterCursor(dated).startsWith('date_applied.lt."2026-11-01"'), true);
  assert.equal(decodeCursor("not-a-date|2026-11-01T10:00:00Z|aaaaaaaa-0000-4000-8000-000000000001"), null);
});

// ── Idempotency-Key ────────────────────────────────────────────────────────

function memoryStore(opts: { missing?: boolean } = {}) {
  const rows = new Map<string, IdempotencyRecord & { method: string; path: string }>();
  let clock = Date.parse("2026-11-12T08:00:00Z");
  const store: IdempotencyStore = {
    async claim(key, hash, method, path) {
      if (opts.missing) return "missing";
      if (rows.has(key)) return "taken";
      rows.set(key, { request_hash: hash, status_code: null, response: null, created_at: new Date(clock).toISOString(), method, path });
      return "claimed";
    },
    async read(key) {
      return rows.get(key) ?? null;
    },
    async retake(key, seen, hash, method, path) {
      const r = rows.get(key);
      if (!r || r.created_at !== seen) return false;
      rows.set(key, { request_hash: hash, status_code: null, response: null, created_at: new Date(clock).toISOString(), method, path });
      return true;
    },
    async finish(key, hash, response) {
      const r = rows.get(key);
      if (r && r.request_hash === hash) rows.set(key, { ...r, status_code: response.status, response: response.body });
    },
    async release(key, hash) {
      const r = rows.get(key);
      if (r && r.request_hash === hash && r.status_code === null) rows.delete(key);
    },
  };
  return { store, rows, advance: (ms: number) => (clock += ms), now: () => clock };
}

const asStored = async (r: StoredResponse) => r;

test("idempotency: the same key runs the write once and replays its answer", async () => {
  const m = memoryStore();
  let writes = 0;
  const run = async () => ({ status: 200, body: { ok: true, id: `row-${++writes}` } });
  const opts = { key: "k1", hash: fingerprint({ method: "POST", path: "/api/applications", body: canonicalJsonBody('{"role":"Engineer","company_name":"Sage"}') }), method: "POST", path: "/api/applications", store: m.store, now: m.now };
  const first = await runIdempotent(opts, run, asStored);
  const second = await runIdempotent(opts, run, asStored);
  assert.equal(writes, 1);
  assert.deepEqual(first, { kind: "ran", value: { status: 200, body: { ok: true, id: "row-1" } }, stored: true });
  assert.deepEqual(second, { kind: "replayed", response: { status: 200, body: { ok: true, id: "row-1" } } });
});

test("idempotency: the body is compared whatever its key order; other work under the key is refused", async () => {
  const fp = (body: string) => fingerprint({ method: "PUT", path: "/api/applications", body: canonicalJsonBody(body) });
  assert.equal(fp('{"id":"x","append_note":"A"}'), fp('{ "append_note": "A", "id": "x" }'));
  const m = memoryStore();
  await runIdempotent({ key: "k", hash: fp('{"id":"x","append_note":"A"}'), method: "PUT", path: "/api/applications", store: m.store, now: m.now }, async () => ({ status: 200, body: {} }), asStored);
  let ran = false;
  const other = await runIdempotent({ key: "k", hash: fp('{"id":"x","append_note":"B"}'), method: "PUT", path: "/api/applications", store: m.store, now: m.now }, async () => ((ran = true), { status: 200, body: {} }), asStored);
  assert.deepEqual(other, { kind: "reused" });
  assert.equal(ran, false);
});

test("idempotency: a key whose first request still runs answers in progress; a dead one is taken again", async () => {
  const m = memoryStore();
  await m.store.claim("k", "h".repeat(64), "POST", "/p");
  let ran = 0;
  const opts = { key: "k", hash: "h".repeat(64), method: "POST", path: "/p", store: m.store, now: m.now };
  assert.deepEqual(await runIdempotent(opts, async () => ({ status: 200, body: { n: ++ran } }), asStored), { kind: "in_progress" });
  m.advance(IN_PROGRESS_STALE_MS);
  const retaken = await runIdempotent(opts, async () => ({ status: 200, body: { n: ++ran } }), asStored);
  assert.equal(retaken.kind, "ran");
  assert.equal(ran, 1);
});

test("idempotency: a failure is not kept, so a retry runs again; a 4xx is kept", async () => {
  const m = memoryStore();
  const opts = { key: "k", hash: "1".repeat(64), method: "POST", path: "/p", store: m.store, now: m.now };
  const failed = await runIdempotent(opts, async () => ({ status: 500, body: { error: "x" } }), asStored);
  assert.deepEqual(failed, { kind: "ran", value: { status: 500, body: { error: "x" } }, stored: false });
  assert.equal(m.rows.has("k"), false);
  await assert.rejects(runIdempotent(opts, async () => { throw new Error("boom"); }, asStored));
  assert.equal(m.rows.has("k"), false, "a thrown error releases the claim");
  await runIdempotent(opts, async () => ({ status: 409, body: { error: "duplicate" } }), asStored);
  assert.deepEqual(await runIdempotent(opts, async () => ({ status: 200, body: {} }), asStored), { kind: "replayed", response: { status: 409, body: { error: "duplicate" } } });
});

test("idempotency: a key is free again after a day; no table runs the request unprotected", async () => {
  const m = memoryStore();
  const opts = { key: "k", hash: "2".repeat(64), method: "POST", path: "/p", store: m.store, now: m.now };
  await runIdempotent(opts, async () => ({ status: 200, body: { day: 1 } }), asStored);
  m.advance(IDEMPOTENCY_TTL_MS);
  const later = await runIdempotent({ ...opts, hash: "3".repeat(64) }, async () => ({ status: 200, body: { day: 2 } }), asStored);
  assert.deepEqual(later, { kind: "ran", value: { status: 200, body: { day: 2 } }, stored: true });
  const none = memoryStore({ missing: true });
  let runs = 0;
  const out = await runIdempotent({ ...opts, store: none.store, now: none.now }, async () => ({ status: 200, body: { n: ++runs } }), asStored);
  assert.deepEqual(out, { kind: "unavailable", value: { status: 200, body: { n: 1 } } });
});

test("idempotency: the header is a short visible token", () => {
  assert.deepEqual(readIdempotencyKey(null), { none: true });
  assert.deepEqual(readIdempotencyKey(" 7f9c2a1e-0b6d-4c1e-9d3a-2f1e0c9b8a76 "), { key: "7f9c2a1e-0b6d-4c1e-9d3a-2f1e0c9b8a76" });
  for (const bad of ["", "has space", "x".repeat(256), "naïve"]) assert.ok("error" in readIdempotencyKey(bad), bad);
  const rec = (over: Partial<IdempotencyRecord>): IdempotencyRecord => ({ request_hash: "h", status_code: 200, response: {}, created_at: "2026-11-12T08:00:00Z", ...over });
  const now = Date.parse("2026-11-12T08:00:30Z");
  assert.equal(classifyRecord(rec({}), "h", now), "replay");
  assert.equal(classifyRecord(rec({ request_hash: "other" }), "h", now), "reused");
  assert.equal(classifyRecord(rec({ status_code: null }), "h", now), "in_progress");
  assert.equal(classifyRecord(rec({ created_at: "2026-11-11T08:00:00Z", request_hash: "other" }), "h", now), "expired");
});

// ── The same line twice ─────────────────────────────────────────────────────

test("a line appended again inside ten minutes is a repeat, anywhere in the notes", () => {
  const t0 = Date.parse("2026-11-11T08:00:00Z");
  const notes = [stampNoteLine("Screening call booked", t0 + 120_000), stampNoteLine("T+7 follow-up sent", t0), "Applied 4 Nov."].join("\n");
  assert.equal(isRecentDuplicate(notes, "T+7 follow-up sent", t0 + 9 * 60_000), true);
  assert.equal(isRecentDuplicate(notes, "T+7 follow-up sent", t0 + 11 * 60_000), false);
  assert.equal(isRecentDuplicate(notes, "T+14 follow-up sent", t0 + 60_000), false);
  assert.equal(isRecentDuplicate(null, "anything", t0), false);
});

// ── The date applied ───────────────────────────────────────────────────────

test("a Ready to submit row may be created without a date; a sent one may not", () => {
  const saved = validateEditable({ company_name: "Sage", role: "Graduate Engineer", status: "Ready to submit" }, false);
  assert.ok("fields" in saved && saved.fields.date_applied === null && saved.fields.status === "saved");
  for (const status of [undefined, "Applied", "screening"]) {
    assert.deepEqual(validateEditable({ company_name: "Sage", role: "Engineer", ...(status ? { status } : {}) }, false), { error: DATE_REQUIRED }, String(status));
  }
  assert.ok("error" in validateEditable({ company_name: "Sage", role: "Engineer", status: "saved", date_applied: "12/11/2026" }, false));
  const cleared = validateEditable({ date_applied: "" }, true);
  assert.ok("fields" in cleared && cleared.fields.date_applied === null);
  assert.equal(followupTooEarly(null, "2026-11-20"), false);
  assert.equal(followupTooEarly("2026-11-21", "2026-11-20"), true);
});

test("moving a dateless row on dates it today; clearing a sent row's date is refused", () => {
  const today = "2026-11-12";
  assert.deepEqual(resolveSentDate({ status: "Applied", stored: null, patch: undefined, today }), { ok: true, set: today });
  assert.deepEqual(resolveSentDate({ status: "interview", stored: null, patch: undefined, today }), { ok: true, set: today });
  assert.deepEqual(resolveSentDate({ status: "applied", stored: "2026-11-01", patch: undefined, today }), { ok: true });
  assert.deepEqual(resolveSentDate({ status: "applied", stored: null, patch: "2026-11-10", today }), { ok: true });
  assert.deepEqual(resolveSentDate({ status: "Ready to submit", stored: "2026-11-01", patch: null, today }), { ok: true });
  assert.deepEqual(resolveSentDate({ status: "applied", stored: "2026-11-01", patch: null, today }), { error: DATE_REQUIRED });
});

// ── Logged by ──────────────────────────────────────────────────────────────

test("logged_by: you, or a short name an automation gives itself", () => {
  assert.deepEqual(readLoggedBy(undefined), { loggedBy: null });
  assert.deepEqual(readLoggedBy("  Claude   sweep "), { loggedBy: "Claude sweep" });
  assert.deepEqual(readLoggedBy("Me"), { loggedBy: "you" });
  for (const bad of [42, "<script>", "x".repeat(41), "-dash first"]) assert.ok("error" in readLoggedBy(bad), String(bad));
  assert.equal(loggedByBadge("Claude sweep"), "Logged by Claude sweep");
  assert.equal(loggedByBadge("you"), null, "the user's own rows carry no badge");
  assert.equal(loggedByBadge(undefined), null);
  assert.equal(loggedByBadge("<b>x</b>"), null, "a stored value is re-checked before it is shown");
});
