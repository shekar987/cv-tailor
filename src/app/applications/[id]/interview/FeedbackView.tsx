"use client";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { CHECK_LABELS, type InterviewFeedback } from "@/lib/mockInterview";

// The feedback after an interview. Every ✓ carries the words from your answer
// that earned it (lib/mockInterview drops a pass whose quote isn't there),
// figures are checked against your CV, and the headline is computed from the
// checks — never a grade written by the model.

type PlannedQuestion = { id: string; text: string; intent?: string };

function formatSeconds(s: number | null): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

export default function FeedbackView({ feedback, questions, roundLabel, onAgain }: { feedback: InterviewFeedback; questions: PlannedQuestion[]; roundLabel: string; onAgain: () => void }) {
  const intentOf = new Map(questions.map((q) => [q.id, q.intent ?? ""]));
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
            {a.metrics.figuresNotInCv.length > 0 && (
              <li>
                <Badge variant="dot" tone="miss">!</Badge>
                <span>You said {a.metrics.figuresNotInCv.join(", ")} — your CV doesn&apos;t show {a.metrics.figuresNotInCv.length === 1 ? "that figure" : "those figures"}. An interviewer may ask where it comes from.</span>
              </li>
            )}
            {a.metrics.fillers > 2 && (
              <li>
                <Badge variant="dot" tone="rec">?</Badge>
                <span>{a.metrics.fillers} filler words ({a.metrics.fillerWords.join(", ")}). A short pause sounds more confident.</span>
              </li>
            )}
            {a.metrics.weCount >= 3 && a.metrics.weCount > a.metrics.iCount * 2 && (
              <li>
                <Badge variant="dot" tone="rec">?</Badge>
                <span>You said &ldquo;we&rdquo; {a.metrics.weCount} times and &ldquo;I&rdquo; {a.metrics.iCount}. Say what you did yourself.</span>
              </li>
            )}
          </ul>
          {a.tryInstead && (
            <p className="interviewTry"><strong>Try this instead:</strong> {a.tryInstead}</p>
          )}
          {(a.tryInsteadFlags ?? []).length > 0 && (
            <p className="interviewTry" data-try-flags>
              <span className="prepTrace warn">Not from your CV: rephrase before you say this</span>{" "}
              {(a.tryInsteadFlags ?? []).map((s, i) => (
                <span key={i}>
                  &ldquo;{s}&rdquo;{i < (a.tryInsteadFlags ?? []).length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
          {a.cvLine && (
            <p className="interviewCvLine"><strong>From your CV:</strong> {a.cvLine}</p>
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
