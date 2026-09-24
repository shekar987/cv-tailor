// Right-to-work wording in GENERATED text. The document switch
// (lib/preferences.includeRightToWorkOnCv, default off) keeps the profile's
// Right to Work section off the CV, but the summary, experience and cover
// letter are written from the master CV text, which states the status — so
// the models kept writing "Student visa … Graduate Route from January 2027"
// into the summary and the letter. When the switch is off, the tailor route
// runs these deterministic filters on the finished text: a sentence (or a
// bullet) that mentions the status is removed, and the removed text is
// reported so the user sees exactly what went. Nothing is rewritten.
//
// Import-free: runs in the route and under node:test.

// The status vocabulary. "visa" is matched only in its immigration sense —
// never a capitalised "Visa" alone, which is also a company.
const RTW_RE =
  /\bsponsor(?:ship|ed|ing|s)?\b|\bright(?:s)? to (?:live and )?work\b|\bwork (?:authori[sz]ation|permit)\b|\bgraduate route\b|\bgraduate visa\b|\b(?:student|graduate|skilled[- ]worker|work|tier \d|my|a|the|current|valid|this|his|her|their|require[sd]?|need(?:s|ed)?|without|no|on a)\s+visas?\b|\bvisas?\s+(?:sponsorship|status|holder|route|expir\w*|valid|until|requirements?|is|runs)\b|\bindefinite leave\b|\bILR\b|\bsettled status\b|\b(?:eligible|authori[sz]ed|entitled|permitted|legally able|legal right|legally entitled) to (?:live and )?work\b|\bimmigration\b|\bcitizenship\b|\bwork(?:ing)? rights\b|\bwork(?:ing)? authori[sz]ation\b|\bBRP\b|\bshare code\b/i;

export function mentionsRightToWork(s: string): boolean {
  return RTW_RE.test(s) || /\bvisa\b/.test(s);
}

export type StripResult = { text: string; removed: string[] };

// Line-based sections (experience, skills): a line that mentions the status
// goes as a whole — a bullet never carries anything else worth keeping there.
export function stripRightToWorkLines(text: string): StripResult {
  const removed: string[] = [];
  const kept = text.split("\n").filter((line) => {
    if (line.trim() && mentionsRightToWork(line)) {
      removed.push(line.trim());
      return false;
    }
    return true;
  });
  return { text: collapseBlankRuns(kept).join("\n"), removed };
}

// Prose (summary, cover letter): only the offending sentence goes; the line
// keeps its other sentences. Paragraph breaks survive; a paragraph left
// empty disappears.
export function stripRightToWorkSentences(text: string): StripResult {
  const removed: string[] = [];
  const kept = text.split("\n").map((line) => {
    if (!line.trim() || !mentionsRightToWork(line)) return line;
    const sentences = splitSentences(line);
    const keep = sentences.filter((s) => {
      if (mentionsRightToWork(s)) {
        removed.push(s.trim());
        return false;
      }
      return true;
    });
    return keep.join(" ").trim();
  });
  return { text: collapseBlankRuns(kept).join("\n"), removed };
}

// Projects come as { "0": [bullets], "1": [...] } (or a selected-project
// shape carrying `bullets`); a bullet that mentions the status is dropped.
export function stripRightToWorkBullets(projects: unknown): { projects: unknown; removed: string[] } {
  const removed: string[] = [];
  const filterList = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.filter((b) => {
          if (typeof b === "string" && mentionsRightToWork(b)) {
            removed.push(b.trim());
            return false;
          }
          return true;
        })
      : list;
  if (Array.isArray(projects)) return { projects: projects.map(filterList), removed };
  if (projects && typeof projects === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(projects as Record<string, unknown>)) out[k] = filterList(v);
    return { projects: out, removed };
  }
  return { projects, removed };
}

function splitSentences(line: string): string[] {
  // A sentence ends at . ! or ? followed by whitespace and a capital, digit
  // or opening quote; "e.g. this" and "v2.1" don't split.
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim() && out.length > 0 && !out[out.length - 1].trim()) continue;
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}
