// Chunk 31 (20 Nov 2026): hands-free turn-taking. The end-of-turn timer, the
// energy VAD, the barge-in gate and the on-device recognition gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endOfTurn, clampPause, createVad, createBargeIn, onDeviceRecognitionAvailable,
  PAUSE_DEFAULT_MS, PAUSE_MIN_MS, PAUSE_MAX_MS, FINISHING_MS, MIN_AUTO_WORDS, BARGE_IN_MIN_MS,
} from "../src/lib/interview/turnTaking.ts";

test("a pause shorter than the setting never submits", () => {
  assert.deepEqual(endOfTurn(1500, 20, 1600), { action: "wait" });
  // The Done-when case: a 3-second thinking pause with the threshold at 3 s.
  assert.deepEqual(endOfTurn(3000, 40, 3000), { action: "finishing", progress: 0 });
  assert.notEqual(endOfTurn(3000 + FINISHING_MS - 1, 40, 3000).action, "submit");
});

test("past the pause the Finishing ring fills, then the answer is sent", () => {
  const mid = endOfTurn(1600 + FINISHING_MS / 2, 20, 1600);
  assert.equal(mid.action, "finishing");
  assert.ok(mid.action === "finishing" && Math.abs(mid.progress - 0.5) < 1e-9);
  assert.deepEqual(endOfTurn(1600 + FINISHING_MS, 20, 1600), { action: "submit" });
});

test("short fragments never auto-send", () => {
  assert.deepEqual(endOfTurn(60_000, MIN_AUTO_WORDS - 1, 1600), { action: "wait" });
  assert.deepEqual(endOfTurn(Number.NaN, 20, 1600), { action: "wait" });
});

test("the pause setting is clamped to the 1-3 s slider", () => {
  assert.equal(clampPause(500), PAUSE_MIN_MS);
  assert.equal(clampPause(9000), PAUSE_MAX_MS);
  assert.equal(clampPause(1700), 1800);
  assert.equal(clampPause("x"), PAUSE_DEFAULT_MS);
  assert.equal(PAUSE_DEFAULT_MS, 1600);
});

test("the VAD hears a voice over a quiet room and holds between syllables", () => {
  const vad = createVad();
  let t = 0;
  for (let i = 0; i < 50; i++) assert.equal(vad.update(0.005, (t += 16)), false);
  assert.equal(vad.update(0.12, (t += 16)), true);
  const heard = vad.lastVoiceAt();
  assert.equal(heard, t);
  // A dip between syllables stays "speech" inside the hangover…
  assert.equal(vad.update(0.005, (t += 100)), true);
  // …and ends after it.
  assert.equal(vad.update(0.005, (t += 200)), false);
  assert.equal(vad.lastVoiceAt(), heard);
});

test("a noisy room raises the floor, so its hum is not a voice", () => {
  const vad = createVad();
  let t = 0;
  for (let i = 0; i < 400; i++) vad.update(0.03, (t += 16));
  assert.equal(vad.update(0.035, (t += 16)), false, "hum stays below threshold");
  assert.equal(vad.update(0.2, (t += 16)), true, "a real voice is still heard");
});

test("a long answer can't teach the floor that the voice is noise", () => {
  const vad = createVad();
  let t = 0;
  for (let i = 0; i < 1000; i++) vad.update(0.15, (t += 16));
  assert.ok(vad.noiseFloor() < 0.05);
  assert.equal(vad.update(0.15, (t += 16)), true);
});

test("barge-in fires once after ~250 ms of continuous speech", () => {
  const gate = createBargeIn();
  assert.equal(gate.update(true, 0), false);
  assert.equal(gate.update(true, BARGE_IN_MIN_MS - 10), false);
  assert.equal(gate.update(true, BARGE_IN_MIN_MS), true);
  assert.equal(gate.update(true, BARGE_IN_MIN_MS + 100), false, "only once");
  gate.reset();
  // A cough (short burst, then silence) resets the run.
  assert.equal(gate.update(true, 1000), false);
  assert.equal(gate.update(false, 1100), false);
  assert.equal(gate.update(true, 1200), false);
  assert.equal(gate.update(true, 1200 + BARGE_IN_MIN_MS), true);
});

test("on-device recognition needs a real WebGPU adapter on a desktop", () => {
  assert.equal(onDeviceRecognitionAvailable({ webgpu: true, coarsePointer: false, deviceMemory: 8 }), true);
  assert.equal(onDeviceRecognitionAvailable({ webgpu: false, coarsePointer: false, deviceMemory: 16 }), false);
  assert.equal(onDeviceRecognitionAvailable({ webgpu: true, coarsePointer: true, deviceMemory: 8 }), false);
  assert.equal(onDeviceRecognitionAvailable({ webgpu: true, coarsePointer: false, deviceMemory: 2 }), false);
  assert.equal(onDeviceRecognitionAvailable({ webgpu: true, coarsePointer: false, deviceMemory: null }), true);
});
