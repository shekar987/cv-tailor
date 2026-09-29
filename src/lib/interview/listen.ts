// Listening to the candidate (browser-only): the Web Speech API, British
// English, continuous with interim results. Chrome and Edge send the audio to
// Google or Microsoft to transcribe it (the page says so); Firefox has no
// recognition, so the page offers typing. Recognition ends on its own after a
// pause or a network hiccup, so it is restarted for as long as we listen.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type Listener = {
  start(): void;
  // Stop listening; resolves once the last result is in.
  stop(): void;
  abort(): void;
  reset(): void;
  lastHeardAt(): number;
};

export function recognitionSupported(): boolean {
  const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createListener(handlers: {
  onText: (finalText: string, interimText: string) => void;
  onError: (error: "not-allowed" | "no-speech" | "network" | "other", detail: string) => void;
}): Listener | null {
  const w = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let rec: Recognition | null = null;
  let active = false;
  let finalText = "";
  let heardAt = 0;

  const make = () => {
    const r = new Ctor();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    // Each session's results are its own; earlier sessions' finals are kept.
    let sessionFinal = "";
    r.onresult = (ev) => {
      let interim = "";
      let fin = "";
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) fin += res[0].transcript + " ";
        else interim += res[0].transcript + " ";
      }
      sessionFinal = fin;
      heardAt = performance.now();
      handlers.onText(`${finalText} ${sessionFinal}`.replace(/\s+/g, " ").trim(), interim.replace(/\s+/g, " ").trim());
    };
    r.onerror = (ev) => {
      if (ev.error === "aborted") return;
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        active = false;
        handlers.onError("not-allowed", ev.error);
      } else if (ev.error === "no-speech") {
        handlers.onError("no-speech", ev.error);
      } else if (ev.error === "network") {
        handlers.onError("network", ev.error);
      } else {
        handlers.onError("other", ev.error);
      }
    };
    r.onend = () => {
      finalText = `${finalText} ${sessionFinal}`.replace(/\s+/g, " ").trim();
      sessionFinal = "";
      if (active) {
        try {
          rec = make();
          rec.start();
        } catch {
          active = false;
        }
      }
    };
    return r;
  };

  return {
    start() {
      if (active) return;
      active = true;
      heardAt = performance.now();
      rec = make();
      try {
        rec.start();
      } catch {
        active = false;
      }
    },
    stop() {
      active = false;
      rec?.stop();
    },
    abort() {
      active = false;
      rec?.abort();
    },
    reset() {
      finalText = "";
    },
    lastHeardAt: () => heardAt,
  };
}
