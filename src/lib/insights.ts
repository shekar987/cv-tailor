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

export type GateRead = "apply" | "long_shot" | "skip";

export type InsightRow = {
  status: string;
  role: string;
  company: string;
  kwHits?: number;
  kwTotal?: number;
  reqHits?: number;
  reqTotal?: number;
  gateRead?: GateRead;
};

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
  byRole: Bucket[];
  byCompany: Bucket[];
};

export const MIN_DECIDED = 3;
const PROGRESSED = new Set(["Screening", "Interview", "Offer"]);

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
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
  const ats = obj(r.ats ?? snapshot.ats);
  const keywords = obj(ats.keywords);
  const required = obj(ats.required);
  const kwHits = len(keywords.hits);
  const kwTotal = kwHits + len(keywords.misses);
  if (kwTotal > 0) {
    out.kwHits = kwHits;
    out.kwTotal = kwTotal;
  }
  const reqHits = len(required.hits);
  const reqTotal = reqHits + len(required.misses);
  if (reqTotal > 0) {
    out.reqHits = reqHits;
    out.reqTotal = reqTotal;
  }
  const gates = obj(r.gates ?? snapshot.gates);
  if (gates.read === "apply" || gates.read === "long_shot" || gates.read === "skip") out.gateRead = gates.read;
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
  const byRole = new Map<string, Acc>();
  const byCompany = new Map<string, Acc>();
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
    if (row.role) bucketOf(byRole, row.role.toLowerCase(), row.role, row);
    if (row.company) bucketOf(byCompany, row.company.toLowerCase(), row.company, row);
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
    byRole: top(byRole),
    byCompany: top(byCompany),
  };
}
