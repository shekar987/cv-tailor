// Tests for src/lib/eventClashes.ts (Chunk JH-8, 27 Nov 2026).
// Fictional data only; no network or database calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findClashes, sequenceFromNotes } from "../src/lib/eventClashes.ts";
import { buildIcs } from "../src/lib/ics.ts";

function ev(opts: {
  id: string;
  title?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  due_at?: string | null;
  date_only?: boolean;
  status?: string;
}) {
  return { title: opts.id, ...opts };
}

describe("findClashes", () => {
  it("returns empty when event has no starts_at", () => {
    const e = ev({ id: "a", due_at: "2026-11-30T10:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const r = findClashes(e, [other]);
    assert.deepEqual(r, { clashes: [], tight: [] });
  });

  it("two overlapping timed events are clashes", () => {
    const e = ev({ id: "a", title: "Interview", starts_at: "2026-11-30T10:30:00Z", ends_at: "2026-11-30T11:30:00Z" });
    const other = ev({ id: "b", title: "Peer call", starts_at: "2026-11-30T11:00:00Z", ends_at: "2026-11-30T12:00:00Z" });
    const { clashes, tight } = findClashes(e, [other]);
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0].id, "b");
    assert.equal(clashes[0].title, "Peer call");
    assert.equal(tight.length, 0);
  });

  it("exactly 15-minute gap is not tight and not a clash", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T11:15:00Z", ends_at: "2026-11-30T12:15:00Z" });
    const { clashes, tight } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
    assert.equal(tight.length, 0);
  });

  it("gap under 15 minutes is tight, not a clash", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T11:10:00Z", ends_at: "2026-11-30T12:10:00Z" });
    const { clashes, tight } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
    assert.equal(tight.length, 1);
    assert.equal(tight[0].id, "b");
  });

  it("date-only events are ignored", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:00:00Z", date_only: true });
    const { clashes, tight } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
    assert.equal(tight.length, 0);
  });

  it("due_at-only deadlines (no starts_at) are ignored", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", due_at: "2026-11-30T10:30:00Z" });
    const { clashes, tight } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
    assert.equal(tight.length, 0);
  });

  it("done events are ignored", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:30:00Z", ends_at: "2026-11-30T11:30:00Z", status: "done" });
    const { clashes } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
  });

  it("cancelled events are ignored", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:30:00Z", ends_at: "2026-11-30T11:30:00Z", status: "cancelled" });
    const { clashes } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
  });

  it("missed events are ignored", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:30:00Z", ends_at: "2026-11-30T11:30:00Z", status: "missed" });
    const { clashes } = findClashes(e, [other]);
    assert.equal(clashes.length, 0);
  });

  it("event does not clash with itself", () => {
    const e = ev({ id: "a", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const { clashes, tight } = findClashes(e, [e]);
    assert.equal(clashes.length, 0);
    assert.equal(tight.length, 0);
  });

  it("winter timezone clash: 10:30 Europe/London (=UTC) vs 11:00 UTC overlap", () => {
    // In winter, Europe/London IS UTC. 10:30Z-11:30Z vs 11:00Z-12:00Z → overlap 11:00-11:30Z.
    const e = ev({ id: "a", starts_at: "2026-11-30T10:30:00Z", ends_at: "2026-11-30T11:30:00Z" });
    const other = ev({ id: "b", starts_at: "2026-11-30T11:00:00Z", ends_at: "2026-11-30T12:00:00Z" });
    const { clashes } = findClashes(e, [other]);
    assert.equal(clashes.length, 1, "overlapping times in winter = clash");
  });

  it("events with offset notation compare as instants", () => {
    // 10:30+01:00 = 09:30Z; 09:00Z-10:00Z does not overlap
    const e = ev({ id: "a", starts_at: "2026-11-30T10:30:00+01:00", ends_at: "2026-11-30T11:30:00+01:00" });
    const other = ev({ id: "b", starts_at: "2026-11-30T09:00:00Z", ends_at: "2026-11-30T10:00:00Z" });
    const { clashes } = findClashes(e, [other]);
    // 10:30+01:00 = 09:30Z; other ends at 10:00Z — no overlap (09:30-10:30Z vs 09:00-10:00Z → they DO overlap)
    assert.equal(clashes.length, 1, "UTC instants compared correctly");
  });

  it("non-timed event (no starts_at) returns empty result even with overlapping others", () => {
    const e = ev({ id: "a" });
    const other = ev({ id: "b", starts_at: "2026-11-30T10:00:00Z", ends_at: "2026-11-30T11:00:00Z" });
    const { clashes, tight } = findClashes(e, [other]);
    assert.deepEqual({ clashes, tight }, { clashes: [], tight: [] });
  });
});

describe("reschedule: Moved from note drives SEQUENCE", () => {
  it("sequenceFromNotes returns 0 for null/empty notes", () => {
    assert.equal(sequenceFromNotes(null), 0);
    assert.equal(sequenceFromNotes(""), 0);
    assert.equal(sequenceFromNotes("Some prep notes"), 0);
  });

  it("sequenceFromNotes counts each 'Moved from' line", () => {
    const notes1 = "Moved from 24 Nov 2026 14:00 UTC\nInitial notes.";
    const notes2 = "Moved from 25 Nov 2026 10:00 UTC\n" + notes1;
    assert.equal(sequenceFromNotes(notes1), 1);
    assert.equal(sequenceFromNotes(notes2), 2);
  });
});

describe("ICS SEQUENCE field", () => {
  it("SEQUENCE:0 is emitted when sequence is 0", () => {
    const ics = buildIcs({ uid: "evt-1@jobhuntz.app", title: "Interview", start: "2026-11-30T10:00:00Z", sequence: 0 });
    assert.ok(ics.includes("SEQUENCE:0"), `expected SEQUENCE:0 in:\n${ics}`);
  });

  it("SEQUENCE:1 is emitted after first reschedule", () => {
    const ics = buildIcs({ uid: "evt-1@jobhuntz.app", title: "Interview", start: "2026-11-30T14:00:00Z", sequence: 1 });
    assert.ok(ics.includes("SEQUENCE:1"), `expected SEQUENCE:1 in:\n${ics}`);
  });

  it("SEQUENCE is omitted when sequence field is absent", () => {
    const ics = buildIcs({ uid: "evt-2@jobhuntz.app", title: "Call", start: "2026-11-30T10:00:00Z" });
    assert.ok(!ics.includes("SEQUENCE:"), "SEQUENCE should be absent when field is not set");
  });

  it("same UID with higher SEQUENCE replaces old event in calendar apps", () => {
    // Both events use the same UID; the higher SEQUENCE wins.
    const ics0 = buildIcs({ uid: "evt-3@jobhuntz.app", title: "Screening", start: "2026-11-30T09:00:00Z", sequence: 0 });
    const ics1 = buildIcs({ uid: "evt-3@jobhuntz.app", title: "Screening", start: "2026-11-30T11:00:00Z", sequence: 1 });
    const uid0 = (ics0.match(/UID:([^\r\n]+)/) ?? [])[1];
    const uid1 = (ics1.match(/UID:([^\r\n]+)/) ?? [])[1];
    assert.equal(uid0, uid1, "UIDs must match for the update to replace the old event");
    assert.ok(ics1.includes("SEQUENCE:1"), "updated ICS has higher SEQUENCE");
  });
});
