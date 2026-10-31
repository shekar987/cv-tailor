"use client";

// "Form answers" on /app (31 Oct 2026, Chunk 6): the answer bank
// (lib/answerBank) to copy into an application form — each built from the
// user's own Eligibility answers on Customize — and a box that reads a
// question pasted from the form and shows the stored answer that fits.
// Consent and criminal-record questions are never answered.
import { useMemo, useState } from "react";
import Link from "next/link";
import { buildAnswerBank, matchQuestion, answerNote, BLOCKED_MESSAGES, type AnswerFacts } from "@/lib/answerBank";

export default function FormAnswers({ facts }: { facts: AnswerFacts | null }) {
  const bank = useMemo(() => buildAnswerBank(facts), [facts]);
  const [copied, setCopied] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const match = useMemo(() => matchQuestion(question), [question]);
  const matched = match.key ? bank.find((e) => e.key === match.key) ?? null : null;
  const note = answerNote(match, facts);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 2000);
    } catch {
      setCopied(null);
    }
  }

  const unanswered = bank.every((e) => e.answer === null);

  return (
    <section className="ruledCard formAnswers" aria-labelledby="form-answers-title" data-form-answers>
      <h2 id="form-answers-title" className="label">Form answers</h2>
      <p className="formAnswers__intro">
        From your Eligibility answers on <Link href="/customize#eligibility">Customize</Link>. Copy them into the application form. Consent and criminal-record questions are never filled in: answer those yourself.
      </p>
      {unanswered ? (
        <p className="formAnswers__empty">Answer the Eligibility questions on Customize and your form answers appear here.</p>
      ) : (
        <ul className="formAnswers__list">
          {bank.map((e) => (
            <li key={e.key} className="formAnswers__item" data-answer-key={e.key}>
              <span className="formAnswers__q">{e.label}</span>
              {e.answer ? (
                <>
                  <span className="formAnswers__a">{e.answer}</span>
                  <button type="button" className="linkBtn" onClick={() => void copy(e.key, e.answer!)} data-copy-answer={e.key}>
                    {copied === e.key ? "Copied" : "Copy"}
                  </button>
                </>
              ) : (
                <span className="formAnswers__a formAnswers__a--unset">Not answered on Customize</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="formAnswers__ask">
        <span>Paste a question from the form</span>
        <input
          className="textInput"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
          placeholder="Will you now or in the future require sponsorship?"
          data-form-question
        />
      </label>
      {question.trim() && (
        <div className="formAnswers__match" aria-live="polite" data-form-match={match.blocked ?? match.key ?? "none"}>
          {match.blocked ? (
            <p>{BLOCKED_MESSAGES[match.blocked]}</p>
          ) : matched?.answer ? (
            <>
              <p>
                <strong>{matched.answer}</strong>{" "}
                <button type="button" className="linkBtn" onClick={() => void copy(`match:${matched.key}`, matched.answer!)}>
                  {copied === `match:${matched.key}` ? "Copied" : "Copy"}
                </button>
              </p>
              {note && <p className="formAnswers__note">{note}</p>}
            </>
          ) : matched ? (
            <p>That is the “{matched.label}” question, which your Eligibility answers on Customize don&apos;t cover yet.</p>
          ) : (
            <p>No stored answer fits that question. Answer it yourself.</p>
          )}
        </div>
      )}
    </section>
  );
}
