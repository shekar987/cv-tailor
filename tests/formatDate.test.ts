// lib/formatDate: one date style on every screen (Chunk 19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../src/lib/formatDate.ts";

test("formatDate prints '6 Nov 2026' and '30 Sep 2026' — never 'Sept', never 06/11/2026", () => {
  assert.equal(formatDate("2026-11-06"), "6 Nov 2026");
  assert.equal(formatDate("2026-09-30"), "30 Sep 2026");
  assert.equal(formatDate(new Date("2026-09-30T10:00:00Z")), "30 Sep 2026");
  assert.equal(formatDate("2026-11-06T09:15:00.000Z"), "6 Nov 2026");
});

test("a plain date is printed as written; a timestamp is the day in London unless told otherwise", () => {
  // 23:30 UTC on 31 Mar 2026 is 00:30 on 1 Apr in London (BST).
  assert.equal(formatDate("2026-03-31T23:30:00Z"), "1 Apr 2026");
  assert.equal(formatDate("2026-03-31T23:30:00Z", { timeZone: "UTC" }), "31 Mar 2026");
  assert.equal(formatDate("2026-03-31"), "31 Mar 2026");
  assert.equal(formatDate("2026-11-06", { year: false }), "6 Nov");
});

test("nothing readable prints nothing", () => {
  for (const v of [null, undefined, "", "not a date", "2026-13-01", Number.NaN]) assert.equal(formatDate(v as string), "", String(v));
});
