// Hands-free turn-taking for the mock interview (Chunk 31). Import-free and
// pure so node:test can drive it with made-up clocks and levels.
//
// Three pieces:
//   - endOfTurn: when a spoken answer is finished. Silence past the user's
//     pause setting (1-3 s, default 1.6 s) starts a 1.5 s "Finishing… keep
//     talking to continue" ring; any speech resets it; only a full ring sends.
//   - createVad: a small energy voice-activity detector over the microphone's
//     RMS, with a noise floor that adapts while nobody speaks. It tells the
//     room "someone is talking" sooner than speech recognition returns words,
//     so a slow transcript never ends a turn early. No model download.
//   - createBargeIn: speaking over the interviewer stops it, but only after
//     ~250 ms of continuous speech, so a cough or the interviewer's own voice
//     leaking past echo cancellation doesn't cut it off.

export const PAUSE_MIN_MS = 1000;
export const PAUSE_MAX_MS = 3000;
export const PAUSE_DEFAULT_MS = 1600;
export const PAUSE_STEP_MS = 200;
export const FINISHING_MS = 1500;
// Short fragments ("um, so…") never auto-send (same rule as lib/interviewFlow).
export const MIN_AUTO_WORDS = 5;
export const BARGE_IN_MIN_MS = 250;

/** The pause setting as stored (a number of ms), clamped to the slider and its step. */
export function clampPause(ms: unknown): number {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n)) return PAUSE_DEFAULT_MS;
  const clamped = Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, n));
  return Math.round(clamped / PAUSE_STEP_MS) * PAUSE_STEP_MS;
}

export type TurnDecision =
  | { action: "wait" }
  | { action: "finishing"; progress: number }
  | { action: "submit" };

/**
 * `silentMs`: time since the last sign of speech (a recognition result or the
 * VAD hearing a voice, whichever is later). A pause shorter than `pauseMs`
 * never submits; after it the ring fills over `finishingMs`.
 */
export function endOfTurn(silentMs: number, words: number, pauseMs: number, finishingMs = FINISHING_MS): TurnDecision {
  if (!(words >= MIN_AUTO_WORDS) || !(silentMs >= pauseMs)) return { action: "wait" };
  const progress = (silentMs - pauseMs) / Math.max(1, finishingMs);
  return progress >= 1 ? { action: "submit" } : { action: "finishing", progress };
}

export type Vad = {
  /** Feed one frame's RMS (0..1) at time `nowMs`; returns whether a voice is present. */
  update(rms: number, nowMs: number): boolean;
  speaking(): boolean;
  /** When a voice was last heard (ms, the caller's clock), or null if never. */
  lastVoiceAt(): number | null;
  noiseFloor(): number;
};

export type VadOptions = {
  /** A voice is a level this many times the noise floor… */
  ratio?: number;
  /** …and at least this loud (RMS 0..1), so a silent room never "speaks". */
  minLevel?: number;
  /** Speech stays "on" this long after the level drops (between syllables). */
  hangoverMs?: number;
  /** The floor's starting value and how fast it follows a quiet room (0..1 per frame). */
  initialFloor?: number;
  floorRate?: number;
};

export function createVad(opts: VadOptions = {}): Vad {
  const ratio = opts.ratio ?? 3;
  const minLevel = opts.minLevel ?? 0.04;
  const hangoverMs = opts.hangoverMs ?? 220;
  const floorRate = opts.floorRate ?? 0.05;
  let floor = opts.initialFloor ?? 0.01;
  let on = false;
  let lastLoud: number | null = null;

  return {
    update(rms, nowMs) {
      const level = Number.isFinite(rms) ? Math.max(0, rms) : 0;
      const loud = level >= minLevel && level >= floor * ratio;
      if (loud) {
        lastLoud = nowMs;
        on = true;
      } else {
        // The floor learns the room only while nobody is talking, and never
        // climbs past the speech threshold (a long answer can't teach it that
        // the voice is "noise").
        floor += (Math.min(level, minLevel) - floor) * floorRate;
        on = lastLoud !== null && nowMs - lastLoud < hangoverMs;
      }
      return on;
    },
    speaking: () => on,
    lastVoiceAt: () => lastLoud,
    noiseFloor: () => floor,
  };
}

export type BargeIn = {
  /** Feed the VAD's verdict each frame; true exactly once, when barge-in fires. */
  update(speech: boolean, nowMs: number): boolean;
  reset(): void;
};

export function createBargeIn(minSpeechMs = BARGE_IN_MIN_MS): BargeIn {
  let since: number | null = null;
  let fired = false;
  return {
    update(speech, nowMs) {
      if (fired) return false;
      if (!speech) {
        since = null;
        return false;
      }
      if (since === null) since = nowMs;
      if (nowMs - since >= minSpeechMs) {
        fired = true;
        return true;
      }
      return false;
    },
    reset() {
      since = null;
      fired = false;
    },
  };
}

/**
 * Whether the "On this device" recognition option may be offered: a real
 * WebGPU adapter (requestAdapter() returned one, not just navigator.gpu), a
 * desktop pointer and enough memory for a ~60 MB model. Chunk 31 ships the
 * gate; the on-device recogniser itself is a follow-up chunk.
 */
export function onDeviceRecognitionAvailable(caps: { webgpu: boolean; coarsePointer: boolean; deviceMemory: number | null }): boolean {
  return caps.webgpu && !caps.coarsePointer && (caps.deviceMemory ?? 8) >= 4;
}

// Barge-in also needs this level (RMS 0..1): a voice in the room, not the
// interviewer's quieter echo from the speakers.
export const BARGE_IN_MIN_LEVEL = 0.08;
