// British English for every generated text (30 Sep audit, Phase 2): a
// deterministic pass over the common American forms — -ize/-yze, -or,
// -er, -ense, -og, single-l past tenses, and "program" only where it means a
// scheme, never software. Case is kept ("Optimized" → "Optimised", "ANALYZE"
// → "ANALYSE"); an address, a path, a word with a digit or an internal
// capital (a product name) is never touched. The keyword matcher folds both
// spellings to one token (lib/atsMatch), so search visibility is unchanged.
// Import-free.

export type SpellingChange = { from: string; to: string };

// -ize words that are -ize in British English too.
const IZE_KEEP = new Set(["size", "sizes", "sized", "sizing", "seize", "seizes", "seized", "seizing", "prize", "prizes", "prized", "capsize", "capsized", "resize", "resized", "resizing", "downsize", "downsized", "downsizing", "oversize", "oversized"]);
const OUR_STEMS = "behavi|col|fav|flav|harb|hon|hum|lab|neighb|rum|sav|vap|vig|endeav|arm|ard|cand|clam|demean|ferv|od|parl|ranc|splend|tum|val";
const SCHEME_BEFORE = "graduate|training|development|apprenticeship|placement|mentoring|onboarding|internship|rotation|research|degree|masters|master's|master’s|leadership|exchange|rotational|graduate-scheme|early careers|early-careers";
const SCHEME_AFTER = "manager|management|director|coordinator|lead|leads|of study";

const RULES: [RegExp, string][] = [
  // -yze → -yse
  [/\b([a-z]{2,})yz(e|es|ed|ing|er|ers)\b/gi, "$1ys$2"],
  // -ization → -isation, -izer → -iser, -ize → -ise (stem of three letters or more)
  [/\b([a-z]{3,})iz(ation|ations|ational|ationally|er|ers|able|ably|ing|ed|es|e)\b/gi, "$1is$2"],
  // -or → -our (a closed list; "honorary", "laboratory", "humorous" stay)
  [new RegExp(String.raw`\b(${OUR_STEMS})or(s|ed|ing|al|ally|able|ite|ites|ful|fully|less|ably|ism|ist|ists|ise|ised|ises|ising|iser|isers|isation|isations)?\b`, "gi"), "$1our$2"],
  // -er → -re (the units and a few nouns; "meter" alone is British for the device)
  [/\b(cent|calib)ering\b/gi, "$1ring"],
  [/\b(cent|calib|fib|theat)ered\b/gi, "$1red"],
  [/\b(cent|lit|fib|theat|calib|kilomet|millimet|centimet|micromet)er(s)?\b/gi, "$1re$2"],
  // -ense → -ence
  [/\b(defen|offen|preten)se(s|less)?\b/gi, "$1ce$2"],
  // catalog → catalogue
  [/\bcatalog(s|ed|ing|ue)?\b/gi, "catalogue$1"],
  // a doubled l before the suffix
  [/\b(travel|cancel|model|label|signal|total|fuel|level|channel|counsel|marvel|rival|tunnel|panel)(ed|ing|er|ers)\b/gi, "$1l$2"],
  [/\b(enrol|fulfil|instal|distil|instil)l(ment|ments)\b/gi, "$1$2"],
  [/\bskillful(ly)?\b/gi, "skilful$1"],
  [/\backnowledgment(s)?\b/gi, "acknowledgement$1"],
  [/\baging\b/gi, "ageing"],
  [/\bgray(s|er|est|ish)?\b/gi, "grey$1"],
  [/\baluminum\b/gi, "aluminium"],
  // program → programme only for a scheme, never software
  [new RegExp(String.raw`\b(${SCHEME_BEFORE})\s+program(s|me|mes)?\b`, "gi"), "$1 programme$2"],
  [new RegExp(String.raw`\bprogram(s)?\s+(${SCHEME_AFTER})\b`, "gi"), "programme$1 $2"],
];

// A word the pass never touches: an address, a path, an email, a version
// or model number, a product name with an internal capital.
function protectedToken(t: string): boolean {
  return /[\/@]|https?:|\d|^[A-Z][a-z]+[A-Z]|^[a-z]+[A-Z]/.test(t) || /\.[a-z]{2,}$/i.test(t);
}

function keepCase(from: string, to: string): string {
  if (from === from.toUpperCase() && /[A-Z]/.test(from)) return to.toUpperCase();
  if (from[0] === from[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

// Case kept word by word for the two-word rules ("Graduate Program" → "Graduate Programme").
function keepCaseWords(from: string, to: string): string {
  const f = from.split(" ");
  return to.split(" ").map((w, i) => (f[i] ? keepCase(f[i], w) : w)).join(" ");
}

function applyRules(chunk: string, changes: SpellingChange[]): string {
  let out = chunk;
  for (const [re, to] of RULES) {
    out = out.replace(re, (m: string, ...groups: unknown[]) => {
      if (IZE_KEEP.has(m.toLowerCase())) return m;
      const g = groups.slice(0, -2).map((x) => (typeof x === "string" ? x : ""));
      const repl = to.replace(/\$(\d)/g, (_s, n: string) => g[Number(n) - 1] ?? "");
      const cased = keepCase(m, repl.toLowerCase() === repl ? repl : repl);
      if (cased !== m) changes.push({ from: m, to: cased });
      return cased;
    });
  }
  return out;
}

// A job header ("Title | Employer | Dates") is rule 8 territory: verbatim.
const HEADER_LINE = /^[^•\-*\s].*\|.*\|/;
// A capitalised word that is not the first of its sentence is a name
// ("Center Parcs", "Honor Technology", "Gray Matter", "Belize") — never
// respelt. The first word of a sentence, line or bullet may be ("Optimized
// the…" → "Optimised the…").
const SENTENCE_END = /[.!?:;•]$|^[-–—*•]$|^\d+[.)]$/;
function sentenceStart(prev: string | null): boolean {
  return prev === null || prev === "" || SENTENCE_END.test(prev) || /\n/.test(prev);
}
function isCapitalised(tok: string): boolean {
  const w = tok.replace(/^[("'“‘[]+/, "");
  return /^[A-Z][a-z]/.test(w);
}

export type ToBritishOptions = {
  /** Words never respelt (an employer's or the company's name), compared case-insensitively. */
  protect?: Iterable<string>;
};

// The text in British English, and every word that changed.
export function toBritish(text: string, options: ToBritishOptions = {}): { text: string; changes: SpellingChange[] } {
  if (!text) return { text, changes: [] };
  const changes: SpellingChange[] = [];
  const protect = new Set([...(options.protect ?? [])].map((w) => w.toLowerCase().replace(/[^a-z0-9'’-]/g, "")));
  const guarded = (tok: string) => protect.has(tok.toLowerCase().replace(/[^a-z0-9'’-]/g, ""));
  const lines = text.split("\n").map((line) => {
    if (HEADER_LINE.test(line.trim())) return line;
    let prev: string | null = null;
    const converted = line
      .split(/(\s+)/)
      .map((tok) => {
        if (tok.trim() === "") return tok;
        const keep = protectedToken(tok) || guarded(tok) || (isCapitalised(tok) && !sentenceStart(prev));
        const out = keep ? tok : applyRules(tok, changes);
        prev = tok;
        return out;
      })
      .join("");
    // The scheme rules span two words; run them once over the joined line too.
    return RULES.slice(-2).reduce((acc, [re, to]) => acc.replace(re, (m: string, ...groups: unknown[]) => {
      const g = groups.slice(0, -2).map((x) => (typeof x === "string" ? x : ""));
      const repl = keepCaseWords(m, to.replace(/\$(\d)/g, (_s, n: string) => g[Number(n) - 1] ?? ""));
      if (repl !== m) changes.push({ from: m, to: repl });
      return repl;
    }), converted);
  });
  return { text: lines.join("\n"), changes };
}

// Every string in a JSON-shaped value, in British English.
export function toBritishDeep<T>(value: T, changes: SpellingChange[] = [], options: ToBritishOptions = {}): T {
  if (typeof value === "string") {
    const r = toBritish(value, options);
    changes.push(...r.changes);
    return r.text as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => toBritishDeep(v, changes, options)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toBritishDeep(v, changes, options);
    return out as T;
  }
  return value;
}
