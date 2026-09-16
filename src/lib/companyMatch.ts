// Is this research about the same company as this job? A JD names the company
// however the recruiter felt like writing it ("Monzo Bank", "Monzo"); the
// research profile names it however the website did. Legal suffixes and
// punctuation are noise; a real containment must be a whole word of at least
// four letters, so "Meta" can never claim "Metaphor Labs" and "Go" can never
// claim "Google". Callers strip placeholders ("Unknown", "N/A") first — that's
// their job, this only compares names.

const NOISE = new Set(["the", "ltd", "limited", "inc", "llc", "plc", "gmbh", "corp", "corporation", "co"]);

export function normalizeCompanyName(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NOISE.has(t))
    .join(" ");
}

export function companyNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 4) return false;
  return ` ${long} `.includes(` ${short} `);
}
