// The JD-copy guard: a letter or summary sentence that states a requirement
// of the posting as the candidate's own past work, when the master CV and
// the project pool never show that requirement. The Maven Securities letter
// of 30 Sep said "I also performed nanosecond-level investigations on
// low-latency trading systems", "My experience directly matches the core
// requirement of handling terabytes of exchange traffic" and "familiarity
// with … containerisation (Docker/Kubernetes)" — none of it in the CV, and
// the claims check only knows the registry's skills. Deterministic, so it
// runs whatever the provider and whether or not the fact-check call answered.
//
// Terms come from two places: the evidence map's `gap` items (the posting's
// named requirements the CV never shows — the map is already the whole-term,
// conservative read) and the analyzer's key_responsibilities phrases no
// single CV line carries most of. A hit is a must-go problem for the fact
// check (lib/supportCheck): the model may keep the sentence's true core,
// and a fix is accepted only when it no longer names the term.
//
// Imports only ./atsMatch.ts, ./evidenceMap.ts and ./supportCheck.ts (node:test).
import { matchAtsKeywords } from "./atsMatch.ts";
import type { EvidenceMap } from "./evidenceMap.ts";
import { JD_COPY_PROBLEM, contentWords, type SupportSection } from "./supportCheck.ts";

export type JdCopyTerm = { term: string; from: "requirement" | "responsibility" };

const MAX_RESPONSIBILITIES = 20;
// A responsibility phrase is "shown" by a CV line that carries at least this
// share of its content words, and "claimed" by a sentence the same way.
const PHRASE_OVERLAP = 0.6;
const MIN_PHRASE_WORDS = 2;

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.replace(/\s+/g, " ").trim()) : [];
}

function phraseCarried(text: string, phraseWords: string[]): boolean {
  if (phraseWords.length === 0) return false;
  const have = new Set(contentWords(text));
  const hits = phraseWords.filter((w) => have.has(w)).length;
  return hits >= Math.max(MIN_PHRASE_WORDS, Math.ceil(phraseWords.length * PHRASE_OVERLAP));
}

// The posting's requirements the sources never show.
export function jdCopyTerms(analysis: unknown, evidence: EvidenceMap | null | undefined, sources: (string | null | undefined)[]): JdCopyTerm[] {
  const out: JdCopyTerm[] = [];
  const seen = new Set<string>();
  for (const item of evidence?.items ?? []) {
    // A soft-skill "gap" only means the CV never says the word; a named
    // technology, domain or qualification the CV lacks is the invention.
    if (item.status !== "gap" || item.kind === "soft") continue;
    const k = item.term.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ term: item.term, from: "requirement" });
  }
  const lines = sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").flatMap((s) => s.split("\n"));
  const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  for (const phrase of strList(a.key_responsibilities).slice(0, MAX_RESPONSIBILITIES)) {
    const words = [...new Set(contentWords(phrase))];
    if (words.length < MIN_PHRASE_WORDS) continue;
    const k = phrase.toLowerCase();
    if (seen.has(k)) continue;
    if (lines.some((l) => phraseCarried(l, words))) continue;
    seen.add(k);
    out.push({ term: phrase, from: "responsibility" });
  }
  return out;
}

// Ownership: the candidate says they did, built, used or know the thing.
const FIRST_PERSON_RE = /\b(?:I|I've|I'd|I'm|I’ve|I’d|I’m|my|we|we've|our)\b/;
const OWN_VERB_RE =
  /\b(?:built|build(?:ing)?|developed|develop(?:ing)?|performed|perform(?:ing)?|handled|handl(?:e|ing)|delivered|deliver(?:ing)?|led|lead(?:ing)?|designed|design(?:ing)?|implemented|implement(?:ing)?|engineered|architected|maintained|managed|owned|shipped|created|wrote|written|ran|running|operated|optimi[sz]ed|deployed|integrated|automated|worked\s+(?:on|with|in)|work(?:ing)?\s+(?:on|with|in)|used|using|utili[sz]ed|(?:have|has|had|gained|bring|bringing|offer)\s+(?:\w+\s+){0,3}experience\s+(?:of|with|in)|experience\s+(?:of|with|in)|(?:my|our)\s+(?:[\w/-]+\s+){0,3}experience\b|familiar(?:ity)?\s+with|proficien\w+\s+(?:in|with)|expertise\s+(?:in|with)|skilled\s+(?:in|with)|background\s+in|hands[- ]on\s+(?:experience\s+)?(?:with|in)|track\s+record\s+(?:of|in|with)|matches|meets|covers)\b/gi;
// A verb attributed to the reader or a third party ("your team built",
// "the team that built", "engineers who handle") is not the candidate's.
const ATTRIBUTED_RE = /\b(?:you|your|they|their|team|teams|company|engineers?|who|that|which)\s+(?:\w+\s+)?$/i;

function ownsWork(sentence: string): boolean {
  const first = FIRST_PERSON_RE.exec(sentence);
  if (!first) return false;
  const after = sentence.slice(first.index);
  for (const m of after.matchAll(OWN_VERB_RE)) {
    const before = after.slice(0, m.index ?? 0);
    if (ATTRIBUTED_RE.test(before)) continue;
    return true;
  }
  return false;
}

function namesTerm(sentence: string, t: JdCopyTerm): boolean {
  if (t.from === "requirement") return matchAtsKeywords(sentence, [t.term]).matched > 0;
  return phraseCarried(sentence, [...new Set(contentWords(t.term))]);
}

// The terms a sentence claims as the candidate's own work. The summary is
// about the candidate by construction, so naming the term there is the
// claim; the letter needs the candidate to say they did or know it.
export function jdCopyHits(sentence: string, section: SupportSection, terms: JdCopyTerm[]): string[] {
  if (terms.length === 0 || !sentence.trim()) return [];
  if (section === "coverLetter" && !ownsWork(sentence)) return [];
  return terms.filter((t) => namesTerm(sentence, t)).map((t) => t.term);
}

// The problem line supportSentences carries to the fact check.
export function jdCopyProblems(sentence: string, section: SupportSection, terms: JdCopyTerm[]): string[] {
  const hits = jdCopyHits(sentence, section, terms);
  return hits.length ? [`${JD_COPY_PROBLEM} (${hits.join(", ")}) — say only what the master CV shows about this, or drop it`] : [];
}
