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
  [new RegExp(String.raw`\b(${OUR_STEMS})or(s|ed|ing|al|ally|able|ite|ites|ful|fully|less|ably|ism|ist|ists)?\b`, "gi"), "$1our$2"],
  // -er → -re (the units and a few nouns; "meter" alone is British for the device)
  [/\b(cent|lit|fib|theat|calib|kilomet|millimet|centimet|micromet)er(s|ed|ing)?\b/gi, "$1re$2"],
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

// The text in British English, and every word that changed.
export function toBritish(text: string): { text: string; changes: SpellingChange[] } {
  if (!text) return { text, changes: [] };
  const changes: SpellingChange[] = [];
  const out = text
    .split(/(\s+)/)
    .map((tok) => (tok.trim() === "" || protectedToken(tok) ? tok : applyRules(tok, changes)))
    .join("");
  // The scheme rules span two words; run them once over the joined text too.
  const joined = RULES.slice(-2).reduce((acc, [re, to]) => acc.replace(re, (m: string, ...groups: unknown[]) => {
    const g = groups.slice(0, -2).map((x) => (typeof x === "string" ? x : ""));
    const repl = to.replace(/\$(\d)/g, (_s, n: string) => g[Number(n) - 1] ?? "");
    if (repl !== m) changes.push({ from: m, to: repl });
    return repl;
  }), out);
  return { text: joined, changes };
}

// Every string in a JSON-shaped value, in British English.
export function toBritishDeep<T>(value: T, changes: SpellingChange[] = []): T {
  if (typeof value === "string") {
    const r = toBritish(value);
    changes.push(...r.changes);
    return r.text as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => toBritishDeep(v, changes)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toBritishDeep(v, changes);
    return out as T;
  }
  return value;
}
