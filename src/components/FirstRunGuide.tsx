"use client";

// The first-run checklist (12 Nov 2026, Chunk 24; the rules are lib/firstRun):
// 1. upload your CV, 2. confirm right to work and sponsorship, 3. paste your
// first job. One step is current and carries the action; the others say what
// they are. Shown in place of What's next's empty plan and under Customise's
// saved CV, for an account with no application yet.
//
// Presentational: each page passes its own facts and its own save for step 2,
// so Customise saves through the Eligibility it already holds (an unsaved draft
// there is never written by this click) and What's next reads the stored
// settings first (lib/cvStore refuses a write after a failed read).

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import StatusText from "@/components/ui/StatusText";
import { firstRunStep, rtwChoiceLabel, RTW_CHOICES, type FirstRunFacts, type FirstRunStep, type RtwStatus } from "@/lib/firstRun";

type Props = {
  facts: FirstRunFacts;
  // Step 1's action. Null where the upload box is already on screen (Customise).
  cvHref?: string | null;
  // Step 2's three answers; resolves true once saved. Without it, step 2 links to Customise.
  onChooseRtw?: (status: Exclude<RtwStatus, "unknown">) => Promise<boolean>;
  // Another save of the same answers is in flight (Customise's Eligibility Save): wait for it.
  busy?: boolean;
  footer?: ReactNode;
};

const ORDER: FirstRunStep[] = ["cv", "rtw", "job"];

export default function FirstRunGuide({ facts, cvHref = "/customize#master-cv", onChooseRtw, busy = false, footer }: Props) {
  const [saving, setSaving] = useState<RtwStatus | null>(null);
  const [error, setError] = useState("");
  // The answer's button unmounts once it is saved: focus moves on to the next step's action.
  const [answered, setAnswered] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!answered) return;
    rootRef.current?.querySelector<HTMLElement>("[data-first-run-job], [data-first-run-rtw-answer] a")?.focus();
  }, [answered]);
  const step = firstRunStep(facts);
  const at = step ? ORDER.indexOf(step) : ORDER.length;
  const state = (s: FirstRunStep) => {
    const i = ORDER.indexOf(s);
    return i < at ? "done" : i === at ? "current" : "next";
  };

  async function choose(status: Exclude<RtwStatus, "unknown">) {
    if (!onChooseRtw || saving) return;
    setSaving(status);
    setError("");
    const ok = await onChooseRtw(status).catch(() => false);
    setSaving(null);
    if (!ok) setError("Couldn't save your answer. Check your connection and try again, or answer under Eligibility on My CV.");
    else setAnswered(true);
  }

  const rtwState = state("rtw");
  const jobState = state("job");

  return (
    <section ref={rootRef} className="firstRun" aria-labelledby="first-run-title" data-first-run data-first-run-step={step ?? "done"}>
      <h2 id="first-run-title" className="firstRun__title">Three steps to your first tailored CV</h2>
      <ol className="firstRun__steps">
        <li className="firstRun__step" data-step="cv" data-state={state("cv")}>
          <span className="firstRun__mark" aria-hidden="true">{state("cv") === "done" ? <Icon name="check" /> : "1"}</span>
          <div className="firstRun__body">
            <p className="firstRun__name">
              Upload your CV{state("cv") === "done" && <span className="srOnly"> (done)</span>}
            </p>
            <p className="firstRun__detail">
              {state("cv") === "done"
                ? "Saved. We build every tailored CV from it. We never add anything it does not say."
                : "Add your main CV once: a PDF, a Word file or pasted text. We build every tailored CV from it. We never add anything it does not say."}
            </p>
            {state("cv") === "current" && cvHref && (
              <div className="firstRun__actions">
                <Button href={cvHref} data-first-run-cv>Upload your CV</Button>
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
                Answered: {rtwChoiceLabel(facts.rtwStatus)}. Change it under <Link href="/customize#eligibility">Eligibility on My CV</Link>.
              </p>
            ) : (
              <p className="firstRun__detail">
                Most UK application forms ask this near the start. We never guess it from your CV. Choose the answer that is true for you. If you skip it, your form answers say &ldquo;Not answered&rdquo; until you choose.
              </p>
            )}
            {rtwState === "current" &&
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
                  <Button href="/customize#eligibility" variant="secondary">Answer on My CV</Button>
                </div>
              ))}
          </div>
        </li>

        <li className="firstRun__step" data-step="job" data-state={jobState}>
          <span className="firstRun__mark" aria-hidden="true">3</span>
          <div className="firstRun__body">
            <p className="firstRun__name">Paste your first job</p>
            <p className="firstRun__detail">
              Paste a job description, or a link to the job, on the Tailor page. A free check runs first. It tells you how well you match before you use a tailored CV.
            </p>
            {/* Reachable once there is a CV; the filled button only when it is the step. */}
            {(jobState === "current" || rtwState === "current") && (
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
