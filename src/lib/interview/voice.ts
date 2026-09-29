// The interviewer's voice (browser-only). One voice for a whole interview:
//   - kokoro: HeadTTS (vendored in public/vendor/headtts) running Kokoro's
//     British voices on WebGPU, with exact visemes and timestamps for the
//     avatar's lips;
//   - browser: speechSynthesis with the best British voice installed, the
//     lips driven from estimated word timings (TalkingHead turns words into
//     visemes itself);
//   - silent: captions only.
// Every line goes through speakable() first (lib/speechText).

import type { TalkingHead } from "@/vendor/talkinghead/talkinghead.mjs";
import { speakable, splitSentences } from "@/lib/speechText";

export type VoiceKind = "kokoro" | "browser" | "silent";

export interface InterviewVoice {
  kind: VoiceKind;
  label: string;
  // Resolves when the line has been spoken (or stopped).
  speak(text: string, head: TalkingHead | null, onCaption?: (caption: string) => void): Promise<void>;
  // Synthesise ahead of time (Kokoro only), e.g. the next planned question.
  prefetch?(text: string): void;
  // Kokoro only: switch to another British voice (Emma's, Daniel's).
  setSpeaker?(voiceId: string): void;
  stop(head: TalkingHead | null): void;
}

// ── Kokoro via HeadTTS ───────────────────────────────────────────────────────

type HeadTtsMessage = { type: string; data: { audio?: AudioBuffer; words?: string[] } & Record<string, unknown> };
type HeadTts = {
  connect(settings: null, onprogress?: (ev: ProgressEvent) => void): Promise<void>;
  setup(o: Record<string, unknown>): void;
  synthesize(o: { input: string }, onmessage: (m: HeadTtsMessage) => void, onerror?: (e: unknown) => void): Promise<unknown>;
};

const HEADTTS_URL = "/vendor/headtts/modules/headtts.mjs";

// Loads the model (downloaded once, cached by the browser) and measures how
// fast this device really is on a test sentence: seconds of speech produced
// per second of work. Under ~1.2x the conversation would stall.
export async function loadKokoroVoice(opts: {
  voice: string;
  // Every voice this session may use, loaded up front.
  voices: string[];
  audioCtx: AudioContext;
  fp16: boolean;
  onProgress?: (pct: number) => void;
}): Promise<{ voice: InterviewVoice; realtimeFactor: number }> {
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ HEADTTS_URL)) as { HeadTTS: new (s: Record<string, unknown>) => HeadTts };
  const tts = new mod.HeadTTS({
    endpoints: ["webgpu"],
    audioCtx: opts.audioCtx,
    languages: ["en-gb"],
    dictionaryURL: "/vendor/headtts/dictionaries/",
    voiceURL: "/vendor/headtts/voices/",
    voices: [...new Set([opts.voice, ...opts.voices])],
    dtypeWebgpu: opts.fp16 ? "fp16" : "fp32",
    defaultVoice: opts.voice,
    defaultLanguage: "en-gb",
    connectTimeoutMs: 180_000,
  });
  await tts.connect(null, (ev) => {
    if (ev.lengthComputable && ev.total > 0) opts.onProgress?.(Math.round((ev.loaded / ev.total) * 100));
  });
  tts.setup({ voice: opts.voice, language: "en-gb", speed: 1 });

  const synth = (input: string) =>
    new Promise<HeadTtsMessage[]>((resolve, reject) => {
      const out: HeadTtsMessage[] = [];
      tts
        .synthesize({ input }, (m) => {
          if (m.type === "audio") out.push(m);
        }, reject)
        .then(() => resolve(out), reject);
    });

  // The real speed test: a short sentence, timed.
  const t0 = performance.now();
  const test = await synth(speakable("Right, thank you. Let's carry on."));
  const seconds = test.reduce((s, m) => s + (m.data.audio?.duration ?? 0), 0);
  const realtimeFactor = seconds / Math.max(0.001, (performance.now() - t0) / 1000);

  const cache = new Map<string, Promise<HeadTtsMessage[]>>();
  const render = (text: string) => {
    const key = speakable(text);
    let p = cache.get(key);
    if (!p) {
      p = Promise.all(splitSentences(key).map(synth)).then((parts) => parts.flat());
      cache.set(key, p);
    }
    return p;
  };
  let stopped = false;

  const voice: InterviewVoice = {
    kind: "kokoro",
    label: "Natural British voice",
    setSpeaker(voiceId) {
      tts.setup({ voice: voiceId, language: "en-gb", speed: 1 });
      cache.clear();
    },
    prefetch(text) {
      void render(text).catch(() => cache.delete(speakable(text)));
    },
    async speak(text, head, onCaption) {
      stopped = false;
      onCaption?.(text);
      const messages = await render(text);
      cache.delete(speakable(text));
      if (stopped || !head) return;
      for (const m of messages) head.speakAudio(m.data);
      await new Promise<void>((resolve) => { void head.speakMarker(resolve); });
    },
    stop(head) {
      stopped = true;
      head?.stopSpeaking();
    },
  };
  return { voice, realtimeFactor };
}

// ── The browser's own voice ──────────────────────────────────────────────────

const FEMALE = /sonia|libby|maisie|hazel|susan|kate|serena|bella|female/i;
const MALE = /ryan|thomas|george|daniel|arthur|oliver|male/i;

// The best British voice installed: Edge's online "Natural" voices first.
export function pickBrowserVoice(voices: SpeechSynthesisVoice[], gender: "female" | "male"): SpeechSynthesisVoice | null {
  const gb = voices.filter((v) => /^en[-_]GB$/i.test(v.lang));
  const pool = gb.length ? gb : voices.filter((v) => /^en[-_]/i.test(v.lang));
  if (!pool.length) return null;
  const want = gender === "female" ? FEMALE : MALE;
  const other = gender === "female" ? MALE : FEMALE;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 4 : 0) + (want.test(v.name) ? 3 : 0) - (other.test(v.name) && !want.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 1 : 0) + (/^en[-_]GB$/i.test(v.lang) ? 1 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

export async function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = window.speechSynthesis.getVoices();
  if (now.length) return now;
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 3000);
  });
}

// Word timings for the lips when the audio can't be analysed: a base per word
// plus a share per syllable, with pauses at commas.
export function estimateWordTimings(text: string, rate = 1): { words: string[]; wtimes: number[]; wdurations: number[]; total: number } {
  const words = text.split(/\s+/).filter(Boolean);
  const wtimes: number[] = [], wdurations: number[] = [];
  let t = 0;
  for (const w of words) {
    const syllables = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
    const d = (140 + 120 * syllables) / rate;
    wtimes.push(t);
    wdurations.push(d);
    t += d + (/[,;:]$/.test(w) ? 180 : /[.!?]$/.test(w) ? 320 : 30) / rate;
  }
  return { words, wtimes, wdurations, total: t };
}

export function browserVoice(voice: SpeechSynthesisVoice | null): InterviewVoice {
  let cancelled = false;
  return {
    kind: "browser",
    label: voice ? voice.name.replace(/\s*-\s*English.*$/i, "").replace(/^Microsoft\s+/i, "") : "Browser voice",
    async speak(text, head, onCaption) {
      cancelled = false;
      onCaption?.(text);
      for (const sentence of splitSentences(speakable(text))) {
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(sentence);
          if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-GB";
          u.rate = 1;
          let started = false;
          const lips = () => {
            if (started || !head) return;
            started = true;
            const timing = estimateWordTimings(sentence);
            const ctx = head.audioCtx;
            const silent = ctx.createBuffer(1, Math.max(1, Math.ceil((timing.total / 1000) * ctx.sampleRate)), ctx.sampleRate);
            head.speakAudio({ audio: silent, words: timing.words, wtimes: timing.wtimes, wdurations: timing.wdurations });
          };
          u.onstart = lips;
          u.onend = () => { head?.stopSpeaking(); resolve(); };
          u.onerror = () => { head?.stopSpeaking(); resolve(); };
          window.speechSynthesis.speak(u);
          // Some voices never fire onstart: move the lips anyway.
          setTimeout(lips, 400);
        });
      }
    },
    stop(head) {
      cancelled = true;
      window.speechSynthesis.cancel();
      head?.stopSpeaking();
    },
  };
}

export const silentVoice: InterviewVoice = {
  kind: "silent",
  label: "Captions only",
  async speak(text, _head, onCaption) {
    onCaption?.(text);
  },
  stop() {},
};
