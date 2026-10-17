// The letter's style-shaped pieces (16 Oct 2026, lib/formatStyles — the
// CareerSet letter): the requirements its four numbered points may be built
// on, the interest line's reason held to the posting and the research, the
// tidy of a numbered list a removal left holes in, and where the
// right-to-work statement goes in the close. Deterministic; UKJI's letter
// never reaches these (its style carries no opening, no renumbering and
// places the statement as it always did).
//
// Imports ./supportCheck.ts (the one content-word overlap) and the evidence
// map's types, so it runs under node:test.
import { contentOverlap } from "./supportCheck.ts";
import type { EvidenceMap, EvidenceItem } from "./evidenceMap.ts";

// The requirements a numbered point may be built on: the ones the master CV
// shows — paid work, a personal project, or a listed skill — in importance
// order, each with where the evidence is. A point on anything else names a
// gap, which the JD-copy guard removes (lib/jdCopyGuard).
export const MAX_ELIGIBLE_POINTS = 12;
export function eligiblePointsBlock(map: EvidenceMap | null | undefined): string {
  const ok = (map?.items ?? []).filter((i) => i.status === "experience" || i.status === "project" || i.status === "listed");
  if (ok.length === 0) return "";
  const rank: Record<EvidenceItem["importance"], number> = { required: 0, preferred: 1, keyword: 2 };
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const i of [...ok].sort((a, b) => rank[a.importance] - rank[b.importance])) {
    const k = i.term.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const where = i.where ? `: ${i.where}` : "";
    const note =
      i.status === "experience"
        ? `paid work shows it${where}`
        : i.status === "project"
          ? `only a personal project shows it${where} — the point must name the project and say it is one`
          : "listed on the CV only — name it, never describe work done with it";
    lines.push(`- ${i.term} (${note})`);
    if (lines.length >= MAX_ELIGIBLE_POINTS) break;
  }
  return `\nELIGIBLE REQUIREMENTS for the numbered points — the posting's own words, each one the master CV shows; a point on any other requirement is removed by a deterministic check:\n${lines.join("\n")}\n`;
}

// ── The interest line ────────────────────────────────────────────────────────

// Below this share of the reason's content words in the posting and the
// research, the reason was not taken from them.
export const INTEREST_MIN_OVERLAP = 0.5;

// The reason after the opening ("I am particularly interested in this role
// because <reason>."), or null when the sentence is not the interest line.
export function interestReason(sentence: string, opening: string): string | null {
  const s = sentence.trim();
  if (!opening || !s.toLowerCase().startsWith(opening.toLowerCase())) return null;
  return s.slice(opening.length).replace(/[.!?]+$/, "").trim();
}

export function interestLineSupported(sentence: string, opening: string, sources: (string | null | undefined)[]): boolean {
  const reason = interestReason(sentence, opening);
  if (reason === null) return true;
  if (!reason) return false;
  return contentOverlap(reason, sources.filter((s): s is string => typeof s === "string" && s.trim() !== "")) >= INTEREST_MIN_OVERLAP;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/;

// The letter with the interest line removed when its reason is not in the
// posting or the research; `line` is the sentence as found (null when the
// letter has none), `kept` whether it stayed.
export function checkInterestLine(letter: string, opening: string, sources: (string | null | undefined)[]): { text: string; line: string | null; kept: boolean } {
  if (!opening || !letter) return { text: letter, line: null, kept: false };
  const lines = letter.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const sentences = lines[i].trim().split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
    const at = sentences.findIndex((s) => interestReason(s, opening) !== null);
    if (at === -1) continue;
    const line = sentences[at];
    if (interestLineSupported(line, opening, sources)) return { text: letter, line, kept: true };
    const rest = sentences.filter((_, j) => j !== at).join(" ");
    if (rest) lines[i] = rest;
    else lines.splice(i, 1);
    return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n"), line, kept: false };
  }
  return { text: letter, line: null, kept: false };
}

// ── The numbered points ──────────────────────────────────────────────────────

const NUMBERED_RE = /^(\s*)(\d{1,2})\.(\s+)(\S.*)$/;
const BARE_NUMBER_RE = /^\s*\d{1,2}\.\s*$/;

// A removal (the fact check, the proper-noun drop, the page fit) can leave a
// numbered line as a bare "2.": those go, and the points that remain are
// renumbered 1..k in order.
export function tidyNumberedPoints(letter: string): { text: string; bareRemoved: number; renumbered: boolean; points: number } {
  const lines = letter.replace(/\r/g, "").split("\n");
  const kept = lines.filter((l) => !BARE_NUMBER_RE.test(l));
  const bareRemoved = lines.length - kept.length;
  let n = 0;
  let renumbered = false;
  const out = kept.map((l) => {
    const m = NUMBERED_RE.exec(l);
    if (!m) return l;
    n += 1;
    if (Number(m[2]) === n) return l;
    renumbered = true;
    return `${m[1]}${n}.${m[3]}${m[4]}`;
  });
  const changed = bareRemoved > 0 || renumbered;
  return { text: changed ? out.join("\n").replace(/\n{3,}/g, "\n\n") : letter, bareRemoved, renumbered, points: n };
}

export function countNumberedPoints(letter: string): number {
  return letter.replace(/\r/g, "").split("\n").filter((l) => NUMBERED_RE.test(l)).length;
}

// ── The close ────────────────────────────────────────────────────────────────

// The statement at the START of the close paragraph (the line carrying the
// thanks sentence): "I have the permanent right to work … Thank you for
// considering my application. I would welcome …". Null when the letter has
// no such line (the caller then places it as its own paragraph).
export function insertIntoClose(letter: string, sentence: string, thanksLine: string): string | null {
  if (!thanksLine) return null;
  const lines = letter.replace(/\r/g, "").split("\n");
  const i = lines.findIndex((l) => l.includes(thanksLine));
  if (i === -1) return null;
  if (lines[i].includes(sentence)) return letter;
  lines[i] = `${sentence} ${lines[i].trim()}`;
  return lines.join("\n");
}

// The lines the page fit may not trim: a style's fixed lines (its furniture
// regexes) and the close paragraph.
export function protectedLetterLines(letter: string, furniture: readonly RegExp[], thanksLine: string): string[] {
  return letter
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && (furniture.some((re) => re.test(l)) || (thanksLine !== "" && l.includes(thanksLine))));
}
