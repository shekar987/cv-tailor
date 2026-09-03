// ATS job-board discovery and fetching for the company research engine.
//
// This is the HIGH-SIGNAL source: a company's live job ads name the stack
// they actually hire for (Kubernetes, PyTorch, LangChain, …), where their
// marketing site's fingerprint mostly reveals the marketing site. Greenhouse,
// Lever, Ashby and Workable all expose free, public, no-key JSON APIs for a
// company's job board — we only need to discover the board token from their
// careers page.

import { htmlToText, decodeEntities } from "./fetchPage";

export type JobOpening = {
  title: string;
  location: string;
  url: string;
  description: string; // plain text, capped
};

export type BoardProvider = "greenhouse" | "lever" | "ashby" | "workable";

export type BoardRef = { provider: BoardProvider; token: string };

export type JobBoardResult = {
  provider: BoardProvider;
  token: string;
  openings: JobOpening[];
};

const MAX_OPENINGS = 30;
const MAX_DESC_CHARS = 4_000;

// ── Discovery ───────────────────────────────────────────────────────────────

const BOARD_PATTERNS: [BoardProvider, RegExp][] = [
  ["greenhouse", /(?:boards|job-boards)\.(?:eu\.)?greenhouse\.io\/([A-Za-z0-9-_]+)/],
  ["greenhouse", /greenhouse\.io\/embed\/job_board\?(?:[^"'\s]*&)?for=([A-Za-z0-9-_]+)/],
  ["lever", /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9-_]+)/],
  ["ashby", /jobs\.ashbyhq\.com\/([A-Za-z0-9-_.%]+)/],
  ["workable", /apply\.workable\.com\/([A-Za-z0-9-]+)/],
];

// First board reference found anywhere in a page's HTML (links, embeds,
// scripts alike).
export function detectBoard(html: string): BoardRef | null {
  for (const [provider, re] of BOARD_PATTERNS) {
    const m = re.exec(html || "");
    if (m && m[1] && !["embed", "boards", "jobs", "job", "www"].includes(m[1].toLowerCase())) {
      return { provider, token: decodeURIComponent(m[1]) };
    }
  }
  return null;
}

// Careers-page candidates worth a second fetch when the homepage itself
// carries no board reference. Same-page links only; the caller fetches these
// through fetchPage (SSRF guard included) with its page budget.
export function careersLinkCandidates(links: { href: string; text: string }[], baseUrl: string): string[] {
  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const scored: { href: string; score: number }[] = [];
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    const hay = `${u.pathname.toLowerCase()} ${l.text.toLowerCase()}`;
    let score = 0;
    if (/careers?/.test(hay)) score += 3;
    if (/\bjobs?\b/.test(hay)) score += 2;
    if (/join|work-with|work-at|hiring|open.?(?:roles|positions)/.test(hay)) score += 1;
    if (score > 0) scored.push({ href: u.toString(), score });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scored) {
    if (!seen.has(s.href)) {
      seen.add(s.href);
      out.push(s.href);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// ── Fetching (fixed, trusted API hosts — not user-controlled) ───────────────

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function fetchBoard(ref: BoardRef): Promise<JobBoardResult | null> {
  const openings: JobOpening[] = [];
  try {
    if (ref.provider === "greenhouse") {
      const data = (await getJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs?content=true`
      )) as { jobs?: unknown[] } | null;
      for (const j of (data?.jobs ?? []).slice(0, MAX_OPENINGS)) {
        const job = j as Record<string, unknown>;
        openings.push({
          title: str(job.title, 200),
          location: str((job.location as Record<string, unknown> | undefined)?.name, 120),
          url: str(job.absolute_url),
          // Greenhouse returns the posting body as HTML-escaped HTML.
          description: htmlToText(decodeEntities(str(job.content, 40_000)), MAX_DESC_CHARS),
        });
      }
    } else if (ref.provider === "lever") {
      const data = (await getJson(
        `https://api.lever.co/v0/postings/${encodeURIComponent(ref.token)}?mode=json`
      )) as unknown[] | null;
      for (const j of (Array.isArray(data) ? data : []).slice(0, MAX_OPENINGS)) {
        const job = j as Record<string, unknown>;
        openings.push({
          title: str(job.text, 200),
          location: str((job.categories as Record<string, unknown> | undefined)?.location, 120),
          url: str(job.hostedUrl),
          description: str(job.descriptionPlain, MAX_DESC_CHARS) || htmlToText(str(job.description, 40_000), MAX_DESC_CHARS),
        });
      }
    } else if (ref.provider === "ashby") {
      const data = (await getJson(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.token)}`
      )) as { jobs?: unknown[] } | null;
      for (const j of (data?.jobs ?? []).slice(0, MAX_OPENINGS)) {
        const job = j as Record<string, unknown>;
        openings.push({
          title: str(job.title, 200),
          location: str(job.location, 120),
          url: str(job.jobUrl) || str(job.applyUrl),
          description: htmlToText(str(job.descriptionHtml, 40_000), MAX_DESC_CHARS) || str(job.descriptionPlain, MAX_DESC_CHARS),
        });
      }
    } else if (ref.provider === "workable") {
      const data = (await getJson(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(ref.token)}?details=true`
      )) as { jobs?: unknown[] } | null;
      for (const j of (data?.jobs ?? []).slice(0, MAX_OPENINGS)) {
        const job = j as Record<string, unknown>;
        openings.push({
          title: str(job.title, 200),
          location: [str(job.city, 60), str(job.country, 60)].filter(Boolean).join(", "),
          url: str(job.url) || str(job.shortlink),
          description: htmlToText(str(job.description, 40_000), MAX_DESC_CHARS),
        });
      }
    }
  } catch {
    return null; // network/format failure — research degrades, never breaks
  }
  const kept = openings.filter((o) => o.title);
  return kept.length > 0 ? { provider: ref.provider, token: ref.token, openings: kept } : null;
}

// ── Deterministic stack-keyword harvest from job-ad text ────────────────────
// A curated tech vocabulary matched on word boundaries. "Go" is deliberately
// only counted as "Golang" — bare "Go" in prose is untellable from the verb.

const TECH_TERMS: string[] = [
  // Languages
  "Python", "TypeScript", "JavaScript", "Java", "Kotlin", "Swift", "Rust", "Golang",
  "Ruby", "PHP", "Scala", "Elixir", "C\\+\\+", "C#", "\\.NET", "SQL",
  // Backend / frameworks
  "Spring Boot", "Spring", "Django", "Flask", "FastAPI", "Rails", "Laravel",
  "Node\\.js", "Express", "NestJS", "GraphQL", "gRPC", "REST",
  // Frontend
  "React", "React Native", "Next\\.js", "Vue", "Nuxt", "Angular", "Svelte", "Flutter",
  // Data stores / messaging
  "PostgreSQL", "Postgres", "MySQL", "MongoDB", "Redis", "Elasticsearch",
  "Kafka", "RabbitMQ", "ActiveMQ", "SQS", "DynamoDB", "Cassandra", "Snowflake",
  "BigQuery", "Redshift", "ClickHouse", "Supabase", "Firebase",
  // Infra / DevOps
  "Kubernetes", "Docker", "Terraform", "Ansible", "Helm", "AWS", "GCP", "Azure",
  "Jenkins", "GitLab CI", "GitHub Actions", "CircleCI", "ArgoCD", "Prometheus",
  "Grafana", "Datadog", "CI/CD", "Microservices", "Serverless", "Lambda", "Kong",
  "Istio", "Nginx",
  // Data / ML / AI
  "PyTorch", "TensorFlow", "scikit-learn", "Pandas", "Spark", "Airflow", "dbt",
  "MLflow", "LangChain", "LlamaIndex", "LangGraph", "OpenAI", "Anthropic", "Claude",
  "GPT-4", "Gemini", "RAG", "LLM", "LLMs", "Machine Learning", "Deep Learning",
  "Computer Vision", "NLP", "pgvector", "Pinecone", "Weaviate", "Embeddings",
  // Practices worth surfacing
  "Event-Driven", "Domain-Driven", "TDD", "Agile", "Scrum",
];

export function harvestStackKeywords(texts: string[]): { keyword: string; count: number }[] {
  const corpus = texts.join("\n");
  const out: { keyword: string; count: number }[] = [];
  for (const term of TECH_TERMS) {
    const display = term.replace(/\\/g, "");
    const re = new RegExp(`(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`, "gi");
    const count = (corpus.match(re) || []).length;
    if (count > 0) out.push({ keyword: display, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, 25);
}
