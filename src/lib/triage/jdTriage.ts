// JD triage (1 Nov 2026, Chunk 8): one word per posting — Apply / Review /
// Skip — read off the job description's own text before anything is spent.
// Born of two postings on 1 Nov: Moneybox's Forward Deployed Engineer was
// submitted although its Essential list opened with "5+ years of software
// engineering", and Fuzzy Labs hid its clearance requirement in the screening
// questions ("lived in UK 5+ years?", "willing to do SC?").
//
// Skip when the posting:
//   - asks for 3+ years of experience as a REQUIREMENT (an Essential /
//     Requirements / "You have" section, a requirement cue such as "at least"
//     or "you'll have", or "N years of experience" in a posting with no
//     headings) — a company fact ("founded 10 years ago") never counts, and a
//     Desirable list makes it a Review;
//   - needs security clearance (SC, DV, "eligible for security clearance");
//   - needs five years' UK residence (the clearance rule in other words);
//   - is a contract role (day rate, IR35, "6-month contract", "contract role")
//     — a "permanent contract" or "smart contracts" is not;
//   - will not sponsor "now or in the future" / "at any time" — "unable to
//     sponsor at this time" is not a Skip.
// Review when it asks for about 2 years (2+, 2–3, "two years"), the right to
// work "for the duration" of the job, or names C#, .NET, Java, Kotlin or C++
// as a core language (the title or the requirements, not a Desirable line and
// not one option of "Python or Java").
//
// Deterministic and import-free (node:test runs it). Each reason is the
// phrase the rule matched, at most 120 characters; each hit also keeps its
// sentence so the badge can show where it was read. An optional profile
// drops what plainly does not apply to the person: a "Skip" for sponsorship
// when their right to work is full, and a years "Skip" when their stated
// years meet the minimum. With no profile the rules run exactly as above.

export type TriageVerdict = "apply" | "review" | "skip";
export type TriageRule =
  | "years"
  | "clearance"
  | "residence"
  | "contract"
  | "sponsorship"
  | "years_review"
  | "rtw_duration"
  | "languages";
export type TriageHit = { level: "skip" | "review"; rule: TriageRule; phrase: string; sentence: string };
export type JdTriage = { verdict: TriageVerdict; reasons: string[]; hits: TriageHit[] };
export type TriageProfile = {
  // lib/knockouts Eligibility.rightToWork.status: "full" drops the sponsorship rule.
  rightToWork?: string | null;
  // lib/knockouts Eligibility.yearsExperience: meeting a stated minimum drops that years "Skip".
  yearsExperience?: number | null;
};

export const MAX_PHRASE_CHARS = 120;
const MAX_SENTENCE_CHARS = 240;
const MAX_REASONS = 6;
const MAX_HITS = 12;

export const TRIAGE_LABELS: Record<TriageVerdict, string> = { apply: "Apply", review: "Review", skip: "Skip" };
export const TRIAGE_RULE_LABELS: Record<TriageRule, string> = {
  years: "Years of experience",
  clearance: "Security clearance",
  residence: "UK residence",
  contract: "Contract role",
  sponsorship: "No sponsorship",
  years_review: "Years of experience",
  rtw_duration: "Right to work for the duration",
  languages: "Core language",
};

type Section = "req" | "nice" | "other" | null;

// ── Sections ────────────────────────────────────────────────────────────────

const NICE_HEADING = /\b(?:nice[\s-]to[\s-]haves?|desirable|desired|bonus(?:\s+points)?|preferred|pluses|a\s+plus|extra\s+credit|ideally|would\s+be\s+(?:great|nice|good)|advantageous|beneficial|not\s+required|optional)\b/i;
const REQ_HEADING = /\b(?:requirements?|required|essential|essentials|qualifications?|what\s+you(?:['’]ll|\s+will)?\s+(?:need|bring|have)|you\s+(?:have|bring|are|need|will\s+have)|you['’]ll\s+(?:have|need|bring)|about\s+you|who\s+you\s+are|looking\s+for|must[\s-]haves?|skills|experience|ideal\s+candidate|to\s+succeed|what\s+we\s+need|your\s+(?:background|profile|experience|skills)|criteria|competenc(?:y|ies)|apply\s+if)\b/i;
const OTHER_HEADING = /\b(?:about|the\s+role|role|responsibilit\w*|what\s+you['’]ll\s+(?:do|be\s+doing)|what\s+you\s+will\s+(?:do|be\s+doing)|day[\s-]to[\s-]day|benefits?|perks|what\s+we\s+offer|why\s+(?:join|us)|life\s+at|our\s+(?:values|culture|team|mission|story)|how\s+to\s+apply|interview|process|the\s+team|salary|compensation|package|location|diversity|equal|inclusion|brief|overview|summary|company|who\s+we\s+are|mission)\b/i;

function classifyHeading(text: string): Section | "unknown" {
  if (NICE_HEADING.test(text)) return "nice";
  if (REQ_HEADING.test(text)) return "req";
  if (OTHER_HEADING.test(text)) return "other";
  return "unknown";
}

const BULLET_RE = /^\s*(?:[-•*·▪◦–—]|\d{1,2}[.)])\s+/;

// A heading: a short line of words with no figure and no closing punctuation
// (a bullet never is one). "Python" alone passes the shape test but names no
// section, so it changes nothing (see classifyHeading's "unknown").
function asHeading(raw: string): string | null {
  if (BULLET_RE.test(raw)) return null;
  const t = raw.trim();
  if (!t || t.length > 70 || /\d/.test(t) || /[.!?;,]$/.test(t)) return null;
  if (t.split(/\s+/).length > 9) return null;
  return t.replace(/:$/, "");
}

// "Essential: 5+ years …" — a label that sets the context of its own line.
const LABEL_RE = /^([A-Za-z][A-Za-z '’&/-]{1,40}):\s+\S/;

// ── Sentence cues ───────────────────────────────────────────────────────────

const REQ_CUE = /\b(?:essential|required|requirements?|must(?:\s+have)?|you(?:['’]ll|\s+will)?\s+(?:have|need|bring)|we(?:['’]re|\s+are)\s+looking\s+for|have\s+(?:[\w-]+\s+){0,2}?experience|minimum(?:\s+of)?|at\s+least|proven|demonstrable)\b/i;
const NICE_CUE = /\b(?:desirable|nice[\s-]to[\s-]have|bonus|preferred|ideally|a\s+plus|advantageous|beneficial|not\s+(?:a\s+)?(?:required|requirement|essential))\b/i;

// ── Years ───────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const NUM = `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
// "5+ years", "5 plus years", "3-5 years", "two to three years", "between 3
// and 5 years", "5+ years'". The first number is the minimum.
const YEARS_RE = new RegExp(
  `(?<![\\w.£$€%])(${NUM})(?:\\s*(?:\\+|plus))?(?:\\s*(?:-|–|—|to|and)\\s*${NUM})?(?:\\s*\\+)?\\s*(?:full\\s+|calendar\\s+)?years?\\b`,
  "gi"
);
// A span of time, not a requirement: "within 2 years", "in the last 3 years",
// "for over 10 years", "18 years old", "5 years ago".
const YEARS_BEFORE_SKIP = /(?:within|in\s+the\s+(?:last|past|next|first)|over\s+the\s+(?:last|past|next)|(?:last|past|next|first)|every|up\s+to|less\s+than|under|after|for(?:\s+(?:over|more\s+than|nearly|almost))?|aged?|since)\s*$/i;
const YEARS_AFTER_SKIP = /^\s*(?:old\b|of\s+age\b|ago\b|later\b|from\s+now\b)/i;
// What follows a requirement: "of experience", "' experience", "in software",
// "as a developer", "of software engineering".
const YEARS_AFTER_REQ = /^\s*(?:['’]\s*)?(?:(?:of\s+)?(?:[\w-]+\s+){0,4}?(?:experience|engineering|development|programming|coding)\b|exp\b|in\s+(?:a|an|the|software|industry|engineering|commercial|professional|production|web|backend|frontend|data)\b|working\b|as\s+an?\b|building\b|developing\b|commercial\b|professional\b|hands-on\b|industry\b|relevant\b|post-?qualification\b)/i;

function numberOf(token: string): number {
  const t = token.toLowerCase();
  return /^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t] ?? NaN);
}

// ── The other rules ─────────────────────────────────────────────────────────

const CLEARANCE_I = /security[\s-]+clear(?:ance|ed)|developed\s+vetting|eligible\s+for\s+security\b/i;
// Upper case only: "SC" and "DV" are abbreviations; "dv" in running text is not.
// "willing to do SC?" (Fuzzy Labs' screening question) is the last form.
const CLEARANCE_CS = /\bSC\s+clear(?:ance|ed)\b|\bDV\b(?:\s+clear(?:ance|ed))?|eligible\s+for\s+SC\b|\bSC\b(?=\s*(?:\)|checks?|vetting|level))|\b(?:do|undergo|obtain|hold|have|complete|pass|achieve|gain)\s+(?:an?\s+)?SC\b/;
const CLEARANCE_NOT = /\b(?:no|not|n['’]t|without)\b[^.?!]{0,40}\b(?:clearance|vetting)\b|\bclearance\b[^.?!]{0,30}\bnot\s+(?:required|needed|necessary)\b/i;

const RESIDENCE = /lived\s+in\s+(?:the\s+)?(?:UK|U\.K\.|United\s+Kingdom)\s+(?:for\s+)?(?:at\s+least\s+|a\s+minimum\s+of\s+|the\s+(?:last|past)\s+)?(?:5|five)\s*\+?\s*(?:consecutive\s+|continuous\s+)?years|(?:5|five)\s+years['’]?\s+(?:of\s+)?(?:continuous\s+)?(?:UK\s+)?residen(?:ce|cy)|resident\s+in\s+(?:the\s+)?(?:UK|United\s+Kingdom)\s+for\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?(?:the\s+(?:last|past)\s+)?(?:5|five)\s+years/i;

const CONTRACT = /\bday[\s-]rates?\b|\b(?:inside|outside)\s+IR35\b|\bIR35\b|\b(?:\d{1,2}|three|six|nine|twelve)(?:\s*(?:-|to)\s*\d{1,2})?[\s-]+months?['’]?\s+(?:initial\s+|rolling\s+)?(?:contract|engagement)\b|\bcontract\s+(?:role|position|basis|opportunity|assignment|engagement|job)\b|\b(?:initial|rolling|freelance|interim)\s+contract\b|\bon\s+a\s+contract\b|\b(?:contract|employment|job)\s+type\s*[:\-–]\s*contract(?:or)?\b|\bcontractor\s+(?:role|position|basis)\b|\((?:contract|contractor)\)/i;

const NO_SPONSOR = /\b(?:unable|not\s+able|cannot|can\s*not|can['’]t|do\s+not|don['’]t|does\s+not|doesn['’]t|will\s+not|won['’]t|not\s+in\s+a\s+position|are\s+not|aren['’]t|is\s+not|isn['’]t|no)\b[^.?!]{0,60}?\bsponsor\w*/i;
const SPONSOR_FUTURE = /\bnow\s+or\s+(?:at\s+any\s+(?:point|time)\s+)?in\s+the\s+future\b|\bnow\s+or\s+at\s+any\s+(?:point|time)\b|\bat\s+any\s+(?:point|time)\b|\bcurrently\s+or\s+in\s+the\s+future\b/i;

const RTW_DURATION = /\bright\s+to\s+work\b[^.?!]{0,80}?\bfor\s+the\s+(?:full\s+|entire\s+|whole\s+)?duration\b|\bfor\s+the\s+(?:full\s+|entire\s+|whole\s+)?duration\b[^.?!]{0,80}?\bright\s+to\s+work\b/i;

const CORE_LANGS: { name: string; re: RegExp }[] = [
  { name: "C#", re: /(?<![\w#])C#(?![\w#])/ },
  { name: ".NET", re: /\.NET\b|\bdotnet\b/i },
  { name: "Java", re: /\bJava\b(?![\s-]?[Ss]cript)/i },
  { name: "Kotlin", re: /\bKotlin\b/i },
  { name: "C++", re: /(?<![\w+])C\+\+(?![\w+])/ },
];
// "Python or Java", "strongly-typed languages (Go, Java, C, Scala etc.)": a
// language named beside other mainstream ones is an option or an example,
// not THE language of the job.
const OTHER_LANG_OPTION = /\b(?:Python|TypeScript|JavaScript|Go|Golang|Rust|Ruby|PHP|Scala|Swift|Elixir|Node(?:\.js)?)\b/;

// ── Helpers ─────────────────────────────────────────────────────────────────

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Ctx = { section: Section; sentence: string; isTitle: boolean };

function yearsHits(ctx: Ctx, profile: TriageProfile | undefined, add: (h: TriageHit) => void) {
  const s = ctx.sentence;
  // The residence rule owns "lived in the UK for 5 years".
  if (RESIDENCE.test(s)) return;
  for (const m of s.matchAll(YEARS_RE)) {
    const at = m.index ?? 0;
    const before = s.slice(Math.max(0, at - 30), at);
    const after = s.slice(at + m[0].length);
    if (YEARS_BEFORE_SKIP.test(before) || YEARS_AFTER_SKIP.test(after)) continue;
    const min = numberOf(m[1]);
    if (!Number.isFinite(min) || min < 2 || min > 19) continue;
    // A softener counts in the years phrase's own clause only: "3+ years'
    // experience in Product Management, ideally delivering …" is still a
    // minimum; "Ideally 3+ years" and "3+ years preferred" are not.
    const clause = `${s.slice(0, at)} ${m[0]} ${after.split(/[,;(]|\s[—–]\s/)[0]}`;
    const nice = ctx.section === "nice" || NICE_CUE.test(clause);
    const cue = REQ_CUE.test(s);
    const req = !nice && (ctx.section === "req" || cue || (ctx.section === null && YEARS_AFTER_REQ.test(after)));
    const phrase = m[0];
    if (min >= 3) {
      if (req) {
        const years = profile?.yearsExperience;
        if (typeof years === "number" && Number.isFinite(years) && years >= min) continue;
        add({ level: "skip", rule: "years", phrase, sentence: s });
      } else if (nice) {
        add({ level: "review", rule: "years_review", phrase, sentence: s });
      }
    } else if (req || nice || (ctx.section !== "other" && (ctx.section === null || YEARS_AFTER_REQ.test(after)))) {
      add({ level: "review", rule: "years_review", phrase, sentence: s });
    }
  }
}

function firstMatch(s: string, ...res: RegExp[]): string | null {
  for (const re of res) {
    const m = s.match(re);
    if (m) return m[0];
  }
  return null;
}

/** The posting's triage: Apply / Review / Skip and the phrases that decided it (see the header). */
export function triageJd(text: string, profile?: TriageProfile): JdTriage {
  const hits: TriageHit[] = [];
  const seen = new Set<string>();
  const add = (h: TriageHit) => {
    const key = `${h.rule}|${h.phrase.toLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key) || hits.length >= MAX_HITS) return;
    seen.add(key);
    hits.push({ ...h, phrase: clip(h.phrase, MAX_PHRASE_CHARS), sentence: clip(h.sentence, MAX_SENTENCE_CHARS) });
  };

  let section: Section = null;
  let titleSeen = false;
  for (const raw of (text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    // The first line is the job title, unless it is a section heading (a
    // pasted posting can open on "Requirements").
    const heading = asHeading(raw);
    const kind = heading === null ? "unknown" : classifyHeading(heading);
    const isTitle = !titleSeen && kind !== "req" && kind !== "nice";
    titleSeen = true;

    if (heading !== null && !isTitle) {
      if (kind !== "unknown") section = kind;
      else if (/:\s*$/.test(raw)) section = "other";
      // A heading is not itself a requirement; it only sets the context.
      if (kind !== "unknown" || /:\s*$/.test(raw)) continue;
    }

    let lineSection = section;
    const label = raw.trim().replace(BULLET_RE, "").match(LABEL_RE);
    if (label) {
      const labelKind = classifyHeading(label[1]);
      if (labelKind === "req" || labelKind === "nice") lineSection = labelKind;
    }

    const body = raw.replace(BULLET_RE, "").trim();
    for (const sentence of sentencesOf(body)) {
      const ctx: Ctx = { section: lineSection, sentence, isTitle };

      yearsHits(ctx, profile, add);

      const residence = sentence.match(RESIDENCE);
      if (residence) add({ level: "skip", rule: "residence", phrase: residence[0], sentence });

      const clearance = firstMatch(sentence, CLEARANCE_I, CLEARANCE_CS);
      if (clearance && !CLEARANCE_NOT.test(sentence)) add({ level: "skip", rule: "clearance", phrase: clearance, sentence });

      const contract = sentence.match(CONTRACT);
      if (contract) add({ level: "skip", rule: "contract", phrase: contract[0], sentence });

      const noSponsor = sentence.match(NO_SPONSOR);
      const future = sentence.match(SPONSOR_FUTURE);
      if (noSponsor && future && profile?.rightToWork !== "full") {
        const start = noSponsor.index ?? 0;
        const end = Math.max(start + noSponsor[0].length, (future.index ?? 0) + future[0].length);
        add({ level: "skip", rule: "sponsorship", phrase: sentence.slice(start, end), sentence });
      }

      const rtw = sentence.match(RTW_DURATION);
      if (rtw) add({ level: "review", rule: "rtw_duration", phrase: rtw[0], sentence });

      const core = isTitle || (lineSection !== "nice" && !NICE_CUE.test(sentence) && (lineSection === "req" || REQ_CUE.test(sentence)));
      if (core && !OTHER_LANG_OPTION.test(sentence)) {
        for (const lang of CORE_LANGS) {
          if (lang.re.test(sentence)) add({ level: "review", rule: "languages", phrase: lang.name, sentence });
        }
      }
    }
  }

  const skip = hits.filter((h) => h.level === "skip");
  const verdict: TriageVerdict = skip.length ? "skip" : hits.length ? "review" : "apply";
  const deciding = skip.length ? skip : hits;
  const reasons: string[] = [];
  for (const h of deciding) {
    if (!reasons.some((r) => r.toLowerCase() === h.phrase.toLowerCase())) reasons.push(h.phrase);
    if (reasons.length >= MAX_REASONS) break;
  }
  return { verdict, reasons, hits };
}

/** "Skip: 5+ years; security clearance" — the badge's text. */
export function triageText(t: JdTriage): string {
  return t.reasons.length ? `${TRIAGE_LABELS[t.verdict]}: ${t.reasons.join("; ")}` : TRIAGE_LABELS[t.verdict];
}

const VERDICTS: readonly TriageVerdict[] = ["apply", "review", "skip"];
const RULES = new Set<string>(Object.keys(TRIAGE_RULE_LABELS));

/** A stored triage re-bounded on read (a user can write their own row), or null. */
export function normalizeTriage(value: unknown): JdTriage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.verdict !== "string" || !(VERDICTS as readonly string[]).includes(v.verdict)) return null;
  const reasons = Array.isArray(v.reasons)
    ? v.reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "").slice(0, MAX_REASONS).map((r) => clip(r, MAX_PHRASE_CHARS))
    : [];
  const hits = Array.isArray(v.hits)
    ? v.hits
        .filter(
          (h): h is TriageHit =>
            !!h &&
            typeof h === "object" &&
            ((h as TriageHit).level === "skip" || (h as TriageHit).level === "review") &&
            RULES.has((h as TriageHit).rule) &&
            typeof (h as TriageHit).phrase === "string" &&
            typeof (h as TriageHit).sentence === "string"
        )
        .slice(0, MAX_HITS)
        .map((h) => ({ level: h.level, rule: h.rule, phrase: clip(h.phrase, MAX_PHRASE_CHARS), sentence: clip(h.sentence, MAX_SENTENCE_CHARS) }))
    : [];
  return { verdict: v.verdict as TriageVerdict, reasons, hits };
}

/** The profile from a lib/knockouts Eligibility (read structurally, so this module imports nothing). */
export function eligibilityTriageProfile(eligibility: unknown): TriageProfile | undefined {
  if (!eligibility || typeof eligibility !== "object") return undefined;
  const e = eligibility as { rightToWork?: { status?: unknown }; yearsExperience?: unknown };
  return triageProfileOf({ rightToWork: e.rightToWork?.status, yearsExperience: e.yearsExperience });
}

/** The profile as a request body carries it ({ rightToWork, yearsExperience }), bounded. */
export function triageProfileOf(value: unknown): TriageProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const rtw = typeof v.rightToWork === "string" && v.rightToWork !== "unknown" ? v.rightToWork.slice(0, 40) : null;
  const years = typeof v.yearsExperience === "number" && Number.isFinite(v.yearsExperience) ? Math.max(0, Math.min(60, Math.round(v.yearsExperience))) : null;
  return rtw || years !== null ? { rightToWork: rtw, yearsExperience: years } : undefined;
}
