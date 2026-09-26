// The cover letter's furniture, fixed deterministically. Letters sent on
// 20 Sep opened "Dear Artificial," (a company addressed as if it were a
// person) and one ended on the bare name with no sign-off; a model can also
// still write its own date line, which the preview then doubles. In the
// body only punctuation is touched: the prompt allows one em-dash and the
// 26 Sep letters carried up to eight — a pattern many recruiters now read as
// machine-written (capEmDashes).
//
// Imports only ./companyMatch.ts (import-free), so it runs under node:test.
import { companyNamesMatch } from "./companyMatch.ts";

export type LetterFixes = { salutation: string | null; signOff: boolean; dateLine: boolean; emDashes?: number };

// At most one em-dash: a parenthetical pair inside a sentence ("workflows —
// dashboards, forms — across") becomes brackets, the first single dash stays
// and any later one becomes a comma.
export function capEmDashes(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let kept = 0;
  const out = text.split("\n").map((line) => {
    if (!line.includes("—")) return line;
    let l = line.replace(/\s*—\s*([^—.!?\n]{1,90}?)\s*—\s*/g, (_m, inner: string) => {
      replaced += 2;
      return ` (${inner.trim()}) `;
    });
    l = l.replace(/\s*—\s*/g, (m) => {
      if (kept === 0) {
        kept++;
        return m;
      }
      replaced++;
      return ", ";
    });
    return l.replace(/ +([,.;:)])/g, "$1").replace(/\( +/g, "(").replace(/ {2,}/g, " ");
  });
  return { text: replaced ? out.join("\n") : text, replaced };
}

const DATE_LINE_RE = /^\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}$|^[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const SALUTATION_RE = /^dear\s+(.+?)\s*,?\s*$/i;
const SIGNOFF_RE = /^(?:kind|best|warm|warmest)\s+regards,?$|^regards,?$|^yours\s+(?:sincerely|faithfully|truly),?$|^sincerely,?$/i;

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normalizeLetter(letter: unknown, opts: { company?: string | null; name?: string | null } = {}): { letter: unknown; fixes: LetterFixes } {
  const fixes: LetterFixes = { salutation: null, signOff: false, dateLine: false };
  if (typeof letter !== "string" || !letter.trim()) return { letter, fixes };
  const lines = letter.replace(/\r/g, "").split("\n");
  const firstIdx = () => lines.findIndex((l) => l.trim() !== "");

  // A date line the model wrote (the app adds today's date itself).
  let i = firstIdx();
  if (i !== -1 && DATE_LINE_RE.test(lines[i].trim())) {
    lines.splice(i, 1);
    fixes.dateLine = true;
  }

  // "Dear Artificial," → "Dear Artificial team,".
  i = firstIdx();
  const company = (opts.company ?? "").trim();
  if (i !== -1) {
    const m = SALUTATION_RE.exec(lines[i].trim());
    if (m && company && companyNamesMatch(m[1], company) && !/\bteam\b|\bhiring\b|\bmanager\b/i.test(m[1])) {
      lines[i] = `Dear ${m[1].trim()} team,`;
      fixes.salutation = lines[i];
    }
  }

  // A sign-off, then the name ("SOMA SHEKAR KEESARI" on a CV header signs as
  // "Soma Shekar Keesari").
  const raw = (opts.name ?? "").replace(/\s+/g, " ").trim();
  const name = raw && raw === raw.toUpperCase() ? raw.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : raw;
  const nonEmpty = lines.map((l, idx) => ({ l: l.trim(), idx })).filter((x) => x.l !== "");
  const signoff = nonEmpty.findIndex((x) => SIGNOFF_RE.test(x.l));
  if (signoff === -1) {
    const last = nonEmpty[nonEmpty.length - 1];
    // The model copies a CV header's capitals ("SOMA SHEKAR KEESARI").
    if (last && name && fold(last.l) === fold(name) && last.l === last.l.toUpperCase() && last.l !== name) {
      lines[last.idx] = name;
    }
    if (last && name && fold(last.l) === fold(name)) {
      lines.splice(last.idx, 0, "Kind regards,");
      fixes.signOff = true;
    } else if (name) {
      lines.push("", "Kind regards,", name);
      fixes.signOff = true;
    }
  } else if (signoff === nonEmpty.length - 1 && name) {
    lines.push(name);
    fixes.signOff = true;
  } else if (name && signoff === nonEmpty.length - 2) {
    const last = nonEmpty[nonEmpty.length - 1];
    if (fold(last.l) === fold(name) && last.l === last.l.toUpperCase() && last.l !== name) lines[last.idx] = name;
  }
  const dashes = capEmDashes(lines.join("\n"));
  if (dashes.replaced) fixes.emDashes = dashes.replaced;
  return { letter: dashes.text.replace(/\n{3,}/g, "\n\n").trim(), fixes };
}
