// Chunk 30 (15 Nov 2026): the call-tile interviewer stage. The chip text for
// each state, that reduced motion carries no animation class, the mic meter
// only while answering, and the audio-level helper's decay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CallStage, { type CallAccent, type CallState } from "../src/app/applications/[id]/interview/CallStage.tsx";
import { decayedLevel, rmsOfSamples, BUMP_LEVEL, SPEAKING_FLOOR, DECAY_MS } from "../src/lib/interview/audioLevel.ts";

type Props = {
  name: string; role: string; initials: string; accent: CallAccent;
  state: CallState; captionText: string; audioLevel: number; micLevel: number; reducedMotion: boolean;
};
const base: Props = {
  name: "Emma Clarke", role: "Talent Acquisition Partner", initials: "EC", accent: "amber",
  state: "idle", captionText: "Tell me about yourself.", audioLevel: 0.3, micLevel: 0, reducedMotion: false,
};
const render = (p: Partial<Props> = {}) => renderToStaticMarkup(createElement(CallStage, { ...base, ...p }));

test("the chip names what the interviewer is doing, by state", () => {
  assert.match(render({ state: "speaking" }), /Emma is speaking/);
  assert.match(render({ state: "listening" }), /Listening/);
  assert.match(render({ state: "thinking" }), /Thinking/);
  assert.match(render({ state: "idle" }), /Emma is ready/);
});

test("reduced motion carries no animation class; the animated build does", () => {
  const still = render({ reducedMotion: true, state: "speaking" });
  assert.doesNotMatch(still, /callStage--animated/);
  assert.match(still, /data-reduced-motion="true"/);
  const animated = render({ reducedMotion: false, state: "speaking" });
  assert.match(animated, /callStage--animated/);
});

test("Emma and Daniel differ by accent, not a face", () => {
  assert.match(render({ accent: "amber" }), /data-accent="amber"/);
  assert.match(render({ accent: "teal", name: "Daniel Okafor", initials: "DO" }), /data-accent="teal"/);
  // A monogram, never an illustrated face asset.
  assert.match(render({ initials: "DO", name: "Daniel Okafor" }), /callStage__monogram[^>]*>DO</);
});

test("the mic meter shows only while you answer, with lit segments by level", () => {
  assert.doesNotMatch(render({ state: "speaking" }), /callMeter/);
  const listening = render({ state: "listening", micLevel: 0.5 });
  assert.match(listening, /callMeter/);
  // 12 segments, half lit at 0.5.
  assert.equal((listening.match(/callMeter__seg"/g) ?? []).length, 12);
  assert.equal((listening.match(/data-on="true"/g) ?? []).length, 6);
});

test("the audio level is published so the ring can react", () => {
  assert.match(render({ state: "speaking", audioLevel: 0.44 }), /--audio-level:0\.44|--audio-level: ?0\.44/);
  // Out-of-range input is clamped, never passed through.
  assert.match(render({ audioLevel: 5 }), /--audio-level:1\b|--audio-level: ?1\b/);
  assert.match(render({ audioLevel: Number.NaN }), /--audio-level:0\b|--audio-level: ?0\b/);
});

test("decayedLevel peaks on a boundary and eases to the floor over the window", () => {
  assert.equal(decayedLevel(0), BUMP_LEVEL);
  assert.equal(decayedLevel(-5), BUMP_LEVEL);
  assert.equal(decayedLevel(DECAY_MS), SPEAKING_FLOOR);
  assert.equal(decayedLevel(DECAY_MS * 3), SPEAKING_FLOOR);
  const mid = decayedLevel(DECAY_MS / 2);
  assert.ok(mid < BUMP_LEVEL && mid > SPEAKING_FLOOR, "halfway is between peak and floor");
  // Monotonic over the decay.
  assert.ok(decayedLevel(30) > decayedLevel(60) && decayedLevel(60) > decayedLevel(120));
});

test("rmsOfSamples normalises a time-domain frame to 0..1", () => {
  assert.equal(rmsOfSamples([0, 0, 0, 0]), 0);
  assert.equal(rmsOfSamples([]), 0);
  // A loud frame clamps at 1 rather than overflowing.
  assert.equal(rmsOfSamples([1, -1, 1, -1]), 1);
  const quiet = rmsOfSamples([0.1, -0.1, 0.1, -0.1]);
  assert.ok(quiet > 0 && quiet < 1);
});
