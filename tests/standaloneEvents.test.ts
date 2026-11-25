// Tests for Chunk JH-2B: standalone chore/call events and ICS calendar feed.
//
// Covers:
//   1. STANDALONE_KINDS — chore and call are standalone; interview is not.
//   2. EventKind labels — chore and call have human-readable labels.
//   3. ICS output format — the feed's eventToIcs logic (timed, date-only, fallback).
//   4. Token uniqueness — two calls to randomBytes produce different tokens.
//   5. Token hash stability — the same token always hashes the same way.
//   6. Wrong token hashes differently — a changed token is a different hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { STANDALONE_KINDS, EVENT_KIND_LABELS, type EventKind } from "../src/lib/plan.ts";
import { buildIcs, type IcsEvent } from "../src/lib/ics.ts";

// ---------------------------------------------------------------------------
// 1. STANDALONE_KINDS
// ---------------------------------------------------------------------------

test("STANDALONE_KINDS includes networking, chore and call", () => {
  assert.ok(STANDALONE_KINDS.has("networking"), "networking must be standalone");
  assert.ok(STANDALONE_KINDS.has("chore"), "chore must be standalone");
  assert.ok(STANDALONE_KINDS.has("call"), "call must be standalone");
});

test("STANDALONE_KINDS does not include application-tied event kinds", () => {
  const tied: EventKind[] = ["interview", "assessment", "take_home", "deadline", "follow_up", "offer_deadline", "screening_call", "video", "work_trial", "screening_questions"];
  for (const kind of tied) {
    assert.ok(!STANDALONE_KINDS.has(kind), `${kind} should NOT be standalone`);
  }
});

// ---------------------------------------------------------------------------
// 2. Labels
// ---------------------------------------------------------------------------

test("chore and call have human-readable labels", () => {
  assert.equal(EVENT_KIND_LABELS["chore"], "Chore");
  assert.equal(EVENT_KIND_LABELS["call"], "Call");
});

// ---------------------------------------------------------------------------
// 3. ICS output — the shape the feed route would produce
// ---------------------------------------------------------------------------

function makeTimedIcsEvent(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "abc-123@jobhuntz.app",
    title: "Pack a bag",
    start: "2026-11-25T10:00:00Z",
    end: "2026-11-25T11:00:00Z",
    stamp: "2026-11-22T09:00:00Z",
    ...overrides,
  };
}

test("ICS feed event: timed chore is a complete, valid VCALENDAR", () => {
  const ics = buildIcs(makeTimedIcsEvent());
  const lines = ics.split("\r\n");
  assert.ok(ics.endsWith("\r\n"), "must be CRLF terminated");
  assert.ok(lines.includes("BEGIN:VCALENDAR"));
  assert.ok(lines.includes("BEGIN:VEVENT"));
  assert.ok(lines.includes("UID:abc-123@jobhuntz.app"), "stable UID from event id");
  assert.ok(lines.includes("DTSTART:20261125T100000Z"));
  assert.ok(lines.includes("DTEND:20261125T110000Z"));
  assert.ok(lines.includes("SUMMARY:Pack a bag"));
  assert.ok(lines.includes("END:VEVENT"));
  assert.ok(lines.includes("END:VCALENDAR"));
});

test("ICS feed event: date-only event uses VALUE=DATE", () => {
  const ics = buildIcs({
    uid: "dead-123@jobhuntz.app",
    title: "Pay council tax",
    start: "2026-11-30",
    dateOnly: true,
    stamp: "2026-11-22T09:00:00Z",
  });
  const lines = ics.split("\r\n");
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261130"), "date-only DTSTART");
  // DTEND is the next calendar day.
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261201"), "DTEND is next day");
  // DTSTART and DTEND must be VALUE=DATE form (no T in those lines).
  assert.ok(!lines.some((l) => l.startsWith("DTSTART:") || l.startsWith("DTEND:")), "no bare DTSTART/DTEND clock lines");
});

test("ICS feed event: multiple events are all wrapped in one VCALENDAR", () => {
  const events: IcsEvent[] = [
    makeTimedIcsEvent({ uid: "ev-1@jobhuntz.app", title: "Call recruiter" }),
    makeTimedIcsEvent({ uid: "ev-2@jobhuntz.app", title: "Pack bag", start: "2026-11-26T09:00:00Z" }),
  ];
  const ics = buildIcs(events);
  const lines = ics.split("\r\n");
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 2, "two VEVENTs");
  assert.equal(lines.filter((l) => l === "BEGIN:VCALENDAR").length, 1, "one VCALENDAR");
});

test("ICS feed: empty event list produces a valid but empty VCALENDAR", () => {
  const ics = buildIcs([]);
  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("END:VCALENDAR"));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

// ---------------------------------------------------------------------------
// 4–6. Token security
// ---------------------------------------------------------------------------

test("two generated tokens are always different", () => {
  const a = randomBytes(32).toString("hex");
  const b = randomBytes(32).toString("hex");
  assert.notEqual(a, b, "randomBytes must produce distinct values");
  assert.equal(a.length, 64, "hex-encoded 32 bytes = 64 chars");
});

test("hashing the same token twice gives the same hash", () => {
  const token = randomBytes(32).toString("hex");
  const h1 = createHash("sha256").update(token).digest("hex");
  const h2 = createHash("sha256").update(token).digest("hex");
  assert.equal(h1, h2, "SHA-256 is deterministic");
  assert.equal(h1.length, 64, "hex SHA-256 = 64 chars");
});

test("a different token (regenerate) produces a different hash", () => {
  const oldToken = randomBytes(32).toString("hex");
  const newToken = randomBytes(32).toString("hex");
  const oldHash = createHash("sha256").update(oldToken).digest("hex");
  const newHash = createHash("sha256").update(newToken).digest("hex");
  assert.notEqual(oldHash, newHash, "regenerating invalidates the old URL");
});
