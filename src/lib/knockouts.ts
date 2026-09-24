// Knockout questions — the eligibility conditions an application form screens
// on before anyone reads the CV: right to work / sponsorship, security
// clearance, years of experience stated as a requirement, location and
// on-site terms, degree or degree class, licences that must already be held,
// and contract vs permanent terms. Failing one is usually an automatic
// rejection ("your CV was not reviewed"), so this runs BEFORE a tailor credit
// is spent, from the free JD analysis.
//
// Deterministic and import-free on purpose (unit-tested with node:test): the
// detector is the source of truth. A model may propose extra gates from the
// same JD analysis call, but a proposal is kept only when its wording is found
// verbatim in the JD, and its value is always re-parsed here. The comparison
// with the user's eligibility profile never guesses: an unset profile field
// answers "unknown", never "pass" or "fail".

export type GateCategory =
  | "sponsorship"
  | "clearance"
  | "years"
  | "location"
  | "degree"
  | "licence"
  | "employment_type";

export const GATE_CATEGORIES: readonly GateCategory[] = [
  "sponsorship",
  "clearance",
  "years",
  "location",
  "degree",
  "licence",
  "employment_type",
];

export type Strictness = "must" | "preferred";

export type ClearanceLevel = "bpss" | "ctc" | "sc" | "dv" | "nppv" | "us_secret" | "us_ts";
export type DegreeLevel = "bachelors" | "masters" | "phd";
export type DegreeClass = "first" | "2:1" | "2:2";
export type EmploymentType = "permanent" | "contract" | "fixed_term" | "internship" | "part_time";

export type GateValue =
  | { kind: "sponsorship"; sponsorship: "unavailable" | "available" | "unstated"; citizenship: boolean; country: string | null }
  | { kind: "clearance"; level: ClearanceLevel; mustHold: boolean }
  | { kind: "years"; years: number; subject: string | null }
  | {
      kind: "location";
      mode: "onsite" | "hybrid" | "remote" | "unstated";
      daysInOffice: number | null;
      place: string | null;
      relocation: "required" | "assisted" | "none";
    }
  | { kind: "degree"; level: DegreeLevel | "unstated"; classification: DegreeClass | null; orEquivalent: boolean }
  | { kind: "licence"; name: string }
  | { kind: "employment_type"; type: EmploymentType; months: number | null; ir35: "inside" | "outside" | null }
  | { kind: "unparsed" };

export type Gate = {
  category: GateCategory;
  // The JD sentence or bullet the gate was read from, trimmed. Never invented.
  requirement: string;
  strictness: Strictness;
  source: "detector" | "model";
  value: GateValue;
};

export type Eligibility = {
  version: 1;
  // "full" = permanent (settled status, ILR, citizenship). "time_limited" = a
  // visa that allows work now without sponsorship but will need it later
  // (Student, Graduate, some Skilled Worker routes); permissionEnds is the
  // month it runs to ("2027-01"), typed by the user, never inferred.
  rightToWork: { status: "full" | "time_limited" | "needs_sponsorship" | "unknown"; countries: string[]; permissionEnds: string | null };
  clearance: { held: "none" | "bpss" | "ctc" | "sc" | "dv" | "unknown"; eligible: boolean | null };
  yearsExperience: number | null;
  location: { base: string[]; onsiteOk: boolean | null; hybridOk: boolean | null; relocateOk: boolean | null };
  degree: { level: "none" | "bachelors" | "masters" | "phd" | "unknown"; classification: "first" | "2:1" | "2:2" | "other" | "unknown" };
  licences: string[];
  employmentTypes: EmploymentType[];
  updatedAt: string | null;
};

export type Verdict = "pass" | "soft" | "hard" | "unknown";

export type GateVerdict = {
  gate: Gate;
  verdict: Verdict;
  // One sentence addressed to "you".
  reason: string;
  // Soft only: honest wording that addresses the gap head-on.
  wording?: string;
};

export type GateRead = "apply" | "long_shot" | "skip";

export type GatesSummary = {
  read: GateRead;
  hard: number;
  soft: number;
  unknown: number;
  // requirement: the JD sentence the gate was read from, so a tracker row can
  // say "Knockout: <quote>" months later.
  items: { category: GateCategory; verdict: Verdict; requirement?: string }[];
};

// The one-line copy for a stored read (tracker sheet and CV panel):
// "Knockout: <quote>" when a condition failed hard, "Long shot" for soft
// ones, "Clear" when nothing failed, "Not checked" when no read was stored.
export type GateLine = { label: "Knockout" | "Long shot" | "Clear" | "Not checked"; detail: string };
export function gateLine(g: GatesSummary | null | undefined): GateLine {
  if (!g) return { label: "Not checked", detail: "No eligibility read was stored with this application." };
  const items = Array.isArray(g.items) ? g.items : [];
  const quote = (v: Verdict) => {
    const it = items.find((x) => x.verdict === v);
    if (!it) return "";
    return it.requirement?.trim() || CATEGORY_LABEL[it.category] || "";
  };
  const hard = items.filter((x) => x.verdict === "hard").length || g.hard;
  const soft = items.filter((x) => x.verdict === "soft").length || g.soft;
  const unknown = items.filter((x) => x.verdict === "unknown").length || g.unknown;
  if (hard > 0 || g.read === "skip") {
    const q = quote("hard");
    return { label: "Knockout", detail: q ? `Knockout: ${q}` : "Knockout: a condition the form screens on was failed." };
  }
  if (soft > 0 || g.read === "long_shot") {
    const q = quote("soft");
    return { label: "Long shot", detail: q ? `Long shot: ${q}` : "Long shot: a condition was borderline." };
  }
  return { label: "Clear", detail: unknown > 0 ? `Clear — nothing failed; ${unknown} condition${unknown === 1 ? "" : "s"} to check yourself.` : "Clear — no knockout condition failed." };
}

export const MAX_GATES = 20;
export const MAX_GATE_SNIPPET = 200;
export const MIN_FULL_JD_CHARS = 1_500;
// A years shortfall up to this is arguable on the form ("3+ years" with 2);
// beyond it the honest answer is "no".
export const YEARS_SOFT_SHORTFALL = 2;

// ── Eligibility profile ──────────────────────────────────────────────────────

export const EMPTY_ELIGIBILITY: Eligibility = {
  version: 1,
  rightToWork: { status: "unknown", countries: [], permissionEnds: null },
  clearance: { held: "unknown", eligible: null },
  yearsExperience: null,
  location: { base: [], onsiteOk: null, hybridOk: null, relocateOk: null },
  degree: { level: "unknown", classification: "unknown" },
  licences: [],
  employmentTypes: [],
  updatedAt: null,
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function strList(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim().slice(0, maxLen);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

const EMPLOYMENT_TYPES: readonly EmploymentType[] = ["permanent", "contract", "fixed_term", "internship", "part_time"];

export function normalizeEligibility(v: unknown): Eligibility {
  const e = obj(v);
  const rtw = obj(e.rightToWork);
  const cl = obj(e.clearance);
  const loc = obj(e.location);
  const deg = obj(e.degree);
  const years =
    typeof e.yearsExperience === "number" && Number.isFinite(e.yearsExperience)
      ? Math.max(0, Math.min(60, Math.round(e.yearsExperience)))
      : null;
  const employmentTypes = strList(e.employmentTypes, 5, 20).filter((t): t is EmploymentType =>
    (EMPLOYMENT_TYPES as readonly string[]).includes(t)
  );
  return {
    version: 1,
    rightToWork: {
      status: oneOf(rtw.status, ["full", "time_limited", "needs_sponsorship", "unknown"] as const, "unknown"),
      countries: strList(rtw.countries, 10, 40),
      permissionEnds:
        typeof rtw.permissionEnds === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(rtw.permissionEnds) ? rtw.permissionEnds : null,
    },
    clearance: {
      held: oneOf(cl.held, ["none", "bpss", "ctc", "sc", "dv", "unknown"] as const, "unknown"),
      eligible: boolOrNull(cl.eligible),
    },
    yearsExperience: years,
    location: {
      base: strList(loc.base, 5, 60),
      onsiteOk: boolOrNull(loc.onsiteOk),
      hybridOk: boolOrNull(loc.hybridOk),
      relocateOk: boolOrNull(loc.relocateOk),
    },
    degree: {
      level: oneOf(deg.level, ["none", "bachelors", "masters", "phd", "unknown"] as const, "unknown"),
      classification: oneOf(deg.classification, ["first", "2:1", "2:2", "other", "unknown"] as const, "unknown"),
    },
    licences: strList(e.licences, 15, 80),
    employmentTypes,
    updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : null,
  };
}

// Has the user answered anything at all? An untouched profile yields only
// "unknown" verdicts and a nudge to fill it in.
export function isEligibilitySet(e: Eligibility): boolean {
  return (
    e.rightToWork.status !== "unknown" ||
    e.clearance.held !== "unknown" ||
    e.yearsExperience !== null ||
    e.location.base.length > 0 ||
    e.location.onsiteOk !== null ||
    e.location.relocateOk !== null ||
    e.degree.level !== "unknown" ||
    e.licences.length > 0 ||
    e.employmentTypes.length > 0
  );
}

// ── Text helpers ─────────────────────────────────────────────────────────────

// Lowercase, ASCII-fold the punctuation the detectors care about, collapse
// whitespace. Used for verbatim tracing of model gates and for snippet keys.
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^a-z0-9%+#:/.,'"()&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "uk", "united kingdom": "uk", "great britain": "uk", britain: "uk", england: "uk", scotland: "uk", wales: "uk", "northern ireland": "uk",
  us: "us", usa: "us", "u.s.": "us", "u.s.a.": "us", "united states": "us", "united states of america": "us", america: "us",
  eu: "eu", europe: "eu", "european union": "eu", eea: "eu",
  ireland: "ireland", "republic of ireland": "ireland",
};
const COUNTRY_WORDS = Object.keys(COUNTRY_ALIASES).concat([
  "canada", "australia", "new zealand", "germany", "netherlands", "france", "spain", "italy", "india", "singapore",
  "switzerland", "sweden", "denmark", "norway", "finland", "poland", "portugal", "belgium", "austria", "japan", "uae",
]);

export function normalizeCountry(s: string): string {
  const t = s.toLowerCase().replace(/^the\s+/, "").replace(/[.]/g, "").trim();
  return COUNTRY_ALIASES[t] ?? COUNTRY_ALIASES[`${t}.`] ?? t;
}
function isCountry(s: string): boolean {
  const t = s.toLowerCase().replace(/^the\s+/, "").replace(/[.]/g, "").trim();
  return COUNTRY_WORDS.map((w) => w.replace(/[.]/g, "")).includes(t) || Object.values(COUNTRY_ALIASES).includes(t);
}

function snippet(unit: string): string {
  const t = unit.replace(/\s+/g, " ").trim();
  return t.length > MAX_GATE_SNIPPET ? t.slice(0, MAX_GATE_SNIPPET - 1).trimEnd() + "…" : t;
}

// Split the JD into sentence-sized units, remembering the requirement context
// of the heading each unit sits under.
type Unit = { text: string; sectionMust: boolean; sectionPreferred: boolean };

const HEADING_MUST =
  /^(?:(?:key |minimum |essential |core |basic |mandatory |required )?(?:requirements?|qualifications?|criteria)|essentials?|must[- ]haves?|what (?:you(?:'ll| will)? need|we(?:'re| are) looking for|you(?:'ll| will)? bring)|about you|who you are|you (?:will )?have|skills (?:and|&) experience|(?:required )?(?:skills|experience)(?: (?:and|&) (?:skills|experience|qualifications))?|eligibility|security|clearance|right to work|location)\b/i;
const HEADING_PREFERRED =
  /^(?:nice[- ]to[- ]haves?|desirable|preferred(?: qualifications| skills)?|bonus(?: points)?|it(?:'s| would be) (?:a plus|great|nice) if|good to have|advantageous)\b/i;
const HEADING_OTHER =
  /^(?:about (?:us|the (?:company|team|role|job|position))|the role|the team|the company|benefits|what we offer|perks|salary|package|responsibilities|what you(?:'ll| will) (?:do|be doing)|day[- ]to[- ]day|your (?:role|responsibilities)|how to apply|application process|diversity|equal opportunit)/i;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70) return false;
  if (/[.!?]$/.test(t)) return false;
  // A colon-terminated short line, an ALL CAPS line, or a Title Case line
  // with no verb-like ending are headings; a bullet is not.
  if (/^[-*•▪●◦]/.test(t)) return false;
  return /:$/.test(t) || (t === t.toUpperCase() && /[A-Z]/.test(t)) || /^[A-Z][\w'&/ -]{2,60}$/.test(t);
}

function toUnits(jd: string): Unit[] {
  const units: Unit[] = [];
  let sectionMust = false;
  let sectionPreferred = false;
  for (const rawLine of jd.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s\-*•▪●◦–—]+/, "").trim();
    if (!line) continue;
    if (isHeading(line)) {
      const h = line.replace(/:$/, "").trim();
      if (HEADING_PREFERRED.test(h)) { sectionMust = false; sectionPreferred = true; }
      else if (HEADING_MUST.test(h)) { sectionMust = true; sectionPreferred = false; }
      else if (HEADING_OTHER.test(h)) { sectionMust = false; sectionPreferred = false; }
      // Anything else: keep the previous context (sub-headings, company names).
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?;])\s+(?=[A-Z(•"'])/)) {
      const text = sentence.trim();
      if (text.length >= 8) units.push({ text, sectionMust, sectionPreferred });
    }
  }
  return units;
}

const MUST_RE =
  /\b(?:must|required|require|requirement|essential|mandatory|minimum|at least|non[- ]negotiable|you(?:'ll| will)? (?:have|need|hold|bring|be)|we need|need to|needs to|only (?:candidates|applicants)|will not be considered|cannot be considered)\b/i;
const PREFERRED_RE =
  /\b(?:nice[- ]to[- ]have|preferred|preferably|ideally|ideal(?:ly)?|desirable|bonus|a plus|advantageous|beneficial|would be (?:great|good|useful)|not (?:essential|required))\b/i;

function contextOf(u: Unit): { must: boolean; preferred: boolean } {
  const preferred = PREFERRED_RE.test(u.text) || (u.sectionPreferred && !MUST_RE.test(u.text));
  const must = !preferred && (MUST_RE.test(u.text) || u.sectionMust);
  return { must, preferred };
}

// ── Category detectors ───────────────────────────────────────────────────────

// Sponsorship / right to work
const NO_SPONSOR_RE =
  /\b(?:no|not|cannot|can't|unable to|will not|won't|does not|doesn't|do not|don't|isn't|is not|aren't|are not|without|never)\b[^.;\n]{0,45}?\bsponsor(?:ship|ed|ing)?\b|\bsponsorship\b[^.;\n]{0,25}?\b(?:not|un)available\b|\bsponsorship\b[^.;\n]{0,25}?\bnot\s+(?:offered|provided|possible)\b/i;
const SPONSOR_OK_RE =
  /\bsponsorship\b[^.;\n]{0,25}?\b(?:is\s+)?(?:available|offered|provided|possible|considered)\b|\b(?:can|will|able to|happy to|willing to|open to)\s+(?:offer\s+|provide\s+|consider\s+)?(?:visa\s+)?sponsor(?:ship|ing)?\b/i;
const RTW_REQ_RE =
  /\b(?:must|need to|needs to|required to|should|will need to)\s+(?:already\s+)?(?:have|hold|possess)\b[^.;\n]{0,30}?\b(?:right to work|work authori[sz]ation|eligib\w+ to work)\b|\b(?:right to work|eligib\w+ to work|authori[sz]ed to work|work authori[sz]ation|legally (?:able|entitled) to work)\b[^.;\n]{0,50}?\b(?:required|essential|is a must|is mandatory|without (?:the need for )?(?:visa )?sponsorship|is necessary)\b/i;
// Permanent status: citizenship, ILR / settled status, or a "permanent /
// indefinite right to work" — a time-limited visa never satisfies these.
const CITIZEN_RE =
  /\b(?:british|uk|u\.?s\.?|american|irish|eu|australian|canadian)\s+citizen(?:s|ship)?\b|\bindefinite leave to remain\b|\bILR\b|\bsettled status\b|\bgreen card\b|\bpermanent residen(?:t|cy)\b|\bcitizenship\s+(?:is\s+)?required\b|\b(?:permanent|indefinite)\s+(?:right to (?:live and )?work|work authori[sz]ation)\b/i;
const RTW_COUNTRY_RE =
  /\b(?:right|rights|eligib\w+|entitle\w+|authori[sz]\w+|able|permitted|allowed)\s+to\s+(?:live\s+and\s+)?work\s+in\s+(?:the\s+)?([a-z][a-z .]{1,30}?)(?=\s+(?:without|and|is|are|with|at|from|on|for|who)\b|[,.;:)!?]|$)/i;

// "We cannot sponsor clearance" is about vetting, not visas.
const CLEARANCE_SPONSOR_RE = /\bsponsor\w*\s+(?:(?:the|your|an?|for)\s+)?(?:sc|dv|ctc|bpss|security|clearance|vetting)\b/i;

function detectSponsorship(u: Unit): Gate | null {
  const t = u.text;
  const relevant =
    /\bsponsor|\bright to work|\bwork authori|\beligib\w+ to work|\bauthori[sz]ed to work|\bentitled to work|\bcitizen|\bILR\b|\bindefinite leave|\bsettled status|\bgreen card|\bpermanent residen|\b(?:permanent|indefinite) right/i.test(t);
  if (!relevant) return null;
  if (CLEARANCE_SPONSOR_RE.test(t) && !/\bvisa\b|\bright to work\b|\bwork authori|\bcitizen/i.test(t)) return null;
  const countryMatch = RTW_COUNTRY_RE.exec(t);
  const country = countryMatch ? normalizeCountry(countryMatch[1]) : null;
  const citizenship = CITIZEN_RE.test(t);
  let sponsorship: "unavailable" | "available" | "unstated" = "unstated";
  if (NO_SPONSOR_RE.test(t) || RTW_REQ_RE.test(t) || citizenship) sponsorship = "unavailable";
  else if (SPONSOR_OK_RE.test(t)) sponsorship = "available";
  else if (!/\bsponsor/i.test(t) && !countryMatch) return null; // a stray "citizen"-ish word with nothing to say
  const { preferred } = contextOf(u);
  return {
    category: "sponsorship",
    requirement: snippet(t),
    strictness: preferred ? "preferred" : "must",
    source: "detector",
    value: { kind: "sponsorship", sponsorship, citizenship, country },
  };
}

// Security clearance
const CLEARANCE_CONTEXT_RE = /\bclear(?:ance|ed|ances)\b|\bvetting\b|\bvetted\b|\bsecurity check\b|\bTS\/SCI\b|\btop secret\b/i;
const CLEARANCE_LEVELS: [RegExp, ClearanceLevel][] = [
  [/\b(?:e?DV|developed vetting)\b/, "dv"],
  [/\bTS\/SCI\b|\btop[- ]secret\b/i, "us_ts"],
  [/\bSC\b|\bsecurity check(?:ed)?\b/, "sc"],
  [/\bCTC\b|\bcounter[- ]terrorist check\b/i, "ctc"],
  [/\bNPPV\s?[23]?\b/, "nppv"],
  [/\bBPSS\b|\bbaseline personnel security standard\b/i, "bpss"],
  [/\bsecret\b(?![- ]service)/i, "us_secret"],
];
const CLEARANCE_ELIGIBLE_RE =
  /\beligible\s+(?:for|to\s+(?:obtain|gain|undergo|get|hold|achieve))\b|\bwilling(?:ness)?\s+to\s+(?:undergo|obtain|go through|be)\b|\bability\s+to\s+(?:obtain|gain|achieve|pass)\b|\b(?:will|may)\s+be\s+(?:required|expected|asked)\s+to\s+(?:undergo|obtain|gain|achieve|pass|complete)\b|\bmust\s+be\s+(?:able|willing|eligible)\s+to\s+(?:obtain|gain|undergo|achieve|pass)\b|\bsubject\s+to\b[^.;\n]{0,25}?\b(?:vetting|clearance|checks?)\b|\bcapable\s+of\s+(?:obtaining|gaining|achieving)\b|\bcan\s+be\s+(?:obtained|gained|sponsored)\b|\b(?:we|company)\s+(?:will|can)\s+sponsor\b/i;

function detectClearance(u: Unit): Gate | null {
  const t = u.text;
  if (!CLEARANCE_CONTEXT_RE.test(t)) return null;
  let level: ClearanceLevel | null = null;
  for (const [re, lv] of CLEARANCE_LEVELS) {
    if (re.test(t)) { level = lv; break; }
  }
  if (!level) return null;
  const mustHold = !CLEARANCE_ELIGIBLE_RE.test(t);
  const { preferred } = contextOf(u);
  return {
    category: "clearance",
    requirement: snippet(t),
    strictness: preferred ? "preferred" : "must",
    source: "detector",
    value: { kind: "clearance", level, mustHold },
  };
}

// Years of experience
const YEARS_RE =
  /\b(?:(minimum(?:\s+of)?|at\s+least|over|more\s+than|min\.?)\s+)?(\d{1,2})(\s*(?:\+|plus))?(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*(?:\+\s*)?(?:years?|yrs?)(?:['’]s?)?\s+(?:of\s+)?((?:[\w/+#.-]+\s+){0,4}?)(?:experience|exp\b|expertise|background|track record)(?:\s+(?:in|with|of|using|across)\s+([\w/+#.,& -]{2,50}?))?(?=[.;:)!?]|\s+(?:and|or|is|are|as|-|–)\b|$|\b)/i;

function detectYears(u: Unit): Gate | null {
  const m = YEARS_RE.exec(u.text);
  if (!m) return null;
  const years = parseInt(m[2], 10);
  if (!Number.isFinite(years) || years <= 0 || years > 40) return null;
  const explicitFloor = !!(m[1] || m[3]);
  const { must, preferred } = contextOf(u);
  if (!must && !preferred && !explicitFloor) return null; // "we've been going 10 years" and similar prose
  const before = (m[5] || "").trim();
  const after = (m[6] || "").trim();
  const subject = (after || before).replace(/\s+/g, " ").slice(0, 60) || null;
  return {
    category: "years",
    requirement: snippet(u.text),
    strictness: preferred ? "preferred" : "must",
    source: "detector",
    value: { kind: "years", years, subject },
  };
}

// Location / on-site
const ONSITE_RE = /\b(?:(?:fully|100%|full[- ]time|entirely)\s+)?(?:on[- ]?site|in[- ]?office|office[- ]based|in\s+the\s+office|from\s+(?:our|the)\s+office)\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const HYBRID_DAYS_RE = /\b(\d|one|two|three|four|five)\s*(?:-\s*\d\s*)?days?\s*(?:a|per|each|\/)\s*week\b|\b(\d|one|two|three|four|five)\s+days?\s+(?:in|on)\s+(?:the\s+)?(?:office|site)\b/i;
const REMOTE_RE = /\b(?:fully\s+|100%\s+)?remote\b/i;
const PLACE_RE =
  /\b(?:based|located|commutable|commuting distance|within (?:easy )?reach|reside|residing|live|living|relocate|relocation|office|offices|HQ|headquarters|site)\b[^.;\n]{0,30}?\b(?:in|to|of|near|around|from|at)\s+(?:the\s+)?((?:[A-Z][\w'-]+)(?:\s+(?:[A-Z][\w'-]+|of|the|upon|on|and))*)/;
const PLACE_BASED_RE = /\b((?:[A-Z][\w'-]+)(?:\s+[A-Z][\w'-]+)?)[- ]based\b/;
const PLACE_OFFICE_RE = /\b(?:our\s+)?((?:[A-Z][\w'-]+)(?:\s+[A-Z][\w'-]+)?)\s+(?:office|offices|HQ|headquarters|hub|campus)\b/;
// "Support Hub, Liverpool - Permanent": a workplace named by its city with no
// on-site/hybrid word anywhere. Checked before the other place patterns so the
// city wins over the word before "Hub".
const PLACE_HUB_RE = /\b(?:[Hh]ub|[Oo]ffices?|HQ|[Hh]eadquarters|[Ss]tudio|[Cc]ampus),\s+((?:[A-Z][\w'-]+)(?:\s+[A-Z][\w'-]+)?)\b/;
const COUNTRY_ONLY_RE = /\b(uk|united kingdom|us|usa|united states|eu|europe|ireland|canada|australia|germany|netherlands|india|singapore)[- ]?(?:only|based|residents?|residing)\b/i;
const RELOCATION_RE = /\brelocat(?:e|ion|ing)\b/i;
const COMMUTE_RE = /\bcommut(?:e|ing|able)\b/i;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const NOT_A_PLACE_RE = /^(?:Our|The|A|An|This|You|We|Hybrid|Remote|Office|Monday|Tuesday|Wednesday|Thursday|Friday|Team|Role|Company|Home|Site|Central|Head)$/i;

function placeFrom(t: string): string | null {
  const m = PLACE_HUB_RE.exec(t) || PLACE_RE.exec(t) || PLACE_BASED_RE.exec(t) || PLACE_OFFICE_RE.exec(t);
  if (m) {
    const p = m[1].replace(/\s+(?:of|the|upon|on|and)$/i, "").trim();
    if (p.length >= 2 && p.length <= 40 && !NOT_A_PLACE_RE.test(p)) return p;
  }
  const c = COUNTRY_ONLY_RE.exec(t);
  return c ? c[1] : null;
}

function detectLocation(u: Unit): Gate | null {
  const t = u.text;
  const onsite = ONSITE_RE.test(t);
  const hybrid = HYBRID_RE.test(t);
  const remote = REMOTE_RE.test(t);
  const relocation = RELOCATION_RE.test(t);
  const place = placeFrom(t);
  // "commute to our Bristol office three days per week" is a location gate
  // without the words on-site or hybrid.
  const commute = COMMUTE_RE.test(t) && place !== null;
  // "Support Hub, Liverpool - Permanent": a workplace with a city and no
  // working-mode word. Kept as mode "unstated" so it can never fail hard.
  const hub = !onsite && !hybrid && !remote && place !== null && PLACE_HUB_RE.test(t);
  const countryOnly =
    COUNTRY_ONLY_RE.test(t) || (place !== null && isCountry(place) && /\bmust\b|\bonly\b|\brequired\b|\bbased\b/i.test(t));
  if (!onsite && !hybrid && !commute && !relocation && !hub && !(remote && countryOnly)) return null;
  let daysInOffice: number | null = null;
  const d = HYBRID_DAYS_RE.exec(t);
  if (d) {
    const raw = (d[1] || d[2] || "").toLowerCase();
    daysInOffice = NUMBER_WORDS[raw] ?? (parseInt(raw, 10) || null);
  }
  let mode: "onsite" | "hybrid" | "remote" | "unstated" = "unstated";
  if (hybrid || (commute && daysInOffice !== null && daysInOffice < 5)) mode = "hybrid";
  else if (onsite || commute) mode = "onsite";
  else if (remote) mode = "remote";
  let reloc: "required" | "assisted" | "none" = "none";
  if (relocation) reloc = /\b(?:assist\w*|package|support\w*|help|allowance|paid|cover\w*)\b/i.test(t) ? "assisted" : "required";
  if (!onsite && !hybrid && reloc === "assisted" && !countryOnly) return null; // a relocation package alone is not a gate
  const { preferred } = contextOf(u);
  return {
    category: "location",
    requirement: snippet(t),
    strictness: preferred ? "preferred" : "must",
    source: "detector",
    value: { kind: "location", mode, daysInOffice, place, relocation: reloc },
  };
}

// Degree
const DEGREE_ANCHOR_RE = /\bdegree\b|\bqualification\b|\bbsc\b|\bmsc\b|\bmeng\b|\bbeng\b|\bphd\b|\bph\.d\b|\bmba\b|\bbachelor|\bmaster['’]?s\b|\bdoctorate\b|\bgraduate\b/i;
const DEGREE_LEVELS: [RegExp, DegreeLevel][] = [
  [/\b(?:phd|ph\.d|doctorate|doctoral)\b/i, "phd"],
  [/\b(?:master['’]?s?|msc|m\.?sc|meng|mba|ma\b|postgraduate)\b/i, "masters"],
  [/\b(?:bachelor['’]?s?|bsc|b\.?sc|beng|b\.?eng|ba\b|undergraduate|degree)\b/i, "bachelors"],
];
const DEGREE_CLASS_RE = /\b(2[:.]1|upper[- ]second|2[:.]2|lower[- ]second|first[- ]class|1st[- ]class|a first)\b/i;
const OR_EQUIVALENT_RE = /\bor\s+equivalent\b|\bor\s+(?:relevant|comparable|equivalent|similar)\s+(?:experience|qualification|background)|\bequivalent\s+(?:practical\s+|work\s+)?experience\b|\bor\s+experience\b/i;

function detectDegree(u: Unit): Gate | null {
  const t = u.text;
  if (!DEGREE_ANCHOR_RE.test(t)) return null;
  const { must, preferred } = contextOf(u);
  if (!must && !preferred) return null; // "our graduate scheme" and similar prose
  let level: DegreeLevel | "unstated" = "unstated";
  for (const [re, lv] of DEGREE_LEVELS) {
    if (re.test(t)) { level = lv; break; }
  }
  const cm = DEGREE_CLASS_RE.exec(t);
  let classification: DegreeClass | null = null;
  if (cm) {
    const c = cm[1].toLowerCase();
    classification = /2[:.]1|upper/.test(c) ? "2:1" : /2[:.]2|lower/.test(c) ? "2:2" : "first";
  }
  return {
    category: "degree",
    requirement: snippet(t),
    strictness: preferred ? "preferred" : "must",
    source: "detector",
    value: { kind: "degree", level, classification, orEquivalent: OR_EQUIVALENT_RE.test(t) },
  };
}

// Licences / certifications that must already be held
const LICENCE_RE =
  /\b(?:hold(?:s|ing|er)?|valid|current|full|clean|possess(?:es|ing)?|have|has|with)\b[^.;\n]{0,30}?\b((?:uk\s+)?driving\s+licen[cs]e|(?:[A-Z]{2,6}(?:[- ][A-Z]{2,6})?\s+)?certif(?:ied|ication|icate)(?:\s+in\s+[\w\s]{2,30}?)?|chartered\s+\w+|registered\s+(?:nurse|engineer|architect|manager)|PMP|CISSP|CISM|CISA|CCNP|CCNA|PRINCE2|ITIL(?:\s+v?\d)?|AWS\s+certified(?:\s+[\w\s]{2,30}?)?|azure\s+certified(?:\s+[\w\s]{2,30}?)?|CPA|ACCA|CIMA|ACA|CFA|SIA\s+licen[cs]e|forklift\s+licen[cs]e|CSCS\s+card|gas\s+safe|NEBOSH|IOSH|DBS\s+check|enhanced\s+DBS)\b/i;
const MUST_BE_CERTIFIED_RE = /\bmust\s+be\b[^.;\n]{0,25}?\b(certified|chartered|licen[cs]ed|registered|accredited)\b/i;

function detectLicence(u: Unit): Gate | null {
  const t = u.text;
  const { must } = contextOf(u);
  if (!must) return null;
  const m = LICENCE_RE.exec(t) || MUST_BE_CERTIFIED_RE.exec(t);
  if (!m) return null;
  const name = m[1].replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name || (/^certif/i.test(name) && name.length < 12)) return null; // bare "certification" says nothing
  return {
    category: "licence",
    requirement: snippet(t),
    strictness: "must",
    source: "detector",
    value: { kind: "licence", name },
  };
}

// Employment type
const CONTRACT_MONTHS_RE = /\b(\d{1,2})[- ]months?\b[^.;\n]{0,25}?\b(?:contract|FTC|fixed[- ]term|assignment)\b|\b(?:contract|FTC|fixed[- ]term)\b[^.;\n]{0,15}?\b(\d{1,2})[- ]months?\b/i;
const FIXED_TERM_RE = /\bfixed[- ]term\b|\bFTC\b/;
const CONTRACT_RE = /\bcontract(?:or)?\b[^.;\n]{0,15}?\b(?:role|position|basis|opportunity|only|assignment|engagement)\b|\bday[- ]rate\b|\b(?:inside|outside)\s+IR35\b|\bfreelance\b|\bcontract\s+(?:to\s+)?(?:hire|perm)\b|\b\d{1,2}[- ]months?\s+contract\b/i;
const PERMANENT_RE = /\bpermanent\b|\bperm\b/i;
const INTERN_RE = /\binternship\b|\bintern\b|\bplacement\s+(?:year|student)\b/i;
const PART_TIME_RE = /\bpart[- ]time\b/i;
const IR35_RE = /\b(inside|outside)\s+IR35\b/i;

function detectEmployment(u: Unit): Gate | null {
  const t = u.text;
  const isContract = CONTRACT_RE.test(t) || FIXED_TERM_RE.test(t);
  const isPerm = PERMANENT_RE.test(t);
  if (isContract && isPerm) return null; // "permanent or contract" - not a gate
  let type: EmploymentType | null = null;
  if (INTERN_RE.test(t)) type = "internship";
  else if (FIXED_TERM_RE.test(t)) type = "fixed_term";
  else if (isContract) type = "contract";
  else if (PART_TIME_RE.test(t)) type = "part_time";
  else if (isPerm) type = "permanent";
  if (!type) return null;
  const mm = CONTRACT_MONTHS_RE.exec(t);
  const months = mm ? parseInt(mm[1] || mm[2], 10) || null : null;
  const ir = IR35_RE.exec(t);
  const { must, preferred } = contextOf(u);
  return {
    category: "employment_type",
    requirement: snippet(t),
    strictness: must && !preferred ? "must" : "preferred",
    source: "detector",
    value: { kind: "employment_type", type, months, ir35: ir ? (ir[1].toLowerCase() as "inside" | "outside") : null },
  };
}

const DETECTORS: Record<GateCategory, (u: Unit) => Gate | null> = {
  sponsorship: detectSponsorship,
  clearance: detectClearance,
  years: detectYears,
  location: detectLocation,
  degree: detectDegree,
  licence: detectLicence,
  employment_type: detectEmployment,
};

function gateKey(g: Gate): string {
  return `${g.category}|${normalizeForMatch(g.requirement).slice(0, 60)}`;
}

export function detectGates(jd: string): Gate[] {
  const out: Gate[] = [];
  const seen = new Set<string>();
  const perCategory = new Map<GateCategory, number>();
  for (const u of toUnits(jd || "")) {
    for (const category of GATE_CATEGORIES) {
      const g = DETECTORS[category](u);
      if (!g) continue;
      const k = gateKey(g);
      if (seen.has(k)) continue;
      // The same category rarely needs more than a few distinct sentences.
      const n = perCategory.get(g.category) ?? 0;
      if (n >= 4) continue;
      seen.add(k);
      perCategory.set(g.category, n + 1);
      out.push(g);
      if (out.length >= MAX_GATES) return out;
    }
  }
  return out;
}

// Re-parse a snippet as one category, for gates proposed by the model.
export function parseGateValue(category: GateCategory, text: string): GateValue {
  const g = DETECTORS[category]({ text, sectionMust: true, sectionPreferred: false });
  return g ? g.value : { kind: "unparsed" };
}

// Model-proposed gates (from the JD analysis call) are accepted only when the
// quoted requirement is actually in the JD; the value is re-parsed here and a
// detector gate for the same sentence wins.
export function mergeModelGates(detected: Gate[], modelGates: unknown, jd: string): Gate[] {
  const out = [...detected];
  if (!Array.isArray(modelGates)) return out;
  const seen = new Set(out.map(gateKey));
  const normJd = normalizeForMatch(jd || "");
  let considered = 0;
  for (const raw of modelGates) {
    if (considered >= 12) break;
    considered++;
    const m = obj(raw);
    if (typeof m.category !== "string" || !(GATE_CATEGORIES as readonly string[]).includes(m.category)) continue;
    const category = m.category as GateCategory;
    const requirement = typeof m.requirement === "string" ? snippet(m.requirement.slice(0, MAX_GATE_SNIPPET * 2)) : "";
    if (requirement.length < 8) continue;
    const norm = normalizeForMatch(requirement.replace(/…$/, ""));
    if (!norm || !normJd.includes(norm.slice(0, 120))) continue; // not verbatim -> dropped
    const gate: Gate = {
      category,
      requirement,
      strictness: m.strictness === "preferred" ? "preferred" : "must",
      source: "model",
      value: parseGateValue(category, requirement),
    };
    const k = gateKey(gate);
    if (seen.has(k)) continue;
    // A detector gate whose sentence overlaps this one already covers it.
    const head = norm.slice(0, 40);
    if (out.some((g) => g.category === category && (normalizeForMatch(g.requirement).includes(head) || norm.includes(normalizeForMatch(g.requirement).slice(0, 40))))) continue;
    seen.add(k);
    out.push(gate);
    if (out.length >= MAX_GATES) break;
  }
  return out;
}

// ── Comparison ───────────────────────────────────────────────────────────────

const CLEARANCE_RANK: Record<string, number> = { bpss: 1, ctc: 2, nppv: 2, sc: 3, dv: 4 };
const DEGREE_RANK: Record<string, number> = { none: 0, bachelors: 1, masters: 2, phd: 3 };
const CLASS_RANK: Record<string, number> = { "2:2": 1, "2:1": 2, first: 3 };
const CLEARANCE_LABEL: Record<ClearanceLevel, string> = {
  bpss: "BPSS", ctc: "CTC", sc: "SC", dv: "DV", nppv: "NPPV", us_secret: "Secret", us_ts: "Top Secret",
};
const DEGREE_LABEL: Record<string, string> = { bachelors: "a bachelor's degree", masters: "a master's degree", phd: "a PhD", unstated: "a degree" };
const TYPE_LABEL: Record<EmploymentType, string> = {
  permanent: "a permanent", contract: "a contract", fixed_term: "a fixed-term", internship: "an internship", part_time: "a part-time",
};

function v(gate: Gate, verdict: Verdict, reason: string, wording?: string): GateVerdict {
  return wording ? { gate, verdict, reason, wording } : { gate, verdict, reason };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function placeMatches(place: string, bases: string[]): boolean {
  const p = normalizeForMatch(place);
  return bases.some((b) => {
    const n = normalizeForMatch(b);
    return n === p || n.includes(p) || p.includes(n) || normalizeCountry(b) === normalizeCountry(place);
  });
}

// The base city named as a whole word inside the requirement sentence
// ("central London near Tottenham Court Road" for a London base). A base
// written as "Leeds, UK" counts by its first part.
function baseNamedIn(text: string, bases: string[]): string | null {
  const t = ` ${normalizeForMatch(text)} `;
  for (const b of bases) {
    const city = normalizeForMatch(b.split(",")[0]);
    if (city.length >= 3 && t.includes(` ${city} `)) return b.split(",")[0].trim();
  }
  return null;
}

function countryOk(country: string | null, countries: string[]): boolean | null {
  if (!country) return true;
  if (countries.length === 0) return null;
  return countries.some((c) => normalizeCountry(c) === normalizeCountry(country));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2027-01" → "Jan 2027", for verdict text and the Customize summary line.
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function compareGate(gate: Gate, e: Eligibility): GateVerdict {
  const val = gate.value;
  const pref = gate.strictness === "preferred";
  // A preferred gate can never fail hard.
  const hard = (reason: string, wording?: string) => (pref ? v(gate, "soft", reason, wording) : v(gate, "hard", reason, wording));

  switch (val.kind) {
    case "sponsorship": {
      const s = e.rightToWork.status;
      if (val.sponsorship === "available") return v(gate, "pass", "Sponsorship is offered for this role.");
      if (s === "unknown") return v(gate, "unknown", "Set your right-to-work status in Customize to check this.");
      if (s === "needs_sponsorship") {
        if (val.sponsorship === "unavailable")
          return hard("This role won't sponsor a visa and your profile says you need sponsorship. Applications failing this are usually rejected automatically, without the CV being read.");
        return v(gate, "soft", "The posting asks about your right to work without saying whether it sponsors.", "State plainly that you would need visa sponsorship and ask whether they can offer it.");
      }
      if (s === "time_limited") {
        // Work is allowed now without sponsorship; it ends when the visa does.
        const ends = e.rightToWork.permissionEnds ? ` (until ${monthLabel(e.rightToWork.permissionEnds)})` : "";
        if (val.citizenship)
          return hard(`This asks for permanent right to work, settled status or citizenship; your permission is time-limited${ends}. Applications failing this are usually rejected automatically, without the CV being read.`);
        const ok = countryOk(val.country, e.rightToWork.countries);
        if (ok === false) return v(gate, "unknown", `You've listed right to work in ${e.rightToWork.countries.join(", ")}; this role needs it in ${val.country}. Check before applying.`);
        if (val.sponsorship === "unavailable")
          return v(gate, "soft", `You can start without sponsorship${ends}, but this employer says it won't sponsor and you will need it when your permission ends.`, "State plainly that you can start without sponsorship and the month from which you would need it.");
        return v(gate, "pass", `You can work this role without sponsorship now${ends}; the form may ask when you would need it.`);
      }
      if (val.citizenship) return v(gate, "unknown", "This asks for citizenship or settled status, not just the right to work; confirm yours qualifies.");
      const ok = countryOk(val.country, e.rightToWork.countries);
      if (ok === false) return v(gate, "unknown", `You've listed right to work in ${e.rightToWork.countries.join(", ")}; this role needs it in ${val.country}. Check before applying.`);
      return v(gate, "pass", "You have the right to work this role asks for.");
    }
    case "clearance": {
      const held = e.clearance.held;
      const label = CLEARANCE_LABEL[val.level];
      if (held === "unknown") return v(gate, "unknown", "Set your clearance status in Customize to check this.");
      if (val.level === "us_secret" || val.level === "us_ts") return v(gate, "unknown", `This asks for US ${label} clearance; your profile records UK clearance only. Check it yourself.`);
      const need = CLEARANCE_RANK[val.level] ?? 0;
      const have = held === "none" ? 0 : CLEARANCE_RANK[held] ?? 0;
      if (have >= need) return v(gate, "pass", `You hold ${label} clearance or higher.`);
      if (val.mustHold)
        return hard(`Requires active ${label} clearance and you don't hold it. Clearance takes months to obtain, and applications failing this are usually rejected automatically, without the CV being read.`);
      if (e.clearance.eligible === true)
        return v(gate, "pass", `You don't hold ${label} yet, but the role only asks that you can obtain it.`, `Say you meet the residency requirement and are willing to undergo ${label} vetting.`);
      if (e.clearance.eligible === false) return hard(`The role needs you to be eligible for ${label} clearance and your profile says you aren't.`);
      return v(gate, "unknown", `The role asks that you can obtain ${label} clearance; say in Customize whether you're eligible.`);
    }
    case "years": {
      const y = e.yearsExperience;
      if (y === null) return v(gate, "unknown", "Add your years of experience in Customize to check this.");
      const need = val.years;
      const subj = val.subject ? ` (${val.subject})` : "";
      if (y >= need) return v(gate, "pass", `Asks for ${need}+ years${subj}; you have ${y}.`);
      const shortfall = need - y;
      if (pref || shortfall <= YEARS_SOFT_SHORTFALL)
        return v(gate, "soft", `Asks for ${need}+ years${subj}; you have ${y}. Close enough to argue.`, `Lead with the depth of what you did in those ${y} years rather than the count; don't round up.`);
      return hard(`Asks for ${need}+ years${subj}; you have ${y}. A years question on the form is answered with a number, and yours falls short.`);
    }
    case "location": {
      const loc = e.location;
      const place = val.place;
      if (val.mode === "remote") {
        if (!place) return v(gate, "pass", "Remote role.");
        const ok = countryOk(place, loc.base.length ? loc.base : e.rightToWork.countries);
        if (ok === true || placeMatches(place, loc.base)) return v(gate, "pass", `Remote within ${place}, where you're based.`);
        if (ok === null) return v(gate, "unknown", `Remote but restricted to ${place}; add your base location in Customize to check.`);
        return v(gate, "unknown", `Remote but restricted to ${place}; your profile lists elsewhere. Check before applying.`);
      }
      if (val.relocation === "required" && val.mode === "unstated") {
        if (loc.relocateOk === true) return v(gate, "pass", "Relocation required and you're open to it.");
        if (loc.relocateOk === false) return v(gate, "soft", "Relocation is required and you've said you won't relocate.", "Only apply if you'd genuinely consider moving; say so plainly.");
        return v(gate, "unknown", "Relocation is required; say in Customize whether you'd relocate.");
      }
      const modeLabel =
        val.mode === "hybrid" ? `hybrid${val.daysInOffice ? ` (${val.daysInOffice} days in the office)` : ""}` : val.mode === "onsite" ? "on-site" : "located";
      if (place) {
        if (loc.base.length === 0) return v(gate, "unknown", `${cap(modeLabel)} in ${place}; add your base location in Customize to check the commute.`);
        // "central London near Tottenham Court Road": the place parsed is a
        // street, but the sentence names your base city — that is a pass.
        const base = placeMatches(place, loc.base) ? place : baseNamedIn(gate.requirement, loc.base);
        if (base) return v(gate, "pass", `${cap(modeLabel)} in ${base}, where you're based.`);
        if (loc.relocateOk === true) return v(gate, "soft", `${cap(modeLabel)} in ${place}; you're based in ${loc.base.join(", ")}.`, `Say you're willing to relocate to ${place}, and when.`);
        if (loc.relocateOk === false) {
          if (val.mode === "onsite") return hard(`On-site in ${place}; you're based in ${loc.base.join(", ")} and not relocating.`);
          return v(gate, "soft", `${cap(modeLabel)} in ${place}; you're based in ${loc.base.join(", ")} and not relocating. Office days are sometimes negotiable.`, "Ask how fixed the office days are before you commit.");
        }
        return v(gate, "unknown", `${cap(modeLabel)} in ${place}; say in Customize whether you'd relocate.`);
      }
      const ok = val.mode === "hybrid" ? loc.hybridOk ?? loc.onsiteOk : loc.onsiteOk;
      if (ok === true) return v(gate, "pass", `${cap(modeLabel)} role and you're fine with that.`);
      if (ok === false) return v(gate, "soft", `${cap(modeLabel)} role; you've said you'd rather not.`, "Decide whether you'd actually do the office days before applying.");
      return v(gate, "unknown", `${cap(modeLabel)} role; say in Customize whether that works for you.`);
    }
    case "degree": {
      const d = e.degree;
      if (d.level === "unknown") return v(gate, "unknown", "Add your highest degree in Customize to check this.");
      const need = val.level === "unstated" ? 1 : DEGREE_RANK[val.level];
      const have = DEGREE_RANK[d.level] ?? 0;
      const label = DEGREE_LABEL[val.level];
      if (have < need) {
        if (val.orEquivalent) return v(gate, "soft", `Asks for ${label} or equivalent experience; you don't hold the degree.`, "Point to the equivalent experience the posting allows, specifically.");
        return hard(`Requires ${label}; your profile says you don't hold one.`);
      }
      if (val.classification) {
        if (d.classification === "unknown") return v(gate, "unknown", `Asks for a ${val.classification}; add your degree classification in Customize.`);
        if (d.classification === "other") return v(gate, "unknown", `Asks for a ${val.classification}; your classification isn't on the UK scale, so check how they'd treat it.`);
        if ((CLASS_RANK[d.classification] ?? 0) < (CLASS_RANK[val.classification] ?? 0))
          return hard(`Requires a ${val.classification} and your profile records a ${d.classification}. Degree class is a form question.`);
      }
      return v(gate, "pass", `You hold ${label}${val.classification ? ` at ${val.classification} or better` : ""}.`);
    }
    case "licence": {
      if (e.licences.length === 0) return v(gate, "unknown", `Asks that you hold ${val.name}; list your licences and certifications in Customize to check.`);
      const want = normalizeForMatch(val.name);
      const has = e.licences.some((l) => {
        const n = normalizeForMatch(l);
        return n === want || n.includes(want) || want.includes(n);
      });
      if (has) return v(gate, "pass", `You hold ${val.name}.`);
      return v(gate, "soft", `Asks that you hold ${val.name}, which isn't in your list.`, `Confirm whether you actually hold ${val.name}; if not, don't claim it.`);
    }
    case "employment_type": {
      if (e.employmentTypes.length === 0) return v(gate, "pass", `This is ${TYPE_LABEL[val.type]} role.`);
      if (e.employmentTypes.includes(val.type)) return v(gate, "pass", `This is ${TYPE_LABEL[val.type]} role, which you'd take.`);
      return v(gate, "soft", `This is ${TYPE_LABEL[val.type]} role${val.months ? ` (${val.months} months)` : ""}; your profile lists ${e.employmentTypes.join(", ")}.`, "Only apply if you'd genuinely accept these terms.");
    }
    default:
      return v(gate, "unknown", "Check this requirement yourself before applying.");
  }
}

export function compareGates(gates: Gate[], e: Eligibility): GateVerdict[] {
  return gates.map((g) => compareGate(g, e));
}

export type Coverage = { matched: number; total: number } | null;

// The one-line read: any hard fail is a skip; a soft fail, weak required-skill
// coverage or a thin keyword overlap is a long shot; otherwise apply. Unknown
// gates never move the read - they're listed for the user to check.
export function readVerdict(verdicts: GateVerdict[], required: Coverage, top15: Coverage): { read: GateRead; reason: string } {
  const hardOnes = verdicts.filter((x) => x.verdict === "hard");
  if (hardOnes.length > 0) {
    return {
      read: "skip",
      reason: `${hardOnes.length === 1 ? "One eligibility gate" : `${hardOnes.length} eligibility gates`} you can't pass right now. Applications failing a gate are usually rejected automatically, without the CV being read.`,
    };
  }
  const reasons: string[] = [];
  const soft = verdicts.filter((x) => x.verdict === "soft").length;
  if (soft > 0) reasons.push(`${soft} eligibility ${soft === 1 ? "gate is" : "gates are"} arguable`);
  if (required && required.total > 0 && required.matched / required.total < 0.5)
    reasons.push(`your CV shows ${required.matched} of ${required.total} required skills`);
  if (top15 && top15.total > 0 && top15.matched < 10 && (!required || required.total === 0))
    reasons.push(`${top15.matched} of ${top15.total} of the role's terms are in your CV`);
  if (reasons.length > 0) return { read: "long_shot", reason: reasons.join("; ") + ". Worth applying if you can address that head-on." };
  const unknown = verdicts.filter((x) => x.verdict === "unknown").length;
  return {
    read: "apply",
    reason: unknown > 0 ? `No gate you'd fail; ${unknown} to check yourself below.` : "No eligibility gate you'd fail, and your CV covers the role's requirements.",
  };
}

export function jdQuality(jd: string): { chars: number; partial: boolean } {
  const chars = (jd || "").trim().length;
  return { chars, partial: chars > 0 && chars < MIN_FULL_JD_CHARS };
}

export function summarizeGates(verdicts: GateVerdict[], read: GateRead): GatesSummary {
  const count = (k: Verdict) => verdicts.filter((x) => x.verdict === k).length;
  return {
    read,
    hard: count("hard"),
    soft: count("soft"),
    unknown: count("unknown"),
    items: verdicts.slice(0, MAX_GATES).map((x) => ({ category: x.gate.category, verdict: x.verdict, requirement: x.gate.requirement })),
  };
}

export const CATEGORY_LABEL: Record<GateCategory, string> = {
  sponsorship: "Right to work",
  clearance: "Security clearance",
  years: "Years of experience",
  location: "Location",
  degree: "Degree",
  licence: "Licence / certification",
  employment_type: "Contract type",
};
