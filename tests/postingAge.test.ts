import test from "node:test";
import assert from "node:assert/strict";
import { postingAgeDays, POSTING_AGE_BANDS } from "../src/lib/postingAge.ts";

test("postingAgeDays reads relative and absolute posting dates off the JD; nothing stated → null", () => {
  assert.equal(postingAgeDays("Software Engineer\nPosted 3 days ago\nLondon", "2026-09-24"), 3);
  assert.equal(postingAgeDays("Posted 2 weeks ago", "2026-09-24"), 14);
  assert.equal(postingAgeDays("Listed 5 hours ago", "2026-09-24"), 0);
  assert.equal(postingAgeDays("Posted today", "2026-09-24"), 0);
  assert.equal(postingAgeDays("Posted yesterday", "2026-09-24"), 1);
  assert.equal(postingAgeDays("Date posted: 12 September 2026", "2026-09-24"), 12);
  assert.equal(postingAgeDays("Posted on 12/09/2026", "2026-09-24"), 12);
  assert.equal(postingAgeDays("Posted 2026-09-20", "2026-09-24"), 4);
  assert.equal(postingAgeDays("Posted 30+ days ago", "2026-09-24"), 30);
  assert.equal(postingAgeDays("Closing date: 30 September 2026", "2026-09-24"), null, "a closing date is not a posting date");
  assert.equal(postingAgeDays("Posted on 30 September 2026", "2026-09-24"), null, "a posting date after the applied date is not trusted");
  assert.equal(postingAgeDays("We are hiring a Software Engineer.", "2026-09-24"), null);
  assert.equal(postingAgeDays("", "2026-09-24"), null);
});

test("posting-age bands", () => {
  const band = (d: number) => POSTING_AGE_BANDS.find((b) => b.test(d))!.key;
  assert.deepEqual([band(0), band(3), band(4), band(14), band(15), band(60)], ["fresh", "fresh", "week", "week", "old", "old"]);
});
