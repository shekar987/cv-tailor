"use client";

// The first-run checklist (12 Nov 2026, Chunk 24; the rules are lib/firstRun):
// 1. upload your CV and confirm what we read from it, 2. answer right to work,
// 3. paste your first job. One step is current and carries the filled action;
// each step ticks on its own fact (Chunk 29), so an answer given early ticks at
// once. Shown in place of Schedule's empty plan and under My CV's saved CV, for
// an account with no application yet.
//
// Presentational: each page passes its own facts and its own save for step 2,
// so My CV saves through the Eligibility it already holds (an unsaved draft
// there is never written by this click) and Schedule reads the stored settings
// first (lib/cvStore refuses a write after a failed read).
//
// Step 2 is answered HERE whenever the page can save it (Chunk 29: the audit
// found a new user could not tell whether Eligibility or Right to work on the
// CV completed it). Where it can't, the link opens the one question on My CV.

// Relative imports so tests/firstRunGuide can render it under node:test.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Button from "./ui/Button.tsx";
import Icon from "./ui/Icon.tsx";
import StatusText from "./ui/StatusText.tsx";
import { firstRunStep, rtwChoiceLabel, RTW_CHOICES, stepState, type FirstRunFacts, type RtwStatus } from "../lib/firstRun.ts";

// The right-to-work question on My CV: opens Eligibility and focuses the one select.
export const RTW_QUESTION_HREF = "/customize#eligibility-rtw";

type Props = {
  facts: FirstRunFacts;
  // Step 1's action before a CV exists. Null where the upload box is already on screen (My CV).
  cvHref?: string | null;
  // Step 1's action once the CV is saved but its details are not confirmed.
  detailsHref?: string;
  // My CV: scroll to Your details on the same page instead of following a link.
  onCheckDetails?: () => void;
  // Step 2's three answers; resolves true once saved. Without it, step 2 links to the question on My CV.
  onChooseRtw?: (status: Exclude<RtwStatus, "unknown">) => Promise<boolean>;
  // My CV: open the question on the same page instead of following a link.
  onOpenRtw?: () => void;
  // Another save of the same answers is in flight (My CV's Eligibility Save): wait for it.
  busy?: boolean;
  footer?: ReactNode;
};

export default function FirstRunGuide({
  facts,
  cvHref = "/customize#master-cv",
  detailsHref = "/customize#your-details",
  onCheckDetails,
  onChooseRtw,
  onOpenRtw,
  busy = false,
  footer,
}: Props) {
  const [saving, setSaving] = useState<RtwStatus | null>(null);
  const [error, setError] = useState("");
  // The answer's buttons unmount once it is saved: focus moves on to the next action.
  const [answered, setAnswered] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!answered) return;
    rootRef.current?.querySelector<HTMLElement>("[data-first-run-job], [data-first-run-details], [data-first-run-cv], [data-first-run-rtw-answer] a, [data-first-run-rtw-answer] button")?.focus();
  }, [answered]);
  const step = firstRunStep(facts);
  const cvState = stepState(facts, "cv");
  const rtwState = stepState(facts, "rtw");
  const jobState = stepState(facts, "job");

  async function choose(status: Exclude<RtwStatus, "unknown">) {
    if (!onChooseRtw || saving) return;
    setSaving(status);
    setError("");
    const ok = await onChooseRtw(status).catch(() => false);
    setSaving(null);
    if (!ok) setError("Couldn't save your answer. Check your connection and try again, or answer under Eligibility on My CV.");
    else setAnswered(true);
  }

  const rtwLink = (label: string) =>
    onOpenRtw ? (
      <button type="button" className="inlineLink" onClick={onOpenRtw} data-first-run-rtw-link>
        {label}
      </button>
    ) : (
      <Link href={RTW_QUESTION_HREF} className="inlineLink" data-first-run-rtw-link>
        {label}
      </Link>
    );

  return (
    <section ref={rootRef} id="first-run" className="firstRun" aria-labelledby="first-run-title" data-first-run data-first-run-step={step ?? "done"}>
      <h2 id="first-run-title" className="firstRun__title">Three steps to your first tailored CV</h2>
      <ol className="firstRun__steps">
        <li className="firstRun__step" data-step="cv" data-state={cvState}>
          <span className="firstRun__mark" aria-hidden="true">{cvState === "done" ? <Icon name="check" /> : "1"}</span>
          <div className="firstRun__body">
            <p className="firstRun__name">
              Upload your CV and check your details{cvState === "done" && <span className="srOnly"> (done)</span>}
            </p>
            <p className="firstRun__detail">
              {cvState === "done"
                ? "Saved, and your details are confirmed. We build every tailored CV from your CV. We never add anything it does not say."
                : facts.hasCv
                  ? "Your CV is saved. Now check the details we read from it: your name, email, phone, location and education. Fix anything wrong, then confirm."
                  : "Add your main CV once: a PDF, a Word file or pasted text. We build every tailored CV from it. We never add anything it does not say."}
            </p>
            {cvState === "current" && !facts.hasCv && cvHref && (
              <div className="firstRun__actions">
                <Button href={cvHref} data-first-run-cv>Upload your CV</Button>
              </div>
            )}
            {cvState === "current" && facts.hasCv && (
              <div className="firstRun__actions">
                {onCheckDetails ? (
                  // The confirm button below it is the filled one on that page.
                  <Button onClick={onCheckDetails} variant="secondary" data-first-run-details>Check your details</Button>
                ) : (
                  <Button href={detailsHref} data-first-run-details>Check your details</Button>
                )}
              </div>
            )}
          </div>
        </li>

        <li className="firstRun__step" data-step="rtw" data-state={rtwState}>
          <span className="firstRun__mark" aria-hidden="true">{rtwState === "done" ? <Icon name="check" /> : "2"}</span>
          <div className="firstRun__body">
            <p className="firstRun__name">
              Answer one question about your right to work{rtwState === "done" && <span className="srOnly"> (done)</span>}
            </p>
            {rtwState === "done" ? (
              <p className="firstRun__detail" data-first-run-rtw-answer={facts.rtwStatus}>
                Answered: {rtwChoiceLabel(facts.rtwStatus)}. {rtwLink("Change your answer")}
              </p>
            ) : (
              <p className="firstRun__detail">
                Most UK application forms ask this near the start. We never guess it from your CV. Choose the answer that is true for you{onChooseRtw ? " here" : ""}.{facts.hasCv ? "" : " You can answer it now, before your CV."}
              </p>
            )}
            {rtwState !== "done" &&
              (onChooseRtw ? (
                <>
                  <div className="firstRun__choices" role="group" aria-label="Your right to work in the UK">
                    {RTW_CHOICES.map((c) => (
                      <button
                        key={c.status}
                        type="button"
                        className="firstRun__choice"
                        onClick={() => void choose(c.status)}
                        disabled={saving !== null || busy}
                        aria-busy={saving === c.status || undefined}
                        data-first-run-rtw={c.status}
                      >
                        <span className="firstRun__choiceLabel">{saving === c.status ? "Saving…" : c.label}</span>
                        <span className="firstRun__choiceDetail">{c.detail}</span>
                      </button>
                    ))}
                  </div>
                  {error && <StatusText role="alert">{error}</StatusText>}
                </>
              ) : (
                <div className="firstRun__actions">
                  <Button href={RTW_QUESTION_HREF} variant="secondary" data-first-run-rtw-link>Answer the question</Button>
                </div>
              ))}
          </div>
        </li>

        <li className="firstRun__step" data-step="job" data-state={jobState}>
          <span className="firstRun__mark" aria-hidden="true">3</span>
          <div className="firstRun__body">
            <p className="firstRun__name">Paste your first job</p>
            <p className="firstRun__detail">
              Paste a job description, or a link to the job, on the{" "}
              <Link href="/app" className="inlineLink" data-first-run-tailor-link>Tailor page</Link>. A free check runs first. It tells you how well you match before you use a tailored CV.
            </p>
            {/* Reachable once there is a CV; the filled button only when it is the step. */}
            {facts.hasCv && jobState !== "done" && (
              <div className="firstRun__actions">
                <Button href="/app" variant={jobState === "current" ? "primary" : "secondary"} data-first-run-job>
                  {jobState === "current" ? "Paste your first job" : "Skip to your first job"}
                </Button>
              </div>
            )}
          </div>
        </li>
      </ol>
      {footer}
    </section>
  );
}
