import { test } from "node:test";
import assert from "node:assert/strict";
import { workerPresence, WORKER_OFFLINE_MS } from "../src/lib/agent/deviceStatus.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test("never connected", () => {
  const p = workerPresence(null, NOW);
  assert.equal(p.state, "never");
  assert.equal(p.online, false);
  assert.equal(p.relative, null);
  assert.equal(p.ageMs, null);
});

test("unparseable timestamp reads as never", () => {
  assert.equal(workerPresence("not a date", NOW).state, "never");
});

test("just seen is online and says 'just now'", () => {
  const p = workerPresence(iso(2_000), NOW);
  assert.equal(p.state, "online");
  assert.equal(p.online, true);
  assert.equal(p.relative, "just now");
});

test("seen within the 2-minute window is online", () => {
  const p = workerPresence(iso(90_000), NOW);
  assert.equal(p.online, true);
  assert.equal(p.relative, "1m ago");
});

test("exactly at the threshold is still online", () => {
  const p = workerPresence(iso(WORKER_OFFLINE_MS), NOW);
  assert.equal(p.online, true);
});

test("older than 2 minutes is offline", () => {
  const p = workerPresence(iso(WORKER_OFFLINE_MS + 1_000), NOW);
  assert.equal(p.state, "offline");
  assert.equal(p.online, false);
  assert.equal(p.relative, "2m ago");
});

test("seconds and hours phrasing", () => {
  assert.equal(workerPresence(iso(25_000), NOW).relative, "25s ago");
  assert.equal(workerPresence(iso(3 * 60 * 60 * 1000), NOW).relative, "3h ago");
});

test("older than a day drops the relative label (date shown instead)", () => {
  const p = workerPresence(iso(26 * 60 * 60 * 1000), NOW);
  assert.equal(p.state, "offline");
  assert.equal(p.relative, null);
});

test("future timestamp (clock skew) clamps to just now and online", () => {
  const p = workerPresence(iso(-5_000), NOW);
  assert.equal(p.online, true);
  assert.equal(p.relative, "just now");
  assert.equal(p.ageMs, 0);
});
