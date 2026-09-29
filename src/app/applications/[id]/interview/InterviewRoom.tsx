"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TalkingHead } from "@/vendor/talkinghead/talkinghead.mjs";
import Button from "@/components/ui/Button";
import { flow, initialFlow, answerText, silenceDecision, type FlowQuestion } from "@/lib/interviewFlow";
import { wordCount, isRepeatRequest, isThinkingRequest } from "@/lib/speechText";
import { createListener, recognitionSupported, type Listener } from "@/lib/interview/listen";
import type { InterviewVoice } from "@/lib/interview/voice";
import type { InterviewFeedback } from "@/lib/mockInterview";

// The live interview. Turn-taking is lib/interviewFlow's reducer; this
// component turns each phase into effects: speak with the microphone off,
// listen with a silence countdown, send the answer, speak the reply.

export type StartedInterview = {
  id: string;
  type: string;
  persona: { name: string; firstName: string; role: string; gender: "female" | "male"; kokoroVoice: string; avatar: string };
  say: string;
  question: FlowQuestion | null;
  upcoming: FlowQuestion | null;
  progress: { asked: number; total: number; answers: number; max: number };
};

type Line = { who: "interviewer" | "you"; text: string };

type Props = {
  interview: StartedInterview;
  voice: InterviewVoice;
  getHead: () => TalkingHead | null;
  typedOnly: boolean;
  silenceWindowMs: number;
  onSpeakingChange: (speaking: boolean) => void;
  onFinished: (feedback: InterviewFeedback, questions: unknown[]) => void;
  onLeave: () => void;
};

const TURN_TIMEOUT_MS = 25_000;

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function InterviewRoom({ interview, voice, getHead, typedOnly, silenceWindowMs, onSpeakingChange, onFinished, onLeave }: Props) {
  // The page mounts one room per interview (keyed by its id), so the opening
  // line is the reducer's first state.
  const [state, dispatch] = useReducer(flow, interview, (iv) =>
    flow(flow(initialFlow, { type: "START" }), { type: "STARTED", say: iv.say, question: iv.question, answers: iv.progress.answers })
  );
  const [caption, setCaption] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [{ who: "interviewer", text: interview.say }]);
  const [progress, setProgress] = useState(interview.progress);
  const [typing, setTyping] = useState(typedOnly || !recognitionSupported());
  const [typed, setTyped] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const listenerRef = useRef<Listener | null>(null);
  const answerStartRef = useRef(0);
  const upcomingRef = useRef<FlowQuestion | null>(interview.upcoming);
  const typedRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  // Read by timers and handlers; synced after every render.
  const stateRef = useRef(state);
  const answerTextRef = useRef("");
  const submitRef = useRef<(answer: string) => void>(() => {});

  // One recognizer for the whole interview.
  useEffect(() => {
    if (typing) return;
    const l = createListener({
      onText: (finalText, interimText) => dispatch({ type: "HEARD", finalText, interimText }),
      onError: (kind) => {
        if (kind === "not-allowed") {
          setTyping(true);
          setNotice("The microphone is blocked, so you can type your answers. To speak instead, allow the microphone for this site in the browser's address bar and reload.");
        } else if (kind === "network") {
          setNotice("Speech recognition lost its connection. Keep talking, or press T to type.");
        }
      },
    });
    listenerRef.current = l;
    return () => {
      l?.abort();
      listenerRef.current = null;
    };
  }, [typing]);

  // speaking: microphone off, say the line, then listen.
  useEffect(() => {
    onSpeakingChange(state.phase === "speaking");
    if (state.phase !== "speaking") return;
    let cancelled = false;
    listenerRef.current?.abort();
    const head = getHead();
    void voice.speak(state.say, head, (c) => { if (!cancelled) setCaption(c); }).then(() => {
      if (!cancelled) dispatch({ type: "SPEECH_ENDED" });
    });
    if (upcomingRef.current) voice.prefetch?.(upcomingRef.current.text);
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.say, voice, getHead, onSpeakingChange]);

  // listening: recognition on, the countdown watches the silence.
  useEffect(() => {
    if (state.phase !== "listening") return;
    answerStartRef.current = performance.now();
    if (typing) {
      typedRef.current?.focus();
      return;
    }
    const l = listenerRef.current;
    l?.reset();
    l?.start();
    const timer = setInterval(() => {
      if (!l) return;
      const silent = performance.now() - l.lastHeardAt();
      const d = silenceDecision(silent, wordCount(answerTextRef.current), silenceWindowMs);
      if (d.action === "submit") {
        setCountdown(null);
        submitRef.current(answerTextRef.current);
      } else setCountdown(d.action === "countdown" ? d.progress : null);
    }, 150);
    return () => {
      clearInterval(timer);
      setCountdown(null);
    };
  }, [state.phase, typing, silenceWindowMs]);

  // thinking: send the answer, speak the reply.
  const sendTurn = useCallback(async (answer: string): Promise<void> => {
    listenerRef.current?.stop();
    const seconds = Math.round((performance.now() - answerStartRef.current) / 1000);
    for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ action: "turn", interviewId: interview.id, answerIndex: stateRef.current.answers, answer, mode: typing ? "typed" : "voice", seconds }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.errorType === "stale_turn") {
        throw new Error("This interview moved on in another tab. Reload the page to continue there.");
      }
      if (!res.ok) throw new Error(data.error || "The interviewer didn't respond.");
      setLines((prev) => [...prev, { who: "you", text: answer }, { who: "interviewer", text: data.reply.say }]);
      if (data.progress) setProgress(data.progress);
      upcomingRef.current = data.reply.upcoming ?? null;
      setTyped("");
      if (data.degraded) setNotice("The interviewer's reply was simplified this time (the AI didn't answer), so the interview moved to the next question.");
      dispatch({ type: "REPLY", say: data.reply.say, question: data.reply.question, done: !!data.done, degraded: !!data.degraded });
      return;
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      // One silent retry after a timeout; then the answer waits to be resent.
      if (aborted && attempt === 0) continue;
      dispatch({ type: "FAILED", error: aborted ? "The interviewer took too long to reply. Send your answer again." : err instanceof Error ? err.message : "Something went wrong." });
      return;
    } finally {
      clearTimeout(timeout);
    }
    }
  }, [interview.id, typing]);

  // Every way an answer is finished comes here. "Can I have a moment?" and
  // "Could you repeat that?" are answered on the page, with no model call.
  const submitAnswer = useCallback((raw: string) => {
    if (stateRef.current.phase !== "listening") return;
    const answer = raw.trim();
    if (!answer) return;
    if (isThinkingRequest(answer)) {
      setTyped("");
      listenerRef.current?.reset();
      dispatch({ type: "HEARD", finalText: "", interimText: "" });
      setNotice("Take your time — answer when you're ready.");
      return;
    }
    if (isRepeatRequest(answer)) {
      setTyped("");
      dispatch({ type: "REPEAT" });
      return;
    }
    if (typing) dispatch({ type: "HEARD", finalText: answer, interimText: "" });
    dispatch({ type: "SUBMIT" });
    void sendTurn(answer);
  }, [typing, sendTurn]);

  useEffect(() => {
    stateRef.current = state;
    answerTextRef.current = typing ? typed : answerText(state);
    submitRef.current = submitAnswer;
  });

  // finishing: ask for the feedback.
  useEffect(() => {
    if (state.phase !== "finishing") return;
    let cancelled = false;
    listenerRef.current?.abort();
    voice.stop(getHead());
    (async () => {
      try {
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finish", interviewId: interview.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Couldn't build your feedback.");
        dispatch({ type: "FEEDBACK" });
        onFinished(data.feedback as InterviewFeedback, data.questions ?? []);
      } catch (err) {
        if (!cancelled) dispatch({ type: "FAILED", error: err instanceof Error ? err.message : "Couldn't build your feedback." });
      }
    })();
    return () => { cancelled = true; };
  }, [state.phase, interview.id, voice, getHead, onFinished]);

  const submitNow = useCallback(() => {
    submitAnswer(typing ? typed : answerText(stateRef.current));
  }, [typing, typed, submitAnswer]);

  const interrupt = useCallback(() => {
    if (stateRef.current.phase !== "speaking") return;
    voice.stop(getHead());
    dispatch({ type: "INTERRUPT" });
  }, [voice, getHead]);

  const togglePause = useCallback(() => {
    const p = stateRef.current.phase;
    if (p === "paused") dispatch({ type: "RESUME" });
    else if (p === "speaking" || p === "listening") {
      voice.stop(getHead());
      listenerRef.current?.abort();
      dispatch({ type: "PAUSE" });
    }
  }, [voice, getHead]);

  const endInterview = useCallback(() => {
    if (stateRef.current.answers === 0) {
      voice.stop(getHead());
      onLeave();
      return;
    }
    voice.stop(getHead());
    dispatch({ type: "FINISH" });
  }, [voice, getHead, onLeave]);

  // Keyboard: Enter/Space finish · Esc interrupt · R repeat · P pause · T type.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (typing && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitNow();
        }
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
      const p = stateRef.current.phase;
      if ((e.key === "Enter" || e.key === " ") && p === "listening") {
        e.preventDefault();
        submitNow();
      } else if (e.key === "Escape") {
        if (p === "speaking") interrupt();
        else setConfirmEnd(true);
      } else if ((e.key === "r" || e.key === "R") && p === "listening") {
        dispatch({ type: "REPEAT" });
      } else if (e.key === "p" || e.key === "P") {
        togglePause();
      } else if ((e.key === "t" || e.key === "T") && !typing) {
        e.preventDefault();
        listenerRef.current?.abort();
        setTyping(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, submitNow, interrupt, togglePause]);

  useEffect(() => {
    if (confirmEnd) endRef.current?.focus();
  }, [confirmEnd]);

  const phaseLabel: Record<string, string> = {
    starting: "Joining…",
    speaking: `${interview.persona.firstName} is speaking`,
    listening: typing ? "Your turn — type your answer" : "Your turn — listening",
    thinking: `${interview.persona.firstName} is thinking…`,
    paused: "Paused",
    finishing: "Writing your feedback…",
    feedback: "Finished",
    error: "Something went wrong",
    setup: "",
  };
  const live = answerText(state);

  return (
    <section className="interviewRoom" aria-label="Mock interview">
      <div className="interviewRoom__status" data-phase={state.phase}>
        <span className="interviewRoom__dot" aria-hidden="true" />
        <span aria-live="polite">{phaseLabel[state.phase]}</span>
        <span className="interviewRoom__progress">
          {progress.asked > 0 && progress.asked <= progress.total ? `Question ${progress.asked} of ${progress.total}` : "Closing questions"}
        </span>
      </div>

      <div className="interviewCaption" aria-live="polite" aria-atomic="true">
        <span className="interviewCaption__who">{interview.persona.firstName}:</span> {caption || state.say}
      </div>

      {state.phase === "listening" && !typing && (
        <div className="interviewAnswer" data-listening="true">
          <div className="interviewAnswer__label">
            You
            {countdown !== null && (
              <span className="interviewCountdown" role="timer" aria-label="Sending your answer when this fills">
                <span className="interviewCountdown__fill" style={{ transform: `scaleX(${countdown})` }} />
              </span>
            )}
          </div>
          <p className="interviewAnswer__text">{live || <span className="interviewAnswer__hint">Start speaking when you&apos;re ready. When you pause, your answer is sent after a short countdown.</span>}</p>
        </div>
      )}

      {typing && (state.phase === "listening" || state.phase === "thinking") && (
        <div className="interviewAnswer">
          <label className="interviewAnswer__label" htmlFor="interviewTyped">Your answer</label>
          <textarea
            id="interviewTyped"
            ref={typedRef}
            className="interviewTyped"
            rows={5}
            maxLength={4000}
            value={typed}
            disabled={state.phase !== "listening"}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type your answer as you would say it. Ctrl+Enter to send."
          />
        </div>
      )}

      {state.error && <p className="limitNotice" role="alert">{state.error}</p>}
      {notice && <p className="interviewNotice" role="status">{notice}</p>}

      <div className="interviewControls">
        {state.phase === "listening" && (
          <Button onClick={submitNow} disabled={!(typing ? typed.trim() : live)} data-interview-submit>
            I&apos;ve finished my answer
          </Button>
        )}
        {state.phase === "speaking" && (
          <Button variant="secondary" onClick={interrupt}>Skip to my answer</Button>
        )}
        {state.phase === "listening" && (
          <Button variant="secondary" onClick={() => dispatch({ type: "REPEAT" })}>Repeat the question</Button>
        )}
        {(state.phase === "speaking" || state.phase === "listening" || state.phase === "paused") && (
          <Button variant="ghost" onClick={togglePause}>{state.phase === "paused" ? "Resume" : "Pause"}</Button>
        )}
        {!typing && state.phase === "listening" && (
          <Button variant="ghost" onClick={() => { listenerRef.current?.abort(); setTyping(true); }}>Type instead</Button>
        )}
        {state.phase !== "finishing" && state.phase !== "feedback" && (
          <Button variant="ghost" onClick={() => setConfirmEnd(true)}>End interview</Button>
        )}
      </div>

      {confirmEnd && (
        <div className="interviewConfirm" role="group" aria-label="End the interview?">
          <span>{state.answers === 0 ? "Leave before answering anything? Your credit has been used." : "End now and get feedback on the answers you've given?"}</span>
          <Button ref={endRef} onClick={() => { setConfirmEnd(false); endInterview(); }}>{state.answers === 0 ? "Leave" : "End and get feedback"}</Button>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep going</Button>
        </div>
      )}

      <p className="interviewKeys">Keys: Enter or Space finish your answer · Esc skip or end · R repeat · P pause{typing ? "" : " · T type"}</p>

      <details className="interviewTranscript">
        <summary>Transcript so far</summary>
        <ol>
          {lines.map((l, i) => (
            <li key={i} data-who={l.who}>
              <strong>{l.who === "interviewer" ? interview.persona.firstName : "You"}:</strong> {l.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
