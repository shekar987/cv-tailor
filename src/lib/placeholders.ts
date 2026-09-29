// Template text a model leaves when it wants a figure the CV does not give:
// "Reduced load time by X%", "[NUMBER] users", "<Company>", "TBC". A CV or
// letter that reaches an employer with one of these is worse than one with
// no figure at all, so every generated section is checked (lib/quality for
// bullets and the /app notice, lib/supportCheck for the summary and letter).
// Import-free: runs on the server, in the browser and under node:test.

// The experience step's bullet ids ("[R1.3]") count too: every check here
// runs after lib/bulletIds has stripped them, so one that is still there is
// a marker about to reach an employer (a paid eval run on 29 Sep had six).

const PATTERNS: RegExp[] = [
  // Anything in square, angle or curly brackets: "[X%]", "[Company Name]",
  // "<N>", "{metric}". Real CV prose never brackets a word this way.
  /\[[^\]\n]{1,40}\]/g,
  /<[A-Za-z][A-Za-z %_-]{0,30}>/g,
  /\{[A-Za-z][A-Za-z %_-]{0,30}\}/g,
  // X or N standing in for a number: "by X%", "X% faster", "£XK", "XX users".
  /\b(?:X{1,3}|N)\s?%/g,
  /[£$€]\s?X{1,3}(?:[kKmM]\b|\b)/g,
  // …but never the company X ("at X (formerly Twitter)") or "X-ray".
  /\b(?:by|to|of|over|than|from|across|for)\s+X{1,3}(?![\w%-])(?!\s*\()/g,
  /\bX{1,3}\+?\s+(?:users?|customers?|clients?|requests?|transactions?|hours?|days?|weeks?|months?|minutes?|seconds?|ms|percent|times|engineers?|people|projects?|services|tests?)\b/g,
  // Instructions left in the text.
  /\b(?:TBC|TBD|TODO|TKTK)\b/g,
  /\b(?:add|insert|include)\s+(?:a\s+|the\s+|your\s+)?(?:metric|figure|number|percentage|result|company(?:\s+name)?|role(?:\s+title)?|name)(?:\s+here)?\b/gi,
  /\blorem ipsum\b/gi,
];

// Every placeholder in the text, in order of appearance, each once.
export function placeholderHits(text: unknown): string[] {
  const str = typeof text === "string" ? text : "";
  if (!str) return [];
  const found: { at: number; end: number; hit: string }[] = [];
  for (const re of PATTERNS) {
    for (const m of str.matchAll(re)) {
      const at = m.index ?? 0;
      found.push({ at, end: at + m[0].length, hit: m[0].trim() });
    }
  }
  // "[X%]" is one placeholder, not "[X%]" and "X%", and "to XX users" one,
  // not two: overlapping matches merge into one span.
  const spans: { at: number; end: number }[] = [];
  for (const f of found.sort((a, b) => a.at - b.at)) {
    const last = spans[spans.length - 1];
    if (last && f.at < last.end) last.end = Math.max(last.end, f.end);
    else spans.push({ at: f.at, end: f.end });
  }
  return [...new Set(spans.map((s) => str.slice(s.at, s.end).trim()))];
}

export function hasPlaceholder(text: unknown): boolean {
  return placeholderHits(text).length > 0;
}
