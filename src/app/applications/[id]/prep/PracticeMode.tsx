"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PrepPack, PrepQuestion } from "@/lib/prepPack";
import type { PrepRating, PrepRatings } from "@/lib/prepProgress";
import Button from "@/components/ui/Button";
import { AnswerBody, CATEGORY_LABEL, RATING_LABEL } from "./PrepPackView";

// Flashcard practice: the question alone, then the answer on demand, then a
// self-rating. Keyboard is an accelerator, never the only path — every key has
// a visible button. Space/Enter reveal, Enter (revealed) → next, 1/2/3 rate
// (only after reveal; rating advances), ←/→ move, Esc exits. The listener is
// window-level only while this is mounted and steps aside for form fields and
// modifier chords, and only preventDefaults keys it handles.

type Props = {
  pack: PrepPack;
  ratings: PrepRatings;
  onRate: (questionId: string, rating: PrepRating) => void;
  onExit: () => void;
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export default function PracticeMode({ pack, ratings, onRate, onExit }: Props) {
  const [shakyOnly, setShakyOnly] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  const deck: PrepQuestion[] = useMemo(
    () => (shakyOnly ? pack.questions.filter((q) => ratings[q.id] === 1) : pack.questions),
    [pack.questions, shakyOnly, ratings]
  );
  const finished = index >= deck.length;
  const current = finished ? null : deck[index];
  const shakyCount = pack.questions.filter((q) => ratings[q.id] === 1).length;

  // Focus lands on the card so screen readers announce it and keys go here.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(next, deck.length)));
      setRevealed(false);
    },
    [deck.length]
  );

  const reveal = useCallback(() => {
    setRevealed(true);
    setAnnounce("Answer shown.");
  }, []);

  const rate = useCallback(
    (value: PrepRating) => {
      if (!current || !revealed) return;
      onRate(current.id, value);
      setAnnounce(`Rated ${RATING_LABEL[value]}.`);
      goTo(index + 1);
    },
    [current, revealed, onRate, goTo, index]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onExit();
          return;
        case "ArrowLeft":
          if (index > 0) {
            e.preventDefault();
            goTo(index - 1);
          }
          return;
        case "ArrowRight":
          if (!finished) {
            e.preventDefault();
            goTo(index + 1);
          }
          return;
        case " ":
          if (!finished && !revealed) {
            e.preventDefault();
            reveal();
          }
          return;
        case "Enter":
          if (finished) return;
          e.preventDefault();
          if (revealed) goTo(index + 1);
          else reveal();
          return;
        case "1":
        case "2":
        case "3":
          if (!finished && revealed) {
            e.preventDefault();
            rate(Number(e.key) as PrepRating);
          }
          return;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, revealed, finished, goTo, reveal, rate, onExit]);

  function toggleShaky() {
    setShakyOnly((v) => !v);
    setIndex(0);
    setRevealed(false);
  }

  const progressPct = deck.length === 0 ? 0 : Math.round((Math.min(index, deck.length) / deck.length) * 100);
  const tally = { 3: 0, 2: 0, 1: 0, unrated: 0 };
  for (const q of deck) {
    const r = ratings[q.id];
    if (r === 1 || r === 2 || r === 3) tally[r] += 1;
    else tally.unrated += 1;
  }

  return (
    <div className="practiceCard" ref={cardRef} tabIndex={-1} aria-label="Practice mode">
      <div className="practiceTop">
        <span className="practiceCounter" aria-live="off">
          {finished ? `${deck.length} / ${deck.length}` : `${index + 1} / ${deck.length}`}
        </span>
        <div
          className="fitBarTrack practiceProgress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={deck.length}
          aria-valuenow={Math.min(index, deck.length)}
          aria-label="Practice progress"
        >
          <div className="fitBarFill" style={{ width: `${progressPct}%` }} />
        </div>
        <button
          type="button"
          className={`stackChip prepChip${shakyOnly ? " active" : ""}`}
          aria-pressed={shakyOnly}
          onClick={toggleShaky}
          disabled={shakyCount === 0 && !shakyOnly}
          title={shakyCount === 0 ? "Rate a question Shaky first" : undefined}
        >
          Review shaky only{shakyCount > 0 ? ` · ${shakyCount}` : ""}
        </button>
        <button type="button" className="appsActionBtn practiceExit" onClick={onExit}>
          Exit
        </button>
      </div>

      <div className="srOnly" aria-live="polite">{announce}</div>

      {current ? (
        <>
          <div className="practiceMeta">
            <span className={`stackChip prepCat ${current.category}`}>{CATEGORY_LABEL[current.category]}</span>
            {ratings[current.id] && <span className={`prepRatingTag r${ratings[current.id]}`}>{RATING_LABEL[ratings[current.id]!]}</span>}
          </div>
          <p className="practiceQuestion">{current.question}</p>
          {!revealed ? (
            <div className="practiceNav">
              <Button onClick={reveal}>Show answer</Button>
              <span className="practiceHint">Think it through out loud first.</span>
            </div>
          ) : (
            <div className="practiceAnswer">
              {current.whyTheyAsk && (
                <p className="prepWhy">
                  <span className="prepWhyLabel">Why they ask</span> {current.whyTheyAsk}
                </p>
              )}
              <AnswerBody q={current} />
              <div className="practiceRate" role="group" aria-label="How did that go?">
                <span className="practiceRateLabel">How did that go?</span>
                <button type="button" className="practiceRateBtn shaky" onClick={() => rate(1)}>
                  Shaky <kbd className="kbd">1</kbd>
                </button>
                <button type="button" className="practiceRateBtn ok" onClick={() => rate(2)}>
                  OK <kbd className="kbd">2</kbd>
                </button>
                <button type="button" className="practiceRateBtn nailed" onClick={() => rate(3)}>
                  Nailed it <kbd className="kbd">3</kbd>
                </button>
              </div>
            </div>
          )}
          <div className="practiceNav practiceNavBottom">
            <button type="button" className="appsActionBtn" onClick={() => goTo(index - 1)} disabled={index === 0}>
              ← Previous
            </button>
            <button type="button" className="appsActionBtn" onClick={() => goTo(index + 1)}>
              {index + 1 === deck.length ? "Finish →" : "Next →"}
            </button>
          </div>
          <p className="practiceKeys">
            <kbd className="kbd">Space</kbd> reveal · <kbd className="kbd">1</kbd> <kbd className="kbd">2</kbd> <kbd className="kbd">3</kbd> rate ·{" "}
            <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> move · <kbd className="kbd">Esc</kbd> exit
          </p>
        </>
      ) : (
        <div className="practiceSummary">
          <p className="practiceQuestion">{deck.length === 0 ? "Nothing to review." : "Deck complete."}</p>
          {deck.length > 0 && (
            <ul className="practiceTally">
              <li><span className="prepRatingTag r3">Nailed it</span> {tally[3]}</li>
              <li><span className="prepRatingTag r2">OK</span> {tally[2]}</li>
              <li><span className="prepRatingTag r1">Shaky</span> {tally[1]}</li>
              <li><span className="prepRatingTag">Unrated</span> {tally.unrated}</li>
            </ul>
          )}
          <div className="practiceNav">
            <Button onClick={() => goTo(0)}>Restart</Button>
            {shakyCount > 0 && !shakyOnly && (
              <Button variant="secondary" onClick={toggleShaky}>
                Review shaky · {shakyCount}
              </Button>
            )}
            <Button variant="ghost" onClick={onExit}>
              Exit practice
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
