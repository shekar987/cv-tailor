// The project pool as cards (4 Nov 2026, Chunk 14): which projects go on a CV, how many,
// and in what order. Pure, so node:test can run it (tests/projectPool). The code chooses
// now, not the model: a pinned project is always there, and "newest first" means it.
//
// A card keeps its dates as the user wrote them, because a date is a fact: "2024" is never
// printed as "Jan 2024". They are read only to sort. A label prints on the CV every time,
// verbatim, whatever the tailoring step writes, and the same goes for the name and dates.
import { matchAtsKeywords } from "./atsMatch.ts";
import { projectKey } from "./projectLinks.ts";

export type PoolCard = {
  id: string;
  name: string;
  start: string;
  end: string;
  ongoing: boolean;
  tech: string[];
  /** What you did, in your own words. */
  body: string;
  label: string;
  /** Link lines as the pool wrote them, so the links section still reads them. */
  links: string[];
  pinned: boolean;
};

export type PoolCount = "auto" | 1 | 2 | 3 | 4;
export type PoolOrder = "relevance" | "date";
export type PoolSettings = { count: PoolCount; order: PoolOrder };

export const DEFAULT_POOL_SETTINGS: PoolSettings = { count: "auto", order: "relevance" };
export const POOL_COUNT_CHOICES: readonly PoolCount[] = ["auto", 1, 2, 3, 4];
export const MAX_POOL_CARDS = 30;
const MAX_NAME = 200;
const MAX_DATE = 30;
const MAX_TECH_ITEMS = 30;
const MAX_TECH_ITEM = 60;
const MAX_BODY = 6000;
const MAX_LABEL = 160;
const MAX_LINK_LINES = 6;
const MAX_LINK_LINE = 300;
/** On a tight page: the top project keeps three bullets, the others two. */
export const TOP_PROJECT_BULLETS = 3;
export const OTHER_PROJECT_BULLETS = 2;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizePoolSettings(value: unknown): PoolSettings {
  const o = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const count = POOL_COUNT_CHOICES.includes(o.count as PoolCount) ? (o.count as PoolCount) : "auto";
  return { count, order: o.order === "date" ? "date" : "relevance" };
}

/** A stored value re-bounded on read: the user can write their own row. A nameless card is dropped. */
export function normalizePoolCards(value: unknown): PoolCard[] {
  if (!Array.isArray(value)) return [];
  const out: PoolCard[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const name = str(o.name, MAX_NAME).replace(/\s*\|\s*/g, " – ");
    if (!name) continue;
    let id = str(o.id, 60) || `card-${out.length + 1}`;
    if (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    out.push({
      id,
      name,
      start: str(o.start, MAX_DATE),
      end: str(o.end, MAX_DATE),
      ongoing: o.ongoing === true,
      tech: (Array.isArray(o.tech) ? o.tech : []).map((t) => str(t, MAX_TECH_ITEM)).filter(Boolean).slice(0, MAX_TECH_ITEMS),
      body: typeof o.body === "string" ? o.body.trim().slice(0, MAX_BODY) : "",
      label: str(o.label, MAX_LABEL),
      links: (Array.isArray(o.links) ? o.links : []).map((l) => str(l, MAX_LINK_LINE)).filter(Boolean).slice(0, MAX_LINK_LINES),
      pinned: o.pinned === true,
    });
    if (out.length >= MAX_POOL_CARDS) break;
  }
  return out;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as written, on one scale: months since year 0. A bare year reads as its last month. */
export function readPoolDate(text: string): number | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  let m = /^([a-z]{3,9})\.?\s+((?:19|20)\d{2})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3));
    return month < 0 ? null : Number(m[2]) * 12 + month;
  }
  m = /^(\d{1,2})\/((?:19|20)\d{2})$/.exec(t);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? Number(m[2]) * 12 + Number(m[1]) - 1 : null;
  m = /^((?:19|20)\d{2})-(\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  m = /^((?:19|20)\d{2})$/.exec(t);
  return m ? Number(m[1]) * 12 + 11 : null;
}

/** "Ongoing" counts as today. A card with one date reads by that date. */
export function cardEnd(card: Pick<PoolCard, "start" | "end" | "ongoing">, today: Date): number | null {
  if (card.ongoing) return today.getUTCFullYear() * 12 + today.getUTCMonth();
  return readPoolDate(card.end) ?? readPoolDate(card.start);
}

export function hasDates(card: Pick<PoolCard, "start" | "end" | "ongoing">): boolean {
  return card.ongoing || readPoolDate(card.end) !== null || readPoolDate(card.start) !== null;
}

/** The dates as they print, exactly as written. */
export function cardDateLine(card: Pick<PoolCard, "start" | "end" | "ongoing">): string {
  const end = card.ongoing ? "Present" : card.end.trim();
  const start = card.start.trim();
  return start && end ? `${start} – ${end}` : start || end;
}

/** The card's name with its label, verbatim, as the CV heading carries it. */
export function labelledCardName(card: Pick<PoolCard, "name" | "label">): string {
  const label = card.label.trim();
  if (!label || card.name.toLowerCase().includes(label.toLowerCase())) return card.name;
  return `${card.name} (${label})`;
}

// ── Text ────────────────────────────────────────────────────────────────────

/** One card as pool text, the shape the rest of the pipeline already reads. */
export function cardToText(card: PoolCard): string {
  const date = cardDateLine(card);
  const lines = [date ? `${card.name} | ${date}` : card.name];
  if (card.label.trim()) lines.push(card.label.trim());
  if (card.tech.length > 0) lines.push(`Tech: ${card.tech.join(", ")}`);
  lines.push(...card.links);
  if (card.body.trim()) lines.push(card.body.trim());
  return lines.join("\n");
}

export function cardsToPoolText(cards: readonly PoolCard[]): string {
  return cards.map(cardToText).join("\n\n");
}

// ── Choosing ────────────────────────────────────────────────────────────────

export type PoolContext = {
  /** The posting's terms (lib/atsMatch), the same score the CV is held to. */
  keywords?: unknown;
  required?: unknown;
  pageTarget: 1 | 2;
  /** How many jobs the Experience section holds. */
  roles: number;
  today: Date;
};

/** The number Auto means: two on one page (three with 0 or 1 jobs), three on two; never more than the pool holds. */
export function resolveCount(settings: PoolSettings, ctx: Pick<PoolContext, "pageTarget" | "roles">, poolSize: number): number {
  const wanted = settings.count === "auto" ? (ctx.pageTarget === 1 ? (ctx.roles <= 1 ? 3 : 2) : 3) : settings.count;
  return Math.min(wanted, poolSize);
}

export type ChosenCard = { card: PoolCard; matches: string[]; score: number };

function scoreCard(card: PoolCard, ctx: PoolContext): ChosenCard {
  const text = cardToText(card);
  const required = matchAtsKeywords(text, ctx.required).matchedKeywords;
  const keywords = matchAtsKeywords(text, ctx.keywords).matchedKeywords;
  const matches = [...new Set([...required, ...keywords])];
  return { card, matches, score: required.length * 2 + keywords.length };
}

/** The relevance order: the posting's match, then end date, newest first. */
export function byRelevance(a: ChosenCard, b: ChosenCard, today: Date): number {
  return b.score - a.score || (cardEnd(b.card, today) ?? -1) - (cardEnd(a.card, today) ?? -1);
}

/** The date order: end date, newest first, with undated cards last. */
export function byDate(a: ChosenCard, b: ChosenCard, today: Date): number {
  const ae = cardEnd(a.card, today);
  const be = cardEnd(b.card, today);
  if (ae === null && be === null) return b.score - a.score;
  if (ae === null) return 1;
  if (be === null) return -1;
  return be - ae || b.score - a.score;
}

export type PoolSelection = {
  chosen: ChosenCard[];
  /** The number the settings mean for this CV. */
  count: number;
  /** "You pinned 3 but chose 2.", or null. */
  pinWarning: string | null;
};

export function pinWarning(cards: readonly PoolCard[], settings: PoolSettings, count: number): string | null {
  const pinned = cards.filter((c) => c.pinned).length;
  if (pinned <= count) return null;
  return `You pinned ${pinned} but ${settings.count === "auto" ? "Auto chose" : "chose"} ${count}.`;
}

/**
 * The projects for this CV, in order: pinned ones first and always there, then the rest
 * by the chosen order until the number is reached. Pins past the number all stay, and
 * the warning says so.
 */
export function selectCards(cards: readonly PoolCard[], settings: PoolSettings, ctx: PoolContext): PoolSelection {
  const count = resolveCount(settings, ctx, cards.length);
  const compare = settings.order === "date" ? byDate : byRelevance;
  const scored = cards.map((c) => scoreCard(c, ctx));
  // Array.sort is stable: equal cards keep the order the user gave them.
  const sorted = [...scored].sort((a, b) => compare(a, b, ctx.today));
  const pinned = sorted.filter((c) => c.card.pinned);
  const rest = sorted.filter((c) => !c.card.pinned);
  return {
    chosen: [...pinned, ...rest.slice(0, Math.max(0, count - pinned.length))],
    count,
    pinWarning: pinWarning(cards, settings, count),
  };
}

/** "Auto (2) · Most relevant": the line on the tailor page. */
export function poolSummaryLine(settings: PoolSettings, count: number): string {
  return `${settings.count === "auto" ? `Auto (${count})` : count} · ${settings.order === "date" ? "Newest first" : "Most relevant"}`;
}

// ── Holding the model to the choice ─────────────────────────────────────────

export type WrittenProject = { name: string; date: string; tech: string; bullets: string[] };

/** The card's own lines as bullets, when the model wrote none for it. Its words, not new ones. */
function bulletsFromBody(card: PoolCard): string[] {
  return card.body
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[•▪●◦\-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, TOP_PROJECT_BULLETS);
}

/**
 * The chosen cards, in order, with the bullets the model wrote for each. The name, the
 * dates, the tech and the label come from the card: the tailoring step may not drop or
 * reword them, whatever it returned. A project it left out keeps the card's own words.
 */
export function alignWritten(chosen: readonly ChosenCard[], written: readonly WrittenProject[]): WrittenProject[] {
  const byKey = new Map(written.map((w) => [projectKey(w.name), w]));
  return chosen.map(({ card }) => ({
    name: labelledCardName(card),
    date: cardDateLine(card),
    tech: card.tech.join(", "),
    bullets: byKey.get(projectKey(card.name))?.bullets ?? bulletsFromBody(card),
  }));
}

// ── Fitting one page ────────────────────────────────────────────────────────

/** A tight page: the top project keeps three bullets, the others two. */
export function capPoolBullets<P extends { bullets: string[] }>(projects: readonly P[]): P[] {
  return projects.map((p, i) => ({ ...p, bullets: p.bullets.slice(0, i === 0 ? TOP_PROJECT_BULLETS : OTHER_PROJECT_BULLETS) }));
}

/**
 * The last resort when bullets have been reduced and it still runs over: the last project
 * that is not pinned goes, one at a time, and the message says so. A project is never
 * dropped silently, and a pinned one never.
 */
export function dropToFit<P extends { name: string }>(
  projects: readonly P[],
  fits: (projects: P[]) => boolean,
  isPinned: (project: P) => boolean
): { projects: P[]; dropped: string[]; message: string | null } {
  const kept = [...projects];
  const dropped: string[] = [];
  while (!fits(kept) && kept.length > 1) {
    let at = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!isPinned(kept[i])) {
        at = i;
        break;
      }
    }
    if (at < 0) break;
    dropped.push(kept[at].name);
    kept.splice(at, 1);
  }
  const message = dropped.length > 0 ? `${projects.length} projects don't fit on 1 page; showing ${kept.length}. Switch to 2 pages or pick ${kept.length}.` : null;
  return { projects: kept, dropped, message };
}
