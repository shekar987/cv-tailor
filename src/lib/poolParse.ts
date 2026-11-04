// The old free-text pool, read into cards for the user to check (4 Nov 2026, Chunk 14).
// Nothing is lost silently: every line lands on a card, or in `leftover`, which the
// review screen shows. The text stays the source until the user confirms. Tests in
// tests/projectPool; relative imports so node:test can run it.
import { BULLET_RE, LINK_RE, YEAR_ONLY_RE, isProjectHeader, isTechLine } from "./evidenceMap.ts";
import { splitTrailingDate } from "./projectDate.ts";
import type { PoolCard } from "./projectPool.ts";

const TECH_LABEL_RE = /^(?:tech(?:nologies)?(?:\s*stack)?|stack|built with|tools)\s*:\s*/i;
// "Personal portfolio project modelled on a real-world brief": what kind of project it is.
const LABEL_LINE_RE = /^(?:personal|portfolio|side|solo|university|academic|group|team|open[- ]source|freelance|client|final[- ]year|research|dissertation|hackathon)\b.*\bproject\b/i;
const BRACKET_LABEL_RE = /\s*\(([^()]*\bproject\b[^()]*)\)\s*$/i;
const MAX_LABEL_WORDS = 14;

// Split outside brackets: "Supabase (Postgres, Auth), Vercel" is two.
function splitOutsideBrackets(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,|;·]/.test(ch)) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((t) => t.trim()).filter(Boolean);
}

const LINK_ITEM_RE = /^(?:github|gitlab|live|demo|website|repo|url)\b|https?:\/\/|\b[\w-]+\.(?:app|com|io|dev|co\.uk)\b/i;

// A tech line can carry links too: "Tech Stack: React, Vercel | GitHub | Live: example.app".
function readTech(card: PoolCard, text: string) {
  const items = splitOutsideBrackets(text);
  card.tech.push(...items.filter((t) => !LINK_ITEM_RE.test(t)));
  const links = items.filter((t) => LINK_ITEM_RE.test(t));
  if (links.length > 0) card.links.push(links.join(" | "));
}

function isLabelLine(segment: string): boolean {
  return LABEL_LINE_RE.test(segment) && segment.split(/\s+/).length <= MAX_LABEL_WORDS;
}

function datesFrom(text: string): { start: string; end: string; ongoing: boolean } {
  const parts = text.split(/\s*(?:[–—-]|\bto\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const ongoing = /^(?:present|current|now|ongoing)$/i.test(parts[1]);
    return { start: parts[0], end: ongoing ? "" : parts[1], ongoing };
  }
  return { start: "", end: parts[0] ?? "", ongoing: false };
}

function blankCard(id: string, name: string): PoolCard {
  return { id, name, start: "", end: "", ongoing: false, tech: [], body: "", label: "", links: [], pinned: false };
}

export type ParsedPool = { cards: PoolCard[]; leftover: string[] };

export function parsePoolText(text: string): ParsedPool {
  const cards: PoolCard[] = [];
  const leftover: string[] = [];
  let card: PoolCard | null = null;
  let body: string[] = [];
  let prevWasHeader = false;
  let inBullet = false;
  let sawBlank = false;

  const close = () => {
    if (card) card.body = body.join("\n").trim();
    body = [];
  };

  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ").trim();
    if (!line) {
      inBullet = false;
      sawBlank = true;
      if (body.length > 0 && body[body.length - 1] !== "") body.push("");
      continue;
    }
    const flat = line.replace(/\s{2,}/g, " ");
    const looksNamed = !!splitTrailingDate(line).date || /\s[—–|·]\s/.test(flat);
    const headerShaped = isProjectHeader(flat, prevWasHeader, inBullet) || (!prevWasHeader && !inBullet && !BULLET_RE.test(line) && line.length <= 140 && BRACKET_LABEL_RE.test(line));
    // A short line right under a project's name and tech is its first line of text, not a
    // new project, unless a blank line or a name's own marks say otherwise.
    const stillThisCard = !!card && body.length === 0 && !sawBlank && !looksNamed;
    if (headerShaped && !stillThisCard) {
      close();
      sawBlank = false;
      const { title, date } = splitTrailingDate(line);
      const bracket = BRACKET_LABEL_RE.exec(title);
      // "(GitHub)" after a name is a link's word, not part of the name.
      const name = (bracket ? title.slice(0, bracket.index) : title).replace(/\s*\|\s*$/, "").replace(/\s*\(\s*github\s*\)\s*$/i, "").trim();
      card = blankCard(`card-${cards.length + 1}`, name.replace(/\s*\|\s*/g, " – "));
      if (bracket) card.label = bracket[1].trim();
      if (date) Object.assign(card, datesFrom(date));
      cards.push(card);
      prevWasHeader = true;
      inBullet = false;
      continue;
    }
    if (!card) {
      leftover.push(line);
      continue;
    }
    const wasHeader: boolean = prevWasHeader;
    prevWasHeader = false;
    if (YEAR_ONLY_RE.test(line) && !hasDate(card)) {
      Object.assign(card, datesFrom(line));
      prevWasHeader = wasHeader;
      continue;
    }
    if (TECH_LABEL_RE.test(line)) {
      readTech(card, line.replace(TECH_LABEL_RE, ""));
      continue;
    }
    if (LINK_RE.test(line) && !BULLET_RE.test(line)) {
      card.links.push(line);
      continue;
    }
    // "Personal portfolio project ... | Tech: React, Node.js": the label, then the stack.
    const segments = line.split(/\s*\|\s*/);
    if (wasHeader && isLabelLine(segments[0])) {
      card.label = card.label || segments[0];
      for (const seg of segments.slice(1)) {
        if (TECH_LABEL_RE.test(seg)) readTech(card, seg.replace(TECH_LABEL_RE, ""));
        else body.push(seg);
      }
      prevWasHeader = wasHeader;
      continue;
    }
    // A bare list of tools, with or without a subtitle above it, is the card's tech once.
    if ((wasHeader || card.tech.length === 0) && !BULLET_RE.test(line) && isTechLine(line)) {
      readTech(card, line);
      continue;
    }
    inBullet = BULLET_RE.test(line) || inBullet;
    body.push(line);
  }
  close();
  return { cards, leftover };
}

function hasDate(card: PoolCard): boolean {
  return !!card.start || !!card.end || card.ongoing;
}
