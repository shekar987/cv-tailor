// The audio level that drives the call-tile's rings (Chunk 30). Import-free and
// pure so node:test can check the decay, and so both voice paths share it.
//
// Two shapes of level:
//   - Browser voice (speechSynthesis) can't be routed into a Web Audio
//     AnalyserNode (it plays through the OS), so the ring is driven from the
//     utterance's `boundary` events: each word start bumps the level to a peak
//     and it decays towards a floor over ~180 ms. `decayedLevel` is that curve.
//   - Kokoro plays an AudioBuffer we own, so its real RMS can be read from an
//     AnalyserNode; `rmsOfSamples` normalises a time-domain frame to 0..1.

// The ring is biggest the instant a word starts, then eases back while the word
// is still being said, so the pulse reads as speech, not a metronome.
export const BUMP_LEVEL = 0.8;
export const SPEAKING_FLOOR = 0.15;
export const DECAY_MS = 180;

/**
 * The browser-voice level `sinceBumpMs` after the last word-start boundary.
 * Peaks at `peak` (0 ms), eases linearly to `floor` by `decayMs`, and holds the
 * floor after — so a long gap between words still shows the "speaking" floor,
 * and 0 is reserved for "not speaking" (the caller sets that itself).
 */
export function decayedLevel(
  sinceBumpMs: number,
  floor = SPEAKING_FLOOR,
  peak = BUMP_LEVEL,
  decayMs = DECAY_MS,
): number {
  if (!(sinceBumpMs > 0)) return peak; // 0, negative or NaN: the bump itself
  if (sinceBumpMs >= decayMs) return floor;
  return peak + (floor - peak) * (sinceBumpMs / decayMs);
}

/**
 * Root-mean-square of a time-domain audio frame, scaled into 0..1 for the ring.
 * `samples` are the float samples an AnalyserNode returns (roughly -1..1); the
 * raw RMS of speech is small, so `gain` lifts it to a visible range and it is
 * clamped at 1.
 */
export function rmsOfSamples(samples: ArrayLike<number>, gain = 4): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / n);
  return Math.min(1, Math.max(0, rms * gain));
}
