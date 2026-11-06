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
// that way. Removed server-side, last, so no later pass brings it back. Any
// title, not only this run's, since a fact-check fix can word it differently.
//
// Only the shape those six tailors wrote (6 Nov 2026, after four reviews of a
// wider rule each found a new way to cut true text): the clause ENDS the
// sentence after a comma — ", applying for the <title> role[ at <employer>]."
// — or it is the whole sentence. The title is a run of plain words, never a
// linking word ("… role after completing a 12-month placement …" is no title),
// ending in a role / position / programme / scheme / placement / internship /
// apprenticeship (a year after it allowed). After it, at most one place: "at"
// an organisation ("the BBC", "J.P. Morgan", "monday.com", "the Bank of
// England"), "with" one that says so ("with Acme Bank"; never "with Python"),
// or "in" a team, a city or one word ("in the payments team", "in fintech").
// Anything else — mid-sentence, before "with two years' …", before a comma — is
// left exactly as it is: a summary that names the job is a style miss, a
// damaged one is a lie.
const anyCase = (s: string) => s.replace(/\\.|[a-z]/g, (c) => (c.length === 2 ? c : `[${c}${c.toUpperCase()}]`));
const W = anyCase;
const LINKING = W(String.raw`(?:after|before|having|following|since|while|whilst|with|and|or|to|in|at|on|for|from|by|as|where|which|who|that|of|following|during|then)`);
// A word of a title: letters, digits, a dot inside ("Node.js"), never a linking word.
const TITLE_WORD = String.raw`(?!${LINKING}\b)[A-Za-z0-9(][\w&'’+#/()-]*(?:\.(?=\w)[\w&'’+#/()-]+)*`;
const ROLE_NOUNS = W(String.raw`(?:roles?|positions?|opportunit(?:y|ies)|jobs?|post|vacanc(?:y|ies)|programmes?|programs?|schemes?|placements?|internships?|apprenticeships?)`);
const TITLE = String.raw`(?:${TITLE_WORD}\s+){0,11}?${ROLE_NOUNS}(?:\s+(?:19|20)\d{2})?`;
const ROLE_OF = String.raw`${W("(?:role|position)")}\s+of\s+(?:${TITLE_WORD}\s+){0,10}?${TITLE_WORD}`;
// An organisation: initials ("J.P."), a capitalised name, or a domain ("monday.com").
const ORG_TOKEN = String.raw`(?:(?:[A-Z]\.){2,}|[A-Z0-9][\w&'’+-]*(?:\.(?=\w)[\w&'’+-]+)*|[a-z][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?)`;
const ORG = String.raw`(?:the\s+)?${ORG_TOKEN}(?:\s+(?:(?:of|for|and|&)\s+)?${ORG_TOKEN}){0,5}`;
const ORG_SAYS_SO = String.raw`(?:Bank|Group|Ltd|plc|PLC|LLP|Inc|Trust|Council|Partners|Capital|Labs?|Systems|Technologies|Solutions|Consulting|Insurance|Health|Hospitals?|University|Agency|Authority|Foundation|Holdings|Services|NHS|Digital|Media|Studios?)`;
const PLACE = String.raw`(?:at\s+${ORG}|with\s+(?:the\s+${ORG}|(?:${ORG_TOKEN}\s+){0,4}${ORG_SAYS_SO}\b)|(?:in|on)\s+(?:the\s+)?(?:${ORG_TOKEN}(?:\s+${ORG_TOKEN}){0,3}|(?:[a-z-]+\s+){0,3}(?:team|squad|group|division|department|unit|function|practice|office)|[a-z-]+))`;
const CLAUSE = String.raw`(?:(?:and|now|currently)\s+)?${W("applying")}\s+(?:for|to)\s+(?:(?:the|this|a|an|your)\s+)?(?:${ROLE_OF}|${TITLE})(?:\s+${PLACE})?\s*[.!?]?\s*$`;
// ", applying for …." ending the sentence (after a comma, a semicolon, a dash, or a
// singular job noun: "Engineer applying for the X role."), or "Applying for …." as
// the whole sentence.
const JOB_NOUN = W(String.raw`(?:developer|engineer|graduate|analyst|scientist|consultant|specialist|designer|architect|programmer|technologist|researcher|student)`);
// After a singular job noun only with an article ("Software developer applying for the X
// role."): "for any software engineer applying for graduate roles" is about someone else.
// After a full stop too, when the clause is a sentence of its own ("… at Acme Ltd. Applying
// for the X role."), which the split keeps joined behind an abbreviation.
const APPLIED_FOR_END_RE = new RegExp(
  String.raw`(?:\s*[,;]\s*|\s+[—–-]\s+|(?<=[.!?])\s+(?=[A-Z])|(?<=\b${JOB_NOUN})\s+(?=(?:(?:and|now|currently)\s+)?applying\s+(?:for|to)\s+(?:the|this|a|an)\s))${CLAUSE}`
);
const APPLIED_FOR_WHOLE_RE = new RegExp(String.raw`^\s*${CLAUSE}`);
const WORDS_RE = /[A-Za-z0-9]+/g;
// A sentence ends before a capital: "J.P. Morgan" and "Acme Inc. in London" stay one.
// A sentence ends before a capital, never after an abbreviation or an initial ("e.g. React",
// "Dr. Patel", "J. Sainsbury", "J.P. Morgan", "Acme Ltd. in London").
const SUMMARY_SPLIT = /(?<!\b(?:[A-Z]|[A-Z]\.[A-Z]|Ltd|Inc|Co|Corp|plc|St|Dr|Mr|Mrs|Ms|No|vs|etc|e\.g|i\.e)\.)(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/;

export function stripAppliedFor(summary: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = summary.split("\n").map((line) => {
    const kept: string[] = [];
    for (const sentence of line.split(SUMMARY_SPLIT)) {
      if (APPLIED_FOR_WHOLE_RE.test(sentence)) {
        removed.push(sentence.trim());
        continue;
      }
      const m = APPLIED_FOR_END_RE.exec(sentence);
      if (!m || m.index === undefined) {
        kept.push(sentence);
        continue;
      }
      const rest = sentence.slice(0, m.index).replace(/[\s,;:—–-]+$/, "");
      removed.push(sentence.trim());
      if ((rest.match(WORDS_RE) ?? []).length < 3) continue;
      // "… at Example Lab Ltd." keeps its own full stop.
      kept.push(/[.!?]$/.test(rest) ? rest : `${rest}.`);
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
