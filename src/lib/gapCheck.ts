// What the posting asks for that the master CV doesn't show by name, sorted
// before a credit is spent (5 Nov 2026). The 5 Nov sweep's MISSING panels
// mixed two kinds of gap:
//   rename: the CV shows the work under another word — "troubleshooting" is
//           the incident bullet, "HTTP" is the REST API work, "observability"
//           is the monitoring line. A one-line master-CV edit may fix it.
//   core:   there is no evidence — DNS and routing, MDM / Intune, accounting,
//           Workday Financials, dbt. The honest move is often to skip.
// Six credits went on roles that were then skipped for core gaps, so the
// pre-check (/api/analyze) now says it first: "3 core gaps: DNS, routing,
// firewalls. This role may not suit you."
//
// The order, so nothing is renamed that shouldn't be: a skill placed as being
// learnt is core; a qualification is core; the free rules (RENAME_RULES, each
// for the whole term, never a word inside it — "Network troubleshooting" is
// not "troubleshooting"); a named technology is core and never sent to the
// model (Docker is not Kubernetes); a soft skill is only a missing word; the
// rest goes to one cheap model call, whose answer counts only where the line
// it quotes is word for word inside one line of the master CV or pool — and
// the row shows that line, never the model's. A term the read never finished
// (the call failed, timed out, or the term was past the cap) is `checked:
// false`, and the banner says so instead of counting it with confidence.
//
// Relative .ts imports only, so it runs under node:test.
import { evidenceLines, isNamedTechnology, type EvidenceMap, type Importance, type RequirementKind, type SourceLine } from "./evidenceMap.ts";
import { languagesIn, namesLanguage } from "./triage/jdTriage.ts";
import { matchAtsKeywords } from "./atsMatch.ts";
import { distinctiveTokens } from "./claims.ts";

export type GapClass = "rename" | "core";
export type GapItem = {
  term: string;
  importance: Importance;
  kind: RequirementKind;
  class: GapClass;
  // The master CV's own line that shows it (a rename), clipped for display.
  line: string | null;
  // The role or project that line sits under.
  where: string | null;
  via: "rule" | "model" | null;
  // Placed as being learnt (registry or the CV's own "Currently learning").
  learning: boolean;
  // False when the read for other wording never finished for this term.
  checked: boolean;
};
export type GapCheck = { items: GapItem[]; model: "ok" | "failed" | "none" };

export const MAX_MODEL_TERMS = 12;
const MAX_LINE_CHARS = 180;
const MAX_ITEMS = 36;

// A posting's word for a practice, as the whole term: "troubleshooting",
// "troubleshooting skills" — never "network troubleshooting".
const practice = (core: string) => new RegExp(String.raw`^(?:${core})(?:\s+(?:skills?|experience|abilit(?:y|ies)))?$`, "i");

// The same work under its usual other names. Each `term` is a posting's whole
// term; `shown` is what a CV line that does that work says instead.
export const RENAME_RULES: { term: RegExp; shown: RegExp }[] = [
  {
    term: practice(String.raw`troubleshoot(?:ing)?|debugging|debugging\s+and\s+troubleshooting|troubleshooting\s+and\s+debugging`),
    shown: /\b(?:debug(?:ged|ging)?|diagnos(?:ed|ing|is|e)|root[-\s]caus\w*|incidents?|outages?|on[-\s]call|resolv(?:ed|ing)\s+(?:\w+\s+){0,2}(?:issues?|bugs?|incidents?|tickets?|problems?|failures?)|fix(?:ed|ing)\s+(?:\w+\s+){0,2}(?:bugs?|defects?|failures?))\b/i,
  },
  { term: /^(?:https?|http\/[\d.]+|http\s+protocols?|http\s+apis?)$/i, shown: /\b(?:rest(?:ful)?\s+apis?|rest\s+(?:endpoints?|services?)|https?\b|api\s+endpoints?|web\s+services?|graphql)\b/i },
  {
    term: practice(String.raw`observability|monitoring|monitoring\s+and\s+observability|observability\s+and\s+monitoring|logging\s+and\s+monitoring`),
    shown: /\b(?:monitor(?:ing|ed)|logging|structured\s+logs?|alerting|grafana|prometheus|datadog|sentry|cloudwatch|new\s+relic|opentelemetry|distributed\s+tracing|telemetry)\b/i,
  },
  {
    term: practice(String.raw`data\s+mapping|field\s+mapping|data\s+mapping\s+and\s+transformation`),
    shown: /\b(?:etl|elt|schema\s+mapping|field\s+mapping|map(?:ped|ping)\s+(?:\w+\s+){0,2}(?:fields?|schemas?)|data\s+transform\w*|transform(?:ed|ing)\s+(?:\w+\s+){0,2}data|data\s+migrat\w*|migrat(?:ed|ing)\s+(?:\w+\s+){0,2}data)\b/i,
  },
  { term: practice(String.raw`incident\s+(?:management|response)`), shown: /\b(?:incidents?|outages?|on[-\s]call|post[-\s]?mortems?|root[-\s]caus\w*)\b/i },
  { term: practice(String.raw`version\s+control|source\s+control`), shown: /\b(?:git|github|gitlab|bitbucket)\b/i },
  { term: practice(String.raw`code\s+reviews?|peer\s+code\s+reviews?`), shown: /\b(?:code\s+reviews?|reviewed\s+(?:\w+\s+){0,2}(?:pull\s+requests?|prs|code)|pull\s+request\s+reviews?)\b/i },
];

// Named platforms and products, whatever their case: never sent to the model,
// never renamed. (lib/evidenceMap isNamedTechnology reads capitals, so
// "Version Control" looks named and "kubernetes" doesn't.)
// Lookarounds, not \b: "C#", "C++" and ".NET" end or start on a symbol, where \b never matches.
const PRODUCT_RE =
  /(?<![\w.+#])(?:kubernetes|k8s|helm|terraform|docker|ansible|jenkins|nginx|aws|azure|gcp|google\s+cloud|salesforce|workday|intune|jamf|mdm|okta|saml|sso|ldap|active\s+directory|snowflake|dbt|databricks|spark|hadoop|kafka|airflow|splunk|datadog|grafana|prometheus|elasticsearch|redis|postgres(?:ql)?|mysql|mongodb|graphql|python|pandas|numpy|django|flask|fastapi|typescript|javascript|node(?:\.?js)?|react|angular|vue|svelte|java|kotlin|scala|rust|golang|ruby|rails|php|c\+\+|c#|\.net|swift|bash|powershell|selenium|cypress|playwright|jest|pytest|excel|jira|confluence|figma|sql\s+server|oracle|sap|tableau|power\s+bi|looker|linux|windows|macos|ios|android|dns|tcp\/?ip|bgp|vpns?|firewalls?|networking|xero|quickbooks|netsuite|accounting|bookkeeping)(?![\w+#])/i;
const PRODUCT_ALL_RE = new RegExp(PRODUCT_RE.source, "gi");
// The products a term names: the product list, the triage's languages, distinctive tokens.
function productsIn(term: string): string[] {
  const found = [...term.matchAll(PRODUCT_ALL_RE)].map((m) => m[0]);
  // The triage's languages and frameworks on the whole term ("Spring Boot") and per word.
  found.push(...languagesIn(term));
  for (const w of term.split(/[\s/,&]+/)) if (w && (namesLanguage(w) || /^go$/i.test(w))) found.push(w);
  found.push(...distinctiveTokens(term));
  return [...new Set(found.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
}
// The second word of a two-word product: "AWS Lambda", "React Native", "GitHub
// Actions", "Docker Compose", "Kafka Streams", "AWS Step Functions". A word beside
// a product is part of its NAME only when it is one of these (or a product itself);
// any other word ("cloud", "front-end", "web framework", "unit testing") asks how
// the product is used.
const PRODUCT_SECOND_WORDS = new Set([
  "lambda", "native", "actions", "compose", "streams", "functions", "step", "pages", "workers", "connect", "studio", "router",
  "hooks", "redux", "beam", "glue", "athena", "redshift", "sagemaker", "bedrock", "kinesis", "fargate", "cloudformation",
  "cdk", "amplify", "cognito", "dynamodb", "aurora", "bigquery", "dataflow", "pubsub", "vertex", "registry", "mesh",
  "swarm", "kernel", "asyncio", "copilot", "synapse", "fabric", "lakehouse", "sentinel", "defender", "streaming", "apex",
]);
// Words that say how a product is used, never part of its name. In a term written
// all in capitals ("Python Test Automation") a capital says nothing, so a word not
// on this list is read as a name ("Azure Synapse Analytics"); in a term written in
// sentence case only a capitalised word is ("Docker Swarm orchestration").
// "query" is a use ("SQL query optimisation"); "React Query" is a capital in
// sentence case, or two words of a title-case term that this list leaves named.
const PRACTICE_WORDS = new Set([
  "test", "tests", "testing", "unit", "automation", "automated", "scripting", "scripts", "development", "developer", "engineering",
  "programming", "coding", "code", "pipeline", "pipelines", "clusters", "cluster", "administration", "admin", "performance", "tuning",
  "optimisation", "optimization", "design", "integration", "integrations", "deployment", "deployments", "monitoring", "migration",
  "migrations", "modelling", "modeling", "data", "analysis", "analytics", "backend", "frontend", "front", "back", "end", "web",
  "framework", "frameworks", "cloud", "services", "service", "applications", "application", "apps", "app", "apis", "api", "rest",
  "queries", "query", "querying", "reporting", "dashboards", "debugging", "troubleshooting", "maintenance", "configuration",
  "management", "security", "best", "practices", "infrastructure", "platform", "platforms", "systems", "system", "solutions",
  "architecture", "components", "component", "libraries", "library", "tools", "tooling", "ecosystem", "environment", "environments",
  "experience", "knowledge", "skills", "proficiency", "stack", "server", "servers", "containers", "containerisation", "orchestration",
  "mobile", "desktop", "ui", "ux", "workflows", "workflow", "processes", "concepts", "fundamentals", "principles", "advanced", "strong",
  "solid", "good", "basic", "using", "with", "of", "in", "on", "for", "the", "to", "based", "including",
]);
// A capitalised word directly after a product, in a term otherwise written in sentence case,
// is part of the product's name: "Swarm" in "Docker Swarm orchestration". Never in a term
// written all in capitals (postings title-case plain words: "AWS EC2 Instances", "Python
// Coding Standards" are uses, and the 6 Nov review found them filed as core gaps), never an
// all-caps acronym ("Python for ML"), never a practice word.
function namesByCase(term: string, products: readonly string[]): boolean {
  const words = term.split(/[^\p{L}\p{N}+#.]+/u).filter((w) => /\p{L}/u.test(w));
  const titleCase = words.every((w) => /^\p{Lu}/u.test(w) || /^(?:and|or|of|in|on|for|the|to|with|a|an)$/.test(w));
  if (titleCase) return false;
  const lower = products.map((p) => p.toLowerCase());
  for (let i = 0; i + 1 < words.length; i++) {
    if (!lower.includes(words[i].toLowerCase())) continue;
    const next = words[i + 1];
    if (/^\p{Lu}\p{Ll}/u.test(next) && !PRACTICE_WORDS.has(next.toLowerCase()) && !lower.includes(next.toLowerCase())) return true;
  }
  return false;
}
// A named technology is never sent to the model:
//   - a term that IS a product, a language or framework ("Spring Boot"), or a
//     two-word product ("AWS Lambda", "GitHub Actions", "React Native");
//   - a named method around a product ("Kafka stream processing", "AWS serverless"
//     — lib/evidenceMap's methods, read by isNamedTechnology);
//   - any term around a product the master CV never shows ("Kubernetes clusters"
//     — asking could only invite a graft).
// A product the CV shows plus plain words ("Python test automation", "AWS cloud",
// "React front-end", "Django web framework") is a question of wording, so the
// model is asked. With no product word, isNamedTechnology reads the LOWERCASED
// term: it reads a capital as a product, and postings capitalise plain words ("Routing").
// Products of three words or a common word that no list above can read: always a name.
const PRODUCT_PHRASE_RE = /\b(?:react\s+server\s+components|(?:react|tanstack)\s+query|unity\s+catalog|data\s+factory|step\s+functions|app\s+router)\b/i;
function isNamed(term: string, sources: string): boolean {
  if (PRODUCT_PHRASE_RE.test(term)) return true;
  const products = productsIn(term);
  if (products.length === 0) return isNamedTechnology(term.toLowerCase());
  const rest = products.reduce((s, p) => s.split(p).join(" "), term).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!rest || /^(?:and|or)$/i.test(rest)) return true;
  if (isNamedTechnology(rest.toLowerCase())) return true;
  const words = rest.toLowerCase().split(/\s+/).filter((w) => w && w !== "and" && w !== "or");
  if (words.some((w) => PRODUCT_SECOND_WORDS.has(w))) return true;
  if (namesByCase(term, products)) return true;
  return products.some((p) => matchAtsKeywords(sources, [p]).matched === 0);
}

function clip(s: string): string {
  const t = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return t.length > MAX_LINE_CHARS ? `${t.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : t;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/^[\s•*\-–—]+/, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();

function bySource(cv: string, pool: string | null | undefined): SourceLine[] {
  const { experience, projects, listed } = evidenceLines(cv, pool);
  // Paid work first, then projects, then lists: the strongest evidence is shown.
  return [...experience, ...projects, ...listed].filter((l) => words(l.text) >= 4);
}

/** The master CV's line that shows a term under another word, by the free rules alone, or null. */
export function renameLine(term: string, cv: string, pool?: string | null): string | null {
  const rule = RENAME_RULES.find((r) => r.term.test(term.trim()));
  const hit = rule ? bySource(cv, pool).find((l) => rule.shown.test(l.text)) : undefined;
  return hit ? clip(hit.text) : null;
}

/** The posting's gaps sorted by the free rules, and the terms left for the model to read. */
export function classifyByRules(map: EvidenceMap | null | undefined, cv: string, pool?: string | null): { items: GapItem[]; askModel: string[] } {
  const items: GapItem[] = [];
  const askModel: string[] = [];
  const lines = bySource(cv, pool);
  for (const i of (map?.items ?? []).slice(0, MAX_ITEMS)) {
    if (i.status !== "gap" && i.status !== "learning") continue;
    const base: GapItem = { term: i.term, importance: i.importance, kind: i.kind, class: "core", line: null, where: null, via: null, learning: i.status === "learning", checked: true };
    if (base.learning || i.kind === "qualification") {
      items.push(base);
      continue;
    }
    const rule = RENAME_RULES.find((r) => r.term.test(i.term.trim()));
    const hit = rule ? lines.find((l) => rule.shown.test(l.text)) : undefined;
    if (hit) {
      items.push({ ...base, class: "rename", line: clip(hit.text), where: hit.where, via: "rule" });
      continue;
    }
    if (rule || isNamed(i.term, pool ? `${cv}\n${pool}` : cv) || i.kind === "soft") {
      items.push(base);
      continue;
    }
    // Left for the model; unchecked until it answers.
    items.push({ ...base, checked: false });
    if (askModel.length < MAX_MODEL_TERMS) askModel.push(i.term);
  }
  return { items, askModel };
}

/** What the model is given: the terms and the master CV (and pool), nothing else. */
export function gapRenameInput(terms: readonly string[], cv: string, pool?: string | null): string {
  return JSON.stringify({ terms, cv: pool ? `${cv}\n\n${pool}` : cv });
}

/**
 * The model's answer, taken only where it holds: a term that was asked, and a
 * line of four words or more that is word for word inside one line of the
 * master CV or pool (an invented tail on a real line is refused). The row
 * shows that source line, the one the quote covers best. Every asked term is
 * checked once the model has answered.
 */
export function applyModelRenames(items: GapItem[], raw: unknown, asked: readonly string[], cv: string, pool?: string | null): GapItem[] {
  const askedSet = new Set(asked.map((t) => t.toLowerCase()));
  const list = raw && typeof raw === "object" ? (raw as { renames?: unknown }).renames : null;
  const lines = bySource(cv, pool).map((l) => ({ ...l, key: norm(l.text) }));
  const found = new Map<string, SourceLine>();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== "object") continue;
    const term = typeof (r as { term?: unknown }).term === "string" ? (r as { term: string }).term.trim() : "";
    const line = typeof (r as { line?: unknown }).line === "string" ? (r as { line: string }).line : "";
    const key = norm(line);
    if (!term || !askedSet.has(term.toLowerCase()) || words(key) < 4 || key.length < 20) continue;
    const within = lines.filter((l) => l.key.includes(key));
    if (within.length === 0) continue;
    within.sort((a, b) => key.length / b.key.length - key.length / a.key.length);
    found.set(term.toLowerCase(), within[0]);
  }
  const answered = Array.isArray(list);
  return items.map((i) => {
    if (!askedSet.has(i.term.toLowerCase())) return i;
    const s = found.get(i.term.toLowerCase());
    if (s && i.class === "core" && !i.learning) return { ...i, class: "rename", line: clip(s.text), where: s.where, via: "model", checked: true };
    return answered ? { ...i, checked: true } : i;
  });
}

/** The banner above the continue button: the required, non-soft core gaps. */
export function coreGapBanner(check: GapCheck | null | undefined): { terms: string[]; text: string; blocks: boolean } | null {
  const core = (check?.items ?? []).filter((i) => i.class === "core" && i.importance === "required" && i.kind !== "soft");
  if (core.length === 0) return null;
  const terms = core.map((i) => i.term);
  const unchecked = core.filter((i) => !i.checked).length;
  // Held only on a read that finished: two or more required skills with no evidence at all.
  const blocks = core.length - unchecked >= 2;
  const shown = terms.slice(0, 5).join(", ");
  const more = terms.length > 5 ? ` and ${terms.length - 5} more` : "";
  const caveat = unchecked > 0 ? ` The check for other wording didn't finish for ${unchecked === 1 ? "one of them" : `${unchecked} of them`}, so your CV may show ${unchecked === 1 ? "it" : "them"} under another name.` : "";
  return {
    terms,
    text: `${terms.length} main ${terms.length === 1 ? "requirement is" : "requirements are"} not in your CV: ${shown}${more}.${blocks ? " This job may not suit you." : ""}${caveat}`,
    blocks,
  };
}

/** The class of a term the tailored CV still misses, from the pre-check, if it was read. */
export function gapFor(check: GapCheck | null | undefined, term: string, masterCv?: string): GapItem | null {
  const key = (s: string) => s.replace(/\s+—.*$/, "").toLowerCase().replace(/[^a-z0-9+#./]+/g, " ").trim();
  const t = key(term);
  if (!t) return null;
  const items = check?.items ?? [];
  const exact = items.find((i) => key(i.term) === t);
  if (exact) return exact;
  // The evidence map splits "X and Y" and trims leads: a missed keyword may carry a gap's
  // whole words ("Kubernetes clusters — not present" → Kubernetes). The other way — a
  // shorter miss inside a longer gap (the keyword "Kubernetes" folded into the required
  // "Kubernetes clusters") — only when the master CV doesn't show the miss: "AWS", which
  // it shows, is never the core gap "AWS Lambda".
  const within = (a: string, b: string) => b.length >= 3 && ` ${a} `.includes(` ${b} `);
  const forward = items.find((i) => within(t, key(i.term)));
  if (forward) return forward;
  const bare = term.replace(/\s+—.*$/, "").trim();
  if (!masterCv || matchAtsKeywords(masterCv, [bare]).matched > 0) return null;
  return items.find((i) => within(key(i.term), t)) ?? null;
}

/** A check from the response or a stored workspace, re-bounded. */
export function normalizeGapCheck(v: unknown): GapCheck | null {
  if (!v || typeof v !== "object" || !Array.isArray((v as { items?: unknown }).items)) return null;
  const raw = v as { items: unknown[]; model?: unknown };
  const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
  const items: GapItem[] = [];
  for (const x of raw.items.slice(0, MAX_ITEMS)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const term = str(o.term, 120);
    if (!term) continue;
    items.push({
      term,
      importance: o.importance === "required" || o.importance === "preferred" ? o.importance : "keyword",
      kind: o.kind === "technical" || o.kind === "domain" || o.kind === "soft" || o.kind === "qualification" ? o.kind : "technical",
      class: o.class === "rename" ? "rename" : "core",
      line: str(o.line, MAX_LINE_CHARS),
      where: str(o.where, 120),
      via: o.via === "rule" || o.via === "model" ? o.via : null,
      learning: o.learning === true,
      checked: o.checked !== false,
    });
  }
  return { items, model: raw.model === "ok" || raw.model === "failed" ? raw.model : "none" };
}
