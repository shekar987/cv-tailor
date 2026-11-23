// Offset paging, the list filters and the note cap (Chunk JH-3, 22 Nov 2026).
// The pure helpers behind GET /api/applications?limit=&offset= and the one
// write normaliser; the routes themselves are exercised on a seeded throwaway
// account by scripts/smoke-tracker-paging.mjs (paging + RLS) and
// scripts/smoke-sweep-contract.mjs (the write normalisation on a real database).
import test from "node:test";
import assert from "node:assert/strict";
import {
  LIST_FILTER_MAX,
  PAGING_LIMIT_DEFAULT,
  PAGING_LIMIT_MAX,
  likePattern,
  nextAfterFull,
  nextOffset,
  readListFilters,
  readPagingQuery,
  storedValuesFor,
} from "../src/lib/applicationRows.ts";
import { MAX_APPENDED_NOTE, cleanNoteLine } from "../src/lib/notesWrite.ts";
import { normaliseStatus, normalizeStatus } from "../src/lib/tracker.ts";
import { validateEditable } from "../src/lib/applicationFields.ts";

const q = (s: string) => readPagingQuery(new URLSearchParams(s));
const asQuery = (r: ReturnType<typeof readPagingQuery>) => {
  assert.ok("query" in r, JSON.stringify(r));
  return r.query;
};

// ── readPagingQuery: limit / offset ──────────────────────────────────────────

test("a bare GET is not paged, and defaults to limit 200, offset 0", () => {
  const query = asQuery(q(""));
  assert.equal(query.paged, false);
  assert.equal(query.limit, PAGING_LIMIT_DEFAULT);
  assert.equal(query.limit, 200);
  assert.equal(query.offset, 0);
});

test("a limit or an offset makes it a page; the default limit is 200", () => {
  assert.equal(asQuery(q("offset=0")).paged, true);
  assert.equal(asQuery(q("offset=0")).limit, 200);
  assert.equal(asQuery(q("limit=50")).paged, true);
  assert.equal(asQuery(q("limit=50")).limit, 50);
  assert.equal(asQuery(q("offset=400")).offset, 400);
});

test("limit is capped at 1000; limit=5000 clamps, limit=1000 is kept", () => {
  assert.equal(PAGING_LIMIT_MAX, 1000);
  assert.equal(asQuery(q("limit=5000")).limit, 1000);
  assert.equal(asQuery(q("limit=1000")).limit, 1000);
  assert.equal(asQuery(q("limit=1")).limit, 1);
});

test("a bad limit or offset is an error, not a silent default", () => {
  for (const bad of ["limit=0", "limit=-1", "limit=1.5", "limit=abc", "offset=-1", "offset=1.5", "offset=x"]) {
    assert.ok("error" in q(bad), bad);
  }
});

// ── The three-page scenario the chunk names: 450 rows, 200 / 200 / 50 ─────────

test("450 rows paginate 200 / 200 / 50 with the right next offsets", () => {
  const total = 450;
  const limit = 200;
  // next points at the next offset until the last page, which is null.
  assert.equal(nextOffset(0, limit, total), 200);
  assert.equal(nextOffset(200, limit, total), 400);
  assert.equal(nextOffset(400, limit, total), null);
  // The DB returns the slice; the sizes a caller would see walking the offsets.
  const pageSize = (offset: number) => Math.max(0, Math.min(limit, total - offset));
  assert.deepEqual([pageSize(0), pageSize(200), pageSize(400)], [200, 200, 50]);
});

test("limit=1000 returns everything in one page when total <= 1000", () => {
  assert.equal(nextOffset(0, 1000, 450), null, "no next: all 450 fit in one 1000 page");
  assert.equal(nextOffset(0, 1000, 1500), 1000, "a next when there are more");
});

test("nextAfterFull: the whole list has no next until it hits the cap", () => {
  assert.equal(nextAfterFull(1557, 1557), null, "every row returned");
  assert.equal(nextAfterFull(2000, 2500), 2000, "capped at 2000, 500 still to page");
});

// ── readListFilters: status (case-insensitive), company, q ───────────────────

test("status matching is case-insensitive and folds to the lower-case key", () => {
  assert.deepEqual(asQuery(q("status=Interview")).filters.statuses, ["interview"]);
  assert.deepEqual(asQuery(q("status=interview")).filters.statuses, ["interview"]);
  assert.deepEqual(asQuery(q("status=Ready%20to%20submit")).filters.statuses, ["saved"]);
  // A comma list, deduped.
  assert.deepEqual(asQuery(q("status=Applied,interview,APPLIED")).filters.statuses, ["applied", "interview"]);
});

test("?status=Interview matches rows stored as 'interview' AND as 'Interview'", () => {
  // The filter widens one status to every stored spelling, so a capitalised
  // legacy row and a lower-case new row both match (the 22 Nov dual-spelling bug).
  const status = normalizeStatus("Interview");
  assert.ok(status);
  const values = storedValuesFor([status]);
  assert.ok(values.includes("interview"));
  assert.ok(values.includes("Interview"));
});

test("an unknown status is an error", () => {
  assert.ok("error" in q("status=Hired"));
  assert.ok("error" in readListFilters(new URLSearchParams("status=whatever")));
});

test("company and q are read and capped", () => {
  assert.equal(asQuery(q("company=Monzo")).filters.company, "Monzo");
  assert.equal(asQuery(q("q=%20platform%20%20engineer")).filters.q, "platform engineer");
  assert.ok("error" in q(`company=${"x".repeat(LIST_FILTER_MAX + 1)}`));
  assert.ok("error" in q(`q=${"x".repeat(LIST_FILTER_MAX + 1)}`));
  // Empty filters are null, not "".
  assert.deepEqual(asQuery(q("")).filters, { statuses: null, company: null, q: null });
});

test("likePattern makes LIKE's own wildcards literal and wraps in *…*", () => {
  assert.equal(likePattern("Monzo"), "*Monzo*");
  assert.equal(likePattern("50%_off"), "*50\\%\\_off*");
  assert.equal(likePattern("a\\b"), "*a\\\\b*");
});

// ── The note cap (raised 500 -> 1000) ────────────────────────────────────────

test("a 900-character note saves; a 1,100-character note is refused with the limit and length", () => {
  assert.equal(MAX_APPENDED_NOTE, 1000);
  const ok = cleanNoteLine("x".repeat(900));
  assert.deepEqual(ok, { line: "x".repeat(900) });
  const exactly = cleanNoteLine("x".repeat(1000));
  assert.deepEqual(exactly, { line: "x".repeat(1000) });
  const over = cleanNoteLine("x".repeat(1100));
  assert.ok("error" in over);
  assert.equal(over.max, 1000);
  assert.equal(over.length, 1100);
  assert.match(over.error, /1100 characters/);
  assert.match(over.error, /limit for one append_note is 1000/);
});

// ── One status spelling on write ─────────────────────────────────────────────

test("normaliseStatus is the write normaliser and returns the lower-case key", () => {
  // Reads fold case already; the point is that this is the ONE function writes use.
  assert.equal(normaliseStatus, normalizeStatus);
  assert.equal(normaliseStatus("Applied"), "applied");
  assert.equal(normaliseStatus("INTERVIEW"), "interview");
  assert.equal(normaliseStatus("Ready to submit"), "saved");
  assert.equal(normaliseStatus("nonsense"), null);
});

test("every create/update normalises the status it stores to one lower-case spelling", () => {
  // validateEditable is the one place a user-supplied status is normalised for
  // storage; POST, PUT, /log and bulk (via PUT) all go through it.
  for (const sent of ["Applied", "applied", "APPLIED"]) {
    const v = validateEditable({ company_name: "Co", role: "Engineer", date_applied: "2026-11-01", status: sent }, false);
    assert.ok("fields" in v, `${sent}: ${JSON.stringify(v)}`);
    assert.equal(v.fields.status, "applied", sent);
  }
  const update = validateEditable({ status: "Interview" }, true);
  assert.ok("fields" in update);
  assert.equal(update.fields.status, "interview");
  // The capitalised "Ready to submit" the sweeps send folds to the "saved" key.
  const ready = validateEditable({ status: "Ready to submit" }, true);
  assert.ok("fields" in ready);
  assert.equal(ready.fields.status, "saved");
});
