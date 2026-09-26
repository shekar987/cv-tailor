// The summary and the cover letter, checked sentence by sentence against the
// master CV. They are the two places a tailored claim is free prose rather
// than a selected master bullet, and the applications of 20 Sep carried what
// no deterministic check can see: an invented anecdote ("the value of that
// work only became clear after I spent time with the teams asking which
// screens were slow"), a "track record of delivering under deadline in
// high-autonomy environments", lessons nobody stated.
//
// One model call (supportCheckPrompt) names, for every sentence about the
// candidate's past, the master-CV lines that support it — copied verbatim —
// or a corrected sentence. This module does not trust it: every quote must
// really be in the master CV (or pool), and must share the sentence's
// substance. A sentence the model finds unsupported is replaced by its fix
// when the fix passes the caller's checks, and removed otherwise; a
// "supported" verdict whose quotes cannot be found is reported, not acted on.
//
// Import-free (node:test).

export type SupportSection = "summary" | "coverLetter";
// problems: what a deterministic lint found in the sentence (relevance
// narration, self-grading) — the model must fix these even when the facts
// in the sentence are true.
export type SupportSentence = { id: string; section: SupportSection; sentence: string; problems: string[] };
export type SupportVerdict = { supported: boolean; support: string[]; fix: string | null };
export type SupportDecision = SupportSentence & {
  action: "keep" | "rewrite" | "remove" | "unverified";
  replacement: string | null;
};

// Courtesy, availability and intent state no fact about the past: never
// checked, never removed ("Thank you for considering my application." and
// "I am based in London and available for hybrid work." were deleted on the
// first measured run).
const COURTESY_RE = /^(?:thank you|thanks|many thanks|i look forward|i would welcome|i'd welcome|i would love|i'd love|please (?:find|see))\b/i;
const INTENT_RE = /^(?:i am|i'm|i would be|i'd be)\s+(?:based in|available|ready|willing|happy|keen|eager|open to|able to (?:start|relocate|work))\b/i;

// Letter and summary sentences that narrate their relevance to the role or
// grade the candidate instead of stating a fact — all seen in generated
// letters on 26 Sep, after the prompt had banned them ("the foundation this
// role needs from day one", "I've built real-time systems under that exact
// constraint", "This taught me to hold…", "showing a sustained commitment").
// Also relative time ("I've spent the last year shipping…" for a job that
// ended two years ago) and teamwork the CV does not state: the model must
// restate either from the master CV's own dates and lines.
const NARRATION_RE =
  /\b(?:the|this)\s+(?:last|past)\s+(?:\d+\s+|few\s+|two\s+|three\s+|couple\s+of\s+)?(?:years?|months?)\b|\brecently\b|\bcollaborat\w*\s+(?:closely\s+)?(?:across|with)\s+(?:teams|stakeholders|colleagues|product|business|designers|cross[- ]functional)\b|\balign(?:s|ed|ing)?\s+(?:exactly|directly|closely|perfectly|well|neatly)?\s*with\s+(?:how|what|the|your|this|my)\b|\bmirror(?:s|ing)?\s+(?:the|your|this|how)\b|\bthe\s+same\s+(?:rigou?r|discipline|mindset|care|approach)\b|\b(?:the\s+)?(?:technical\s+)?foundation\s+(?:you|your|this|the\s+role)\b|\byour\s+team\s+relies\s+on\b|\bexactly\s+how\b|\bproblems?\s+I\s+have\s+tackled\s+directly\b|\b(?:this|the|your)\s+role\s+(?:needs|requires|demands|emphasi[sz]es|calls\s+for|asks\s+for)\b|\bexactly\s+what\b|\bthat\s+exact\b|\bthe\s+(?:same|exact)\s+(?:constraints?|challenges?|problems?|thinking|skills?)\b|\btaught\s+me\b|\bdemonstrat\w*\s+(?:the\s+|my\s+|a\s+|strong\s+)?(?:ability|capacity|commitment|skills?|craftsmanship|ownership)\b|\bshowing\s+(?:a|my)\b|\bsolid\s+foundation\b|\b(?:from|on)\s+day\s+one\b|\bfast[- ]paced\b|\bproven\s+(?:ability|track)\b|\btrack\s+record\b|\bi\s+have\s+consistently\b|\bthriv(?:e|ed)\b|\bpassion(?:ate)?\s+(?:for|about)\b|\bsustained\s+commitment\b|\bdirectly\s+transferable\b|\bperfect\s+fit\b|\bexactly\s+the\s+(?:skills?|skill\s*set|experience|kind|type|sort|mindset|approach|work)\b|\bskill\s*set\b[^.]{0,60}\b(?:demand|require|need)s?\b|\bdirectly\s+(?:applicable|relevant)\s+to\b|\b(?:a|an|the|this|my)\s+(?:[\w-]+\s+)?mindset\b|\bmaps?\s+(?:directly\s+|closely\s+|neatly\s+|well\s+)?(?:on)?to\s+(?:the\s+)?(?:work|what|my|experience)\b|\bthe\s+same\s+(?:[\w-]+\s+){1,6}(?:rigou?r|discipline|mindset|care|approach|thinking)\b|\bproficien(?:cy|t)\b/i;

export function narrationProblem(sentence: string): string | null {
  return NARRATION_RE.test(sentence)
    ? "narrates its relevance to the role or grades the candidate instead of stating a fact — keep only the fact, or remove it"
    : null;
}

// The fallback when the model leaves a flagged sentence as it was: cut the
// trailing clause that carries the narration, when what is left is still a
// sentence with no narration of its own.
export function trimNarration(sentence: string): string | null {
  const parts = sentence.split(/(\s[—–]\s|—|;\s|,\s|:\s)/);
  for (let i = parts.length - 1; i >= 2; i -= 2) {
    if (!NARRATION_RE.test(parts.slice(i).join(""))) continue;
    const kept = parts.slice(0, i - 1).join("").trim().replace(/[,;:—–-]+$/, "").trim();
    if (kept.split(/\s+/).length >= 6 && !NARRATION_RE.test(kept)) return /[.!?]$/.test(kept) ? kept : `${kept}.`;
  }
  return null;
}
export type SupportReport = {
  checked: number;
  changed: { section: SupportSection; sentence: string; action: "rewritten" | "removed"; replacement?: string }[];
  unverified: string[];
  skipped?: "fast" | "failed";
};

export const MAX_SUPPORT_SENTENCES = 40;
const MAX_FIX_CHARS = 600;

// Letter furniture never states a claim.
const SALUTATION_RE = /^dear\b/i;
const SIGNOFF_RE = /^(?:kind|best|warm|warmest)\s+regards,?$|^regards,?$|^yours\s+(?:sincerely|faithfully|truly),?$|^sincerely,?$|^thank\s+you,?$|^many\s+thanks,?$/i;
const DATE_LINE_RE = /^\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}$|^[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}$/;

function sentencesOfLine(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The sentences to check, with stable ids ("s1" summary, "l1" letter). The
// letter's salutation, sign-off lines, the name after the sign-off and a date
// line are skipped.
export function supportSentences(summary: string, letter: string, facts?: { projects: ProjectFacts[]; paidWork: string }): SupportSentence[] {
  const out: SupportSentence[] = [];
  const problems = (sentence: string) => {
    const p = narrationProblem(sentence);
    const merged = facts ? mergedProjects(sentence, facts.projects, facts.paidWork) : [];
    return [
      ...(p ? [p] : []),
      ...(merged.length ? [`${MERGED_PROBLEM} (${merged.join(", ")}) in one sentence — keep each fact with its own named project, or drop the one that is not this project's`] : []),
    ];
  };
  let s = 0;
  for (const line of (summary || "").split(/\n+/)) {
    for (const sentence of sentencesOfLine(line.trim())) out.push({ id: `s${++s}`, section: "summary", sentence, problems: problems(sentence) });
  }
  const lines = (letter || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const signoff = lines.findIndex((l) => SIGNOFF_RE.test(l));
  let l = 0;
  lines.forEach((line, i) => {
    if (SALUTATION_RE.test(line) || SIGNOFF_RE.test(line) || DATE_LINE_RE.test(line)) return;
    if (signoff !== -1 && i > signoff) return; // the name under the sign-off
    for (const sentence of sentencesOfLine(line)) {
      if (COURTESY_RE.test(sentence) || INTENT_RE.test(sentence)) continue;
      out.push({ id: `l${++l}`, section: "coverLetter", sentence, problems: problems(sentence) });
    }
  });
  return out.slice(0, MAX_SUPPORT_SENTENCES);
}

// {"checks":[{"id","supported","support":[…],"fix"}]} → verdicts for known ids.
export function normalizeSupportVerdicts(raw: unknown, sentences: SupportSentence[]): Map<string, SupportVerdict> {
  const out = new Map<string, SupportVerdict>();
  const ids = new Set(sentences.map((x) => x.id));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { checks?: unknown }).checks) ? (raw as { checks: unknown[] }).checks : [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== "string" || !ids.has(r.id) || typeof r.supported !== "boolean") continue;
    const support = Array.isArray(r.support) ? r.support.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 4).map((x) => x.slice(0, 400)) : [];
    const fix = typeof r.fix === "string" ? r.fix.replace(/^\s*[•▪●◦\-*]\s+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_FIX_CHARS) : null;
    out.set(r.id, { supported: r.supported, support, fix });
  }
  return out;
}

// ── Verifying quotes ─────────────────────────────────────────────────────────

function norm(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[•▪●◦→]/g, " ")
    .replace(/[^a-z0-9%+#.'/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const digits = (t: string) => t.match(/\d+(?:\.\d+)?/g) ?? [];

function longestRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

// A quote is in the source when it appears verbatim after normalization, or
// as a contiguous run of at least 60% of its words with every number intact
// (the prep-pack tracer's rule: trimmed quotes pass, invented ones do not).
export function quoteInSource(quote: string, source: string): boolean {
  const q = norm(quote);
  const src = norm(source);
  if (!q || !src) return false;
  if (src.includes(q)) return true;
  const qt = q.split(" ");
  if (qt.length < 5) return false;
  const srcDigits = new Set(digits(src));
  if (!digits(q).every((d) => srcDigits.has(d))) return false;
  return longestRun(qt, src.split(" ")) >= Math.ceil(qt.length * 0.6);
}

const STOP = new Set(
  "a an the and or of to in on at for with by from into over as is are was were be been being that this these those it its my our your their i we you they he she which who whom whose while where when than then so such also more most very across through via using used built build".split(
    " "
  )
);
const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "");
function contentWords(t: string): string[] {
  return norm(t)
    .split(" ")
    .map((w) => w.replace(/^[.'/-]+|[.'/-]+$/g, ""))
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map(stem);
}

// The share of the sentence's content words the supporting lines contain.
export function contentOverlap(sentence: string, lines: string[]): number {
  const words = [...new Set(contentWords(sentence))];
  if (words.length === 0) return 1;
  const have = new Set(lines.flatMap(contentWords));
  return words.filter((w) => have.has(w)).length / words.length;
}

export const MIN_OVERLAP = 0.25;
// Calibrated on the 26 Sep letters: the rewrites that only repeated the
// letter's other facts scored 0.59 and 0.78; real fixes scored 0.05–0.38.
export const REDUNDANT_OVERLAP = 0.55;

// Two sentences that state the same thing: each carries most of the other's
// content words.
function restates(a: string, b: string): boolean {
  return contentOverlap(a, [b]) >= 0.7 && contentOverlap(b, [a]) >= 0.6;
}

// Rule 7: one project's facts are never told as another's. A sentence that
// carries at least two words only project A's text has and two only project
// B's has, without naming both, has merged them — a fact-check fix on 26 Sep
// put Jobhuntz's "Supabase Auth with 3 OAuth methods" into a RideX sentence.
// `paidWork` words are never project-only.
export type ProjectFacts = { name: string; text: string };
export const MERGED_PROBLEM = "combines facts from different projects";
export const isMergeProblem = (s: SupportSentence) => s.problems.some((p) => p.startsWith(MERGED_PROBLEM));
export function mergedProjects(sentence: string, projects: ProjectFacts[], paidWork: string = ""): string[] {
  if (projects.length < 2) return [];
  const words = new Set(contentWords(sentence));
  const paid = new Set(contentWords(paidWork));
  const sets = projects.map((p) => ({ name: p.name, words: new Set(contentWords(p.text)) }));
  const contributing = sets.filter((p) => {
    let own = 0;
    for (const w of p.words) if (words.has(w) && !paid.has(w) && sets.every((o) => o === p || !o.words.has(w))) own++;
    return own >= 2;
  });
  if (contributing.length < 2) return [];
  const named = (n: string) => norm(sentence).includes(norm(n));
  return contributing.some((p) => !named(p.name)) ? contributing.map((p) => p.name) : [];
}

// The same fact told twice in a row reads as generated at once. The first
// measured letter (26 Sep, Somak) got there through a fact-check fix that
// copied the sentence before it; this is the backstop after every pass.
export function dropRepeatedSentences(text: string): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const kept: string[] = [];
  const out = (text || "").split("\n").map((line) => {
    const sentences = sentencesOfLine(line);
    if (sentences.length === 0 || SALUTATION_RE.test(line.trim()) || SIGNOFF_RE.test(line.trim())) return line;
    const keep = sentences.filter((s) => {
      if (s.split(/\s+/).length >= 6 && kept.some((k) => restates(s, k))) {
        dropped.push(s);
        return false;
      }
      kept.push(s);
      return true;
    });
    return keep.length === sentences.length ? line : keep.join(" ");
  });
  return { text: dropped.length ? out.join("\n").replace(/\n{3,}/g, "\n\n") : text, dropped };
}

// A degree the master CV dates to the future, stated as held ("I hold an MSc
// in Computer Science …, graduating January 2027" — in both outputs measured
// on 26 Sep). `inProgress` is the profile's own list (lib/headline
// degreesInProgress); the fix writes the degree as being completed.
const DEGREE_FAMILY: [RegExp, string][] = [
  [/\b(?:phd|ph\.d|doctora\w*)/i, String.raw`(?:PhD|Ph\.D\.?|doctorate)`],
  [/\b(?:msc|m\.sc|meng|mres|mba|ma\b|master)/i, String.raw`(?:MSc|M\.Sc\.?|MEng|MRes|MBA|MA|Master(?:'s|’s|s)?)`],
  [/\b(?:bsc|b\.sc|beng|ba\b|bachelor)/i, String.raw`(?:BSc|B\.Sc\.?|BEng|BA|Bachelor(?:'s|’s|s)?)`],
];
const HELD_VERB = String.raw`(?:(?:have|has)\s+(?:completed|earned|obtained|gained|attained)|hold|holds|have|has|possess|completed|earned|obtained|gained|attained)`;
function heldDegreeRes(inProgress: string[]): RegExp[] {
  return DEGREE_FAMILY.filter(([re]) => inProgress.some((d) => re.test(d))).map(
    ([, words]) => new RegExp(String.raw`\b(I\s+)?${HELD_VERB}\s+((?:a|an|my|the)\s+)?(${words})(?![\w'’-])`, "gi")
  );
}
export function fixHeldDegrees(text: string, inProgress: string[]): { text: string; changed: string[] } {
  const res = heldDegreeRes(inProgress);
  if (!text || res.length === 0) return { text, changed: [] };
  const changed: string[] = [];
  let out = text;
  for (const re of res) {
    out = out.replace(re, (m: string, i: string | undefined, art: string | undefined, deg: string) => {
      changed.push(m);
      return `${i ?? ""}am completing ${art ?? ""}${deg}`;
    });
  }
  return { text: out, changed };
}
export function statesDegreeAsHeld(text: string, inProgress: string[]): boolean {
  return heldDegreeRes(inProgress).some((re) => new RegExp(re.source, "i").test(text));
}

// What to do with each sentence. `accept(fix)` is the caller's own gate for a
// replacement (the claims check, proper nouns, the role title).
export function decideSupport(
  sentences: SupportSentence[],
  verdicts: Map<string, SupportVerdict>,
  sources: (string | null | undefined)[],
  accept: (s: SupportSentence, fix: string) => boolean = () => true
): SupportDecision[] {
  const source = sources.filter((x): x is string => typeof x === "string" && x.trim() !== "").join("\n");
  // A fix that restates another sentence of its own section, or mostly
  // repeats what the rest of the section already says, is no fix: the Somak
  // letter's opening was rewritten into Brane facts the next paragraph told
  // again.
  const repeats = (s: SupportSentence, fix: string) => {
    const others = sentences.filter((o) => o.id !== s.id && o.section === s.section).map((o) => o.sentence);
    return others.some((o) => restates(fix, o)) || (others.length > 0 && contentOverlap(fix, others) >= REDUNDANT_OVERLAP);
  };
  // A sentence the lint flagged but the model left alone: cut the narrating
  // clause when that leaves a clean sentence, else keep it as written.
  const trimmed = (s: SupportSentence): SupportDecision => {
    const t = trimNarration(s.sentence);
    return t && accept(s, t) ? { ...s, action: "rewrite", replacement: t } : { ...s, action: "keep", replacement: null };
  };
  return sentences.map((s) => {
    const v = verdicts.get(s.id);
    // Not listed: the model read it as no claim about the candidate's past.
    if (!v) return isMergeProblem(s) ? { ...s, action: "remove", replacement: null } : s.problems.length ? trimmed(s) : { ...s, action: "keep", replacement: null };
    const verified = v.support.filter((q) => quoteInSource(q, source));
    const fix = v.fix ?? "";
    if (v.supported && s.problems.length === 0) {
      if (verified.length > 0 && contentOverlap(s.sentence, verified) >= MIN_OVERLAP) return { ...s, action: "keep", replacement: null };
      return { ...s, action: "unverified", replacement: null };
    }
    if (fix && fix !== s.sentence && !repeats(s, fix) && accept(s, fix)) return { ...s, action: "rewrite", replacement: fix };
    // One project's facts told as another's is a false attribution, not
    // narration: with no acceptable fix it goes.
    if (isMergeProblem(s)) return { ...s, action: "remove", replacement: null };
    // Facts true but the sentence narrates: never delete a true fact for it.
    if (v.supported) return trimmed(s);
    return { ...s, action: "remove", replacement: null };
  });
}
