// Tracker insights — what actually progresses. Pure aggregation over the
// user's own rows (status, role, company, plus the stored search-visibility
// lists and eligibility read on rows saved since Brief 1/2), so the owner
// can see which kinds of application get past the screen instead of
// guessing. Import-free and unit-tested; the route and the page only call
// these two functions.
//
// Outcome: Screening / Interview / Offer = progressed, Rejected = rejected,
// Applied = still pending, Withdrawn = excluded (the user pulled out; it says
// nothing about the screen). A bucket's rate is progressed / decided and is
// null until at least MIN_DECIDED applications in it have an outcome - a
// 1-of-1 "100%" would mislead.

import { POSTING_AGE_BANDS } from "./postingAge.ts";

export type GateRead = "apply" | "long_shot" | "skip";
export type Seniority = "junior" | "mid" | "senior";

export type InsightRow = {
  status: string;
  role: string;
  company: string;
  kwHits?: number;
  kwTotal?: number;
  reqHits?: number;
  reqTotal?: number;
  gateRead?: GateRead;
  seniority?: Seniority;
  // Prompt 13: how the row was made, whether a follow-up date was set, the
  // page count of the CV sent, and how old the posting was at application.
  source?: "tailored" | "manual";
  followupSet?: boolean;
  pages?: number;
  postingAgeDays?: number;
};

// Role seniority read off the title, stored with every tailored save and
// derived on read for older rows. Deterministic; "mid" is the default.
export function seniorityOf(role: string): Seniority {
  const r = role || "";
  if (/\b(?:senior|lead|staff|principal|head\s+of|sr\.?|architect|manager)\b/i.test(r)) return "senior";
  if (/\b(?:graduate|junior|associate|intern|internship|entry[-\s]level|early[-\s]career|apprentice|trainee|placement)\b/i.test(r)) return "junior";
  return "mid";
}
const SENIORITY_LABEL: Record<Seniority, string> = { junior: "Junior / graduate", mid: "Mid-level", senior: "Senior" };

// A stored count pair: { matched, total } written by the backfill (the
// lists were never kept) or beside the lists by the save path since the
// denominators were made explicit.
function countPair(v: Record<string, unknown>): { hits: number; total: number } | null {
  const hits = Array.isArray(v.hits) ? v.hits.length : typeof v.matched === "number" && Number.isFinite(v.matched) ? Math.round(v.matched) : null;
  const total = Array.isArray(v.hits) || Array.isArray(v.misses)
    ? (Array.isArray(v.hits) ? v.hits.length : 0) + (Array.isArray(v.misses) ? v.misses.length : 0)
    : typeof v.total === "number" && Number.isFinite(v.total) ? Math.round(v.total) : null;
  if (hits === null || total === null || total <= 0 || hits < 0 || hits > total) return null;
  return { hits, total };
}

export type Bucket = {
  key: string;
  label: string;
  n: number;
  progressed: number;
  rejected: number;
  pending: number;
  rate: number | null;
};

export type Insights = {
  total: number;
  counted: number; // total minus withdrawn
  scored: number; // rows with stored keyword lists
  gated: number; // rows with a stored eligibility read
  decided: number;
  progressed: number;
  rejected: number;
  overallRate: number | null;
  byVisibility: Bucket[];
  byRequired: Bucket[];
  byGate: Bucket[];
  bySeniority: Bucket[];
  byRole: Bucket[];
  byCompany: Bucket[];
  bySource: Bucket[];
  byFollowup: Bucket[];
  byPages: Bucket[];
  byPostingAge: Bucket[];
};

// A group's progression rate shows only once at least this many of its
// applications have an outcome (the ≥8-per-group rule): below that a 2-of-3
// reads as 67% and sends the user chasing noise.
export const MIN_DECIDED = 8;
const PROGRESSED = new Set(["Screening", "Interview", "Offer"]);

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Reads a tracker row (the list shape or the detail shape) defensively: a
// user can write their own row under RLS, so nothing here is trusted.
export function rowFromApplication(row: unknown): InsightRow {
  const r = obj(row);
  const out: InsightRow = {
    status: typeof r.status === "string" ? r.status : "",
    role: typeof r.role === "string" ? r.role.trim() : "",
    company: typeof r.company_name === "string" ? r.company_name.trim() : "",
  };
  const snapshot = obj(r.tailored_cv);
  if (r.source === "tailored" || r.source === "manual") out.source = r.source;
  if (r.followup_date !== undefined) out.followupSet = typeof r.followup_date === "string" && r.followup_date.trim() !== "";
  const pages = Number(r.pages ?? snapshot.pages);
  if (Number.isFinite(pages) && pages >= 1 && pages <= 5) out.pages = Math.round(pages);
  const age = Number(r.posting_age_days ?? snapshot.postingAgeDays);
  if (Number.isFinite(age) && age >= 0 && age <= 365) out.postingAgeDays = Math.round(age);
  const ats = obj(r.ats ?? snapshot.ats);
  const kw = countPair(obj(ats.keywords));
  if (kw) {
    out.kwHits = kw.hits;
    out.kwTotal = kw.total;
  }
  const req = countPair(obj(ats.required));
  if (req) {
    out.reqHits = req.hits;
    out.reqTotal = req.total;
  }
  const gates = obj(r.gates ?? snapshot.gates);
  if (gates.read === "apply" || gates.read === "long_shot" || gates.read === "skip") out.gateRead = gates.read;
  const stored = r.seniority ?? snapshot.seniority;
  if (stored === "junior" || stored === "mid" || stored === "senior") out.seniority = stored;
  else if (out.role) out.seniority = seniorityOf(out.role);
  return out;
}

type Acc = { key: string; label: string; n: number; progressed: number; rejected: number; pending: number; labels: Map<string, number> };

function bucketOf(map: Map<string, Acc>, key: string, label: string, row: InsightRow) {
  let acc = map.get(key);
  if (!acc) {
    acc = { key, label, n: 0, progressed: 0, rejected: 0, pending: 0, labels: new Map() };
    map.set(key, acc);
  }
  acc.n++;
  acc.labels.set(label, (acc.labels.get(label) ?? 0) + 1);
  if (PROGRESSED.has(row.status)) acc.progressed++;
  else if (row.status === "Rejected") acc.rejected++;
  else acc.pending++;
}

function finish(acc: Acc): Bucket {
  // The most common spelling wins the label (role/company buckets are keyed
  // case-insensitively).
  let label = acc.label;
  let best = -1;
  for (const [l, n] of acc.labels) if (n > best) { best = n; label = l; }
  const decided = acc.progressed + acc.rejected;
  return {
    key: acc.key,
    label,
    n: acc.n,
    progressed: acc.progressed,
    rejected: acc.rejected,
    pending: acc.pending,
    rate: decided >= MIN_DECIDED ? acc.progressed / decided : null,
  };
}

const VISIBILITY_BANDS: { key: string; label: string; test: (f: number) => boolean }[] = [
  { key: "low", label: "Under half of the role's terms", test: (f) => f < 0.5 },
  { key: "mid", label: "Half to three-quarters", test: (f) => f >= 0.5 && f < 0.75 },
  { key: "high", label: "Three-quarters or more", test: (f) => f >= 0.75 },
];
const REQUIRED_BANDS: { key: string; label: string; test: (f: number) => boolean }[] = [
  { key: "low", label: "Under 50% of required skills", test: (f) => f < 0.5 },
  { key: "mid", label: "50-79% of required skills", test: (f) => f >= 0.5 && f < 0.8 },
  { key: "high", label: "80%+ of required skills", test: (f) => f >= 0.8 },
];
const GATE_LABEL: Record<GateRead, string> = { apply: "Read: apply", long_shot: "Read: long shot", skip: "Read: likely auto-rejected" };

export function computeInsights(rows: InsightRow[]): Insights {
  const counted = rows.filter((r) => r.status !== "Withdrawn");
  const byVisibility = new Map<string, Acc>();
  const byRequired = new Map<string, Acc>();
  const byGate = new Map<string, Acc>();
  const bySeniority = new Map<string, Acc>();
  const byRole = new Map<string, Acc>();
  const byCompany = new Map<string, Acc>();
  const bySource = new Map<string, Acc>();
  const byFollowup = new Map<string, Acc>();
  const byPages = new Map<string, Acc>();
  const byPostingAge = new Map<string, Acc>();
  let scored = 0;
  let gated = 0;
  let progressed = 0;
  let rejected = 0;

  for (const row of counted) {
    if (PROGRESSED.has(row.status)) progressed++;
    else if (row.status === "Rejected") rejected++;
    if (row.kwTotal && row.kwHits !== undefined) {
      scored++;
      const band = VISIBILITY_BANDS.find((b) => b.test(row.kwHits! / row.kwTotal!));
      if (band) bucketOf(byVisibility, band.key, band.label, row);
    }
    if (row.reqTotal && row.reqHits !== undefined) {
      const band = REQUIRED_BANDS.find((b) => b.test(row.reqHits! / row.reqTotal!));
      if (band) bucketOf(byRequired, band.key, band.label, row);
    }
    if (row.gateRead) {
      gated++;
      bucketOf(byGate, row.gateRead, GATE_LABEL[row.gateRead], row);
    }
    if (row.seniority) bucketOf(bySeniority, row.seniority, SENIORITY_LABEL[row.seniority], row);
    if (row.role) bucketOf(byRole, row.role.toLowerCase(), row.role, row);
    if (row.company) bucketOf(byCompany, row.company.toLowerCase(), row.company, row);
    if (row.source) bucketOf(bySource, row.source, row.source === "tailored" ? "Tailored here" : "Added by hand", row);
    if (row.followupSet !== undefined) bucketOf(byFollowup, row.followupSet ? "set" : "none", row.followupSet ? "Follow-up date set" : "No follow-up date", row);
    if (row.pages !== undefined) bucketOf(byPages, String(row.pages), row.pages === 1 ? "One-page CV" : `${row.pages}-page CV`, row);
    if (row.postingAgeDays !== undefined) {
      const band = POSTING_AGE_BANDS.find((b) => b.test(row.postingAgeDays!));
      if (band) bucketOf(byPostingAge, band.key, band.label, row);
    }
  }

  const ordered = (map: Map<string, Acc>, order: string[]) =>
    order.map((k) => map.get(k)).filter((a): a is Acc => !!a).map(finish);
  const top = (map: Map<string, Acc>) =>
    [...map.values()]
      .filter((a) => a.n >= 2)
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
      .slice(0, 8)
      .map(finish);

  const decided = progressed + rejected;
  return {
    total: rows.length,
    counted: counted.length,
    scored,
    gated,
    decided,
    progressed,
    rejected,
    overallRate: decided >= MIN_DECIDED ? progressed / decided : null,
    byVisibility: ordered(byVisibility, ["low", "mid", "high"]),
    byRequired: ordered(byRequired, ["low", "mid", "high"]),
    byGate: ordered(byGate, ["apply", "long_shot", "skip"]),
    bySeniority: ordered(bySeniority, ["junior", "mid", "senior"]),
    byRole: top(byRole),
    byCompany: top(byCompany),
    bySource: ordered(bySource, ["tailored", "manual"]),
    byFollowup: ordered(byFollowup, ["set", "none"]),
    byPages: ordered(byPages, ["1", "2", "3", "4", "5"]),
    byPostingAge: ordered(byPostingAge, ["fresh", "week", "old"]),
  };
}

// ── Does the score predict the outcome? ──────────────────────────────────────
//
// Every decided application with a stored score, plotted as it is: score on
// one axis, outcome on the other. The one summary statistic is the
// probability that a randomly chosen progressed application outscores a
// randomly chosen rejected one (the Mann-Whitney AUC; ties count half).
// 0.5 is a coin flip, and when the highest-scoring applications are all
// rejections the panel says so rather than hiding it in a band.

export type Outcome = "progressed" | "rejected";
export type ScorePoint = { score: number; hits: number; total: number; outcome: Outcome; role: string; company: string };
export type ScoreVerdict = "too_few" | "no_signal" | "weak" | "signal";
export type ScoreOutcome = {
  points: ScorePoint[]; // decided + scored, highest score first
  progressed: number;
  rejected: number;
  pendingScored: number; // open applications with a score (not plotted)
  unscoredDecided: number; // decided applications with no stored score
  meanProgressed: number | null;
  meanRejected: number | null;
  auc: number | null; // null unless both outcomes are present
  topN: number;
  topOutcomes: Outcome[]; // outcomes of the topN highest scores
  topAllRejected: boolean;
  verdict: ScoreVerdict;
};

export const TOP_N = 5;
// Below this many decided-and-scored applications no verdict is offered.
export const MIN_FOR_VERDICT = 8;

export function scoreOutcome(rows: InsightRow[]): ScoreOutcome {
  const points: ScorePoint[] = [];
  let pendingScored = 0;
  let unscoredDecided = 0;
  for (const r of rows) {
    if (r.status === "Withdrawn") continue;
    const decided: Outcome | null = PROGRESSED.has(r.status) ? "progressed" : r.status === "Rejected" ? "rejected" : null;
    const scored = r.kwTotal !== undefined && r.kwTotal > 0 && r.kwHits !== undefined;
    if (!decided) {
      if (scored) pendingScored++;
      continue;
    }
    if (!scored) {
      unscoredDecided++;
      continue;
    }
    points.push({ score: r.kwHits! / r.kwTotal!, hits: r.kwHits!, total: r.kwTotal!, outcome: decided, role: r.role, company: r.company });
  }
  points.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company) || a.role.localeCompare(b.role));
  const prog = points.filter((p) => p.outcome === "progressed");
  const rej = points.filter((p) => p.outcome === "rejected");
  const mean = (xs: ScorePoint[]) => (xs.length ? xs.reduce((n, p) => n + p.score, 0) / xs.length : null);
  let auc: number | null = null;
  if (prog.length && rej.length) {
    let wins = 0;
    for (const p of prog) for (const q of rej) wins += p.score > q.score ? 1 : p.score === q.score ? 0.5 : 0;
    auc = wins / (prog.length * rej.length);
  }
  const topOutcomes = points.slice(0, TOP_N).map((p) => p.outcome);
  const verdict: ScoreVerdict =
    auc === null || points.length < MIN_FOR_VERDICT ? "too_few" : auc < 0.6 ? "no_signal" : auc < 0.7 ? "weak" : "signal";
  return {
    points,
    progressed: prog.length,
    rejected: rej.length,
    pendingScored,
    unscoredDecided,
    meanProgressed: mean(prog),
    meanRejected: mean(rej),
    auc,
    topN: TOP_N,
    topOutcomes,
    topAllRejected: topOutcomes.length === TOP_N && topOutcomes.every((o) => o === "rejected"),
    verdict,
  };
}
