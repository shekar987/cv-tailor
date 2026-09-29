// The interview room's turn-taking, as a pure reducer (node:test). The page
// turns each state into effects: speaking plays the interviewer's line with
// the microphone off (no echo), listening runs speech recognition, thinking
// waits for /api/interview, and the countdown decides when a spoken answer
// is finished.

export type FlowPhase = "setup" | "starting" | "speaking" | "listening" | "thinking" | "paused" | "finishing" | "feedback" | "error";

export type FlowQuestion = { id: string; text: string };

export type FlowState = {
  phase: FlowPhase;
  // What the interviewer is saying (or last said) — also the caption.
  say: string;
  question: FlowQuestion | null;
  // The candidate's answer so far: final speech plus the live interim part.
  finalText: string;
  interimText: string;
  answers: number;
  done: boolean;
  degraded: boolean;
  error: string | null;
  // Where to go back to after a pause.
  resumeTo: "speaking" | "listening" | null;
};

export type FlowEvent =
  | { type: "START" }
  | { type: "STARTED"; say: string; question: FlowQuestion | null; answers: number }
  | { type: "SPEECH_ENDED" }
  | { type: "INTERRUPT" }
  | { type: "HEARD"; finalText: string; interimText: string }
  | { type: "SUBMIT" }
  | { type: "REPLY"; say: string; question: FlowQuestion | null; done: boolean; degraded?: boolean }
  | { type: "REPEAT" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "FINISH" }
  | { type: "FEEDBACK" }
  | { type: "FAILED"; error: string };

export const initialFlow: FlowState = {
  phase: "setup",
  say: "",
  question: null,
  finalText: "",
  interimText: "",
  answers: 0,
  done: false,
  degraded: false,
  error: null,
  resumeTo: null,
};

export const answerText = (s: FlowState) => `${s.finalText} ${s.interimText}`.replace(/\s+/g, " ").trim();

export function flow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "START":
      return state.phase === "setup" || state.phase === "error" ? { ...initialFlow, phase: "starting" } : state;
    case "STARTED":
      return { ...state, phase: "speaking", say: event.say, question: event.question, answers: event.answers, error: null };
    case "SPEECH_ENDED":
    case "INTERRUPT":
      // After the goodbye there is nothing to answer: straight to feedback.
      if (state.phase !== "speaking") return state;
      return state.done ? { ...state, phase: "finishing" } : { ...state, phase: "listening", finalText: "", interimText: "" };
    case "HEARD":
      return state.phase === "listening" ? { ...state, finalText: event.finalText, interimText: event.interimText } : state;
    case "SUBMIT":
      return state.phase === "listening" && answerText(state) ? { ...state, phase: "thinking" } : state;
    case "REPLY":
      return {
        ...state,
        phase: "speaking",
        say: event.say,
        question: event.question ?? state.question,
        answers: state.answers + 1,
        done: event.done,
        degraded: state.degraded || !!event.degraded,
        finalText: "",
        interimText: "",
      };
    case "REPEAT":
      return state.phase === "listening" ? { ...state, phase: "speaking", finalText: "", interimText: "" } : state;
    case "PAUSE":
      return state.phase === "speaking" || state.phase === "listening" ? { ...state, phase: "paused", resumeTo: state.phase } : state;
    case "RESUME":
      return state.phase === "paused" ? { ...state, phase: state.resumeTo ?? "listening", resumeTo: null } : state;
    case "FINISH":
      return state.phase === "feedback" || state.phase === "finishing" ? state : { ...state, phase: "finishing" };
    case "FEEDBACK":
      return { ...state, phase: "feedback" };
    case "FAILED":
      return { ...state, phase: state.phase === "thinking" ? "listening" : "error", error: event.error };
  }
}

// ── When is a spoken answer finished? ────────────────────────────────────────

export const MIN_AUTO_WORDS = 5;
export const COUNTDOWN_DELAY_MS = 1000;

export type SilenceDecision = { action: "wait" } | { action: "countdown"; progress: number } | { action: "submit" };

// `silentMs`: how long since the last speech result. After a short grace the
// countdown ring fills over `windowMs`; any new speech resets it. Short
// fragments ("um, so…") never auto-send.
export function silenceDecision(silentMs: number, words: number, windowMs: number): SilenceDecision {
  if (words < MIN_AUTO_WORDS || silentMs < COUNTDOWN_DELAY_MS) return { action: "wait" };
  const progress = (silentMs - COUNTDOWN_DELAY_MS) / Math.max(1, windowMs);
  return progress >= 1 ? { action: "submit" } : { action: "countdown", progress };
}
