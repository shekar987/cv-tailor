// The job title is the highest-weighted term in most recruiter searches, and
// the gap list kept reporting it missing ("forward deployed engineer — not
// actually present in the tailored text"). The summary prompt now requires
// the exact title; this is the deterministic check the tailor route runs on
// the draft (one retry when it fails) and the harness asserts.
//
// The "core" title is what must appear: the posting's title with any
// bracketed or dash-separated qualifier removed ("Software Engineer
// (AI/Backend)" → "Software Engineer", "Forward Deployed Engineer - London"
// → "Forward Deployed Engineer"). Matching ignores case, punctuation and
// hyphen/space differences, and requires whole words.
// Import-free.

export function coreTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  return title
    .replace(/\s*[(\[].*?[)\]]\s*/g, " ")
    .split(/\s+[-–—|:/]\s+|,\s+/)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[-–—/]/g, " ")
    .replace(/[^a-z0-9+#& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleInText(text: unknown, title: string): boolean {
  const t = fold(typeof text === "string" ? text : "");
  const needle = fold(title);
  if (!t || !needle) return false;
  return ` ${t} `.includes(` ${needle} `);
}

// Whether the summary may open with the title as the candidate's identity
// ("Software Developer with two years' production experience…") rather than
// naming it as the job applied for ("…, applying for the Product Engineer
// role"). Only when that is plainly true: a generic software title, or one of
// the candidate's own job titles (developer and engineer read alike). A
// senior, lead or principal title never is — it would claim the seniority.
const CLAIMS_SENIORITY_RE = /^(?:senior|sr\.?|lead|principal|staff|head|chief|director)\b/i;
const HUMBLE_PREFIX_RE = /^(?:(?:junior|jr\.?|graduate|associate|entry[- ]level|mid[- ]level|intermediate|trainee)\s+)+/i;
const GENERIC_TITLE_RE = /^(?:software|application)\s+(?:developer|engineer)$/i;
function titleKey(s: string): string {
  return fold(s.replace(HUMBLE_PREFIX_RE, ""))
    .replace(/\bdeveloper\b/g, "engineer")
    .replace(/\bfull stack\b/g, "fullstack")
    .replace(/\bback end\b/g, "backend")
    .replace(/\bfront end\b/g, "frontend");
}
export function titleAsIdentity(title: unknown, heldTitles: string[]): boolean {
  const core = coreTitle(title);
  if (!core || CLAIMS_SENIORITY_RE.test(core)) return false;
  const bare = core.replace(HUMBLE_PREFIX_RE, "").trim();
  if (GENERIC_TITLE_RE.test(bare)) return true;
  const key = titleKey(core);
  return heldTitles.some((h) => titleKey(coreTitle(h)) === key);
}

// "…, applying for the Product Engineer role." (5 Nov 2026, the owner's call):
// the summary never names the job being applied for — it ended 6 of 6 tailors
// that way. Removed server-side, last, so no later pass brings it back: the
// clause goes, and a sentence that was nothing else goes with it. Any title,
// not only this run's, since a fact-check fix can word it differently.
//
// The clause, and nothing of the candidate's: it starts the sentence, follows a
// comma or dash, or follows a singular job noun with an article ("Software
// developer applying for the X role"; never "a CV tool that helps engineers
// apply for graduate roles at 120 UK companies"); its title stops at a comma
// (so "applying to Monzo, with a 12-month industrial placement at X" is never
// read as one title); it names a role, position, programme, scheme, placement,
// internship or apprenticeship, with a trailing year ("Programme 2027"); and it
// takes with it only a tail that ends the clause: "at the BBC", "with Acme
// Bank", "in the payments team". A tail that runs on ("… role in London with
// two years' Python") is not taken, and then the sentence is left as it is:
// cutting it would hand the place to the candidate. "with two years' …" is the
// candidate's own fact and stays.
// A title may carry dots ("Node.js Developer", ".NET Engineer"): a dot followed by a letter is part of it.
const TITLE_CHARS = String.raw`(?:[^.!?\n,;]|\.(?=\w))`;
// No "i" flag: the employer after "with" needs its capital letter, so every other
// word is spelled case-free here instead (escapes such as \s are left alone).
const anyCase = (s: string) => s.replace(/\\.|[a-z]/g, (c) => (c.length === 2 ? c : `[${c}${c.toUpperCase()}]`));
const W = anyCase;
const JOB_NOUN = W(String.raw`(?:developer|engineer|graduate|analyst|scientist|consultant|specialist|designer|architect|programmer|technologist|researcher|student)`);
const ROLE_NOUNS = W(String.raw`(?:roles?|positions?|opportunit(?:y|ies)|jobs?|post|vacanc(?:y|ies)|programmes?|programs?|schemes?|placements?|internships?|apprenticeships?)`);
// A word of a place or employer: never a linking word, so "in London with two years'
// Python" is not one tail (and then the sentence is left as it is).
const TAIL_WORD = String.raw`(?!(?:with|and|or|for|to|in|at|as|using|by|from|where|while|which|who)\b)(?:[^\s,.;!?]|\.(?=\w))+`;
const CAP_WORD = String.raw`(?!I\b)[A-Z](?:[\w&'’-]|\.(?=\w))*`;
const CLAUSE_END = String.raw`(?=\s*(?:[,;.!?]|$))`;
const AT_TAIL = String.raw`\s+(?:at|in|within|on|across)\s+(?:the\s+)?${TAIL_WORD}(?:\s+${TAIL_WORD}){0,5}${CLAUSE_END}`;
const WITH_TAIL = String.raw`\s+with\s+(?:the\s+)?${CAP_WORD}(?:\s+(?:${CAP_WORD}|&|of))*${CLAUSE_END}`;
const APPLIED_FOR_RE = new RegExp(
  String.raw`(?:^|[,;:]\s*|\s+[—–-]\s+|(?<=\b${JOB_NOUN})\s+(?=(?:(?:currently|now)\s+)?applying\s+for\s+(?:the|this|a|an)\s))(?:(?:and|now|currently|while)\s+)*${W("(?:applying|apply)")}\s+(?:for|to)\s+(?:(?:the|this|a|an|your)\s+)?(?:${W("(?:role|position)")}\s+of\s+(?:[^.!?\n,;]|\.(?=\w)){1,90}?${CLAUSE_END}|${TITLE_CHARS}{1,90}?\b${ROLE_NOUNS}(?:\s+(?:19|20)\d{2})?(?=[\s,;:.!?]|$))(?:${AT_TAIL}|${WITH_TAIL})?`
);
// After the clause, a place or employer that was not taken would be left on the candidate.
const RUN_ON_RE = /^\s+(?:(?:in|within|on|at|for|to|across|from)\b|with\s+(?:the\s+)?[A-Z])/;
const WORDS_RE = /[A-Za-z0-9]+/g;

export function stripAppliedFor(summary: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = summary.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    for (const sentence of sentences) {
      const m = APPLIED_FOR_RE.exec(sentence);
      if (!m || m.index === undefined || RUN_ON_RE.test(sentence.slice(m.index + m[0].length))) {
        kept.push(sentence);
        continue;
      }
      let rest = (sentence.slice(0, m.index) + sentence.slice(m.index + m[0].length))
        .replace(/^[\s,;:—–-]+/, "")
        .replace(/[\s,;:—–-]+([.!?])?\s*$/, "$1")
        .replace(/\s+([,;.!?])/g, "$1")
        .replace(/,\s*,/g, ",");
      removed.push(sentence.trim());
      if ((rest.match(WORDS_RE) ?? []).length < 3) continue;
      if (!/[.!?]$/.test(rest)) rest += ".";
      // "iOS developer…" keeps its own capitals.
      kept.push(/^[a-z](?![A-Z])/.test(rest) ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest);
    }
    return kept.join(" ");
  });
  return { text: lines.filter((l, i) => l.trim() || summary.split("\n")[i].trim() === "").join("\n").trim(), removed };
}

// The roles a saved tagline names ("Full Stack Engineer | AI Engineer" is
// two): the segments split on a pipe, slash or dot separator that carry a
// role noun. Customize warns on two or more — one positioning per CV (the
// positioning variants exist for the rest); the tailored header is built
// from the variant's headline, never the tagline (lib/headline).
export const ROLE_NOUN_RE =
  /\b(?:engineer|developer|programmer|scientist|analyst|architect|designer|manager|consultant|specialist|administrator|researcher|lead|intern|technician|tester|devops|sre|founder|director|officer|coordinator|strategist|writer|marketer)\b/i;
export function taglineRoles(tagline: unknown): string[] {
  if (typeof tagline !== "string") return [];
  return tagline
    .split(/\s*(?:\||\/|·|•|—|–|;)\s*/)
    .map((s) => s.trim())
    .filter((s) => s && ROLE_NOUN_RE.test(s) && s.split(/\s+/).length <= 6);
}
