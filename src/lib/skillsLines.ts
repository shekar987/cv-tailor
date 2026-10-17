// The skills block, parsed and written back — the one reader of its shape
// (16 Oct 2026, the CareerSet style). UKJI's block is two lines, "Functional
// Competencies: a | b" and "Technical Tools: x | y". CareerSet's keeps the
// competencies line, then a label-only "Technical Tools:" line, then one
// "Group: items" line per group in the style's fixed order ("Languages &
// Frameworks", "Databases", "AI & LLM", "Cloud & DevOps", "Testing", "Other"),
// items comma-separated, with " | " still read as a separator. Every rule
// that used to find THE Technical Tools line (lib/formatRules, lib/claims,
// lib/claimRepair, lib/atsMatch) reads the block through here when the shape
// is grouped, and keeps its own flat code path otherwise — so UKJI's output
// is byte-identical to what it was.
//
// Imports only ./formatStyles/ids.ts (import-free), so it runs under node:test.
import { FLAT_SKILLS, type SkillsShape } from "./formatStyles/ids.ts";

export type SkillsLine = {
  index: number;
  // The label as written, without bold markers ("Technical Tools").
  label: string;
  // The exact text up to and including the colon (bold markers kept), so a
  // rebuilt line reads as the model wrote it.
  prefix: string;
  items: string[];
};
export type SkillsBlock = {
  lines: string[];
  shape: SkillsShape;
  competencies: SkillsLine | null;
  // Flat: `header` carries the items and `groups` is empty. Grouped: the
  // header is the label-only line (or null when the model left it out) and
  // `groups` are the group lines in text order.
  header: SkillsLine | null;
  groups: SkillsLine[];
};

// "**Label:** rest", "**Label**: rest", "Label: rest".
const LABEL_RE = /^(\s*\**\s*)([^:|•]{1,40}?)(\s*\**\s*:\s*\**\s*)(.*)$/;

export function parseLabelLine(line: string): { label: string; prefix: string; body: string } | null {
  const m = LABEL_RE.exec(line);
  if (!m) return null;
  return { label: m[2].trim(), prefix: `${m[1]}${m[2]}${m[3]}`, body: m[4] };
}

const key = (s: string) => s.trim().toLowerCase();

// Items of a list body: " | " always separates; a comma separates too when
// the shape says so, but never inside brackets ("AWS (Lambda, SQS)" is one
// item). Duplicates (case-insensitive) keep the first spelling.
export function splitItems(body: string, commaItems: boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "|" && depth === 0) || (ch === "," && commaItems && depth === 0)) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function joinItems(items: string[], commaItems: boolean): string {
  return items.join(commaItems ? ", " : " | ");
}

export function parseSkillsBlock(skills: string, shape: SkillsShape = FLAT_SKILLS): SkillsBlock {
  const lines = skills.split("\n");
  const block: SkillsBlock = { lines, shape, competencies: null, header: null, groups: [] };
  const groupKeys = new Set(shape.groups.map(key));
  lines.forEach((line, index) => {
    const p = parseLabelLine(line);
    if (!p) return;
    const k = key(p.label);
    if (k === "functional competencies" && !block.competencies) {
      block.competencies = { index, label: p.label, prefix: p.prefix, items: splitItems(p.body, false) };
    } else if (k === "technical tools" && !block.header) {
      block.header = { index, label: p.label, prefix: p.prefix, items: splitItems(p.body, shape.commaItems) };
    } else if (shape.grouped && groupKeys.has(k) && !block.groups.some((g) => key(g.label) === k)) {
      block.groups.push({ index, label: p.label, prefix: p.prefix, items: splitItems(p.body, true) });
    }
  });
  return block;
}

// Every tool item in reading order: the header's items (flat), or each
// group's items in text order (grouped).
export function toolItems(block: SkillsBlock): string[] {
  if (block.shape.grouped) return block.groups.flatMap((g) => g.items);
  return block.header?.items ?? [];
}

// The lines holding tool items — what the rules rewrite.
export function toolLines(block: SkillsBlock): SkillsLine[] {
  if (block.shape.grouped) return block.groups;
  return block.header ? [block.header] : [];
}

// Writes the tool lines back with the given items per line (same order as
// toolLines()). A line given no items is removed; a grouped block whose
// header the model left out is left without one.
export function writeToolLines(block: SkillsBlock, perLine: string[][]): string {
  const lines = [...block.lines];
  const remove = new Set<number>();
  toolLines(block).forEach((l, i) => {
    const items = perLine[i] ?? [];
    if (items.length === 0) remove.add(l.index);
    else lines[l.index] = `${l.prefix}${joinItems(items, block.shape.grouped ? true : block.shape.commaItems)}`;
  });
  return lines.filter((_, i) => !remove.has(i)).join("\n");
}

// Keeps a subset of the tool items, each line keeping its own order.
export function keepToolItems(block: SkillsBlock, keep: Set<string>): string {
  return writeToolLines(block, toolLines(block).map((l) => l.items.filter((it) => keep.has(it))));
}

// Which group a tool belongs to (the CareerSet groups). A fixed table, so
// a restored tool lands where a reader expects it; "Other" when nothing
// matches.
const DATABASES_RE = /\b(?:postgres(?:ql)?|mysql|sqlite|mongodb|mongo|redis|dynamodb|firestore|supabase|cassandra|oracle|mariadb|sql\s+server|elasticsearch|opensearch|neo4j|bigquery|snowflake|redshift|cosmos\s*db|couch(?:base|db)|influxdb|clickhouse|t-sql|pl\/sql)\b/i;
const AI_RE = /\b(?:llms?|rag|langchain|langgraph|llamaindex|openai|anthropic|claude|gpt(?:-\d)?|gemini|hugging\s*face|transformers|pytorch|tensorflow|scikit-learn|sklearn|keras|prompt\s+engineering|embeddings?|vector\s+(?:search|databases?|stores?)|pinecone|weaviate|chroma|machine\s+learning|deep\s+learning|nlp|computer\s+vision|mlflow|spacy|ollama|copilot|claude\s+code)\b/i;
const CLOUD_RE = /\b(?:aws|azure|gcp|google\s+cloud|lambda|terraform|docker|kubernetes|k8s|helm|github\s+actions|gitlab\s+ci|jenkins|ci\/cd|circleci|vercel|netlify|heroku|cloudwatch|cloudfront|s3|ec2|sqs|sns|ecs|eks|rds|api\s+gateway|nginx|linux|ansible|grafana|prometheus|datadog|git|serverless|oidc|cloud\s+functions|firebase|pulumi|railway|fly\.io)\b/i;
const TESTING_RE = /\b(?:jest|vitest|mocha|chai|pytest|unittest|junit|cypress|playwright|selenium|testing\s+library|axe(?:\s+accessibility(?:\s+checks)?)?|k6|postman|cucumber|rspec|unit\s+tests?|e2e|end-to-end\s+tests?|tdd)\b/i;
const LANG_RE = /\b(?:python|java|javascript|typescript|c#|c\+\+|golang|go|rust|ruby|php|kotlin|swift|scala|sql|html5?|css3?|sass|react|next\.?js|node\.?js|vue|angular|svelte|django|flask|fastapi|spring(?:\s+boot)?|express|nest\.?js|rails|\.net|dotnet|graphql|sqlalchemy|prisma|redux|tailwind|laravel|bash|shell|rest(?:ful)?\s+apis?|websockets?|jquery|bootstrap)\b/i;

export function groupFor(item: string, groups: readonly string[]): string {
  const t = item.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const pick = (name: string) => groups.find((g) => key(g) === key(name)) ?? null;
  const order: [RegExp, string][] = [
    [DATABASES_RE, "Databases"],
    [AI_RE, "AI & LLM"],
    [TESTING_RE, "Testing"],
    [CLOUD_RE, "Cloud & DevOps"],
    [LANG_RE, "Languages & Frameworks"],
  ];
  for (const [re, name] of order) {
    if (re.test(t)) {
      const g = pick(name);
      if (g) return g;
    }
  }
  return pick("Other") ?? groups[groups.length - 1] ?? "Other";
}

// Adds an item to a group line, creating the line in the style's order when
// the block has none for that group (after the last group that precedes it,
// else right after the header, else at the end). Flat: appended to the
// header line.
export function addToolItem(block: SkillsBlock, item: string, group: string | null): string {
  if (!block.shape.grouped) {
    if (!block.header) return block.lines.join("\n");
    const lines = [...block.lines];
    lines[block.header.index] = `${block.header.prefix}${joinItems([...block.header.items, item], block.shape.commaItems)}`;
    return lines.join("\n");
  }
  const target = group ?? groupFor(item, block.shape.groups);
  const existing = block.groups.find((g) => key(g.label) === key(target));
  const lines = [...block.lines];
  if (existing) {
    lines[existing.index] = `${existing.prefix}${joinItems([...existing.items, item], true)}`;
    return lines.join("\n");
  }
  const canonical = block.shape.groups.findIndex((g) => key(g) === key(target));
  const before = block.groups.filter((g) => block.shape.groups.findIndex((x) => key(x) === key(g.label)) < canonical);
  const at = before.length > 0 ? Math.max(...before.map((g) => g.index)) + 1 : block.header ? block.header.index + 1 : lines.length;
  lines.splice(at, 0, `${target}: ${item}`);
  return lines.join("\n");
}

// The skills text with the grouped block's labels removed: the label-only
// "Technical Tools:" line goes, each group line keeps only its items. The
// words of a label ("Testing", "Cloud", "LLM") are not the candidate's
// claims and must never be scored or claim-checked as such.
// A grouped block holds only label lines (Functional Competencies, Technical
// Tools, the groups) and blank lines. Anything else the model wrote under
// them is commentary, not a skill — the 17 Oct eval's recsys run carried a
// 23-line "EVIDENCE & RATIONALE" block ("- Kubeflow, JAX: Listed under
// 'Currently learning' — explicitly excluded by rule 2.") straight onto the
// CV, because every rule reads label lines and leaves the rest alone. Dropped
// and reported; a flat (UKJI) block is returned unchanged.
export function dropStrayLines(skills: string, shape: SkillsShape): { skills: string; dropped: string[] } {
  if (!shape.grouped) return { skills, dropped: [] };
  const known = new Set(["functional competencies", "technical tools", ...shape.groups.map(key)]);
  const dropped: string[] = [];
  const kept = skills.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    const p = parseLabelLine(line);
    if (p && known.has(key(p.label))) return true;
    dropped.push(t);
    return false;
  });
  return dropped.length ? { skills: kept.join("\n"), dropped } : { skills, dropped };
}

export function stripGroupLabels(skills: string, shape: SkillsShape): string {
  if (!shape.grouped) return skills;
  const groupKeys = new Set(shape.groups.map(key));
  return skills
    .split("\n")
    .map((line) => {
      const p = parseLabelLine(line);
      if (!p) return line;
      const k = key(p.label);
      if (k === "technical tools" && !p.body.trim()) return "";
      if (groupKeys.has(k)) return p.body;
      return line;
    })
    .filter((l) => l.trim() !== "")
    .join("\n");
}
