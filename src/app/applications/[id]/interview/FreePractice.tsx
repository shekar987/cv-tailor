"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { checkStar, type FreeQuestion, type StarScore } from "@/lib/freePractice";

type Props = {
  questions: FreeQuestion[];
  company?: string;
  onDone: () => void;
};

type PartKey = "situation" | "task" | "action" | "result";
const PART_LABELS: Record<PartKey, string> = {
  situation: "Situation",
  task: "Task",
  action: "Action",
  result: "Result",
};

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function FreePractice({ questions, company, onDone }: Props) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => Array(questions.length).fill(""));
  const [scores, setScores] = useState<(StarScore | null)[]>(() => Array(questions.length).fill(null));
  const [checked, setChecked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [listening, setListening] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const question = questions[index];

  // Count-up timer, reset on each new question
  useEffect(() => {
    if (!started || done) return;
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, done, index]);

  // Detect browser speech support (client only)
  const hasSpeech =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-GB";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcript = Array.from(e.results as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join(" ");
      setAnswers((prev) => {
        const next = [...prev];
        next[index] = (next[index] + " " + transcript).trim();
        return next;
      });
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleSpeech() {
    if (listening) stopListening();
    else startListening();
  }

  function handleCheck() {
    const score = checkStar(answers[index]);
    setScores((prev) => {
      const next = [...prev];
      next[index] = score;
      return next;
    });
    setChecked(true);
  }

  const handleNext = useCallback(() => {
    if (!checked) handleCheck();
    if (index < questions.length - 1) {
      setIndex((i) => i + 1);
      setChecked(false);
      stopListening();
      setTimeout(() => textareaRef.current?.focus(), 50);
    } else {
      setDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, index, questions.length]);

  // ── Summary screen ──────────────────────────────────────────────────────────

  if (done) {
    const totalParts = scores.reduce((sum, s) => sum + (s?.parts ?? 0), 0);
    const maxParts = questions.length * 4;
    return (
      <div className="freePractice">
        <div className="freePractice__header">
          <span className="label">Practice complete</span>
        </div>
        <p className="freePractice__copy">
          Free practice. We check the shape of your answer (STAR), not whether it is right.
        </p>
        <table className="freePractice__table" aria-label="Practice results">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">S</th>
              <th scope="col">T</th>
              <th scope="col">A</th>
              <th scope="col">R</th>
              <th scope="col">Number</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q, i) => {
              const s = scores[i];
              return (
                <tr key={q.id}>
                  <td className="freePractice__intentCell">{q.intent}</td>
                  {(["situation", "task", "action", "result"] as PartKey[]).map((part) => (
                    <td
                      key={part}
                      className={s?.check[part] ? "freePractice__tick" : "freePractice__miss"}
                      aria-label={`${PART_LABELS[part]}: ${s?.check[part] ? "present" : "missing"}`}
                    >
                      {s?.check[part] ? "✓" : "·"}
                    </td>
                  ))}
                  <td
                    className={
                      s?.check.resultHasNumber
                        ? "freePractice__tick"
                        : s?.check.result
                          ? "freePractice__warn"
                          : "freePractice__miss"
                    }
                    aria-label={`Number in result: ${s?.check.resultHasNumber ? "yes" : s?.check.result ? "missing" : "n/a"}`}
                  >
                    {s?.check.resultHasNumber ? "✓" : s?.check.result ? "Missing" : "·"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="freePractice__copy" style={{ marginTop: "0.75rem" }}>
          {totalParts} of {maxParts} STAR parts present across all answers.
        </p>
        <div className="freePractice__actions">
          <Button onClick={onDone}>Close</Button>
        </div>
      </div>
    );
  }

  // ── Pre-start overview ──────────────────────────────────────────────────────

  if (!started) {
    const companyPart = company ? ` at ${company}` : "";
    return (
      <div className="freePractice">
        <div className="freePractice__header">
          <span className="label">Free practice · {questions.length} questions</span>
        </div>
        <p className="freePractice__copy">
          Free practice. We check the shape of your answer (STAR), not whether it is right.
          {companyPart ? ` Practice for your interview${companyPart}.` : ""}
        </p>
        <ol className="freePractice__preview" aria-label="Questions">
          {questions.map((q) => (
            <li key={q.id}>{q.intent}</li>
          ))}
        </ol>
        <div className="freePractice__actions">
          <Button
            onClick={() => {
              setStarted(true);
              setTimeout(() => textareaRef.current?.focus(), 50);
            }}
          >
            Start practice
          </Button>
        </div>
      </div>
    );
  }

  // ── Per-question screen ─────────────────────────────────────────────────────

  const score = scores[index];

  return (
    <div className="freePractice">
      <div className="freePractice__header">
        <span className="label">
          Question {index + 1} of {questions.length}
        </span>
        <span
          className="freePractice__timer"
          role="timer"
          aria-label={`Time elapsed: ${formatTime(elapsed)}`}
          aria-live="off"
        >
          {formatTime(elapsed)}
        </span>
      </div>

      <p className="freePractice__question" aria-live="polite">
        {question.text}
      </p>

      {question.suggestedStory && (
        <details className="freePractice__hint">
          <summary>Suggested story from your CV</summary>
          <p className="freePractice__hintText">{question.suggestedStory}</p>
        </details>
      )}

      <label className="label" htmlFor="free-answer">
        Your answer
      </label>
      <textarea
        id="free-answer"
        ref={textareaRef}
        className="textInput freePractice__textarea"
        rows={6}
        value={answers[index]}
        onChange={(e) => {
          const val = e.target.value;
          setAnswers((prev) => {
            const next = [...prev];
            next[index] = val;
            return next;
          });
          if (checked) setChecked(false);
        }}
        placeholder="Type or speak your answer…"
        aria-label="Your answer"
      />

      <div className="freePractice__row">
        {hasSpeech && (
          <Button variant="ghost" onClick={toggleSpeech} aria-pressed={listening}>
            {listening ? "Stop listening" : "Speak my answer"}
          </Button>
        )}
        {!checked && (
          <Button
            variant="secondary"
            onClick={handleCheck}
            disabled={!answers[index].trim()}
          >
            Check structure
          </Button>
        )}
      </div>

      {checked && score && (
        <div className="freePractice__checklist" role="status" aria-live="polite">
          <p className="label" style={{ marginBottom: "0.5rem" }}>
            Structure check · {score.label}
          </p>
          <ul className="freePractice__starList" aria-label="STAR structure">
            {(["situation", "task", "action", "result"] as PartKey[]).map((part) => {
              const present = score.check[part];
              return (
                <li
                  key={part}
                  className={present ? "freePractice__starItem--present" : "freePractice__starItem--missing"}
                  data-present={present ? "true" : "false"}
                >
                  <span className="freePractice__partLabel">{PART_LABELS[part]}</span>
                  <span>{present ? "Present" : "Missing"}</span>
                  {part === "result" && present && !score.check.resultHasNumber && (
                    <span className="freePractice__partNote">
                      Add a number to strengthen this.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {score.parts === 4 && (
            <p className="freePractice__copy" style={{ marginTop: "0.5rem" }}>
              All four parts present.{" "}
              {!score.check.resultHasNumber && "Add a number to your result if you can."}
            </p>
          )}
        </div>
      )}

      <div className="freePractice__actions">
        <Button onClick={handleNext} disabled={!answers[index].trim() && !checked}>
          {index < questions.length - 1 ? "Next question →" : "Finish practice"}
        </Button>
        {index > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              stopListening();
              setIndex((i) => i - 1);
              setChecked(!!scores[index - 1]);
            }}
          >
            ← Back
          </Button>
        )}
      </div>

      <p className="freePractice__copy" style={{ marginTop: "0.75rem" }}>
        Free practice. We check the shape of your answer (STAR), not whether it is right.
      </p>
    </div>
  );
}
