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
// A title may carry dots ("Node.js Developer", ".NET Engineer"): a dot followed by a letter is part of it.
const TITLE_CHARS = String.raw`(?:[^.!?\n]|\.(?=\w))`;
const APPLIED_FOR_RE = new RegExp(
  String.raw`(?:^|[,;:]\s*|\s+[—–-]\s+|\s+)(?:(?:and|now|currently|while)\s+)*(?:applying|apply)\s+(?:for|to)\s+(?:(?:the|this|a|an|your)\s+)?(?:(?:role|position)\s+of\s+(?:[^.!?\n,;]|\.(?=\w)){1,90}|${TITLE_CHARS}{1,90}?\b(?:roles?|positions?|opportunit(?:y|ies)|jobs?|post|vacanc(?:y|ies)))(?=[\s,;:.!?]|$)(?:\s+(?:at|with)\s+(?:[^.!?\n,;]|\.(?=\w)){1,60})?`,
  "gi"
);
const WORDS_RE = /[A-Za-z0-9]+/g;

export function stripAppliedFor(summary: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = summary.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    for (const sentence of sentences) {
      APPLIED_FOR_RE.lastIndex = 0;
      if (!APPLIED_FOR_RE.test(sentence)) {
        kept.push(sentence);
        continue;
      }
      APPLIED_FOR_RE.lastIndex = 0;
      let rest = sentence.replace(APPLIED_FOR_RE, "").replace(/^[\s,;:—–-]+/, "").replace(/[\s,;:—–-]+([.!?])?\s*$/, "$1");
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
