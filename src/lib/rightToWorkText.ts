// Right-to-work wording in GENERATED text. The document switch
// (lib/preferences.includeRightToWorkOnCv, default off) keeps the profile's
// Right to Work section off the CV, but the summary, experience and cover
// letter are written from the master CV text, which states the status — so
// the models kept writing "Student visa … Graduate Route from January 2027"
// into the summary and the letter. When the switch is off, the tailor route
// runs these deterministic filters on the finished text: a sentence (or a
// bullet) that mentions the status is removed, and the removed text is
// reported so the user sees exactly what went. Nothing is rewritten.
//
// Since 30 Sep 2026 the module is also where every right-to-work and
// availability sentence the app WRITES comes from: rightToWorkStatement()
// turns the user's Eligibility answers into fixed sentences (the copy block
// for application forms, the letter's close when Right to Work is on the
// document), classifyRightToWorkText() reads the master CV's own wording so
// Customize can warn when it disagrees with those answers, and the two
// reconcile*() functions replace a model-written visa or availability
// sentence with the template — or remove it and ask, when the answer is not
// set. The CV's free text ("no sponsorship required", "can work full time
// now") and the model's wording are never a source.
//
// Import-free: runs in the route and under node:test.

// The status vocabulary. "visa" is matched only in its immigration sense —
// never a capitalised "Visa" alone, which is also a company.
const RTW_RE =
  /\bsponsor(?:ship|ed|ing|s)?\b|\bright(?:s)? to (?:live and )?work\b|\bwork (?:authori[sz]ation|permit)\b|\bgraduate route\b|\bgraduate visa\b|\b(?:student|graduate|skilled[- ]worker|work|tier \d|my|a|the|current|valid|this|his|her|their|require[sd]?|need(?:s|ed)?|without|no|on a)\s+visas?\b|\bvisas?\s+(?:sponsorship|status|holder|route|expir\w*|valid|until|requirements?|is|runs)\b|\bindefinite leave\b|\bILR\b|\bsettled status\b|\b(?:eligible|authori[sz]ed|entitled|permitted|legally able|legal right|legally entitled) to (?:live and )?work\b|\bimmigration\b|\bcitizenship\b|\bwork(?:ing)? rights\b|\bwork(?:ing)? authori[sz]ation\b|\bBRP\b|\bshare code\b/i;

export function mentionsRightToWork(s: string): boolean {
  return RTW_RE.test(s) || /\bvisa\b/.test(s);
}

export type StripResult = { text: string; removed: string[] };

// Line-based sections (experience, skills): a line that mentions the status
// goes as a whole — a bullet never carries anything else worth keeping there.
export function stripRightToWorkLines(text: string): StripResult {
  const removed: string[] = [];
  const kept = text.split("\n").filter((line) => {
    if (line.trim() && mentionsRightToWork(line)) {
      removed.push(line.trim());
      return false;
    }
    return true;
  });
  return { text: collapseBlankRuns(kept).join("\n"), removed };
}

// Prose (summary, cover letter): only the offending sentence goes; the line
// keeps its other sentences. Paragraph breaks survive; a paragraph left
// empty disappears.
export function stripRightToWorkSentences(text: string): StripResult {
  const removed: string[] = [];
  const kept = text.split("\n").map((line) => {
    if (!line.trim() || !mentionsRightToWork(line)) return line;
    const sentences = splitSentences(line);
    const keep = sentences.filter((s) => {
      if (mentionsRightToWork(s)) {
        removed.push(s.trim());
        return false;
      }
      return true;
    });
    return keep.join(" ").trim();
  });
  return { text: collapseBlankRuns(kept).join("\n"), removed };
}

// Projects come as { "0": [bullets], "1": [...] } (or a selected-project
// shape carrying `bullets`); a bullet that mentions the status is dropped.
export function stripRightToWorkBullets(projects: unknown): { projects: unknown; removed: string[] } {
  const removed: string[] = [];
  const filterList = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.filter((b) => {
          if (typeof b === "string" && mentionsRightToWork(b)) {
            removed.push(b.trim());
            return false;
          }
          return true;
        })
      : list;
  if (Array.isArray(projects)) return { projects: projects.map(filterList), removed };
  if (projects && typeof projects === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(projects as Record<string, unknown>)) out[k] = filterList(v);
    return { projects: out, removed };
  }
  return { projects, removed };
}

function splitSentences(line: string): string[] {
  // A sentence ends at . ! or ? followed by whitespace and a capital, digit
  // or opening quote; "e.g. this" and "v2.1" don't split.
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim() && out.length > 0 && !out[out.length - 1].trim()) continue;
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

// ── The statement, from the Eligibility answers ──────────────────────────────

export type RtwStatus = "full" | "time_limited" | "needs_sponsorship";
// Structurally lib/knockouts Eligibility's three fields (this module stays
// import-free).
export type RtwFacts = {
  rightToWork: { status: RtwStatus | "unknown"; countries: string[]; permissionEnds: string | null };
  availability: { status: "now" | "from" | "unknown"; from: string | null };
  canWorkFullTime: "yes" | "no" | "unknown";
};
export type RtwStatement = { formBlock: string; rtwSentence: string | null; availabilitySentence: string | null };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "2027-01" → "January 2027"; anything else → null.
export function monthName(ym: string | null | undefined): string | null {
  const m = typeof ym === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym) : null;
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : null;
}
// "UK" → "the UK"; "Ireland" stays.
const THE_COUNTRIES = /^(?:uk|u\.k\.|united kingdom|us|usa|u\.s\.|united states|uae|netherlands|philippines|eu|european union|republic of ireland|czech republic)$/i;
function countryPhrase(countries: string[]): string {
  const c = (countries[0] ?? "").trim().replace(/\s+/g, " ");
  if (!c) return "the UK";
  if (/^the\s/i.test(c)) return c;
  return THE_COUNTRIES.test(c) ? `the ${c}` : c;
}

export function rightToWorkStatement(e: RtwFacts): RtwStatement {
  const country = countryPhrase(e.rightToWork.countries);
  const ends = monthName(e.rightToWork.permissionEnds);
  let rtwSentence: string | null = null;
  if (e.rightToWork.status === "full") rtwSentence = `I have the permanent right to work in ${country} and will not require visa sponsorship.`;
  else if (e.rightToWork.status === "time_limited")
    rtwSentence = `I currently hold a visa that allows me to work in ${country} without sponsorship${ends ? ` until ${ends}` : ""}, and would require sponsorship to continue beyond that.`;
  else if (e.rightToWork.status === "needs_sponsorship") rtwSentence = `I will require visa sponsorship to work in ${country}.`;

  const from = monthName(e.availability.from);
  let availabilitySentence: string | null = null;
  const start = e.availability.status === "now" ? "I am available to start immediately" : e.availability.status === "from" && from ? `I am available to start from ${from}` : null;
  if (start) {
    availabilitySentence = e.canWorkFullTime === "yes" ? `${start} and can work full time.` : e.canWorkFullTime === "no" ? `${start}, though not full time.` : `${start}.`;
  } else if (e.canWorkFullTime === "yes") availabilitySentence = "I can work full time.";
  else if (e.canWorkFullTime === "no") availabilitySentence = "I am not able to work full time.";

  return { formBlock: [rtwSentence, availabilitySentence].filter((x): x is string => !!x).join("\n"), rtwSentence, availabilitySentence };
}

// ── What the master CV's own wording says ────────────────────────────────────
// Conservative: exactly one reading, or null. "No sponsorship required" and
// "right to work in the UK" alone say nothing about permanence; a time-limited
// visa that "will need sponsorship later" is time-limited; anything that reads
// as permanent AND as something else is a contradiction the user must read.

const FULL_RE =
  /\bindefinite leave\b|\bILR\b|(?<!pre-)\bsettled status\b|\b(?:british|uk|irish|eu|eea)\s+(?:citizen|national|passport)\w*|\bcitizenship\b|\bpermanent\s+(?:right|residen\w+)\b|\bfull\s+(?:and\s+permanent\s+)?rights?\s+to\s+(?:live\s+and\s+)?work\b|\bright of abode\b|\bno\s+(?:visa\s+|immigration\s+)?restrictions?\b|\bpermanently\s+(?:eligible|entitled|authori[sz]ed)\b/i;
const TIME_LIMITED_RE =
  /\b(?:student|graduate|skilled[- ]worker|tier\s*\d|post[- ]study|youth mobility|ancestry|dependant|dependent|spouse|family|high potential individual|hpi)\s+(?:visa|route|permit)\b|\bgraduate route\b|\bpre-settled status\b|\bvisas?\b[^.;]{0,40}\b(?:until|valid|expir\w*|ends?|runs?)\b|\b(?:until|valid|expir\w*|ends?)\b[^.;]{0,40}\bvisas?\b|\b(?:will|would|may|might)\s+(?:need|require)\s+(?:visa\s+)?sponsorship\s+(?:after|from|in|by|later|beyond|when|once|at)\b|\bsponsorship\s+(?:later|in\s+(?:the\s+)?future|beyond|after|from)\b/i;
const NEEDS_RE = /\b(?:require|requires|required|requiring|need|needs|needed|needing|seeking|seek|will need|would need|will require|would require)\b[^.;]{0,30}\bsponsor\w*/i;
const NEG_RE = /\b(?:no|not|without|never|don't|do not|won't|will not|doesn't|does not|isn't|is not)\b[^.;]{0,25}\bsponsor\w*/i;

export function classifyRightToWorkText(lines: string[]): RtwStatus | null {
  const text = lines.map((l) => (l ?? "").trim()).filter(Boolean).join(". ");
  if (!text) return null;
  const classes = new Set<RtwStatus>();
  for (const sentence of text.split(/(?<=[.;!?])\s+|\n+/)) {
    if (FULL_RE.test(sentence)) classes.add("full");
    if (TIME_LIMITED_RE.test(sentence)) classes.add("time_limited");
    if (NEEDS_RE.test(sentence) && !NEG_RE.test(sentence)) classes.add("needs_sponsorship");
  }
  if (classes.has("full")) return classes.size === 1 ? "full" : null;
  if (classes.has("time_limited")) return "time_limited";
  if (classes.has("needs_sponsorship")) return "needs_sponsorship";
  return null;
}

// The CV's wording against the Eligibility answer, for the Customize warning.
export function rightToWorkDisagrees(lines: string[], status: RtwStatus | "unknown"): { cv: RtwStatus; eligibility: RtwStatus } | null {
  if (status === "unknown") return null;
  const cv = classifyRightToWorkText(lines);
  return cv && cv !== status ? { cv, eligibility: status } : null;
}

// ── Reconciling generated sentences ──────────────────────────────────────────

// A first-person availability claim: when the candidate can start, or full-
// or part-time work — never "available for hybrid work" or a role described
// as full-time.
const AVAILABILITY_RE =
  /\b(?:available|ready|able|free)\s+to\s+(?:start|begin|join)\b|\bavailable\s+(?:immediately|now|from\s+\w+)\b|\b(?:can|could)\s+(?:start|begin)\b|\bstart(?:ing)?\s+(?:immediately|straight\s+away|from\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d))\b|\bnotice period\b|\b(?:I|I'm|I’m|I am|we)\b[^.]{0,40}\b(?:available|able|free|ready|can\s+work|could\s+work|work(?:ing)?)\b[^.]{0,25}\b(?:full|part)[- ]time\b/i;
export function mentionsAvailability(s: string): boolean {
  return AVAILABILITY_RE.test(s);
}

export type ReconcileResult = { text: string; replaced: { from: string; to: string }[]; removed: string[]; asked: boolean };

// Every availability sentence in the prose becomes the template sentence
// (the first one; later ones go), or goes with `asked` when the answer is
// not set.
export function reconcileAvailabilitySentences(text: string, e: RtwFacts): ReconcileResult {
  const template = rightToWorkStatement(e).availabilitySentence;
  const replaced: ReconcileResult["replaced"] = [];
  const removed: string[] = [];
  let used = false;
  const out = (text || "").split("\n").map((line) => {
    if (!line.trim() || !mentionsAvailability(line)) return line;
    const kept = splitSentences(line).flatMap((s) => {
      if (!mentionsAvailability(s)) return [s];
      if (template && !used) {
        used = true;
        replaced.push({ from: s.trim(), to: template });
        return [template];
      }
      removed.push(s.trim());
      return [];
    });
    return kept.join(" ").trim();
  });
  return { text: collapseBlankRuns(out).join("\n"), replaced, removed, asked: !template && removed.length > 0 };
}

// The model's right-to-work sentences always go (the wording is never a
// source); in "template" mode the caller places rightToWorkStatement's
// sentence itself, and `asked` says a sentence went with no answer to put
// in its place.
export function reconcileRightToWorkSentences(text: string, e: RtwFacts, mode: "strip" | "template"): ReconcileResult & { statement: string | null } {
  const r = stripRightToWorkSentences(text);
  const statement = mode === "template" ? rightToWorkStatement(e).rtwSentence : null;
  return { text: r.text, replaced: [], removed: r.removed, asked: mode === "template" && !statement && r.removed.length > 0, statement };
}
