// JD rules engine (TL-3, 27 Nov 2026). Deterministic — no network calls.
//
// Reuses the section splitter and years detector from lib/triage/jdTriage to
// avoid duplicating detection logic. The red-flag codes here map 1-to-1 with
// jdTriage's TriageHits so the caller (parse.ts) can merge both without
// running two copies of the same regex.
//
// New detectors added here (not in jdTriage):
//   salary         — £X, £Xk–Yk pa, GBP, per annum, per day, hourly
//   stale_posting  — "posted X days/weeks/months ago", explicit dates
//   fixed_start    — "September start", "start date: September", "start: Sep 2027"
//   core_skill     — Java / C# / C++ / .NET / Go / Rust / Kotlin / PHP as THE language
//   skills         — bullet extraction from req/nice sections
//   seniority      — "junior", "graduate", "senior engineer", etc.
//   contract       — permanent / fixed_term / contract / internship
//   remote         — remote / hybrid / on-site
//   meta           — title, company, location from the first few lines
//
// Import-free save for the schema types (no runtime import, type-only).
// Runs under node:test with --experimental-strip-types.

import type { RedFlag, RedFlagCode, Requirement, JdSalary, YearsRequired } from "./schema.ts";
import { RED_FLAG_SEVERITY, RED_FLAG_LABELS } from "./schema.ts";

// ── Shared constants ──────────────────────────────────────────────────────────

const MAX_PHRASE = 180;

// Languages/frameworks that are "undefendable" when listed as THE core skill.
// These are hard-to-fake: a junior CV that lists "Python" cannot plausibly claim
// C# as the production language.
export const UNDEFENDABLE_CORE_LANGS = new Set([
  "java", "c#", "csharp", "c++", "cpp", ".net", "dotnet",
  "go", "golang", "rust", "kotlin", "php",
]);

// ── Section classification (mirrors jdTriage) ─────────────────────────────────

const NICE_H = /\b(?:nice[\s-]to[\s-]haves?|desirable|desired|bonus(?:\s+points)?|preferred|pluses|a\s+plus|extra\s+credit|ideally|would\s+be\s+(?:great|nice|good)|advantageous|beneficial|not\s+required|optional)\b/i;
const REQ_H = /\b(?:requirements?|required|essential|essentials|qualifications?|what\s+you(?:['']ll|\s+will)?\s+(?:need|bring|have)|you\s+(?:have|bring|are|need|will\s+have)|you['']ll\s+(?:have|need|bring)|about\s+you|who\s+you\s+are|looking\s+for|must[\s-]haves?|skills|experience|ideal\s+candidate|to\s+succeed|what\s+we\s+need|your\s+(?:background|profile|experience|skills)|criteria|competenc(?:y|ies)|apply\s+if)\b/i;

type Section = "req" | "nice" | "other";

function classifyHeading(text: string): Section | null {
  if (NICE_H.test(text)) return "nice";
  if (REQ_H.test(text)) return "req";
  return null;
}

const BULLET_RE = /^\s*(?:[-•*·▪◦–—]|\d{1,2}[.)])\s+/;

function asHeading(raw: string): string | null {
  if (BULLET_RE.test(raw)) return null;
  const t = raw.trim();
  if (!t || t.length > 70 || /\d/.test(t) || /[.!?;,]$/.test(t)) return null;
  if (t.split(/\s+/).length > 9) return null;
  return t.replace(/:$/, "");
}

export type SplitLine = { text: string; section: Section; raw: string };

// Split the JD into lines annotated with their section.
export function splitSections(jd: string): SplitLine[] {
  const lines = jd.split(/\r?\n/);
  const out: SplitLine[] = [];
  let section: Section = "other";

  for (const raw of lines) {
    const h = asHeading(raw);
    if (h) {
      const cls = classifyHeading(h);
      if (cls) section = cls;
    }
    // Inline label: "Essential: 5+ years…" flips context for that line only.
    const labelMatch = raw.match(/^([A-Za-z][A-Za-z ''&/-]{1,40}):\s+\S/);
    let lineSection = section;
    if (labelMatch) {
      const cls = classifyHeading(labelMatch[1]);
      if (cls) lineSection = cls;
    }
    out.push({ text: raw.trim(), section: lineSection, raw });
  }

  return out;
}

// ── Salary ────────────────────────────────────────────────────────────────────

// Matches: "£30,000 – £40,000", "£35k-45k", "£50,000 per annum", "$80k",
//          "GBP 35000", "30k–40k", "£500 per day", "£25 per hour"
const SALARY_RE =
  /(?:[£$€]|GBP\s*)?(\d{1,3}(?:[,_]\d{3})*(?:\.\d+)?)\s*(?:k|K)?(?:\s*[-–—to]\s*(?:[£$€]|GBP\s*)?(\d{1,3}(?:[,_]\d{3})*(?:\.\d+)?)\s*(?:k|K)?)?(?:\s*(?:per\s+(?:annum|year|day|hour|hr|month)|p\.?a\.?|\/(?:yr|year|day|hour|hr|annum)))?/gi;

function parseSalaryValue(raw: string): number {
  const clean = raw.replace(/[,_]/g, "").replace(/k$/i, "000").trim();
  return parseFloat(clean) || 0;
}

export function extractSalary(jd: string): JdSalary | null {
  const lc = jd.toLowerCase();
  const hasPound = jd.includes("£");
  const hasDollar = jd.includes("$");
  const hasGbp = /\bgbp\b/i.test(jd);
  if (!hasPound && !hasDollar && !hasGbp && !/\bsalar(?:y|ied)\b|\bcompensation\b|\bpackage\b|\bpa\b|\bper\s+annum\b/i.test(jd)) {
    return null;
  }

  const currency = hasPound || hasGbp ? "GBP" : hasDollar ? "USD" : "GBP";
  let period: JdSalary["period"] = "unknown";

  // Detect period
  if (/\bper\s+(?:day|pd)\b|\/day\b|\bday\s+rate\b/i.test(jd)) period = "daily";
  else if (/\bper\s+(?:hour|hr)\b|\/hr\b|\/hour\b|\bhourly\b/i.test(jd)) period = "hourly";
  else if (/\bper\s+annum\b|\bp\.?a\.?\b|\/(?:yr|year)\b|\bannual(?:ly)?\b|\bsalary\b/i.test(jd)) period = "annual";

  // Find the best salary match
  SALARY_RE.lastIndex = 0;
  let bestMin: number | null = null;
  let bestMax: number | null = null;
  let bestPhrase = "";

  let m: RegExpExecArray | null;
  while ((m = SALARY_RE.exec(jd)) !== null) {
    const raw = m[0];
    const v1 = parseSalaryValue(raw.includes("k") || raw.includes("K") ? m[1] + "k" : m[1]);
    const v2 = m[2] ? parseSalaryValue(raw.includes("k") || raw.includes("K") ? m[2] + "k" : m[2]) : null;

    // Skip obviously wrong matches (version numbers, years)
    if (v1 < 15 || v1 > 2_000_000) continue;

    // Prefer the first reasonable match
    if (bestMin === null) {
      bestMin = v1;
      bestMax = v2 ?? null;
      bestPhrase = raw.slice(0, MAX_PHRASE).trim();
    }
  }

  if (bestMin === null) return null;

  // Multiply "k" values when < 1000
  if (bestMin < 1000 && /k/i.test(bestPhrase)) bestMin *= 1000;
  if (bestMax !== null && bestMax < 1000 && /k/i.test(bestPhrase)) bestMax *= 1000;

  return {
    min: bestMin,
    max: bestMax,
    currency,
    period: period === "unknown" && bestMin > 500 ? "annual" : period,
    source_phrase: bestPhrase,
  };
}

// ── Years ─────────────────────────────────────────────────────────────────────
// (mirrors jdTriage's extraction; kept here so rules.ts is self-contained)

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM_PAT = `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
const YEARS_RE = new RegExp(
  `(?<![\\w.£$€%])(${NUM_PAT})(?:\\s*(?:\\+|plus))?(?:\\s*(?:-|–|—|to|and)\\s*(${NUM_PAT}))?(?:\\s*\\+)?\\s*(?:full\\s+|calendar\\s+)?years?\\b`,
  "gi"
);
const YEARS_BEFORE_SKIP = /(?:within|in\s+the\s+(?:last|past|next|first)|over\s+the\s+(?:last|past|next)|every|up\s+to|less\s+than|under|after|for(?:\s+(?:over|more\s+than|nearly|almost))?|aged?|since)\s*$/i;
const YEARS_AFTER_SKIP = /^\s*(?:old\b|of\s+age\b|ago\b|later\b|from\s+now\b|['']?\s*(?:fixed|FTC\b|contract|maternity|secondment|placement|scheme|programme|program\b|graduate|rotation))/i;
const YEARS_AFTER_REQ = /^\s*(?:['']\s*)?(?:(?:of\s+)?(?:[\w-]+\s+){0,4}?(?:experience|engineering|development|programming|coding)\b|exp\b|in\s+(?:a|an|the|software|industry|engineering|commercial|professional|production|web|backend|frontend|data)\b|working\b|as\s+an?\b|building\b|commercial\b|professional\b|hands-on\b|relevant\b)/i;

function numOf(tok: string): number {
  const t = tok.toLowerCase();
  return /^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t] ?? NaN);
}

export function extractYears(jd: string): YearsRequired | null {
  YEARS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let bestMin: number | null = null;
  let bestPhrase = "";

  while ((m = YEARS_RE.exec(jd)) !== null) {
    const pre = jd.slice(0, m.index);
    const post = jd.slice(m.index + m[0].length);
    if (YEARS_BEFORE_SKIP.test(pre)) continue;
    if (YEARS_AFTER_SKIP.test(post)) continue;
    if (!YEARS_AFTER_REQ.test(post) && !/\bexperience\b/i.test(m[0])) {
      // Check if there's a req cue nearby
      const nearby = jd.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      if (!/\b(?:essential|required|must|at\s+least|minimum|you(?:['']ll|\s+will)?\s+have|proven)\b/i.test(nearby)) continue;
    }

    const v1 = numOf(m[1]);
    if (isNaN(v1) || v1 < 1 || v1 > 20) continue;
    if (bestMin === null) {
      bestMin = v1;
      bestPhrase = m[0].trim();
    }
  }

  if (bestMin === null) return null;
  return { min: bestMin, max: null, source_phrase: bestPhrase.slice(0, MAX_PHRASE) };
}

// ── Stale posting ─────────────────────────────────────────────────────────────

// Matches "Posted 65 days ago", "Posted 3 months ago", "Updated 10 weeks ago",
// and ISO / UK dates like "Posted: 15 March 2025", "Date posted: 2025-03-15".
const POSTED_DAYS_RE = /(?:posted|updated|listed|created|published)\s*(?:on|:)?\s*(\d{1,3})\s*(days?|weeks?|months?)\s+ago/i;
const POSTED_DATE_RE = /(?:posted|updated|listed|created|published)\s*(?:on|:)?\s*(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i;

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDaysAgo(value: string, unit: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) return 0;
  if (/months?/i.test(unit)) return n * 30;
  if (/weeks?/i.test(unit)) return n * 7;
  return n;
}

function parsePostedDate(raw: string): Date | null {
  // ISO
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(raw.trim());
  // "15 March 2025"
  const uk = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (uk) {
    const mon = MONTH_NAMES[uk[2].toLowerCase().slice(0, 3)];
    if (mon !== undefined) return new Date(parseInt(uk[3]), mon, parseInt(uk[1]));
  }
  // "15/03/2025" or "15-03-2025"
  const dmy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
  return null;
}

export const STALE_DAYS = 60; // configurable via caller

export function extractPostedDate(jd: string): { phrase: string; daysOld: number } | null {
  // "X days/weeks/months ago"
  const relMatch = jd.match(POSTED_DAYS_RE);
  if (relMatch) {
    const daysOld = parseDaysAgo(relMatch[1], relMatch[2]);
    return { phrase: relMatch[0].slice(0, MAX_PHRASE), daysOld };
  }
  // Explicit date
  const dateMatch = jd.match(POSTED_DATE_RE);
  if (dateMatch) {
    const date = parsePostedDate(dateMatch[1]);
    if (date) {
      const daysOld = Math.floor((Date.now() - date.getTime()) / 86_400_000);
      return { phrase: dateMatch[0].slice(0, MAX_PHRASE), daysOld };
    }
  }
  return null;
}

// ── Fixed start date ──────────────────────────────────────────────────────────

const MONTH_NAME = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
// "September 2027 start", "start date: September 2027", "start: Sep 2027",
// "starting September", "September intake", "placement starts September"
const FIXED_START_RE = new RegExp(
  `(?:start(?:ing|s|\\s+date)?\\s*[:\\-–]?\\s*${MONTH_NAME}(?:\\s+\\d{4})?|${MONTH_NAME}(?:\\s+\\d{4})?\\s+(?:start|intake|commencement|cohort)|placement\\s+(?:starts?|begins?)\\s+${MONTH_NAME}|September\\s+start\\b|graduate\\s+intake\\s+${MONTH_NAME})`,
  "i"
);

export function extractFixedStart(jd: string): string | null {
  const m = jd.match(FIXED_START_RE);
  return m ? m[0].slice(0, MAX_PHRASE) : null;
}

// ── Core language detection ───────────────────────────────────────────────────

// Detect when a language from UNDEFENDABLE_CORE_LANGS is listed as the
// primary/sole language in a requirements section — not just mentioned.
// Signals like "primarily Java", "Java is the main language", "our stack is Java",
// "N years of Java experience" in a requirements line.
const CORE_LANG_RE = new RegExp(
  `\\b(?:primarily|mainly|core\\s+language|main\\s+stack|stack\\s+is|strong\\s+(?:working\\s+)?(?:knowledge|background|experience|skills)(?:\\s+(?:in|of|with))?|demonstrably\\s+strong|proficiency\\s+in|proficient\\s+in|expertise\\s+in|expert\\s+in|fluency\\s+in|fluent\\s+in|our\\s+(?:stack|codebase)\\s+is|written\\s+in|built\\s+in|\\d+\\s*(?:[–-]\\s*\\d+\\s*)?\\+?\\s*years?\\s+(?:of\\s+)?(?:(?:commercial|professional)\\s+)?(?:experience\\s+(?:with|in|using|writing)\\s+)?)\\s*(?<![A-Za-z0-9_])(java|c#|c\\+\\+|cpp|\\.net|go|golang|rust|kotlin|php)(?![A-Za-z0-9_])`,
  "gi"
);

// Extract the core language when it appears in a req section.
export function extractCoreLanguage(
  lines: SplitLine[]
): { lang: string; phrase: string } | null {
  const reqLines = lines.filter((l) => l.section === "req");
  if (reqLines.length === 0) return null;

  for (const line of reqLines) {
    CORE_LANG_RE.lastIndex = 0;
    const m = CORE_LANG_RE.exec(line.text);
    if (m) {
      const lang = m[1].toLowerCase().replace("c++", "cpp").replace("c#", "csharp").replace(".net", "dotnet").replace("golang", "go");
      if (UNDEFENDABLE_CORE_LANGS.has(lang) || UNDEFENDABLE_CORE_LANGS.has(m[1].toLowerCase())) {
        return { lang: m[1], phrase: m[0].slice(0, MAX_PHRASE) };
      }
    }
  }
  return null;
}

// ── Skills extraction ─────────────────────────────────────────────────────────

// A known technical skills dictionary with synonyms.
const TECH_SYNONYMS: Record<string, string[]> = {
  "Python": ["python", "django", "flask", "fastapi", "pytorch", "tensorflow"],
  "JavaScript": ["javascript", "js", "node.js", "nodejs", "react", "vue", "angular", "next.js"],
  "TypeScript": ["typescript", "ts"],
  "SQL": ["sql", "mysql", "postgresql", "postgres", "sqlite", "oracle", "mssql"],
  "AWS": ["aws", "amazon web services", "lambda", "s3", "ec2", "ecs", "eks", "rds"],
  "Docker": ["docker", "containers", "containerisation", "containerization"],
  "Kubernetes": ["kubernetes", "k8s"],
  "Git": ["git", "github", "gitlab", "bitbucket", "version control"],
  "CI/CD": ["ci/cd", "cicd", "jenkins", "github actions", "gitlab ci", "circle ci", "travis"],
  "Automated testing": ["automated testing", "test automation", "pytest", "jest", "selenium", "playwright"],
  "REST API": ["rest api", "restful", "api design", "openapi", "swagger"],
  "Agile": ["agile", "scrum", "kanban", "jira", "sprint"],
  "Linux": ["linux", "unix", "bash", "shell scripting"],
  "Machine learning": ["machine learning", "ml", "data science", "scikit-learn", "sklearn"],
};

// Categorise a skill term.
function categoriseSkill(skill: string): Requirement["category"] {
  const lc = skill.toLowerCase();
  const techKeywords = ["python", "javascript", "typescript", "java", "c#", "go", "rust",
    "sql", "aws", "docker", "kubernetes", "react", "node", "git", "api", "linux",
    "cloud", "database", "testing", "ci/cd", ".net", "angular", "vue", "redis",
    "kafka", "spark", "terraform", "ml", "ai", "llm", "gcp", "azure"];
  if (techKeywords.some((k) => lc.includes(k))) return "technical";

  const qualKeywords = ["degree", "qualification", "phd", "msc", "bsc", "master", "bachelor",
    "certified", "certification", "licence", "license"];
  if (qualKeywords.some((k) => lc.includes(k))) return "qualification";

  const softKeywords = ["communication", "teamwork", "leadership", "problem.solving", "attention",
    "analytical", "collaborative", "proactive", "self.starter", "organised", "organised"];
  if (softKeywords.some((k) => lc.includes(k))) return "soft";

  return "unknown";
}

// Extract bullet-level skills from req/nice lines.
export function extractSkills(lines: SplitLine[]): {
  must_have: Requirement[];
  nice_to_have: Requirement[];
} {
  const must: Requirement[] = [];
  const nice: Requirement[] = [];

  for (const line of lines) {
    if (line.section === "other") continue;
    if (!line.text || line.text.length < 3) continue;

    // Only process bullet-shaped lines or short req lines
    const isBullet = BULLET_RE.test(line.raw);
    const isShort = line.text.length < 200;
    if (!isBullet && !isShort) continue;

    const text = line.text.replace(BULLET_RE, "").trim();
    if (!text || text.length < 3 || text.length > 180) continue;

    // Skip headings (already handled above)
    if (asHeading(line.raw)) continue;

    const req: Requirement = {
      skill: text.slice(0, 150),
      category: categoriseSkill(text),
      source_phrase: text.slice(0, 200),
      section: line.section === "nice" ? "nice_to_have" : "must_have",
    };

    if (line.section === "nice") nice.push(req);
    else must.push(req);
  }

  return { must_have: must.slice(0, 30), nice_to_have: nice.slice(0, 20) };
}

// ── Tool extraction ───────────────────────────────────────────────────────────

// Known tools and frameworks — a broad but closed list.
const TOOLS_LIST = [
  "Python", "JavaScript", "TypeScript", "Java", "C#", "C++", "Go", "Rust",
  "Kotlin", "PHP", "Swift", "Ruby", "Scala", "Haskell",
  "React", "Vue", "Angular", "Next.js", "Svelte", "Nuxt",
  "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring", "Rails",
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Elasticsearch", "Cassandra",
  "AWS", "GCP", "Azure", "Terraform", "Kubernetes", "Docker", "Ansible",
  "Git", "GitHub", "GitLab", "Jenkins", "GitHub Actions", "CircleCI",
  "Kafka", "RabbitMQ", "Spark", "Airflow",
  "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy",
  "Jest", "Pytest", "Playwright", "Selenium", "Cypress",
  "GraphQL", "REST", "gRPC", "OpenAPI",
  "Linux", "Bash", "PowerShell",
  "Jira", "Confluence", "Figma", "Notion",
];

const TOOLS_RE = new RegExp(
  `\\b(${TOOLS_LIST.map((t) => t.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

export function extractTools(jd: string): string[] {
  const seen = new Set<string>();
  TOOLS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOLS_RE.exec(jd)) !== null) {
    seen.add(m[1].replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return [...seen].slice(0, 30);
}

// ── Seniority ─────────────────────────────────────────────────────────────────

export function extractSeniority(jd: string, yearsMin: number | null): "graduate" | "junior" | "mid" | "senior" | "unknown" {
  // Graduate / intern signals
  if (/\b(?:graduate\b|entry[\s-]level|early[\s-]career|internship|intern\b|placement\s+(?:student|year)|industrial\s+placement|apprentice|trainee)\b/i.test(jd)) {
    return "graduate";
  }

  // Senior signals
  if (/\b(?:senior|staff\s+engineer|principal|lead\s+(?:engineer|developer|software)|head\s+of\s+engineering|engineering\s+manager|architect)\b/i.test(jd)) {
    return "senior";
  }

  // Mid signals
  if (/\b(?:mid[\s-]?level|intermediate|(?:3|4|5|6|7|8|9|\d{2})\s*\+?\s*years?)\b/i.test(jd)) {
    return "mid";
  }

  // Junior signals
  if (/\b(?:junior|associate\s+(?:engineer|developer)|entry[\s-]level|graduate)\b/i.test(jd)) {
    return "junior";
  }

  // Infer from years
  if (yearsMin !== null) {
    if (yearsMin >= 5) return "senior";
    if (yearsMin >= 3) return "mid";
    if (yearsMin <= 1) return "junior";
  }

  return "unknown";
}

function hasContractorCue(jd: string): string | null {
  const re = /\bday[\s-]rates?\b|\b(?:inside|outside)\s+IR35\b|\bIR35\b|\bcontract(?:or)?\s+(?:role|position|basis)\b|\bfreelance\b|\bself[\s-]employed\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jd)) !== null) {
    const pre = jd.slice(Math.max(0, m.index - 50), m.index);
    if (/\bnot\s+(?:a\s+|an\s+)?[^.!?\n]*$/i.test(pre)) continue;
    return m[0];
  }
  return null;
}

// ── Contract type ─────────────────────────────────────────────────────────────

export function extractContractType(jd: string): "permanent" | "fixed_term" | "contract" | "internship" | "unknown" {
  if (/\b(?:internship|intern\b|placement\s+(?:student|year)|industrial\s+placement|apprenticeship)\b/i.test(jd)) {
    return "internship";
  }
  if (hasContractorCue(jd)) {
    return "contract";
  }
  if (/\bfixed[\s-]+term\b|\bFTC\b|\bmaternity\s+(?:leave\s+)?cover\b|\b\d+[\s-]+months?['']?\s+contract\b/i.test(jd)) {
    return "fixed_term";
  }
  if (/\bpermanent\b|\bfull[\s-]+time\b|\bperm\b/i.test(jd)) {
    return "permanent";
  }
  return "unknown";
}

// ── Remote policy ─────────────────────────────────────────────────────────────

export function extractRemotePolicy(jd: string): "remote" | "hybrid" | "onsite" | "unknown" {
  if (/\b(?:fully\s+remote|100%\s+remote|remote\s+first|remote[\s-]first|remote\s+only|work\s+from\s+anywhere)\b/i.test(jd)) {
    return "remote";
  }
  if (/\bhybrid\b/i.test(jd)) return "hybrid";
  if (/\b(?:on[\s-]?site|in[\s-]?office|office[\s-]based|in\s+person|on\s+location)\b/i.test(jd)) return "onsite";
  if (/\b(?:remote\s+(?:option|possible|considered|welcome)|can\s+be\s+remote)\b/i.test(jd)) return "remote";
  return "unknown";
}

// ── Meta (title, company, location) ──────────────────────────────────────────

export function extractMeta(jd: string): { title: string; company: string; location: string } {
  const lines = jd.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Title: usually the first meaningful line
  const title = (lines[0] ?? "").slice(0, 200);

  // Company: "at <Company>" or "Company: <name>" or second short line
  let company = "";
  const companyMatch = jd.match(/\bat\s+([A-Z][A-Za-z0-9&.,'\s-]{2,50})(?:\s+(?:we|is|are|Ltd|Limited|plc|Inc|Group)\b)/);
  if (companyMatch) company = companyMatch[1].trim();
  else {
    const companyLabel = jd.match(/(?:^|\n)\s*(?:company|employer|organisation|organization)\s*[:\-–]\s*([^\n]{2,80})/i);
    if (companyLabel) company = companyLabel[1].trim();
  }

  // Location: "Location: X", a city name in the first 500 chars
  let location = "";
  const locLabel = jd.match(/(?:^|\n)\s*(?:location|based|office|city|place)\s*[:\-–]\s*([^\n]{2,80})/i);
  if (locLabel) location = locLabel[1].trim();
  else {
    const locMatch = jd.slice(0, 500).match(/\b(?:London|Manchester|Edinburgh|Bristol|Birmingham|Leeds|Cambridge|Oxford|Glasgow|Liverpool|Sheffield|Newcastle|Nottingham|Cardiff|Belfast|Dublin|Remote)\b/i);
    if (locMatch) location = locMatch[0];
  }

  return {
    title: title.slice(0, 200),
    company: company.slice(0, 200),
    location: location.slice(0, 200),
  };
}

// ── Red flag assembly ─────────────────────────────────────────────────────────

function makeFlag(code: RedFlagCode, phrase: string): RedFlag {
  return { code, severity: RED_FLAG_SEVERITY[code], label: RED_FLAG_LABELS[code], phrase: phrase.slice(0, MAX_PHRASE) };
}

export interface RulesOutput {
  meta: { title: string; company: string; location: string };
  remote_policy: "remote" | "hybrid" | "onsite" | "unknown";
  seniority: "graduate" | "junior" | "mid" | "senior" | "unknown";
  years_required: YearsRequired | null;
  contract_type: "permanent" | "fixed_term" | "contract" | "internship" | "unknown";
  salary: JdSalary | null;
  posted_phrase: string | null;
  start_date: string | null;
  must_have: Requirement[];
  nice_to_have: Requirement[];
  tools: string[];
  red_flags: RedFlag[];
}

// ── Sponsorship — "no current or future" phrases ─────────────────────────────

// "no current or future visa support", "unable to offer visa sponsorship... now or in the future",
// "will not provide sponsorship at any time", etc.
const NO_SPONSOR_EVER =
  /(?:no\s+current\s+or\s+future\s+visa\s+support|will\s+not\s+(?:support|provide|offer)\s+(?:visa\s+)?sponsorship\s+(?:now\s+or\s+in\s+the\s+future|at\s+any\s+time)|must\s+not\s+require\s+(?:(?:visa\s+)?sponsorship|right\s+to\s+work\s+(?:support|sponsorship))\s+(?:now\s+or\s+in\s+the\s+future|at\s+any\s+time)|unable\s+to\s+(?:offer|provide|support)\s+(?:\w+\s+){0,4}sponsorship[^.]{0,60}(?:now\s+or\s+in\s+the\s+future|at\s+any\s+(?:time|point))|unable\s+to\s+sponsor\s+(?:work\s+)?(?:visa\s+)?(?:holders?[^.]{0,30})?(?:now\s+or\s+in\s+the\s+future|at\s+any\s+time)|no\s+sponsorship\s+(?:now\s+or\s+)?in\s+the\s+future|cannot\s+offer\s+(?:any\s+)?sponsorship(?:[^.]{0,30}future)?)/i;

const CONTRACT_OR_DAY =
  /\bday[\s-]rates?\b|\b(?:inside|outside)\s+IR35\b|\bIR35\b|\bcontract(?:or)?\s+(?:role|position)\b/i;

const FIXED_TERM_DETECT =
  /\bfixed[\s-]+term\b|\bFTC\b|\bmaternity\s+(?:leave\s+)?cover\b/i;

const CLEARANCE_DETECT =
  /security[\s-]+clear(?:ance|ed)|\bSC\s+clear(?:ance|ed)\b|\bDV\b(?:\s+clear(?:ance|ed))?|eligible\s+for\s+SC\b/i;

// Covers: "lived in the UK for at least 5 years", "5 years' UK residency",
//         "ordinarily resident in the United Kingdom for a continuous period of at least 5 years"
const UK_RESIDENCE_DETECT =
  /(?:lived|resident|ordinarily\s+resident|residing|continuously\s+resident)\s+in\s+(?:the\s+)?(?:UK|United\s+Kingdom)[^.]{0,60}(?:5|five)\s*\+?\s*years|(?:5|five)\s+years['']?\s+(?:of\s+)?(?:(?:continuous\s+)?UK\s+)?residen(?:ce|cy)|continuous(?:ly)?\s+(?:resident|residing)\s+in\s+(?:the\s+)?(?:UK|United\s+Kingdom)\s+for\s+(?:at\s+least\s+)?(?:5|five)/i;

// ── Main rules function ───────────────────────────────────────────────────────

export function runRules(jd: string, opts: { salaryFloor?: number; staleDays?: number } = {}): RulesOutput {
  const salaryFloor = opts.salaryFloor ?? 35_000;
  const staleDays = opts.staleDays ?? STALE_DAYS;

  const lines = splitSections(jd);
  const meta = extractMeta(jd);
  const salary = extractSalary(jd);
  const years = extractYears(jd);
  const remote_policy = extractRemotePolicy(jd);
  const contract_type = extractContractType(jd);
  const seniority = extractSeniority(jd, years?.min ?? null);
  const { must_have, nice_to_have } = extractSkills(lines);
  const tools = extractTools(jd);
  const coreLang = extractCoreLanguage(lines);
  const posted = extractPostedDate(jd);
  const fixedStart = extractFixedStart(jd);

  const flags: RedFlag[] = [];

  // CONTRACT_OR_DAY_RATE — hard
  const contractorMatch = hasContractorCue(jd);
  if (contractorMatch) {
    flags.push(makeFlag("CONTRACT_OR_DAY_RATE", contractorMatch));
  }

  // FIXED_TERM — warn
  else if (contract_type === "fixed_term" && FIXED_TERM_DETECT.test(jd)) {
    const m = jd.match(FIXED_TERM_DETECT);
    flags.push(makeFlag("FIXED_TERM", m?.[0] ?? "fixed-term contract"));
  }

  // SECURITY_CLEARANCE — hard
  if (CLEARANCE_DETECT.test(jd)) {
    const m = jd.match(CLEARANCE_DETECT);
    flags.push(makeFlag("SECURITY_CLEARANCE", m?.[0] ?? "security clearance"));
  }

  // UK_RESIDENCE_5Y — hard
  if (UK_RESIDENCE_DETECT.test(jd)) {
    const m = jd.match(UK_RESIDENCE_DETECT);
    flags.push(makeFlag("UK_RESIDENCE_5Y", m?.[0] ?? "5 years UK residence"));
  }

  // NO_SPONSORSHIP_EVER — hard
  if (NO_SPONSOR_EVER.test(jd)) {
    const m = jd.match(NO_SPONSOR_EVER);
    flags.push(makeFlag("NO_SPONSORSHIP_EVER", m?.[0] ?? "no current or future visa support"));
  }

  // YEARS_3_PLUS — hard
  if (years !== null && years.min !== null && years.min >= 3) {
    flags.push(makeFlag("YEARS_3_PLUS", years.source_phrase));
  }

  // SENIORITY_MID_SENIOR — warn (only when the role itself is explicitly mid-level or senior)
  const titleMidSenior = meta.title.match(/\b(?:senior|mid[\s-]?level|staff\s+engineer|principal)\b/i);
  const bodyMidSenior = jd.match(
    /\b(?:this\s+is\s+a\s+(?:senior|mid[\s-]?level)(?:[\s-](?:level|engineering))?\s+(?:position|role)|we(?:['’]re|\s+are)\s+(?:hiring|looking\s+for)\s+a\s+(?:senior|mid[\s-]?level|staff|principal)\b|this\s+role\s+is\s+(?:senior|mid[\s-]?level))\b/i
  );
  if (titleMidSenior || bodyMidSenior) {
    flags.push(makeFlag("SENIORITY_MID_SENIOR", (titleMidSenior?.[0] ?? bodyMidSenior?.[0]) ?? "mid/senior"));
  }

  // UNDEFENDABLE_CORE_SKILL — hard
  if (coreLang) {
    flags.push(makeFlag("UNDEFENDABLE_CORE_SKILL", coreLang.phrase));
  }

  // SALARY_BELOW_FLOOR — warn
  if (salary !== null && salary.min !== null && salary.period !== "daily" && salary.period !== "hourly") {
    if (salary.min < salaryFloor) {
      flags.push(makeFlag("SALARY_BELOW_FLOOR", salary.source_phrase));
    }
  }

  // STALE_POSTING — warn
  if (posted !== null && posted.daysOld > staleDays) {
    flags.push(makeFlag("STALE_POSTING", posted.phrase));
  }

  // FIXED_START_DATE — warn
  if (fixedStart) {
    flags.push(makeFlag("FIXED_START_DATE", fixedStart));
  }

  return {
    meta,
    remote_policy,
    seniority,
    years_required: years,
    contract_type,
    salary,
    posted_phrase: posted?.phrase ?? null,
    start_date: fixedStart,
    must_have,
    nice_to_have,
    tools,
    red_flags: flags,
  };
}
