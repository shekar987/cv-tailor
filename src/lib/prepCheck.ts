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
import { makeLineTracer, type PrepPack, type PrepQuestion, type PrepFlag, type PrepFlagField, type PrepFlagReason, type PrepCheckSummary, type PrepRewriteTarget, MAX_PREP_FLAGS } from "./prepPack.ts";
export type { PrepRewriteTarget } from "./prepPack.ts";
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
  // The employer, for telling a company claim from a candidate one written
  // in the third person; the pack's own company when absent.
  company?: string;
};

// Below this share of a sentence's content words being the CV's own, and
// with no CV line it traces to, the sentence is not from the CV. A starting
// point, to be calibrated offline on stored packs against the master CV the
// way REDUNDANT_OVERLAP was calibrated on real letters (lib/supportCheck).
export const NOT_IN_CV_OVERLAP = 0.5;
const MIN_WORDS = 6;
const MAX_SENTENCE = 400;

// A claim about the candidate's past, as opposed to advice ("For PostgreSQL:
// add indexes on WHERE clauses"), an approach ("On your systems, I'd start
// by…") or intent ("I'm excited about applying…"): a STAR field always is;
// a point, the angle or the opener only when it speaks in the first person,
// not conditionally and not as intent. Measured over the owner's stored
// packs before this rule, 39 of 110 sentences were flagged and most were
// technical approach points — the prompt asks for exactly those.
// The angle speaks to the candidate ("You were selected for…"), so the
// second person is the candidate's voice there too.
const FIRST_PERSON_CLAIM_RE = /\b(?:I|I've|I’ve|I have|I'm|I’m|I am|I was|I led|my|we|we've|we’ve|our|you|you've|you’ve|you have|you were|you are|you're|you’re|your)\b/i;
const CONDITIONAL_RE = /\b(?:I'd|I’d|I would|I will|I'll|I’ll|I could|I might|I can|we'd|we’d|we would|we could|you'd|you’d|you could)\b/i;
const INTENT_RE = /\b(?:excited|keen|eager|looking forward|interested in|would love|hope to|hoping|want to|aim to|plan to)\b/i;
export type PrepSentenceKind = "star" | "prose";
export function claimLike(sentence: string, kind: PrepSentenceKind): boolean {
  if (kind === "star") return true;
  return FIRST_PERSON_CLAIM_RE.test(sentence) && !CONDITIONAL_RE.test(sentence) && !INTENT_RE.test(sentence);
}

const STRATEGY_RE =
  /^(?:I would|I'd|I’d|I will|I'll|I’ll|You could|You can|You might|You should|Ask (?:about|for|them|how|what|whether)|Acknowledge|Approach|Be (?:ready|honest|clear)|Say|Explain|Frame|Mention|Emphasi[sz]e|Lead with|Show|Offer|Prepare|Expect|Point (?:out|to)|Tie|Keep|Avoid|Don't|Do not|If |When )\b/i;

export function prepSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sourceText = (ctx: PrepCheckContext) => [ctx.cv, ctx.pool ?? ""].filter(Boolean).join("\n");

// Why a sentence about the candidate is not from the CV — or null. `kind`
// says whether it is a STAR field (always a claim about the past) or prose
// (a point, the angle, the opener — a claim only when it reads as one);
// `narration` is off for the angle, whose job is to say why the match holds.
export function candidateSentenceFlag(
  sentence: string,
  ctx: PrepCheckContext,
  opts: { kind?: PrepSentenceKind; narration?: boolean } = {}
): { reason: PrepFlagReason; detail: string } | null {
  const kind = opts.kind ?? "star";
  const s = sentence.trim();
  if (!s || STRATEGY_RE.test(s)) return null;
  const sources = [ctx.cv, ctx.pool];
  const figures = checkClaims([{ where: "extra", text: s }], null, sources).numberViolations;
  const absent = figures.find((f) => f.kind === "absent" || f.kind === "combined");
  if (absent) return { reason: "figure", detail: `${absent.figure} is not a figure your CV states` };
  const moved = figures.find((f) => f.kind === "context_mismatch");
  if (moved) return { reason: "figure", detail: `${moved.figure} is on your CV for different work` };
  // A STAR field is about the past whatever its grammar; prose claims the
  // requirement only when the candidate says they did or know it.
  const copied = jdCopyHits(s, kind === "star" ? "summary" : "coverLetter", ctx.copyTerms);
  if (copied.length > 0) return { reason: "jd_copy", detail: `claims ${copied.join(", ")} — the posting asks for it, your CV never shows it` };
  const narration = opts.narration === false ? null : narrationProblem(s);
  if (narration) return { reason: "narration", detail: "grades you or narrates relevance instead of stating a fact" };
  if (!claimLike(s, kind)) return null;
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

// company: "always" — the field is about the employer (questions to ask,
// a company question's intent); "ifNamed" — only a sentence that names or
// refers to the employer, in neither the candidate's voice; "never".
type Field = { questionId: string | null; field: PrepFlagField; index: number; text: string; candidate: boolean; company: "always" | "ifNamed" | "never"; kind: PrepSentenceKind; narration: boolean };

function fieldsOf(pack: PrepPack): Field[] {
  const out: Field[] = [];
  // The angle's headline and reasons are claims about the candidate whatever
  // their grammar (the prompt asks for "each defensible from the master CV").
  // A company fact there is marked, never removed.
  out.push({ questionId: null, field: "headline", index: 0, text: pack.angle.headline, candidate: true, company: "never", kind: "star", narration: false });
  pack.angle.whyYou.forEach((t, i) => out.push({ questionId: null, field: "whyYou", index: i, text: t, candidate: true, company: "never", kind: "star", narration: false }));
  out.push({ questionId: null, field: "opener", index: 0, text: pack.opener, candidate: true, company: "ifNamed", kind: "prose", narration: true });
  pack.questionsToAsk.forEach((t, i) => out.push({ questionId: null, field: "questionToAsk", index: i, text: t, candidate: false, company: "always", kind: "prose", narration: false }));
  for (const q of pack.questions) {
    if (q.category === "gap") continue;
    const company = q.category === "company";
    if (q.star) {
      for (const field of ["situation", "task", "action", "result"] as const) out.push({ questionId: q.id, field, index: 0, text: q.star[field], candidate: true, company: "never", kind: "star", narration: true });
    }
    q.points.forEach((t, i) => out.push({ questionId: q.id, field: "point", index: i, text: t, candidate: true, company: company ? "ifNamed" : "never", kind: "prose", narration: true }));
    if (company) out.push({ questionId: q.id, field: "whyTheyAsk", index: 0, text: q.whyTheyAsk, candidate: false, company: "always", kind: "prose", narration: false });
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
// is a claim about them. A company claim names the employer or refers to
// it ("PwC's client work spans FTSE 500 companies.", "Their platform
// handles…"); the angle's reasons are written in the third person about the
// CANDIDATE ("2+ years shipping production systems: engineered…") and must
// never be read as company facts — over the owner's stored packs (30 Sep)
// the earlier rule removed six such reasons because the corrected master CV
// no longer named their stack.
const COMPANY_REF_RE = /\b(?:they|their|them|the (?:firm|company|business|practice|organi[sz]ation|employer|bank|agency))\b/i;
// A company name's common words never identify it ("Epos Now Group": "now"
// is in half of all prose).
const COMPANY_STOP = new Set([
  "ltd", "limited", "plc", "group", "uk", "the", "and", "inc", "llp", "llc", "co", "corp", "holdings", "international", "global", "services", "solutions", "technologies", "technology", "systems",
  "now", "new", "one", "all", "for", "with", "our", "you", "its", "are", "can", "get", "has", "not", "big", "first", "next", "digital", "capital", "partners", "management", "consulting", "labs", "software",
]);
export function refersToCompany(sentence: string, company: string): boolean {
  if (COMPANY_REF_RE.test(sentence)) return true;
  const folded = ` ${sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return company
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !COMPANY_STOP.has(w))
    .some((w) => folded.includes(` ${w} `));
}
const CANDIDATE_VOICE_RE = /\b(?:I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|my|me|we|we've|we’ve|our|you|you're|you’re|you've|you’ve|your)\b/i;
export const aboutCandidate = (s: string) => CANDIDATE_VOICE_RE.test(s);

// Every sentence checked; company claims removed, candidate claims flagged.
export function checkPrepPack(input: PrepPack, ctx: PrepCheckContext): PrepPack {
  const pack = clone(input);
  const companySources = [ctx.jd, ctx.research ? JSON.stringify(ctx.research) : ""];
  const company = ctx.company ?? pack.company;
  const flags: PrepFlag[] = [];
  let sentences = 0;
  for (const f of fieldsOf(pack)) {
    let text = f.text;
    if (!text.trim()) continue;
    for (const s of prepSentences(text)) {
      sentences++;
      if (f.company === "always" || (f.company === "ifNamed" && !aboutCandidate(s) && refersToCompany(s, company))) {
        const problems = companyFactProblems(s, [...companySources, ctx.cv]);
        if (problems.length > 0) {
          text = withoutSentence(text, s);
          flags.push({ questionId: f.questionId, field: f.field, index: f.index, sentence: s.slice(0, MAX_SENTENCE), reason: "company_fact", detail: `${problems.join(", ")}: not in the job description or your research`, action: "removed" });
          continue;
        }
      }
      if (f.candidate) {
        const flag = candidateSentenceFlag(s, ctx, { kind: f.kind, narration: f.narration });
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
    const ok =
      proposed &&
      proposed !== flag.sentence &&
      candidateSentenceFlag(proposed, ctx, { kind: f.kind, narration: f.narration }) === null &&
      companyFactProblems(proposed, [ctx.jd, ctx.research ? JSON.stringify(ctx.research) : "", ctx.cv]).length === 0;
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
