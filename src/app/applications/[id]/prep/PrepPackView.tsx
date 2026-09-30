"use client";

import { useState } from "react";
import { rewriteKey, type PrepPack, type PrepQuestion, type PrepCategory, type PrepFlag, type PrepFlagField, type PrepRewriteTarget } from "@/lib/prepPack";
import type { PrepRatings } from "@/lib/prepProgress";

// The reading view of a prep pack. Every answer is shown WITH the CV lines it
// was built from and the tracer's verdict on each — the honesty contract made
// visible, so the user knows exactly which claims they can defend in the room.
// Since 30 Sep every sentence the check could not trace to the CV
// (lib/prepCheck) is marked "Not from your CV: rephrase before you say this",
// with "Use only CV facts" to rewrite a question, the angle or the opener
// from the CV alone.

export const NOT_FROM_CV = "Not from your CV: rephrase before you say this";

// The kept flags on one field of one question (null = the angle / opener).
export function flagsFor(flags: PrepFlag[], questionId: string | null, field: PrepFlagField, index = 0): PrepFlag[] {
  return flags.filter((f) => f.action === "kept" && f.questionId === questionId && f.field === field && f.index === index);
}

export function NotFromCv({ flags }: { flags: PrepFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((f, i) => (
        <span key={i} className="prepTrace warn prepFlag" title={f.detail} data-prep-flag={f.reason}>
          {NOT_FROM_CV}
          {flags.length > 1 ? `: “${f.sentence.length > 60 ? `${f.sentence.slice(0, 59)}…` : f.sentence}”` : ""}
        </span>
      ))}
    </>
  );
}

export function RewriteButton({ target, onRewrite, rewriting }: { target: PrepRewriteTarget; onRewrite?: (t: PrepRewriteTarget) => void; rewriting?: string | null }) {
  if (!onRewrite) return null;
  const busy = rewriting === rewriteKey(target);
  return (
    <button type="button" className="inlineLink" onClick={() => onRewrite(target)} disabled={!!rewriting} aria-busy={busy || undefined} data-prep-rewrite={rewriteKey(target)}>
      {busy ? "Rewriting from your CV…" : "Use only CV facts"}
    </button>
  );
}

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
export function AnswerBody({ q, flags = [], onRewrite, rewriting }: { q: PrepQuestion; flags?: PrepFlag[]; onRewrite?: (t: PrepRewriteTarget) => void; rewriting?: string | null }) {
  const flagged = flags.some((f) => f.action === "kept" && f.questionId === q.id);
  return (
    <>
      {q.star && (
        <dl className="prepStar">
          {(
            [
              ["Situation", "situation", q.star.situation],
              ["Task", "task", q.star.task],
              ["Action", "action", q.star.action],
              ["Result", "result", q.star.result],
            ] as const
          )
            .filter(([, , text]) => text)
            .map(([label, field, text]) => (
              <div className="prepStarRow" key={label}>
                <dt className="prepStarLabel">{label}</dt>
                <dd className="prepStarText">
                  {text}
                  <NotFromCv flags={flagsFor(flags, q.id, field)} />
                </dd>
              </div>
            ))}
        </dl>
      )}
      {q.points.length > 0 && (
        <ul className="prepPoints">
          {q.points.map((p, i) => (
            <li key={i}>
              {p}
              <NotFromCv flags={flagsFor(flags, q.id, "point", i)} />
            </li>
          ))}
        </ul>
      )}
      {flagged && onRewrite && (
        <div className="prepOpenerActions">
          <RewriteButton target={{ target: "question", questionId: q.id }} onRewrite={onRewrite} rewriting={rewriting} />
        </div>
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

function QuestionCard({ q, index, rating, flags, onRewrite, rewriting }: { q: PrepQuestion; index: number; rating?: 1 | 2 | 3; flags: PrepFlag[]; onRewrite?: (t: PrepRewriteTarget) => void; rewriting?: string | null }) {
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
      <AnswerBody q={q} flags={flags} onRewrite={onRewrite} rewriting={rewriting} />
    </article>
  );
}

export function formatGenerated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrepPackView({ pack, ratings, onRewrite, rewriting }: { pack: PrepPack; ratings: PrepRatings; onRewrite?: (t: PrepRewriteTarget) => void; rewriting?: string | null }) {
  const angleFlagged = pack.flags.some((f) => f.action === "kept" && f.questionId === null && (f.field === "headline" || f.field === "whyYou"));
  const openerFlagged = pack.flags.some((f) => f.action === "kept" && f.questionId === null && f.field === "opener");
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
          {pack.angle.headline && (
            <p className="prepHeadline">
              {pack.angle.headline}
              <NotFromCv flags={flagsFor(pack.flags, null, "headline")} />
            </p>
          )}
          {pack.angle.whyYou.length > 0 && (
            <ul className="prepList">
              {pack.angle.whyYou.map((w, i) => (
                <li key={i}>
                  {w}
                  <NotFromCv flags={flagsFor(pack.flags, null, "whyYou", i)} />
                </li>
              ))}
            </ul>
          )}
          {angleFlagged && onRewrite && (
            <div className="prepOpenerActions">
              <RewriteButton target={{ target: "angle" }} onRewrite={onRewrite} rewriting={rewriting} />
            </div>
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
            <QuestionCard key={q.id} q={q} index={pack.questions.indexOf(q)} rating={ratings[q.id]} flags={pack.flags} onRewrite={onRewrite} rewriting={rewriting} />
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
          <p className="prepOpener">
            {pack.opener}
            <NotFromCv flags={flagsFor(pack.flags, null, "opener")} />
          </p>
          <div className="prepOpenerActions">
            <button type="button" className="inlineLink" onClick={copyOpener}>
              {copied ? "Copied ✓" : "Copy opener"}
            </button>
            {openerFlagged && <RewriteButton target={{ target: "opener" }} onRewrite={onRewrite} rewriting={rewriting} />}
            {copyError && <span className="error">{copyError}</span>}
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <p className="prepSources" data-prep-check={pack.check ? "checked" : "unchecked"}>
          Built from {sources.join(" · ")}.{" "}
          {pack.check
            ? `${pack.check.sentences} sentence${pack.check.sentences === 1 ? "" : "s"} checked against your master CV — ${pack.check.flagged} marked as not from it${
                pack.check.removed > 0 ? `, ${pack.check.removed} company claim${pack.check.removed === 1 ? "" : "s"} removed because the job description and your research don't state ${pack.check.removed === 1 ? "it" : "them"}` : ""
              }.`
            : "Generated before sentence checks existed — regenerate to check it against your CV."}
        </p>
      )}
    </div>
  );
}
