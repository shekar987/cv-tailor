// Proper nouns in a generated cover letter must come from somewhere: the job
// description, the company research or the master CV. A real letter said
// "available for on-site work in Shoreditch" when Shoreditch appeared in none
// of them - the model invented a place. This finds capitalised names in the
// letter, checks each against the sources, and hands the tailor route the
// offending sentences to regenerate (or, failing that, drop).
//
// Deliberately conservative: sentence-initial words are ignored unless they
// start a multi-word name, short all-caps tokens (acronyms - the claims
// registry covers skills) are ignored, and letter furniture ("Dear Hiring
// Manager", "Kind regards", months) is ignored. Import-free.

const WORD = String.raw`[A-Z][A-Za-z'’]+(?:[-.][A-Za-z'’]+)*`;
const CONNECTOR = String.raw`(?:of|the|and|de|del|da|van|von|&)`;
const RUN_RE = new RegExp(String.raw`\b${WORD}(?:\s+(?:${CONNECTOR}\s+)?${WORD})*`, "g");

const FURNITURE = new Set(
  [
    "i", "i'm", "i've", "i'd", "i'll", "my", "me", "dear", "hiring", "manager", "hiring manager", "team", "sir", "madam", "kind", "regards", "kind regards",
    "best", "best regards", "sincerely", "yours", "yours sincerely", "yours faithfully", "thank", "thanks", "thank you", "please", "cv", "résumé", "resume",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "ltd", "limited", "inc", "plc", "llc", "the", "a", "an", "this", "that", "these", "those", "your", "you", "we", "our", "it", "its",
    "as", "at", "in", "on", "for", "with", "from", "to", "by", "and", "or", "but", "so", "if", "when", "while", "after", "before", "during", "over",
    "having", "being", "given", "beyond", "across", "within", "through", "here", "there", "what", "which", "who", "how", "why",
    "engineer", "engineering", "developer", "software", "backend", "frontend", "full", "stack", "senior", "junior", "lead", "role", "position",
  ].map((w) => w.toLowerCase())
);

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[-–—/]/g, " ")
    // A full stop ends a word ("at Seamflow.") but stays inside one ("Node.js").
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/[^a-z0-9+#&. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isFurniture(run: string): boolean {
  const f = fold(run);
  if (FURNITURE.has(f)) return true;
  // A run made only of furniture words ("Kind Regards", "Hiring Manager").
  return f.split(" ").every((w) => FURNITURE.has(w));
}

function isAcronym(run: string): boolean {
  return /^[A-Z0-9.&-]{1,5}$/.test(run);
}

// Capitalised names in the letter, sentence by sentence. A single word that
// opens a sentence is a capital by grammar, not a name, so it is skipped
// unless the same word also appears capitalised elsewhere mid-sentence.
export function properNounRuns(text: string): string[] {
  const seen = new Map<string, string>();
  const midSentence = new Set<string>();
  const candidates: { run: string; initial: boolean }[] = [];
  for (const s of sentences(text)) {
    RUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUN_RE.exec(s)) !== null) {
      // "At Brane Group": a sentence-initial function word is capitalised by
      // grammar and must not be glued onto the name that follows it.
      const words = m[0].replace(/[.,;:]+$/, "").split(/\s+/);
      while (words.length > 1 && FURNITURE.has(fold(words[0]))) words.shift();
      const run = words.join(" ");
      if (!run || isAcronym(run) || isFurniture(run)) continue;
      const initial = m.index === 0 || /^["“(]/.test(s.slice(0, m.index).trim() + s[m.index - 1]);
      if (!initial || words.length > 1) midSentence.add(fold(run));
      candidates.push({ run, initial });
    }
  }
  for (const c of candidates) {
    const key = fold(c.run);
    if (!key) continue;
    // A sentence-initial single word is grammar, not a name — unless it is
    // spelled like a product (an internal capital or digit: RideX, FastAPI)
    // or appears capitalised mid-sentence elsewhere.
    const productLike = /^[A-Z][a-z]*[A-Z0-9]/.test(c.run);
    if (c.initial && c.run.split(/\s+/).length === 1 && !midSentence.has(key) && !productLike) continue;
    if (!seen.has(key)) seen.set(key, c.run);
  }
  return [...seen.values()];
}

// Names the sources do not contain. A multi-word name is supported when the
// whole phrase is found; otherwise each word must be found somewhere ("Kind
// Regards" aside, that is how "Acme Ltd" survives a JD that says "Acme").
export function unsupportedProperNouns(text: string, sources: (string | null | undefined)[]): string[] {
  const corpus = ` ${sources.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(fold).join(" ")} `;
  const supported = (phrase: string) => corpus.includes(` ${phrase} `);
  return properNounRuns(text).filter((run) => {
    const f = fold(run);
    if (supported(f)) return false;
    const words = f.split(" ").filter((w) => !FURNITURE.has(w) && w.length > 1);
    return !(words.length > 0 && words.every(supported));
  });
}

export function sentencesNaming(text: string, nouns: string[]): string[] {
  if (nouns.length === 0) return [];
  const keys = nouns.map(fold).filter(Boolean);
  return sentences(text).filter((s) => {
    const f = ` ${fold(s)} `;
    return keys.some((k) => f.includes(` ${k} `));
  });
}

// The deterministic fallback: the offending sentences removed, paragraph
// structure kept, a paragraph left empty removed with it.
export function dropSentences(text: string, offending: string[]): string {
  if (offending.length === 0) return text;
  const drop = new Set(offending.map((s) => s.trim()));
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split(/\n/)
        .map((line) => sentences(line).filter((s) => !drop.has(s)).join(" "))
        .filter((line) => line.trim())
        .join("\n")
    )
    .filter((p) => p.trim())
    .join("\n\n");
}
