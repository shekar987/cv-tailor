import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeText, foldLine, icsFilename, toIcsDate, toIcsUtc } from "../src/lib/ics.ts";

test("instant and date formatting", () => {
  assert.equal(toIcsUtc("2026-11-24T14:00:00Z"), "20261124T140000Z");
  assert.equal(toIcsUtc("2026-11-24T14:00:00.000Z"), "20261124T140000Z");
  // An offset time is converted to UTC.
  assert.equal(toIcsUtc("2026-11-24T14:00:00+01:00"), "20261124T130000Z");
  assert.equal(toIcsDate("2026-11-24"), "20261124");
  assert.throws(() => toIcsUtc("not a date"));
});

test("text escaping follows RFC 5545 order", () => {
  assert.equal(escapeText("a, b; c\\d\ne"), "a\\, b\\; c\\\\d\\ne");
});

test("a timed event is a complete, valid VCALENDAR", () => {
  const ics = buildIcs({ uid: "evt-1@jobhuntz", title: "Interview · BP", start: "2026-11-24T14:00:00Z", durationMinutes: 60, stamp: "2026-11-19T09:00:00Z" });
  const lines = ics.split("\r\n");
  assert.ok(ics.endsWith("\r\n"), "CRLF terminated");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
  assert.ok(lines.includes("BEGIN:VEVENT"));
  assert.ok(lines.includes("END:VEVENT"));
  assert.ok(lines.includes("END:VCALENDAR"));
  assert.ok(lines.includes("UID:evt-1@jobhuntz"));
  assert.ok(lines.includes("DTSTAMP:20261119T090000Z"));
  assert.ok(lines.includes("DTSTART:20261124T140000Z"));
  assert.ok(lines.includes("DTEND:20261124T150000Z"), "a 60-minute default duration");
  assert.ok(lines.includes("SUMMARY:Interview · BP"));
  // Every content line is non-empty and CRLF-separated.
  assert.ok(lines.filter((l) => l.length > 0).every((l) => !l.includes("\n")));
});

test("a date-only event uses VALUE=DATE and an exclusive next-day end", () => {
  const ics = buildIcs({ uid: "oa@jobhuntz", title: "Google online assessment", start: "2026-11-22", dateOnly: true, stamp: "2026-11-19T00:00:00Z" });
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261122"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261123"));
  assert.ok(!ics.includes("DTSTART:2026"), "no timed DTSTART");
});

test("long lines fold at 75 octets with CRLF + space", () => {
  const long = "x".repeat(200);
  const folded = foldLine(`DESCRIPTION:${long}`);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1, "it folded");
  assert.ok(Buffer.byteLength(parts[0], "utf8") <= 75);
  for (const p of parts.slice(1)) {
    assert.ok(p.startsWith(" "), "continuation starts with a space");
    assert.ok(Buffer.byteLength(p, "utf8") <= 75);
  }
});

test("multiple events in one calendar", () => {
  const ics = buildIcs([
    { uid: "a@h", title: "A", start: "2026-11-24T14:00:00Z", stamp: "2026-11-19T09:00:00Z" },
    { uid: "b@h", title: "B", start: "2026-11-25T10:00:00Z", stamp: "2026-11-19T09:00:00Z" },
  ]);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.equal(ics.match(/END:VEVENT/g)?.length, 2);
  assert.equal(ics.match(/BEGIN:VCALENDAR/g)?.length, 1);
});

test("icsFilename is a safe slug ending .ics", () => {
  assert.equal(icsFilename("Interview · BP (Tue)"), "interview-bp-tue.ics");
  assert.equal(icsFilename("!!!"), "event.ics");
});
