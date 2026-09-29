// Text for the mock interviewer's voice, and what the candidate's spoken
// answer says about itself. Import-free (node:test).
//
// speakable() turns written text into what a British speaker says: the voice
// engines read "£45,000" and "45000" badly (HeadTTS reads 10,001–999,999 digit
// by digit, as zip codes), "%" as "percent", and "CV" as a word. The
// interviewer's lines always go through it before synthesis.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function underThousand(n: number): string {
  if (n < 100) return underHundred(n);
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${underHundred(rest)}` : ""}`;
}

// British cardinal words: "one hundred and fifty", "two thousand and five",
// "forty-five thousand three hundred".
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${numberToWords(-n)}`;
  if (!Number.isInteger(n)) {
    const [whole, frac] = String(n).split(".");
    return `${numberToWords(Number(whole))} point ${[...frac].map((d) => ONES[Number(d)]).join(" ")}`;
  }
  if (n < 1000) return underThousand(n);
  const scales: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
  for (const [size, name] of scales) {
    if (n >= size) {
      const head = Math.floor(n / size);
      const rest = n % size;
      const tail = rest === 0 ? "" : rest < 100 ? ` and ${underHundred(rest)}` : ` ${numberToWords(rest)}`;
      return `${numberToWords(head)} ${name}${tail}`;
    }
  }
  return String(n);
}

// "2026" → "twenty twenty-six", "2005" → "two thousand and five".
export function yearToWords(y: number): string {
  if (y >= 2000 && y < 2010) return numberToWords(y);
  const hi = Math.floor(y / 100), lo = y % 100;
  return lo === 0 ? `${underHundred(hi)} hundred` : `${underHundred(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : underHundred(lo)}`;
}

const SCALE_WORD: Record<string, string> = { k: "thousand", m: "million", bn: "billion", b: "billion" };

// Letters said one by one ("C V"), unless the acronym is spoken as a word.
const SAID_AS_WORD = new Set(["STAR", "NASA", "SQL", "GIF", "JSON", "REST", "SAAS", "OKR", "OKRS", "DEVOPS", "NATO", "SCRUM", "AGILE"]);
const SPOKEN_AS: Record<string, string> = { SQL: "sequel", JSON: "jason", SAAS: "sass", OKR: "O K R", OKRS: "O K Rs" };

export function speakable(text: string): string {
  let s = String(text || "");
  s = s
    .replace(/\be\.g\.,?/gi, "for example,")
    .replace(/\bi\.e\.,?/gi, "that is,")
    .replace(/\betc\./gi, "and so on.")
    .replace(/\s&\s/g, " and ")
    .replace(/CI\/CD/g, "C I C D")
    .replace(/\b24\/7\b/g, "twenty-four seven");
  // Money: "£45,000", "£45k", "£1.5m", "£40–45k" (a range keeps its scale).
  s = s.replace(/£\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn)\b)?\s?(?:-|–|to)\s?£?\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn)\b)?/gi, (_m, a, sa, b, sb) => {
    const scale = (sb || sa || "").toLowerCase();
    const word = scale ? ` ${SCALE_WORD[scale]}` : "";
    return `${numberToWords(Number(String(a).replace(/,/g, "")))}${sa ? ` ${SCALE_WORD[String(sa).toLowerCase()]}` : word} to ${numberToWords(Number(String(b).replace(/,/g, "")))}${word} pounds`;
  });
  s = s.replace(/£\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn)\b)?/gi, (_m, a, scale) => {
    const n = Number(String(a).replace(/,/g, ""));
    return `${numberToWords(n)}${scale ? ` ${SCALE_WORD[String(scale).toLowerCase()]}` : ""} pounds`;
  });
  // "2k users", "1.5m requests"
  s = s.replace(/\b(\d+(?:\.\d+)?)(k|m|bn)\b/gi, (_m, a, scale) => `${numberToWords(Number(a))} ${SCALE_WORD[String(scale).toLowerCase()]}`);
  s = s.replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_m, a) => `${numberToWords(Number(String(a).replace(/,/g, "")))} per cent`);
  s = s.replace(/(\d[\d,]*)\+/g, (_m, a) => `${numberToWords(Number(String(a).replace(/,/g, "")))} plus`);
  // Ordinals: "1st", "22nd", "90th"
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_m, a) => ordinalWords(Number(a)));
  // Years stand alone; other numbers become words.
  s = s.replace(/\b(19|20)\d{2}\b/g, (y) => yearToWords(Number(y)));
  s = s.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g, (n) => numberToWords(Number(n.replace(/,/g, ""))));
  // Acronyms.
  s = s.replace(/\b[A-Z]{2,5}s?\b/g, (w) => {
    const plural = /[A-Z]s$/.test(w);
    const base = plural ? w.slice(0, -1) : w;
    if (SPOKEN_AS[base]) return SPOKEN_AS[base] + (plural ? "s" : "");
    if (SAID_AS_WORD.has(base)) return w;
    return [...base].join(" ") + (plural ? "s" : "");
  });
  return s.replace(/\s{2,}/g, " ").trim();
}

function ordinalWords(n: number): string {
  const irregular: Record<number, string> = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth" };
  if (irregular[n]) return irregular[n];
  const words = numberToWords(n);
  if (n % 10 !== 0 && n > 20 && irregular[n % 10]) return words.replace(/[a-z]+$/, irregular[n % 10]);
  if (/y$/.test(words)) return words.replace(/y$/, "ieth");
  return `${words}th`;
}

const ABBREVIATIONS = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|approx|no|Ltd|Inc|e\.g|i\.e|etc))$/i;

// Sentences for synthesis, so the first one can play while the rest are made.
export function splitSentences(text: string): string[] {
  const src = String(text || "").replace(/\s+/g, " ").trim();
  if (!src) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    const next = src[i + 1];
    if (next !== undefined && next !== " ") continue; // "Node.js", "3.5"
    const before = src.slice(start, i);
    if (c === "." && ABBREVIATIONS.test(before)) continue;
    const after = src.slice(i + 2);
    if (after && !/^["“'‘(]?[A-Z0-9£]/.test(after)) continue;
    out.push(src.slice(start, i + 1).trim());
    start = i + 2;
  }
  if (start < src.length) out.push(src.slice(start).trim());
  return out.filter(Boolean);
}

export function wordCount(text: string): number {
  return (String(text || "").match(/[A-Za-z0-9£$%'’-]+/g) ?? []).length;
}

// Filler a spoken answer carries. "like" is left out: it is too often a verb.
const FILLER_RE = /\b(um+|uh+|erm+|er|hmm+|you know|sort of|kind of|basically|i mean)\b/gi;
export function countFillers(text: string): { count: number; found: string[] } {
  const found = (String(text || "").match(FILLER_RE) ?? []).map((f) => f.toLowerCase());
  return { count: found.length, found: [...new Set(found)] };
}

const short = (t: string, max: number) => wordCount(t) > 0 && wordCount(t) <= max;

// "Sorry, could you repeat that?" — answered on the page, no model call.
export function isRepeatRequest(text: string): boolean {
  return short(text, 14) && /\b(repeat|say (?:that|it) again|rephrase|pardon|come again|didn'?t (?:catch|hear)|what was the question)\b/i.test(text);
}

// "Can I have a moment?" — the page waits, no model call.
export function isThinkingRequest(text: string): boolean {
  return short(text, 12) && /\b(?:(?:can|could|may) i (?:have|take) (?:a|one) (?:moment|second|minute|sec)|give me (?:a|one) (?:moment|second|minute|sec)|let me think)\b/i.test(text);
}

// "No, I think you've covered everything" at the close.
export function isNoQuestions(text: string): boolean {
  if (!short(text, 22)) return false;
  if (/\?/.test(text)) return false;
  return /\b(no(?:pe)?\b|not really|nothing (?:else|from me|more)|that'?s (?:all|everything|it)|no (?:more )?questions|you(?:'ve| have) covered|i(?:'m| am) (?:good|fine|all set))/i.test(text);
}
