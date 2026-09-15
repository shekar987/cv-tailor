"use client";

import { useState } from "react";
import type { PrepPack, PrepQuestion, PrepCategory } from "@/lib/prepPack";
import type { PrepRatings } from "@/lib/prepProgress";

// The reading view of a prep pack. Every answer is shown WITH the CV lines it
// was built from and the tracer's verdict on each — the honesty contract made
// visible, so the user knows exactly which claims they can defend in the room.

export const CATEGORY_LABEL: Record<PrepCategory, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  role: "Role & motivation",
  company: "Company",
  gap: "Honest gap",
};

const CATEGORY_ORDER: PrepCategory[] = ["behavioral", "technical", "role", "company", "gap"];

export const RATING_LABEL: Record<1 | 2 | 3, string> = { 1: "Shaky", 2: "OK", 3: "Nailed it" };

// STAR + strategy points + evidence + figure check — shared by the reading
// view and practice mode so the two can never drift.
export function AnswerBody({ q }: { q: PrepQuestion }) {
  return (
    <>
      {q.star && (
        <dl className="prepStar">
          {(
            [
              ["Situation", q.star.situation],
              ["Task", q.star.task],
              ["Action", q.star.action],
              ["Result", q.star.result],
            ] as const
          )
            .filter(([, text]) => text)
            .map(([label, text]) => (
              <div className="prepStarRow" key={label}>
                <dt className="prepStarLabel">{label}</dt>
                <dd className="prepStarText">{text}</dd>
              </div>
            ))}
        </dl>
      )}
      {q.points.length > 0 && (
        <ul className="prepPoints">
          {q.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {q.evidence.length > 0 && (
        <div className="prepEvidence">
          <div className="prepEvidenceLabel">From your CV</div>
          {q.evidence.map((e, i) => (
            <div className="prepEvidenceLine" key={i}>
              <span className={`prepTrace ${e.verified ? "ok" : "warn"}`}>
                {e.verified ? "✓ Traced to your CV" : "Couldn't trace — check before using"}
              </span>
              <q className="prepEvidenceText">{e.text}</q>
            </div>
          ))}
        </div>
      )}
      {q.unverifiedNumbers.length > 0 && (
        <p className="prepNumbers">
          Check these figures against your CV before you say them: {q.unverifiedNumbers.join(", ")}
        </p>
      )}
    </>
  );
}

function QuestionCard({ q, index, rating }: { q: PrepQuestion; index: number; rating?: 1 | 2 | 3 }) {
  return (
    <article className="prepQuestion" id={q.id}>
      <div className="prepQHead">
        <span className="prepQIndex">{index + 1}</span>
        <span className={`stackChip prepCat ${q.category}`}>{CATEGORY_LABEL[q.category]}</span>
        {rating && <span className={`prepRatingTag r${rating}`}>{RATING_LABEL[rating]}</span>}
      </div>
      <h3 className="prepQText">{q.question}</h3>
      {q.whyTheyAsk && (
        <p className="prepWhy">
          <span className="prepWhyLabel">Why they ask</span> {q.whyTheyAsk}
        </p>
      )}
      <AnswerBody q={q} />
    </article>
  );
}

export function formatGenerated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrepPackView({ pack, ratings }: { pack: PrepPack; ratings: PrepRatings }) {
  const [filter, setFilter] = useState<PrepCategory | "all">("all");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const counts = CATEGORY_ORDER.map((c) => [c, pack.questions.filter((q) => q.category === c).length] as const).filter(([, n]) => n > 0);
  const visible = filter === "all" ? pack.questions : pack.questions.filter((q) => q.category === filter);

  async function copyOpener() {
    try {
      await navigator.clipboard.writeText(pack.opener);
      setCopied(true);
      setCopyError("");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Couldn't copy — select the text and copy it manually.");
    }
  }

  const sources = [
    pack.sources.jd && "the job description",
    pack.sources.tailoredCv && "the CV you sent",
    pack.sources.research && "your company research",
    pack.sources.talkingPoints && "your talking points",
  ].filter(Boolean) as string[];

  return (
    <div className="prepView">
      {(pack.angle.headline || pack.angle.whyYou.length > 0 || pack.angle.honestGaps.length > 0) && (
        <section className="prepSection" aria-labelledby="prep-angle">
          <h2 className="prepSectionTitle" id="prep-angle">Your angle</h2>
          {pack.angle.headline && <p className="prepHeadline">{pack.angle.headline}</p>}
          {pack.angle.whyYou.length > 0 && (
            <ul className="prepList">
              {pack.angle.whyYou.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {pack.angle.honestGaps.length > 0 && (
            <div className="prepGaps">
              <div className="prepGapsTitle">Honest gaps — say these plainly, never dress them up</div>
              <ul className="prepList">
                {pack.angle.honestGaps.map((g, i) => (
                  <li key={i}>
                    <strong>{g.gap}</strong> — {g.howToAddress}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="prepSection" aria-labelledby="prep-questions">
        <h2 className="prepSectionTitle" id="prep-questions">
          Likely questions <span className="prepCount">{pack.questions.length}</span>
        </h2>
        {counts.length > 1 && (
          <div className="prepFilters" role="group" aria-label="Filter questions by category">
            <button
              type="button"
              className={`stackChip prepChip${filter === "all" ? " active" : ""}`}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All · {pack.questions.length}
            </button>
            {counts.map(([c, n]) => (
              <button
                key={c}
                type="button"
                className={`stackChip prepChip${filter === c ? " active" : ""}`}
                aria-pressed={filter === c}
                onClick={() => setFilter(c)}
              >
                {CATEGORY_LABEL[c]} · {n}
              </button>
            ))}
          </div>
        )}
        <div className="prepQuestions">
          {visible.map((q) => (
            <QuestionCard key={q.id} q={q} index={pack.questions.indexOf(q)} rating={ratings[q.id]} />
          ))}
        </div>
      </section>

      {pack.questionsToAsk.length > 0 && (
        <section className="prepSection" aria-labelledby="prep-ask">
          <h2 className="prepSectionTitle" id="prep-ask">Questions to ask them</h2>
          <ul className="prepList">
            {pack.questionsToAsk.map((qa, i) => (
              <li key={i}>{qa}</li>
            ))}
          </ul>
        </section>
      )}

      {pack.opener && (
        <section className="prepSection" aria-labelledby="prep-opener">
          <h2 className="prepSectionTitle" id="prep-opener">30-second opener</h2>
          <p className="prepOpener">{pack.opener}</p>
          <div className="prepOpenerActions">
            <button type="button" className="inlineLink" onClick={copyOpener}>
              {copied ? "Copied ✓" : "Copy opener"}
            </button>
            {copyError && <span className="error">{copyError}</span>}
          </div>
        </section>
      )}

      {sources.length > 0 && <p className="prepSources">Built from {sources.join(" · ")}. Nothing in it comes from anywhere else.</p>}
    </div>
  );
}
