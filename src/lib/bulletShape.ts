// The shape rules a single bullet is held to, in code (30 Sep audit, Phase
// 2): at most MAX_BULLET_LINES printed lines, no filler word twice, no
// repeated word stem ("Architected and layered … using a layered
// architecture" — a rewrite the tailor produced on 30 Sep that the master
// bullet never had). Shared by lib/quality (the lint that drives the one
// regeneration and the "Before you send" notice) and lib/bulletIds (an
// experience edit that breaks a rule the master bullet kept reverts to the
// master wording). Import-free.

// ~10.5pt Calibri across the usable measure — the same figure the page
// estimate (lib/cvDensity) and the prompts' "two printed lines" use.
export const CHARS_PER_LINE = 95;
export const MAX_BULLET_LINES = 2;

function plain(text: string): string {
  return (text || "").replace(/\*\*/g, "").replace(/^\s*(?:[•\-*]\s+)/, "").replace(/\s+/g, " ").trim();
}

// How many printed lines a bullet takes.
export function bulletLines(text: string, charsPerLine = CHARS_PER_LINE): number {
  const t = plain(text);
  return t ? Math.max(1, Math.ceil(t.length / charsPerLine)) : 0;
}

export function isTooLong(text: string): boolean {
  return bulletLines(text) > MAX_BULLET_LINES;
}

// The filler words recruiters read as machine-written (the owner's ATS
// brief, 29 Sep). "driven" alone is left out: "event-driven" and
// "data-driven" are real engineering terms.
export const INFLATION_WORDS = [
  "expert", "cutting-edge", "world-class", "best-in-class", "state-of-the-art", "innovative", "dynamic", "passionate",
  "results-driven", "seamless", "seamlessly", "robust", "leveraging", "leverage", "leveraged", "synergy", "synergies",
  "guru", "ninja", "rockstar", "highly skilled", "proven track record", "go-getter", "self-starter", "thought leader",
  "production-grade", "mission-critical", "at scale", "end-to-end", "hands-on", "game-changing", "disruptive",
  "spearheaded", "spearheading", "pioneered", "pioneering", "revolutionised", "revolutionized", "transformative",
  "synergised", "synergized", "fostered", "fostering", "delved", "delve", "testament", "highly motivated",
  "strategic thinker", "excellent communication skills", "streamlined", "landscape",
];
const INFLATION_RE = new RegExp(`\\b(?:${INFLATION_WORDS.map((w) => w.replace(/[-/]/g, "[-\\s]?")).join("|")})\\b`, "gi");

export function inflationHits(text: unknown): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of String(typeof text === "string" ? text : "").matchAll(INFLATION_RE)) {
    const w = m[0].toLowerCase().replace(/\s+/g, "-");
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

// A filler word used twice in the one bullet.
export function fillerTwice(text: string): string | null {
  return inflationHits(text).find((h) => h.count >= 2)?.word ?? null;
}

// A crude stem: one common suffix off, and only a stem long enough to be a
// real word ("layered"/"layer" → "layer", "architected"/"architecture" →
// "architect", "optimised"/"optimisation" → "optimis"). Short technical
// nouns ("API", "test") never reach the length and are not flagged.
const STOP = new Set(["with", "from", "into", "that", "this", "using", "used", "across", "through", "their", "which", "while", "where", "these", "those", "than", "then", "over", "under", "about", "after", "before", "between", "within", "without"]);
// "ation" before anything longer: "optimisation" and "optimised" both stem to "optimis".
const SUFFIXES = ["ation", "tion", "ure", "ings", "ing", "ed", "es", "s", "ly"];
export function stemWord(word: string): string {
  const w = word.toLowerCase();
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 5 && w.endsWith(s)) return w.slice(0, -s.length);
  }
  return w;
}
const MIN_STEM = 5;

// The first stem two different positions of the bullet share, or null.
export function repeatedStem(text: string): string | null {
  const words = plain(text).toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 5 && !STOP.has(w));
  const seen = new Map<string, string>();
  for (const w of words) {
    const s = stemWord(w);
    if (s.length < MIN_STEM) continue;
    if (seen.has(s)) return seen.get(s) === w ? w : `${seen.get(s)} / ${w}`;
    seen.set(s, w);
  }
  return null;
}
