// The cover letter fitted to ONE page (7 Oct 2026, the owner's rule: the
// tailored letter is strictly one page). The route builds the letter's own
// PDF (lib/buildCoverLetterPdf — the download's layout, with the date line
// the preview adds) and, while it runs past one page, removes the last
// sentence of the longest body paragraph and rebuilds. Never touched: the
// salutation, the first body line (the role by name), the sign-off and
// what follows it, and any protected line (the Eligibility right-to-work
// statement). Import-free; `countPages` is the builder, a test passes a fake.

export type LetterFitReport = { target: 1; pagesBefore: number; pagesAfter: number; removed: string[]; fits: boolean };

const SALUTATION_RE = /^dear\b/i;
const SIGNOFF_RE = /^(?:kind|best|warm|warmest)\s+regards,?$|^regards,?$|^yours\s+(?:sincerely|faithfully|truly),?$|^sincerely,?$/i;
export const LETTER_FIT_MAX_REMOVALS = 12;

function sentencesOf(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The lines a trim may touch: body lines after the salutation and before
// the sign-off, except the first body line and the protected ones.
function candidates(lines: string[], protect: Set<string>): number[] {
  const out: number[] = [];
  let seenBody = false;
  let afterSignoff = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || afterSignoff) continue;
    if (SIGNOFF_RE.test(t)) {
      afterSignoff = true;
      continue;
    }
    if (SALUTATION_RE.test(t)) continue;
    if (!seenBody) {
      seenBody = true;
      continue;
    }
    if (protect.has(t)) continue;
    out.push(i);
  }
  return out;
}

export function fitLetterToOnePage(
  letter: string,
  countPages: (text: string) => number,
  opts: { protect?: (string | null | undefined)[]; maxRemovals?: number } = {}
): { text: string; report: LetterFitReport } {
  const protect = new Set((opts.protect ?? []).filter((s): s is string => !!s).map((s) => s.trim()));
  const max = opts.maxRemovals ?? LETTER_FIT_MAX_REMOVALS;
  const lines = (letter || "").replace(/\r/g, "").split("\n");
  const removed: string[] = [];
  const pagesBefore = countPages(lines.join("\n"));
  let pages = pagesBefore;
  while (pages > 1 && removed.length < max) {
    const idxs = candidates(lines, protect);
    if (idxs.length === 0) break;
    // The longest line gives up its last sentence; a line left empty goes.
    const target = idxs.reduce((best, i) => (lines[i].trim().length > lines[best].trim().length ? i : best), idxs[0]);
    const sentences = sentencesOf(lines[target]);
    if (sentences.length === 0) break;
    removed.push(sentences[sentences.length - 1]);
    const rest = sentences.slice(0, -1).join(" ");
    if (rest) lines[target] = rest;
    else {
      lines.splice(target, 1);
      // A blank line that now doubles another goes with it.
      if (target < lines.length && !lines[target].trim() && target > 0 && !lines[target - 1].trim()) lines.splice(target, 1);
    }
    pages = countPages(lines.join("\n"));
  }
  const text = removed.length ? lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() : letter;
  return { text, report: { target: 1, pagesBefore, pagesAfter: pages, removed, fits: pages <= 1 } };
}
