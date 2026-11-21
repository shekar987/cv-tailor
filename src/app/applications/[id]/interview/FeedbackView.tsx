"use client";

import { useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import {
  CHECK_LABELS,
  RUBRIC_ROW_LABELS,
  RUBRIC_LEVEL_LABELS,
  paceFlag,
  lengthFlag,
  type AnswerFeedback,
  type InterviewFeedback,
  type RubricRow,
  type StrongerSentence,
} from "@/lib/mockInterview";

// The feedback after an interview. Every ✓ carries the words from your answer
// that earned it (lib/mockInterview drops a pass whose quote isn't there),
// figures are checked against your CV, and the headline is computed from the
// checks — never a grade written by the model. Chunk 32 adds the per-answer
// STAR rubric (Situation/Action/Result/Relevance), delivery stats, a stronger
// version with "traced" badges, and a "Retry this answer" button.

type PlannedQuestion = { id: string; text: string; intent?: string };

function formatSeconds(s: number | null): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

// Clear rubric rows out of four, for the before/after score.
function clearCount(a: AnswerFeedback): number {
  return (a.rubricRows ?? []).filter((r) => r.level === "clear").length;
}

function RubricRows({ rows }: { rows: RubricRow[] }) {
  return (
    <ul className="interviewRubric" data-interview-rubric>
      {rows.map((r) => (
        <li key={r.key} className="interviewRubric__row" data-level={r.level}>
          <span className="interviewRubric__label">{RUBRIC_ROW_LABELS[r.key]}</span>
          <span className="interviewRubric__level" data-level={r.level}>{RUBRIC_LEVEL_LABELS[r.level]}</span>
          {r.quote && <span className="interviewRubric__quote">&ldquo;{r.quote}&rdquo;</span>}
        </li>
      ))}
    </ul>
  );
}

function DeliveryStats({ a }: { a: AnswerFeedback }) {
  const m = a.metrics;
  const pace = paceFlag(m.wpm);
  const len = lengthFlag(a.rubric, m.seconds);
  return (
    <ul className="interviewStats" aria-label="Delivery">
      {m.seconds != null && (
        <li data-flag={len ? "warn" : "ok"}>
          <span className="interviewStats__v">{formatSeconds(m.seconds)}</span>
          <span className="interviewStats__k">length{len === "short" ? " · a bit short" : len === "long" ? " · a bit long" : ""}</span>
        </li>
      )}
      {m.wpm != null && (
        <li data-flag={pace ? "warn" : "ok"}>
          <span className="interviewStats__v">{m.wpm} wpm</span>
          <span className="interviewStats__k">pace{pace === "slow" ? " · slow" : pace === "fast" ? " · fast" : ""}</span>
        </li>
      )}
      {m.pauseSeconds != null && m.pauseSeconds >= 1 && (
        <li data-flag={m.pauseSeconds >= 3 ? "warn" : "ok"}>
          <span className="interviewStats__v">{m.pauseSeconds.toFixed(1)} s</span>
          <span className="interviewStats__k">longest pause</span>
        </li>
      )}
      <li data-flag={m.fillers > 2 ? "warn" : "ok"}>
        <span className="interviewStats__v">{m.fillers}</span>
        <span className="interviewStats__k">filler word{m.fillers === 1 ? "" : "s"}</span>
      </li>
      <li data-flag={m.weCount >= 3 && m.weCount > m.iCount * 2 ? "warn" : "ok"}>
        <span className="interviewStats__v">{m.iCount} / {m.weCount}</span>
        <span className="interviewStats__k">&ldquo;I&rdquo; / &ldquo;we&rdquo;</span>
      </li>
    </ul>
  );
}

function StrongerVersion({ a }: { a: AnswerFeedback }) {
  // Chunk 32 stores the rewrite sentence by sentence with a traced flag each.
  // Older feedback has only the string + flags — fall back to that.
  const sentences: StrongerSentence[] | null = a.strongerSentences && a.strongerSentences.length > 0 ? a.strongerSentences : null;
  if (!sentences && !a.tryInstead) return null;
  return (
    <div className="interviewStronger" data-stronger-version>
      <div className="interviewStronger__head">A stronger version of your answer</div>
      {sentences ? (
        <p className="interviewStronger__body">
          {sentences.map((s, i) => (
            <span key={i} className="interviewStronger__sentence" data-traced={s.traced ? "true" : "false"} data-placeholder={s.placeholder ? "true" : "false"}>
              {s.placeholder ? <em>{s.text}</em> : s.text}
              {s.traced ? (
                <span className="prepTrace ok interviewStronger__badge" title={s.placeholder ? "Fill in your own real result" : "Traced to your answer or CV"}>{s.placeholder ? "your result" : "traced"}</span>
              ) : (
                <span className="prepTrace warn interviewStronger__badge" title="Not found in your answer or CV — check it before you say it">not from your CV</span>
              )}{" "}
            </span>
          ))}
        </p>
      ) : (
        <>
          <p className="interviewStronger__body">{a.tryInstead}</p>
          {(a.tryInsteadFlags ?? []).length > 0 && (
            <p className="interviewTry" data-try-flags>
              <span className="prepTrace warn">Not from your CV: rephrase before you say this</span>{" "}
              {(a.tryInsteadFlags ?? []).map((s, i) => (
                <span key={i}>&ldquo;{s}&rdquo;{i < (a.tryInsteadFlags ?? []).length - 1 ? " · " : ""}</span>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// The "Retry this answer" panel: type the answer again, score it, and show the
// rubric before and after. Session-only — nothing is stored.
function RetryPanel({ interviewId, question, before }: { interviewId: string; question: PlannedQuestion; before: AnswerFeedback }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [after, setAfter] = useState<AnswerFeedback | null>(null);
  // When the retry box was opened — a rough "time taken" for the pace stat.
  // Set on open (below); 0 until then.
  const startedAt = useRef(0);

  async function submit() {
    const answer = draft.trim();
    if (!answer || busy) return;
    setBusy(true);
    setError("");
    try {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", interviewId, questionId: question.id, answer, mode: "typed", seconds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Couldn't score that answer."); return; }
      setAfter(data.answer as AnswerFeedback);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); startedAt.current = Date.now(); }} data-retry-open>Retry this answer</Button>
    );
  }
  return (
    <div className="interviewRetry" data-retry-panel>
      <p className="interviewRetry__q">{question.text}</p>
      {!after && (
        <>
          <textarea
            className="interviewTyped"
            rows={4}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Answer again, as you would say it out loud. Lead with the situation, say what you did yourself, finish with the result."
            aria-label="Your answer again"
          />
          <div className="actions">
            <Button onClick={submit} disabled={busy || !draft.trim()} data-retry-submit>{busy ? "Scoring…" : "Score my new answer"}</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setDraft(""); }}>Cancel</Button>
          </div>
          {error && <p className="limitNotice" role="alert">{error}</p>}
          <p className="fitEvidence">This doesn&apos;t use a tailored CV — retry as often as you like.</p>
        </>
      )}
      {after && (
        <div className="interviewBeforeAfter" data-before-after>
          <div className="interviewBeforeAfter__cols">
            <div className="interviewBeforeAfter__col">
              <div className="label">Before · {clearCount(before)} of 4 clear</div>
              {before.rubricRows && <RubricRows rows={before.rubricRows} />}
            </div>
            <div className="interviewBeforeAfter__col">
              <div className="label">After · {clearCount(after)} of 4 clear</div>
              {after.rubricRows && <RubricRows rows={after.rubricRows} />}
            </div>
          </div>
          <StrongerVersion a={after} />
          <div className="actions">
            <Button variant="ghost" onClick={() => { setAfter(null); setDraft(""); }}>Try again</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setAfter(null); setDraft(""); }}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedbackView({ feedback, questions, roundLabel, onAgain, interviewId }: { feedback: InterviewFeedback; questions: PlannedQuestion[]; roundLabel: string; onAgain: () => void; interviewId?: string }) {
  const intentOf = new Map(questions.map((q) => [q.id, q.intent ?? ""]));
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const r = feedback.readout;
  return (
    <div className="interviewFeedback" data-interview-feedback>
      <Card className="interviewReadout">
        <div className="label">{roundLabel} · your readout</div>
        <div className="interviewReadout__head">
          <span className="interviewBand" data-band={r.band} data-readout-band={r.band}>{r.label}</span>
          <span className="interviewReadout__score">{r.passed} of {r.total} checks met</span>
        </div>
        {r.priorities.length > 0 && (
          <>
            <div className="interviewReadout__sub">Work on these first</div>
            <ol className="interviewReadout__list">
              {r.priorities.map((p) => <li key={p}>{p}</li>)}
            </ol>
          </>
        )}
        <p className="fitEvidence">
          Your answers were transcribed by your browser, so a mis-heard word isn&apos;t your mistake. Technical accuracy isn&apos;t judged here — only how you answered.
          {feedback.partial ? " The AI review didn't come back this time, so these checks are the ones code can make on its own." : ""}
        </p>
      </Card>

      {feedback.answers.map((a, i) => (
        <Card key={a.questionId} className="interviewAnswerCard">
          <div className="label">Question {i + 1}</div>
          <p className="interviewAnswerCard__q">{a.question}</p>
          {intentOf.get(a.questionId) && <p className="interviewAnswerCard__intent">What it was testing: {intentOf.get(a.questionId)}</p>}
          <details className="interviewAnswerCard__answer">
            <summary>Your answer{a.metrics.seconds != null ? ` · ${formatSeconds(a.metrics.seconds)}` : ""} · {a.metrics.words} words</summary>
            <p>{a.answer}</p>
          </details>

          {a.rubricRows && a.rubricRows.length > 0 ? (
            <RubricRows rows={a.rubricRows} />
          ) : (
            <ul className="atsList">
              {a.checks.map((c) => (
                <li key={c.key}>
                  <Badge variant="dot" tone={c.pass ? "hit" : "miss"}>{c.pass ? "✓" : "!"}</Badge>
                  <span>
                    {CHECK_LABELS[c.key]}
                    {c.pass && c.quote ? <span className="interviewQuote"> — &ldquo;{c.quote}&rdquo;</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <DeliveryStats a={a} />

          {a.metrics.figuresNotInCv.length > 0 && (
            <p className="interviewNotice" role="note">
              You said {a.metrics.figuresNotInCv.join(", ")} — your CV doesn&apos;t show {a.metrics.figuresNotInCv.length === 1 ? "that figure" : "those figures"}. An interviewer may ask where it comes from.
            </p>
          )}

          <StrongerVersion a={a} />

          {a.cvLine && (
            <p className="interviewCvLine"><strong>From your CV:</strong> {a.cvLine}</p>
          )}

          {interviewId && questionById.get(a.questionId) && !a.rubric.startsWith("logistics_") && (
            <div className="interviewAnswerCard__actions">
              <RetryPanel interviewId={interviewId} question={questionById.get(a.questionId)!} before={a} />
            </div>
          )}
        </Card>
      ))}

      <div className="actions">
        <Button onClick={onAgain}>Try another round</Button>
        <Button variant="secondary" href="/applications">Back to applications</Button>
      </div>
    </div>
  );
}
