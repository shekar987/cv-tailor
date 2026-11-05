// The score's "Fix before sending" suggestions, checked before they are shown
// (5 Nov 2026). The scoring model proposes edits to surface the role's absent
// terms, and some suggested lines the master CV cannot support ("Optimised
// HTTP request handling and response serialisation"): nothing checked them,
// since they were only suggestions, and a suggestion is a line ready to paste.
//
// A suggestion stays a suggestion only when it is traceable: every absent term
// it names is somewhere in the master CV or pool; the whole suggestion passes
// the same claims check as the tailored CV (a figure the CV lacks, a skill
// being learnt); and every line it proposes carries the master CV's own
// content — at least TRACE_OVERLAP of its content words found in ONE master
// line, so words recombined from several lines don't pass. Anything else
// becomes "needs your evidence": the term, never the line.
//
// Relative .ts imports only, so it runs under node:test.
import { matchAtsKeywords } from "./atsMatch.ts";
import { checkClaims, type ClaimsRegistry, type GraftRule } from "./claims.ts";
import { contentOverlap, quoteInSource } from "./supportCheck.ts";
import { renameLine } from "./gapCheck.ts";

export const TRACE_OVERLAP = 0.6;
const MAX_NEEDS_EVIDENCE = 6;

export type NeedsEvidence = { term: string | null; note: string };
export type SuggestionCheck = { kept: string[]; needsEvidence: NeedsEvidence[] };

// Quotes are paired by family: straight doubles with straight doubles, curly
// with curly, and a single quote only where it is not an apostrophe ("doesn't",
// "team’s" — a quote mark between letters never opens or closes a quote).
const QUOTE_RES = [
  /"([^"\n]{1,400})"/g,
  /“([^”\n]{1,400})”/g,
  /(?<![\p{L}\p{N}])['‘]((?:[^'’\n]|['’](?=\p{L})){1,400}?)['’](?![\p{L}\p{N}])/gu,
];

export function proposedLines(suggestion: string): string[] {
  const out: string[] = [];
  for (const re of QUOTE_RES) {
    for (const m of suggestion.matchAll(re)) {
      const line = m[1].trim();
      if (line.split(/\s+/).length >= 4) out.push(line);
    }
  }
  return out;
}

// The score's own counts ("9/15", "9 of 15") are not claims about the candidate.
const COUNT_RE = /\b\d{1,2}\s*(?:\/|of)\s*\d{1,2}\b/g;

export function checkSuggestions(
  suggestions: readonly string[],
  ctx: { sources: (string | null | undefined)[]; absentTerms: readonly string[]; registry?: ClaimsRegistry | null; grafts?: GraftRule[] }
): SuggestionCheck {
  const sources = ctx.sources.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  const all = sources.join("\n");
  const lines = all.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const inSources = (term: string) => matchAtsKeywords(all, [term]).matched > 0;
  const claimsFail = (text: string) => {
    const check = checkClaims([{ where: "cv", text }], ctx.registry ?? null, sources, ctx.grafts ?? []);
    return check.numberViolations.length > 0 || check.skillViolations.length > 0;
  };
  const kept: string[] = [];
  const needsEvidence: NeedsEvidence[] = [];
  for (const suggestion of suggestions) {
    if (typeof suggestion !== "string" || !suggestion.trim()) continue;
    const named = ctx.absentTerms.filter((t) => t.trim() && matchAtsKeywords(suggestion, [t]).matched > 0);
    const unbacked = named.filter((t) => !inSources(t));
    const untraced = proposedLines(suggestion).filter(
      (line) => !sources.some((s) => quoteInSource(line, s)) && Math.max(0, ...lines.map((l) => contentOverlap(line, [l]))) < TRACE_OVERLAP
    );
    if (unbacked.length === 0 && untraced.length === 0 && !claimsFail(suggestion.replace(COUNT_RE, " "))) {
      kept.push(suggestion);
      continue;
    }
    // A term the CV does show is not the problem: then it is the line itself.
    const term = unbacked[0] ?? null;
    // The CV may show the work under another word (lib/gapCheck): then the word
    // is the user's to add, in their own line, and this one goes further.
    const shown = term ? renameLine(term, sources[0] ?? "", sources.slice(1).join("\n")) : null;
    needsEvidence.push({
      term,
      note: shown
        ? `${term}: your CV may show the work as “${shown}”. If it is the same work, name it in your master CV in your own words; the suggested line goes further than that.`
        : term
          ? `${term}: your master CV doesn't show this. Add it only with real work you can point to.`
          : "A suggestion went beyond what your master CV shows, so it isn't listed. Add only what you can point to.",
    });
  }
  // One line per term: two suggestions about the same gap say the same thing.
  const seen = new Set<string>();
  const unique = needsEvidence.filter((n) => {
    const key = (n.term ?? n.note).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { kept, needsEvidence: unique.slice(0, MAX_NEEDS_EVIDENCE) };
}
