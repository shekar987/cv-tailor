// The score's "Fix before sending" suggestions, checked before they are shown
// (5 Nov 2026). The scoring model proposes edits to surface the role's absent
// terms, and some suggested lines the master CV cannot support ("Optimised
// HTTP request handling and response serialisation"): nothing checked them,
// since they were only suggestions, and a suggestion is a line ready to paste.
//
// A suggestion stays a suggestion only when it is traceable:
//   - every absent term it names is in the master CV or pool, a line about a
//     skill being learnt never counting;
//   - every line it proposes — quoted, or after "to:" / "as:" / "→" — takes
//     EVERY content word from ONE master line (an absent term the master CV
//     names elsewhere aside), so a real line with "with zero downtime and full
//     ownership" added does not pass, and neither do words recombined from
//     several lines;
//   - a line it moves into a role ("into your Northgate Systems role") comes
//     from paid work, not a project (rule 10);
//   - the whole suggestion passes the CV's own claims check.
// A quote of the posting ("The posting asks for "…"") is the posting's words,
// not a proposed line. Anything else becomes "needs your evidence": the term,
// never the line.
//
// Relative .ts imports only, so it runs under node:test.
import { matchAtsKeywords } from "./atsMatch.ts";
import { checkClaims, type ClaimsRegistry, type GraftRule } from "./claims.ts";
import { evidenceLines } from "./evidenceMap.ts";
import { contentOverlap } from "./supportCheck.ts";
import { renameLine } from "./gapCheck.ts";

// Every content word of a proposed line, from one master line.
export const TRACE_OVERLAP = 1;
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
// The posting's own words, quoted to say what it asks for.
const POSTING_QUOTE_RE = /\b(?:posting|job\s+description|JD|advert|ad|asks?\s+for|requires?|wants?|mentions?|says|calls?\s+for|lists?|looking\s+for)\b[^.!?"“‘]{0,30}$/i;
// An unquoted proposed line: "Change the bullet to: Optimised …", "… → Built …".
const UNQUOTED_RE = /(?:\b(?:to|as|with|read|say|reads?)\s*:|→|->)\s*([^"“”]+?)\s*\.?\s*$/i;
// A move into paid work: "Move "…" into your Northgate Systems role".
const MOVE_RE = /\b(?:move|add|put|place|bring|copy)\b[^.]*?\b(?:into|under|to|in)\s+(?:your\s+|the\s+)?(?:[\w&.'’-]+\s+){0,5}?(?:role|job|position|employment|(?:work\s+)?experience(?:\s+section)?)\b/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function proposedLines(suggestion: string): string[] {
  const out: string[] = [];
  for (const re of QUOTE_RES) {
    for (const m of suggestion.matchAll(re)) {
      const line = m[1].trim();
      if (words(line) < 4) continue;
      if (POSTING_QUOTE_RE.test(suggestion.slice(0, m.index ?? 0))) continue;
      out.push(line);
    }
  }
  if (out.length === 0) {
    const m = UNQUOTED_RE.exec(suggestion);
    if (m && words(m[1]) >= 4) out.push(m[1].trim());
  }
  return out;
}

// The suggestion with the posting's quoted words taken out: a term quoted from the
// posting is what the role asks for, not something the suggestion claims.
function withoutPostingQuotes(suggestion: string): string {
  let out = suggestion;
  for (const re of QUOTE_RES) {
    for (const m of suggestion.matchAll(re)) {
      if (POSTING_QUOTE_RE.test(suggestion.slice(0, m.index ?? 0))) out = out.replace(m[0], " ");
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
  const cv = sources[0] ?? "";
  const pool = sources.slice(1).join("\n");
  // The master CV's lines as evidence: paid work, projects and listed lines, never a
  // line about a skill being learnt.
  const ev = evidenceLines(cv, pool);
  const experience = ev.experience.map((l) => l.text);
  const projects = ev.projects.map((l) => l.text);
  const evidence = [...experience, ...projects, ...ev.listed.map((l) => l.text)];
  const learnt = ev.learnt.split("\n").map((l) => l.trim()).filter(Boolean);
  const lines = evidence.length
    ? evidence
    : sources.join("\n").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !learnt.some((x) => l.includes(x)) && !/\bcurrently\s+(?:learning|studying)\b/i.test(l));
  const all = lines.join("\n");
  const inSources = (term: string) => matchAtsKeywords(all, [term]).matched > 0;
  const claimsFail = (text: string) => {
    const check = checkClaims([{ where: "cv", text }], ctx.registry ?? null, sources, ctx.grafts ?? []);
    return check.numberViolations.length > 0 || check.skillViolations.length > 0;
  };
  const kept: string[] = [];
  const needsEvidence: NeedsEvidence[] = [];
  for (const suggestion of suggestions) {
    if (typeof suggestion !== "string" || !suggestion.trim()) continue;
    const own = withoutPostingQuotes(suggestion);
    const named = ctx.absentTerms.filter((t) => t.trim() && matchAtsKeywords(own, [t]).matched > 0);
    const unbacked = named.filter((t) => !inSources(t));
    // A term the master CV names elsewhere may join a line; nothing else may.
    const backed = named.filter((t) => inSources(t));
    const bare = (line: string) => backed.reduce((s, t) => s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), line);
    const tracedIn = (line: string, pool: string[]) => pool.some((l) => contentOverlap(bare(line), [l]) >= TRACE_OVERLAP);
    const proposed = proposedLines(suggestion);
    const untraced = proposed.filter((line) => !tracedIn(line, lines));
    // Project work moved into a paid role is the setting changed, not a rename.
    const moved = MOVE_RE.test(suggestion) && proposed.some((line) => !tracedIn(line, experience) && tracedIn(line, projects));
    if (unbacked.length === 0 && untraced.length === 0 && !moved && !claimsFail(own.replace(COUNT_RE, " "))) {
      kept.push(suggestion);
      continue;
    }
    // A term the CV does show is not the problem: then it is the line itself.
    const term = unbacked[0] ?? null;
    // The CV may show the work under another word (lib/gapCheck): then the word
    // is the user's to add, in their own line, and this one goes further.
    const shown = term ? renameLine(term, cv, pool) : null;
    needsEvidence.push({
      term,
      note: shown
        ? `${term}: your CV may show the work as “${shown}”. If it is the same work, name it in your master CV in your own words; the suggested line goes further than that.`
        : term
          ? `${term}: your master CV doesn't show this. Add it only with real work you can point to.`
          : moved
            ? "A suggestion moved project work into a paid role, so it isn't listed. Your master CV shows that work in a project."
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
