// The score's "Fix before sending" suggestions, checked before they are shown
// (5 Nov 2026). The scoring model proposes edits to surface the role's absent
// terms, and some suggested lines the master CV cannot support ("Optimised
// HTTP request handling and response serialisation"): nothing checked them,
// since they were only suggestions, and a suggestion is a line ready to paste.
//
// A suggestion stays a suggestion only when it is traceable:
//   - every absent term it names is in the master CV or pool, a line about a
//     skill being learnt never counting;
//   - every line it proposes — quoted, after a colon, or after "to" / "as"
//     before a capital ("Rewrite it as Led the …"), or after "→" — takes EVERY
//     word from ONE master line, short words too ("Led", "own", "ran"), only
//     grammatical words aside and an absent term the master CV names
//     elsewhere; words are folded the matcher's way (lib/atsMatch foldWord:
//     "optimised" = "optimized", plurals) so the British-English pipeline's
//     own spelling never fails it. A real line with "with zero downtime and
//     full ownership" added does not pass, and neither do words recombined
//     from several lines;
//   - a line it moves into a role ("Move "…" into your Northgate Systems
//     role") comes from paid work, not a project (rule 10);
//   - the whole suggestion passes the CV's own claims check.
// A quote of the posting ("The posting asks for "…"") is the posting's words,
// not a proposed line — only when the posting is the subject and the cue
// directly precedes the quote ("The JD asks for Kafka; add: "…"" is a line).
// Anything else becomes "needs your evidence": the term, never the line.
//
// Relative .ts imports only, so it runs under node:test.
import { foldWord, matchAtsKeywords } from "./atsMatch.ts";
import { checkClaims, type ClaimsRegistry, type GraftRule } from "./claims.ts";
import { evidenceLines } from "./evidenceMap.ts";
import { parseMasterExperience } from "./bulletIds.ts";
import { renameLine } from "./gapCheck.ts";

// Grammatical words only: "strong", "expert", "led" and "own" are claims and are traced.
const GRAMMAR = new Set(["a", "an", "the", "and", "or", "of", "for", "in", "on", "at", "to", "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "my", "our", "your", "their", "i", "we", "me", "into", "via", "per", "using"]);
function traceWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/\*\*/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/[a-z0-9+#]+(?:\.[a-z0-9]+)*/g) ?? [];
  return new Set(words.filter((w) => !GRAMMAR.has(w)).map(foldWord));
}
// The share of a proposed line's words one master line carries: 1 = every word.
function traceOverlap(line: string, source: string): number {
  const want = traceWords(line);
  if (want.size === 0) return 1;
  const have = traceWords(source);
  return [...want].filter((w) => have.has(w)).length / want.size;
}

// Every word of a proposed line, from one master line.
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
// The posting's own words, quoted to say what it asks for: the posting is the
// subject, and the cue stands right before the quote.
const POSTING_QUOTE_RE = /\b(?:the\s+)?(?:posting|job\s+description|JD|advert|job\s+ad|role|employer|they)\s+(?:also\s+|specifically\s+|explicitly\s+)?(?:asks?\s+for|requires?|wants?|mentions?|says|calls?\s+for|lists?|is\s+looking\s+for|looks?\s+for)(?:\s+(?:experience|skills?|knowledge|expertise|a\s+background)\s+(?:with|in|of))?\s*:?\s*$/i;
// An unquoted proposed line: after a writing cue and a colon ("Change the bullet
// to: Optimised …", "Add: Led …"), after a rewrite verb's "to" / "as" before a
// capital ("Rewrite the booking bullet as Led …"), or an arrow. Never any colon or
// any capital: "Move Python to the front: it is the first term" and "Add Python to
// Technical Tools line first" propose no line.
const UNQUOTED_RES = [
  // After a writing cue the line may start lower case ("to: built and owned …").
  /\b(?:add|write|use|say|reads?|to|as|with)\s*:\s*([^"“”:]+?)\s*\.?\s*$/i,
  // After a label ("Summary:", "Kafka bullet:") only a capital starts a line; "Summary: the
  // first sentence should name Kafka" is advice.
  /\b(?:[Bb]ullet|[Ll]ine|[Ss]entence|[Ss]ummary)\s*:\s*([A-Z0-9][^"“”:]+?)\s*\.?\s*$/,
  /\b(?:[Rr]ewrite|[Rr]ephrase|[Rr]eword|[Cc]hange|[Rr]eplace|[Uu]pdate|[Ee]dit|[Tt]urn)\b[^.:"“”]*?\b(?:to|as|with)\s+([A-Z][^"“”]+?)\s*\.?\s*$/,
  /(?:→|->)\s*([^"“”]+?)\s*\.?\s*$/,
];
// A move into paid work: a move verb and a destination that is a paid role — the
// word role / job / experience, or an employer the master CV's own role headers
// name — wherever it stands ("Move '…' from your Ride App project into your
// Northgate Systems role", "Copy "…" over to your Northgate experience"). A purpose
// ("… to show React experience") is no destination.
const MOVE_VERB_RE = /\b(?:move|add|put|place|bring|copy|shift|transfer|include|insert)\b/i;
// A purpose, up to the next comma or quote: "To show React experience, add "…" under
// your Northgate Systems role" keeps its destination.
// A purpose runs to the next quote mark or the sentence's end, so its reason goes with it
// ("to show React, which is central to the role"); one before the quote stops at the quote,
// keeping the destination after it ("To show React, add "…" under your Northgate Systems role").
// …and at a comma that starts the next instruction (", then move it into your Northgate
// Systems role", ", ideally under …"), so a destination after it is still seen.
const PURPOSE_BODY = String.raw`(?:(?!,\s*(?:then|and|ideally|preferably|but|also|or)\b)[^.;"“”‘])*`;
const PURPOSE_RES = [
  new RegExp(String.raw`\bto\s+(?:show|surface|highlight|demonstrate|evidence|prove|signal|support|lead\s+with)\b${PURPOSE_BODY}`, "gi"),
  new RegExp(String.raw`\bso\s+(?:that\s+)?(?:your|it|the|this|they)\b${PURPOSE_BODY}`, "gi"),
  new RegExp(String.raw`\b(?:because|since)\b${PURPOSE_BODY}`, "gi"),
];
// A destination the suggestion says NOT to use ("Do not move "…" into Experience", "rather
// than to employment history") is no destination.
const NEGATED_BEFORE_RE = /\b(?:not|never|don['’]t|rather\s+than|instead\s+of)\b[^.;]*$/i;
// "your" / "the" role, job or experience — never "the role's top term".
// "your / the" before a role, job or position (never "the role's", never "the job
// description"); none needed before a section ("under Experience", "into work experience").
const ROLE_DEST_RE = /\b(?:into|under|to|in)\s+(?:(?:your|the)\s+(?:[\w&.'’-]+\s+){0,4}?(?:role|job|position)\b(?!['’]s|\s+(?:description|ad|advert|spec|posting|title|board|listing))|(?:your\s+|the\s+)?(?:work\s+experience|experience(?:\s+section)?|employment(?:\s+history)?)\b)/i;
// The employer words of the master CV's role headers ("Northgate Systems"), never job words.
const JOB_WORDS = /^(?:software|senior|junior|lead|staff|principal|full|stack|full-stack|data|engineer|developer|analyst|scientist|graduate|intern|placement|research|assistant|associate|consultant|manager|backend|frontend|front-end|back-end|web|mobile|platform|devops|cloud|machine|learning|ai|and|of|the|at|year)$/i;
// A header segment that is a job title or a date is not the employer: "Technical Analyst",
// "Projects Coordinator" and "Jul 2022 – Sep 2024" add no employer words.
const TITLE_NOUN_RE = /\b(?:engineer|developer|analyst|scientist|consultant|manager|intern|internship|assistant|associate|coordinator|specialist|officer|administrator|designer|architect|lead|tester|technician|executive|director|representative|advis[eo]r|apprentice|apprenticeship|trainee|placement|researcher|tutor|teacher|volunteer|lecturer|programmer|head|founder|owner)s?\b/i;
const DATE_SEGMENT_RE = /\b(?:19|20)\d{2}\b|\b(?:present|current)\b/i;
// Section and label words never name an employer ("under Projects", "to Technical Tools").
const LABEL_WORDS = /^(?:technical|tools|projects?|skills|summary|experience|education|profile|competencies|functional|key|core|highlights?|achievements|certifications?|languages?)$/i;
// From the master CV's role headers in whatever shape ("Title | Employer | Dates",
// "Employer — Title", "Title at Employer, dates"): the capitalised words of the segments that
// are neither a title nor a date — no job word, no month, no label and no skill the CV lists.
const MONTH_WORDS = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$|^present$|^current$/i;
function employerWords(headers: readonly string[], skillsText: string): string[] {
  const skills = new Set((skillsText.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? []));
  const out = new Set<string>();
  for (const h of headers) {
    for (const segment of h.split(/\s*(?:\||—|–|\s-\s|·|@|,|\(|\)|\bat\b)\s*/i)) {
      if (!segment.trim() || TITLE_NOUN_RE.test(segment) || DATE_SEGMENT_RE.test(segment)) continue;
      for (const word of segment.split(/\s+/)) {
        const w = word.replace(/[^\p{L}\p{N}&'’-]/gu, "");
        if (w.length >= 4 && /^[A-Z]/.test(w) && !JOB_WORDS.test(w) && !MONTH_WORDS.test(w) && !LABEL_WORDS.test(w) && !skills.has(w.toLowerCase())) out.add(w);
      }
    }
  }
  return [...out];
}
// A destination match that no "not / rather than / instead of" before it in its sentence turns away.
function affirmedDestination(t: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(g)) {
    if (!NEGATED_BEFORE_RE.test(t.slice(0, m.index ?? 0))) return true;
  }
  return false;
}
function movesIntoPaidWork(suggestion: string, employers: readonly string[]): boolean {
  if (!MOVE_VERB_RE.test(suggestion)) return false;
  const t = PURPOSE_RES.reduce((s, re) => s.replace(re, " "), suggestion);
  if (affirmedDestination(t, ROLE_DEST_RE)) return true;
  return employers.some((e) => affirmedDestination(t, new RegExp(String.raw`\b(?:into|under|to|in)\s+(?:your\s+|the\s+)?(?:[\w&.'’-]+\s+){0,3}?${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`)));
}

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
    UNQUOTED_RES.forEach((re, i) => {
      if (out.length > 0) return;
      const m = re.exec(suggestion);
      if (!m) return;
      const line = m[1].trim();
      // A CV line: four letter-words or more ("to Technical Tools" names a place),
      // never addressed to the reader ("your Northgate bullet already shows it" is a
      // reason), never an instruction ("lead with …", "move PostgreSQL …"); after a
      // rewrite verb's "to" / "as", a capital first ("Rewrite it as Led …"). A line
      // after a colon may be lower case: "to: built and owned the Kafka pipeline …".
      // Nor a line about the posting ("the posting asks for event-driven design twice").
      // A line is about the posting only when the posting is its subject ("the posting asks for
      // …"): "the role-based access layer" and "a JD parser" are CV lines.
      if ((line.match(/\p{L}{2,}/gu) ?? []).length < 4 || /\byou(?:r|rs)?\b/i.test(line) || INSTRUCTION_START_RE.test(line) || /^\s*(?:the|this)\s+(?:posting|job\s+description|jd|advert|job\s+ad|ad|role|job)\b(?![-'’])/i.test(line)) return;
      if (i === 2 && !/^[A-Z0-9]/.test(line)) return;
      out.push(line);
    });
  }
  return out;
}

// An instruction to the user, not a CV line.
// Never a word that is also a past-tense CV verb ("Split the FastAPI service …", "Cut deploy time …").
const INSTRUCTION_START_RE = /^(?:tighten|shorten|trim|expand|merge|quantify|cite|move|put|lead|keep|list|add|use|mention|name|place|swap|replace|drop|remove|reorder|start|open|consider|try|make|bring|highlight|emphasi[sz]e|surface|show|include|mirror|match|reword|rewrite|change|update|edit|lean|frame|position)\b/i;
// "… add it / them / both …": the suggestion tells the user to add what it quoted.
// The verb's object is the quoted term itself — "add it", "put it in your tools", "mention
// this", "name it", "use it" — never "put your Docker work first", never "mention that your
// …" (a clause). Holding an honest suggestion only moves it to "Needs your evidence";
// keeping an invented one is a claim, so this leans to holding.
const ADD_IT_RE = /\b(?:add|list|include|insert|write|put|mention|name|use|cite|state)\s+(?:it|them|both|each|this|those|these|that(?!\s+(?:your|you|the|it|they|i|we|he|she|there|this)\b)|the\s+term|this\s+term|these\s+terms)\b/i;

// The suggestion with the posting's quoted words taken out: a term quoted from the
// posting is what the role asks for, not something the suggestion claims — unless
// the suggestion then says to add it ("asks for "Kubernetes"; add it to your tools").
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
  const employers = employerWords(parseMasterExperience(cv).map((r) => r.header), ev.listed.map((l) => l.text).join("\n"));
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
    const stripped = withoutPostingQuotes(suggestion);
    const own = ADD_IT_RE.test(stripped) ? suggestion : stripped;
    const named = ctx.absentTerms.filter((t) => t.trim() && matchAtsKeywords(own, [t]).matched > 0);
    const unbacked = named.filter((t) => !inSources(t));
    // A term the master CV names elsewhere may join a line; nothing else may.
    const backed = named.filter((t) => inSources(t));
    const bare = (line: string) => backed.reduce((s, t) => s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), line);
    const tracedIn = (line: string, pool: string[]) => pool.some((l) => traceOverlap(bare(line), l) >= TRACE_OVERLAP);
    const proposed = proposedLines(suggestion);
    const untraced = proposed.filter((line) => !tracedIn(line, lines));
    // Project work moved into a paid role is the setting changed, not a rename.
    const moved = movesIntoPaidWork(suggestion, employers) && proposed.some((line) => !tracedIn(line, experience) && tracedIn(line, projects));
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
