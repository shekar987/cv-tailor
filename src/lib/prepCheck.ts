// The prep pack, checked sentence by sentence (30 Sep 2026 audit). The PwC
// pack of 19 Sep carried a STAR action nobody did ("Diagnosed slow queries
// using database query logs … measured response times before and after"),
// an angle that graded the candidate ("track record … cutting edge"), a
// figure moved to different work ("Optimised PostgreSQL and MongoDB queries
// by 30%" for a CV that says query response times improved by 30%), a
// company fact that does not exist ("FTSE 500") and an opener claiming a
// certificate the CV never lists — and the footer said nothing in the pack
// came from anywhere else. verifyEvidence only checked the cited lines and
// the digits in results and points.
//
// Deterministic, at generation and on every rewrite, inside the credit the
// pack already cost:
// - a sentence about the candidate (STAR fields, points, the angle, the
//   opener) is FLAGGED — kept, but marked "Not from your CV: rephrase before
//   you say this" — when it carries a figure the CV lacks or moves one
//   (lib/claims), claims a posting requirement the CV never shows
//   (lib/jdCopyGuard), narrates or grades instead of stating a fact
//   (lib/supportCheck), or is neither traceable to a CV line nor made of
//   the CV's own words (the overlap threshold below);
// - a sentence about the company (the angle, the opener, the questions to
//   ask, a company question's points and intent) is REMOVED when it names a
//   place, product or figure that neither the job description nor the stored
//   research states (lib/properNouns, lib/claims).
// Gap questions and "how to address" lines are strategy, never claims, and
// a forward-looking line ("I would ask about …") is advice; none is flagged.
//
// Imports ./prepPack.ts, ./supportCheck.ts, ./claims.ts, ./properNouns.ts,
// ./jdCopyGuard.ts and ./atsMatch.ts (node:test).
import { makeLineTracer, type PrepPack, type PrepQuestion, type PrepFlag, type PrepFlagField, type PrepFlagReason, type PrepCheckSummary, MAX_PREP_FLAGS } from "./prepPack.ts";
import { narrationProblem, contentOverlap } from "./supportCheck.ts";
import { checkClaims, extractFigures, numberWordsToDigits, namesRequirement } from "./claims.ts";
import { unsupportedProperNouns } from "./properNouns.ts";
import { jdCopyHits, type JdCopyTerm } from "./jdCopyGuard.ts";

export type PrepCheckContext = {
  cv: string;
  pool?: string | null;
  jd: string;
  research: unknown | null;
  copyTerms: JdCopyTerm[];
};

// Below this share of a sentence's content words being the CV's own, and
// with no CV line it traces to, the sentence is not from the CV. A starting
// point, to be calibrated offline on stored packs against the master CV the
// way REDUNDANT_OVERLAP was calibrated on real letters (lib/supportCheck).
export const NOT_IN_CV_OVERLAP = 0.5;
const MIN_WORDS = 6;
const MAX_SENTENCE = 400;

const STRATEGY_RE =
  /^(?:I would|I'd|I’d|I will|I'll|I’ll|You could|You can|You might|You should|Ask (?:about|for|them|how|what|whether)|Acknowledge|Approach|Be (?:ready|honest|clear)|Say|Explain|Frame|Mention|Emphasi[sz]e|Lead with|Show|Offer|Prepare|Expect|Point (?:out|to)|Tie|Keep|Avoid|Don't|Do not|If |When )\b/i;

export function prepSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sourceText = (ctx: PrepCheckContext) => [ctx.cv, ctx.pool ?? ""].filter(Boolean).join("\n");

// Why a sentence about the candidate is not from the CV — or null.
export function candidateSentenceFlag(sentence: string, ctx: PrepCheckContext): { reason: PrepFlagReason; detail: string } | null {
  const s = sentence.trim();
  if (!s || STRATEGY_RE.test(s)) return null;
  const sources = [ctx.cv, ctx.pool];
  const figures = checkClaims([{ where: "extra", text: s }], null, sources).numberViolations;
  const absent = figures.find((f) => f.kind === "absent" || f.kind === "combined");
  if (absent) return { reason: "figure", detail: `${absent.figure} is not a figure your CV states` };
  const moved = figures.find((f) => f.kind === "context_mismatch");
  if (moved) return { reason: "figure", detail: `${moved.figure} is on your CV for different work` };
  const copied = jdCopyHits(s, "summary", ctx.copyTerms);
  if (copied.length > 0) return { reason: "jd_copy", detail: `claims ${copied.join(", ")} — the posting asks for it, your CV never shows it` };
  const narration = narrationProblem(s);
  if (narration) return { reason: "narration", detail: "grades you or narrates relevance instead of stating a fact" };
  if (s.split(/\s+/).length < MIN_WORDS) return null;
  const tracer = makeLineTracer(sourceText(ctx));
  if (tracer(s)) return null;
  const lines = sourceText(ctx).split("\n").filter((l) => l.trim());
  if (contentOverlap(s, lines) >= NOT_IN_CV_OVERLAP) return null;
  return { reason: "not_in_cv", detail: "no line of your CV says this" };
}

// Names and figures about the company that the job description and the
// stored research do not state.
export function companyFactProblems(text: string, sources: (string | null | undefined)[]): string[] {
  // A name never carries its "+" ("AssetGuard+" is the run "AssetGuard"), so
  // the sources are read without it.
  const nouns = unsupportedProperNouns(text, sources.map((s) => (typeof s === "string" ? s.replace(/\+/g, " ") : s)));
  const corpus = sources.filter((x): x is string => typeof x === "string" && x.trim() !== "").map(numberWordsToDigits).flatMap(extractFigures);
  const keys = new Set(corpus.map((f) => f.key));
  const figures = extractFigures(numberWordsToDigits(text)).filter((f) => !keys.has(f.key)).map((f) => f.text);
  return [...nouns, ...figures];
}

// The posting's requirements the CV never shows, from what the tracker row
// stored with the application (the Applied snapshot's term lists) and the
// research's stack. A hand-added row has only the research to go on.
export function prepCopyTerms(ats: unknown, knownGaps: string[], stack: string[], sources: (string | null | undefined)[]): JdCopyTerm[] {
  const a = ats && typeof ats === "object" ? (ats as Record<string, unknown>) : {};
  const lists = [a.required, a.keywords].map((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));
  const src = sources.filter((x): x is string => typeof x === "string" && x.trim() !== "").join("\n");
  const out: JdCopyTerm[] = [];
  const seen = new Set<string>();
  for (const term of [...lists.flat(), ...knownGaps, ...stack]) {
    const t = term.replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    if (namesRequirement(src, t)) continue;
    out.push({ term: t, from: "requirement" });
  }
  return out;
}

// ── The pack ─────────────────────────────────────────────────────────────────

type Field = { questionId: string | null; field: PrepFlagField; index: number; text: string; candidate: boolean; company: boolean };

function fieldsOf(pack: PrepPack): Field[] {
  const out: Field[] = [];
  out.push({ questionId: null, field: "headline", index: 0, text: pack.angle.headline, candidate: true, company: true });
  pack.angle.whyYou.forEach((t, i) => out.push({ questionId: null, field: "whyYou", index: i, text: t, candidate: true, company: true }));
  out.push({ questionId: null, field: "opener", index: 0, text: pack.opener, candidate: true, company: true });
  pack.questionsToAsk.forEach((t, i) => out.push({ questionId: null, field: "questionToAsk", index: i, text: t, candidate: false, company: true }));
  for (const q of pack.questions) {
    if (q.category === "gap") continue;
    const company = q.category === "company";
    if (q.star) {
      for (const field of ["situation", "task", "action", "result"] as const) out.push({ questionId: q.id, field, index: 0, text: q.star[field], candidate: true, company: false });
    }
    q.points.forEach((t, i) => out.push({ questionId: q.id, field: "point", index: i, text: t, candidate: true, company }));
    if (company) out.push({ questionId: q.id, field: "whyTheyAsk", index: 0, text: q.whyTheyAsk, candidate: false, company: true });
  }
  return out;
}

function withoutSentence(text: string, sentence: string): string {
  const idx = text.indexOf(sentence);
  if (idx === -1) return text;
  return `${text.slice(0, idx)}${text.slice(idx + sentence.length)}`.replace(/\s{2,}/g, " ").trim();
}

function writeField(pack: PrepPack, f: Field, text: string): void {
  if (f.questionId === null) {
    if (f.field === "headline") pack.angle.headline = text;
    else if (f.field === "opener") pack.opener = text;
    else if (f.field === "whyYou") pack.angle.whyYou[f.index] = text;
    else if (f.field === "questionToAsk") pack.questionsToAsk[f.index] = text;
    return;
  }
  const q = pack.questions.find((x) => x.id === f.questionId);
  if (!q) return;
  if (f.field === "point") q.points[f.index] = text;
  else if (f.field === "whyTheyAsk") q.whyTheyAsk = text;
  else if (q.star && (f.field === "situation" || f.field === "task" || f.field === "action" || f.field === "result")) q.star[f.field] = text;
}

const clone = (pack: PrepPack): PrepPack => JSON.parse(JSON.stringify(pack)) as PrepPack;

// A sentence spoken by or to the candidate ("I built…", "You were selected…")
// is a claim about them; one with neither voice, in a field that may talk
// about the company ("PwC's client work spans FTSE 500 companies."), is a
// claim about the company.
const CANDIDATE_VOICE_RE = /\b(?:I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|my|me|we|we've|we’ve|our|you|you're|you’re|you've|you’ve|your)\b/i;
export const aboutCandidate = (s: string) => CANDIDATE_VOICE_RE.test(s);

// Every sentence checked; company claims removed, candidate claims flagged.
export function checkPrepPack(input: PrepPack, ctx: PrepCheckContext): PrepPack {
  const pack = clone(input);
  const companySources = [ctx.jd, ctx.research ? JSON.stringify(ctx.research) : ""];
  const flags: PrepFlag[] = [];
  let sentences = 0;
  for (const f of fieldsOf(pack)) {
    let text = f.text;
    if (!text.trim()) continue;
    for (const s of prepSentences(text)) {
      sentences++;
      if (f.company && !aboutCandidate(s)) {
        const problems = companyFactProblems(s, [...companySources, ctx.cv]);
        if (problems.length > 0) {
          text = withoutSentence(text, s);
          flags.push({ questionId: f.questionId, field: f.field, index: f.index, sentence: s.slice(0, MAX_SENTENCE), reason: "company_fact", detail: `${problems.join(", ")}: not in the job description or your research`, action: "removed" });
          continue;
        }
      }
      if (f.candidate) {
        const flag = candidateSentenceFlag(s, ctx);
        if (flag) flags.push({ questionId: f.questionId, field: f.field, index: f.index, sentence: s.slice(0, MAX_SENTENCE), reason: flag.reason, detail: flag.detail, action: "kept" });
      }
    }
    if (text !== f.text) writeField(pack, f, text);
  }
  // Emptied list items go; the flags' indexes are re-pointed by field text.
  pack.angle.whyYou = pack.angle.whyYou.filter(Boolean);
  pack.questionsToAsk = pack.questionsToAsk.filter(Boolean);
  for (const q of pack.questions) q.points = q.points.filter(Boolean);
  const check: PrepCheckSummary = {
    version: 1,
    sentences,
    flagged: flags.filter((x) => x.action === "kept").length,
    removed: flags.filter((x) => x.action === "removed").length,
    companySources: [...(ctx.jd.trim() ? ["jd" as const] : []), ...(ctx.research ? ["research" as const] : [])],
    terms: ctx.copyTerms.length,
  };
  return { ...pack, flags: flags.slice(0, MAX_PREP_FLAGS), check };
}

// ── "Use only CV facts": the rewrite ─────────────────────────────────────────

export type PrepRewriteTarget = { target: "question"; questionId: string } | { target: "angle" } | { target: "opener" };

// The kept flags the target covers, each with a stable id for the model.
export function flaggedForTarget(pack: PrepPack, target: PrepRewriteTarget): { id: string; flag: PrepFlag }[] {
  return pack.flags
    .map((flag, i) => ({ id: `f${i + 1}`, flag }))
    .filter(({ flag }) => flag.action === "kept")
    .filter(({ flag }) =>
      target.target === "question"
        ? flag.questionId === target.questionId
        : target.target === "angle"
          ? flag.questionId === null && (flag.field === "headline" || flag.field === "whyYou")
          : flag.questionId === null && flag.field === "opener"
    );
}

// {"rewrites":[{"id","text"}]} → text per known id ("" = nothing true is left).
export function normalizePrepRewrites(raw: unknown, items: { id: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const ids = new Set(items.map((x) => x.id));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { rewrites?: unknown }).rewrites) ? (raw as { rewrites: unknown[] }).rewrites : [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !ids.has(o.id) || typeof o.text !== "string") continue;
    out.set(o.id, o.text.replace(/\s+/g, " ").trim().slice(0, MAX_SENTENCE));
  }
  return out;
}

// Each flagged sentence becomes its replacement when the replacement passes
// the same check on its own, and goes otherwise (the model's silence, an
// empty text, or a replacement that still fails). The pack is then checked
// again, so the answer always reflects what stands.
export function applyPrepRewrites(input: PrepPack, target: PrepRewriteTarget, replacements: Map<string, string>, ctx: PrepCheckContext): { pack: PrepPack; rewritten: number; removed: number } {
  const pack = clone(input);
  let rewritten = 0;
  let removed = 0;
  const fields = fieldsOf(pack);
  for (const { id, flag } of flaggedForTarget(pack, target)) {
    const f = fields.find((x) => x.questionId === flag.questionId && x.field === flag.field && x.index === flag.index);
    if (!f) continue;
    const current = readField(pack, f);
    if (!current.includes(flag.sentence)) continue;
    const proposed = replacements.get(id) ?? "";
    const ok = proposed && proposed !== flag.sentence && candidateSentenceFlag(proposed, ctx) === null && companyFactProblems(proposed, [ctx.jd, ctx.research ? JSON.stringify(ctx.research) : "", ctx.cv]).length === 0;
    const next = ok ? current.replace(flag.sentence, proposed) : withoutSentence(current, flag.sentence);
    writeField(pack, f, next);
    if (ok) rewritten++;
    else removed++;
  }
  pack.angle.whyYou = pack.angle.whyYou.filter(Boolean);
  pack.questionsToAsk = pack.questionsToAsk.filter(Boolean);
  for (const q of pack.questions) q.points = q.points.filter(Boolean);
  return { pack: checkPrepPack(pack, ctx), rewritten, removed };
}

function readField(pack: PrepPack, f: Field): string {
  if (f.questionId === null) {
    if (f.field === "headline") return pack.angle.headline;
    if (f.field === "opener") return pack.opener;
    if (f.field === "whyYou") return pack.angle.whyYou[f.index] ?? "";
    if (f.field === "questionToAsk") return pack.questionsToAsk[f.index] ?? "";
    return "";
  }
  const q: PrepQuestion | undefined = pack.questions.find((x) => x.id === f.questionId);
  if (!q) return "";
  if (f.field === "point") return q.points[f.index] ?? "";
  if (f.field === "whyTheyAsk") return q.whyTheyAsk;
  if (q.star && (f.field === "situation" || f.field === "task" || f.field === "action" || f.field === "result")) return q.star[f.field];
  return "";
}
