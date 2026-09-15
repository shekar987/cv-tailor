// Stage 4 — the interview prep pack contract (pure, offline-testable).
//
// The model's JSON is coerced here at the boundary — the same philosophy as
// normalizeProfile — and every CV citation is checked deterministically
// against the master CV (verifyEvidence), the way reconcileAtsScore and
// reconcileFitScore cross-check the model's claims against real text. The
// pack a user sees is therefore never trusted from the model as-is, and a
// stored pack (users can write their own row under RLS) is re-normalized on
// every read (packFromRow).

export const PREP_PACK_VERSION = 1;
export const PREP_MIN_QUESTIONS = 4;
export const PREP_MAX_QUESTIONS = 10;

export const PREP_CATEGORIES = ["behavioral", "technical", "role", "company", "gap"] as const;
export type PrepCategory = (typeof PREP_CATEGORIES)[number];

export type PrepStar = { situation: string; task: string; action: string; result: string };
export type PrepEvidence = { text: string; verified: boolean };

export type PrepQuestion = {
  id: string;
  category: PrepCategory;
  question: string;
  whyTheyAsk: string;
  star: PrepStar | null;
  points: string[];
  evidence: PrepEvidence[];
  unverifiedNumbers: string[];
};

export type PrepSources = { jd: boolean; tailoredCv: boolean; research: boolean; talkingPoints: boolean };

export type PrepPack = {
  version: typeof PREP_PACK_VERSION;
  generatedAt: string;
  company: string;
  role: string;
  angle: {
    headline: string;
    whyYou: string[];
    honestGaps: { gap: string; howToAddress: string }[];
  };
  questions: PrepQuestion[];
  questionsToAsk: string[];
  opener: string;
  sources: PrepSources;
};

export type PrepMeta = { company: string; role: string; generatedAt: string; sources: PrepSources };

// The prompt asks for ≤40 words per point; the cap is deliberately looser so a
// long-winded strategy line is kept whole rather than cut mid-sentence. Size
// stays bounded: 10 questions × 5 points × 600 chars is well under the JSON cap.
const MAX_SHORT = 600;
const MAX_STAR_FIELD = 400; // ≈ 45 words
const MAX_OPENER = 700; // ≈ 90 words
const MAX_LIST = 5;
const MAX_GAPS = 4;
const MAX_EVIDENCE = 3;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strList(v: unknown, count: number, max: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count)
    : [];
}
function isCategory(v: unknown): v is PrepCategory {
  return typeof v === "string" && (PREP_CATEGORIES as readonly string[]).includes(v);
}

// Lowercase, strip **bold** and bullet glyphs, unify dashes/quotes, collapse
// everything non-alphanumeric to single spaces. Both sides of every comparison
// go through this, so hard-wrapped PDF lines, "Node.js" vs "node js", and
// en-dash vs hyphen all compare equal.
export function normalizeForMatch(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\*\*/g, " ")
    .replace(/[•·▪●◦]/g, " ")
    .replace(/[–—]/g, " ")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function digitsOf(normalized: string): string[] {
  return normalized.match(/\d+/g) ?? [];
}

// Longest run of consecutive tokens that appears, in order and contiguously,
// in both sequences. Bounded: evidence is ≤ ~60 tokens, a CV ≤ ~4k tokens.
function longestCommonRun(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

function normalizeEvidence(v: unknown): PrepEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: PrepEvidence[] = [];
  for (const entry of v) {
    if (out.length >= MAX_EVIDENCE) break;
    if (typeof entry === "string") {
      const text = str(entry, MAX_SHORT);
      if (text) out.push({ text, verified: false });
    } else {
      const o = obj(entry);
      const text = str(o.text, MAX_SHORT);
      if (text) out.push({ text, verified: o.verified === true });
    }
  }
  return out;
}

function normalizeStar(v: unknown): PrepStar | null {
  const o = obj(v);
  const star = {
    situation: str(o.situation, MAX_STAR_FIELD),
    task: str(o.task, MAX_STAR_FIELD),
    action: str(o.action, MAX_STAR_FIELD),
    result: str(o.result, MAX_STAR_FIELD),
  };
  return star.situation || star.task || star.action || star.result ? star : null;
}

function normalizeSources(v: unknown, fallback: PrepSources): PrepSources {
  const o = obj(v);
  const pick = (k: keyof PrepSources) => (typeof o[k] === "boolean" ? (o[k] as boolean) : fallback[k]);
  return { jd: pick("jd"), tailoredCv: pick("tailoredCv"), research: pick("research"), talkingPoints: pick("talkingPoints") };
}

// Coerce model output (or a stored pack) into the contract. Returns null when
// fewer than PREP_MIN_QUESTIONS usable questions survive — the route treats
// that as a failed generation and refunds. Ids are always reassigned here;
// the model's are never trusted.
export function normalizePrepPack(raw: unknown, meta: PrepMeta): PrepPack | null {
  const r = obj(raw);
  const angleRaw = obj(r.angle);
  const honestGaps: PrepPack["angle"]["honestGaps"] = [];
  if (Array.isArray(angleRaw.honestGaps)) {
    for (const g of angleRaw.honestGaps) {
      if (honestGaps.length >= MAX_GAPS) break;
      const go = obj(g);
      const gap = str(go.gap, MAX_SHORT);
      const howToAddress = str(go.howToAddress, MAX_SHORT);
      if (gap && howToAddress) honestGaps.push({ gap, howToAddress });
    }
  }

  const questions: PrepQuestion[] = [];
  if (Array.isArray(r.questions)) {
    for (const q of r.questions) {
      if (questions.length >= PREP_MAX_QUESTIONS) break;
      const qo = obj(q);
      const question = str(qo.question, MAX_SHORT);
      if (!question || !isCategory(qo.category)) continue;
      const category = qo.category;
      questions.push({
        id: `q${questions.length + 1}`,
        category,
        question,
        whyTheyAsk: str(qo.whyTheyAsk, MAX_SHORT),
        // A gap question never carries a story — that is the whole point of it.
        star: category === "gap" ? null : normalizeStar(qo.star),
        points: strList(qo.points, MAX_LIST, MAX_SHORT),
        evidence: category === "gap" ? [] : normalizeEvidence(qo.evidence),
        unverifiedNumbers: strList(qo.unverifiedNumbers, 10, 40),
      });
    }
  }
  if (questions.length < PREP_MIN_QUESTIONS) return null;

  return {
    version: PREP_PACK_VERSION,
    generatedAt: meta.generatedAt,
    company: meta.company,
    role: meta.role,
    angle: {
      headline: str(angleRaw.headline, MAX_SHORT),
      whyYou: strList(angleRaw.whyYou, MAX_LIST, MAX_SHORT),
      honestGaps,
    },
    questions,
    questionsToAsk: strList(r.questionsToAsk, MAX_LIST, MAX_SHORT),
    opener: str(r.opener, MAX_OPENER),
    sources: meta.sources,
  };
}

// Deterministic honesty check. An evidence line is "verified" when it is found
// in the master CV either verbatim (after normalization) or as a long enough
// contiguous run of its tokens with every number intact. Separately, every
// number the answer states (STAR result, points) must exist somewhere in the
// CV — rule 4, faithful metrics — or it is listed for the user to check.
export function verifyEvidence(pack: PrepPack, cvText: string): PrepPack {
  const normCv = normalizeForMatch(cvText);
  const cvTokens = normCv.split(" ").filter(Boolean);
  const cvDigits = new Set(digitsOf(normCv));

  const isVerified = (text: string): boolean => {
    const norm = normalizeForMatch(text);
    if (!norm) return false;
    if (normCv.includes(norm)) return true;
    const tokens = norm.split(" ").filter(Boolean);
    if (tokens.length < 5) return false;
    const numbersOk = digitsOf(norm).every((d) => cvDigits.has(d));
    if (!numbersOk) return false;
    return longestCommonRun(tokens, cvTokens) >= Math.ceil(tokens.length * 0.6);
  };

  const questions = pack.questions.map((q) => {
    const evidence = q.evidence.map((e) => ({ text: e.text, verified: isVerified(e.text) }));
    // Gap answers are strategy ("ask for a 1–2 week ramp"), not claims about
    // the candidate's record — their numbers are advice, not metrics.
    const stated = q.category === "gap" ? "" : [q.star?.result ?? "", ...q.points].join(" ");
    const unverified = new Set<string>();
    for (const d of digitsOf(normalizeForMatch(stated))) {
      if (!cvDigits.has(d)) unverified.add(d);
    }
    return { ...q, evidence, unverifiedNumbers: [...unverified].slice(0, 10) };
  });
  return { ...pack, questions };
}

// A stored pack, re-normalized. Accepts null/garbage/other versions (→ null).
// Verified flags and unverified numbers are kept as stored — they were
// computed against the CV at generation time.
export function packFromRow(value: unknown): PrepPack | null {
  const r = obj(value);
  if (r.version !== PREP_PACK_VERSION) return null;
  const generatedAt = str(r.generatedAt, 40);
  if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) return null;
  const meta: PrepMeta = {
    company: str(r.company, 200),
    role: str(r.role, 200),
    generatedAt,
    sources: normalizeSources(r.sources, { jd: false, tailoredCv: false, research: false, talkingPoints: false }),
  };
  return normalizePrepPack(r, meta);
}

// The tailored-CV snapshot as prompt text: what was actually sent to this
// employer, so the questions target the CV they read.
export function flattenTailoredCv(snapshot: unknown, maxChars: number): string {
  const s = obj(snapshot);
  const parts: string[] = [];
  const summary = str(s.summary, 4000);
  const skills = str(s.skills, 4000);
  const experience = str(s.experience, 12000);
  if (summary) parts.push(`SUMMARY\n${summary}`);
  if (skills) parts.push(`SKILLS\n${skills}`);
  if (experience) parts.push(`EXPERIENCE\n${experience}`);
  const projects = obj(s.projects);
  const projectLines: string[] = [];
  for (const key of Object.keys(projects).sort()) {
    const bullets = strList(projects[key], 6, 400);
    if (bullets.length) projectLines.push(`Project ${Number(key) + 1}:\n${bullets.map((b) => `- ${b}`).join("\n")}`);
  }
  if (projectLines.length) parts.push(`PROJECTS\n${projectLines.join("\n")}`);
  return parts.join("\n\n").slice(0, maxChars);
}

// Tracker notes for a tailored row end with "— Interview talking points —"
// followed by the generated points, but notes are freely edited afterwards,
// so this is tolerant: the block runs to the end or to the next "— … —" line.
export function extractTalkingPoints(notes: string | null | undefined, maxChars: number): string | null {
  if (!notes) return null;
  const lines = notes.split("\n");
  const start = lines.findIndex((l) => /^—\s*Interview talking points\s*—\s*$/.test(l.trim()));
  if (start === -1) return null;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^—\s.+\s—\s*$/.test(line.trim())) break;
    out.push(line);
  }
  const text = out.join("\n").trim();
  return text ? text.slice(0, maxChars) : null;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function prepPdfFilename(pack: PrepPack): string {
  const parts = [slug(pack.company), slug(pack.role)].filter(Boolean);
  return parts.length ? `Prep-${parts.join("-")}.pdf` : "Prep.pdf";
}
