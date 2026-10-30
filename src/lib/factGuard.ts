// Last-pass fact guard on the finished sections (29 Oct 2026). A CareerSet
// run through OpenRouter wrote "BSc Computer Science" for a master CV that
// says BTech, listed "OpenAI API" under the AI tools although the master CV
// never names it, and summarised a role as "live translation AI development"
// lifted from the job description. Each fix here is deterministic and only
// ever moves the text back towards the master CV:
//   1. degree labels: a degree abbreviation the master CV never uses is
//      replaced by the one it does (BSc → BTech), when the master has one;
//   2. skills: a commonly over-claimed tool that the master CV never names is
//      removed from the skills text;
//   3. summary: a sentence that leans on a phrase found in the job
//      description but nowhere in the master CV is reported (not deleted),
//      so the page can flag it before download.
//
// Import-free, so it runs under node:test.

const DEGREES = ["BTech", "B.Tech", "BSc", "B.Sc", "BEng", "BA", "MSc", "MEng", "MA", "MBA", "PhD"] as const;
const UNDERGRAD = /\b(?:BTech|B\.Tech|BSc|B\.Sc|BEng|BA)\b/g;

// Tools models add from the JD or from habit. Only removed when the master
// CV does not name them anywhere.
export const OVERCLAIMED_TOOLS = [
  "OpenAI API",
  "Kafka",
  "Azure",
  "GCP",
  "Google Cloud",
  "Kubernetes",
  "WebSockets",
  "Claude Code",
  "Rust",
  "Scala",
  "Kotlin",
  "C#",
  ".NET",
] as const;

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, term: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${esc(term)}(?=$|[^A-Za-z0-9])`, "i").test(text);
}

// The master's own undergraduate label ("BTech"), if it uses exactly one.
export function masterUndergrad(master: string): string | null {
  const found = new Set((master.match(UNDERGRAD) || []).map((d) => d.replace(".", "")));
  return found.size === 1 ? [...found][0] : null;
}

export function fixDegreeLabels(text: string, master: string): { text: string; fixed: string[] } {
  const own = masterUndergrad(master);
  if (!own || typeof text !== "string") return { text, fixed: [] };
  const fixed: string[] = [];
  const out = text.replace(UNDERGRAD, (d) => {
    const norm = d.replace(".", "");
    if (norm === own || mentions(master, d)) return d;
    fixed.push(`${d} → ${own}`);
    return own;
  });
  return { text: out, fixed };
}

export function dropUnbackedTools(skills: string, master: string): { text: string; dropped: string[] } {
  if (typeof skills !== "string") return { text: skills, dropped: [] };
  const dropped: string[] = [];
  let out = skills;
  for (const tool of OVERCLAIMED_TOOLS) {
    if (mentions(master, tool) || !mentions(out, tool)) continue;
    // "A, OpenAI API, B" / "OpenAI API, B" / "A, OpenAI API" / "A | OpenAI API"
    const t = esc(tool);
    out = out
      .replace(new RegExp(`\\s*[,|;]\\s*${t}(?=\\s*(?:[,|;]|$|\\n))`, "gim"), "")
      .replace(new RegExp(`(^|[:\\n]\\s*)${t}\\s*[,|;]\\s*`, "gim"), "$1");
    if (!mentions(out, tool)) dropped.push(tool);
  }
  return { text: out, dropped };
}

const STOP = new Set("a an and the of for to in on with by at from as is are be or into across".split(" "));

// Phrases of 2–4 content words that appear in the JD but nowhere in the
// master CV, found inside the summary: likely lifted from the posting.
export function liftedSummaryPhrases(summary: string, master: string, jd: string): string[] {
  if (typeof summary !== "string" || !summary || !jd) return [];
  const words = summary.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).filter(Boolean);
  const m = master.toLowerCase();
  const j = jd.toLowerCase();
  const hits = new Set<string>();
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.some((w) => STOP.has(w)) || gram.join("").length < 10) continue;
      const phrase = gram.join(" ");
      if (j.includes(phrase) && !m.includes(phrase) && !gram.some((w) => m.includes(w) && w.length > 6 && m.split(w).length > 3)) hits.add(phrase);
    }
  }
  return [...hits].slice(0, 5);
}

export type FactGuardReport = { degrees: string[]; droppedTools: string[]; liftedPhrases: string[] };

export function guardFacts(
  sections: { summary: unknown; skills: unknown },
  master: string,
  jd: string
): { summary: unknown; skills: unknown; report: FactGuardReport } {
  const report: FactGuardReport = { degrees: [], droppedTools: [], liftedPhrases: [] };
  let summary = sections.summary;
  let skills = sections.skills;
  if (typeof summary === "string") {
    const d = fixDegreeLabels(summary, master);
    summary = d.text;
    report.degrees.push(...d.fixed);
    report.liftedPhrases = liftedSummaryPhrases(d.text, master, jd);
  }
  if (typeof skills === "string") {
    const t = dropUnbackedTools(skills, master);
    skills = t.text;
    report.droppedTools = t.dropped;
  }
  return { summary, skills, report };
}

export { DEGREES };
