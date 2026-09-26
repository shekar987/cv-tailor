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
