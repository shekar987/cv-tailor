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
// Only where the clause's end is unambiguous; anywhere else the sentence is
// left exactly as it is (a summary that names the job is a style miss, a
// damaged summary is a lie). The clause:
//   - starts the sentence, follows a comma or dash, or follows a singular job
//     noun with an article ("Software developer applying for the X role");
//     never "a CV tool that helps engineers apply for graduate roles";
//   - has a title that never crosses a comma and ends in a role, position,
//     programme, scheme, placement, internship or apprenticeship (a trailing
//     year included), the LAST such noun before the clause's end — backtracking
//     finds "Software Engineer Internship 2027 role at Acme" whole;
//   - may take one place: "at the BBC", "at J.P. Morgan", "in the payments
//     team", or "with" an organisation ("with Acme Bank" — never "with Python",
//     a skill of the candidate's);
//   - then must END: at the sentence's end; before "with" and the candidate's
//     own facts ("with two years' …", "with hands-on experience …" — never
//     "with a focus on payments", the role's); or, when it opens the sentence,
//     before a comma that starts no relative clause ("Applying for the X role,
//     iOS developer with …"). ", where REST APIs are core." stays whole.
// A title may carry dots ("Node.js Developer", ".NET Engineer"): a dot followed by a letter is part of it.
const TITLE_CHARS = String.raw`(?:[^.!?\n,;]|\.(?=\w))`;
// No "i" flag: an organisation needs its capital letter, so every other word is
// spelled case-free here instead (escapes such as \s are left alone).
const anyCase = (s: string) => s.replace(/\\.|[a-z]/g, (c) => (c.length === 2 ? c : `[${c}${c.toUpperCase()}]`));
const W = anyCase;
const JOB_NOUN = W(String.raw`(?:developer|engineer|graduate|analyst|scientist|consultant|specialist|designer|architect|programmer|technologist|researcher|student)`);
const ROLE_NOUNS = W(String.raw`(?:roles?|positions?|opportunit(?:y|ies)|jobs?|post|vacanc(?:y|ies)|programmes?|programs?|schemes?|placements?|internships?|apprenticeships?)`);
// A word of a place or employer: initials ("J.P."), an abbreviation ("Inc."), or a
// plain word that is no linking word (so a place never runs on into the candidate).
const TAIL_WORD = String.raw`(?:(?:[A-Z]\.){2,}|(?:Inc|Ltd|Co|Corp|plc)\.(?=\s)|(?!(?:with|and|or|for|to|in|at|as|using|by|from|where|while|which|who)\b)(?:[^\s,.;!?]|\.(?=\w))+)`;
const AT_TAIL = String.raw`\s+(?:at|in|within|on|across)\s+(?:the\s+)?${TAIL_WORD}(?:\s+${TAIL_WORD}){0,5}`;
// "with" an organisation: a word that says so, or "the" before a capital.
const ORG_WORD = String.raw`(?:Bank|Group|Ltd|plc|PLC|LLP|Inc|Trust|Council|Partners|Capital|Labs?|Systems|Technologies|Solutions|Consulting|Insurance|Health|Hospitals?|University|Agency|Authority|Foundation|Holdings|Services|NHS|Digital|Media|Studios?)`;
const CAP_WORD = String.raw`(?!I\b)[A-Z](?:[\w&'’-]|\.(?=\w))*`;
const WITH_TAIL = String.raw`\s+with\s+(?:(?:the\s+${CAP_WORD}(?:\s+(?:${CAP_WORD}|&|of))*)|(?:${CAP_WORD}\s+)*${ORG_WORD}\b)`;
// The candidate's own facts after "with": years, experience, a degree … — never the role's focus.
const OWN_FACTS = String.raw`\s+with\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|several|over|more\s+than|hands-on|strong|solid|proven|practical|commercial|production|professional|experience|expertise|skills|knowledge|a\s+(?:background|track\s+record|portfolio|degree|first|2:1|master)|an\s+(?:MSc|BSc|MEng|BEng|MA|BA))`;
const CLAUSE = String.raw`(?:(?:and|now|currently|while)\s+)*${W("(?:applying|apply)")}\s+(?:for|to)\s+(?:(?:the|this|a|an|your)\s+)?(?:${W("(?:role|position)")}\s+of\s+${TITLE_CHARS}{1,90}?|${TITLE_CHARS}{1,90}?\b${ROLE_NOUNS}(?:\s+(?:19|20)\d{2})?)(?:${AT_TAIL}|${WITH_TAIL})?`;
const ENDS = String.raw`(?=\s*[.!?]?\s*$|${OWN_FACTS})`;
// Mid-sentence: after a comma or dash, or straight after a singular job noun with an article.
const APPLIED_FOR_MID_RE = new RegExp(
  String.raw`(?:[,;:]\s*|\s+[—–-]\s+|(?<=\b${JOB_NOUN})\s+(?=(?:(?:currently|now)\s+)?applying\s+for\s+(?:the|this|a|an)\s))${CLAUSE}${ENDS}`
);
// Opening the sentence: it may also end before a comma that starts no relative clause.
const APPLIED_FOR_START_RE = new RegExp(String.raw`^${CLAUSE}(?=\s*[.!?]?\s*$|${OWN_FACTS}|\s*,\s*(?!(?:where|which|who|whose|when|that|whereby)\b))`);
const WORDS_RE = /[A-Za-z0-9]+/g;
// Sentence ends that are not abbreviations or initials ("Ltd. ", "J.P. Morgan").
const SUMMARY_SPLIT = /(?<!\b(?:[A-Z]|Ltd|Inc|Co|Corp|plc|St|Dr|Mr|Mrs|Ms|No|vs|etc|e\.g|i\.e)\.)(?<=[.!?])\s+/;

export function stripAppliedFor(summary: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = summary.split("\n").map((line) => {
    const sentences = line.split(SUMMARY_SPLIT);
    const kept: string[] = [];
    for (const sentence of sentences) {
      const m = APPLIED_FOR_START_RE.exec(sentence) ?? APPLIED_FOR_MID_RE.exec(sentence);
      if (!m || m.index === undefined) {
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
