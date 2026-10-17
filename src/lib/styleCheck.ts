// A style's own format check (16 Oct 2026, lib/formatStyles — CareerSet):
// our deterministic read of the style's rules over the finished document,
// never a score and never a model. Shown on /app under "Before you send",
// re-run on the edited preview, stored with the Applied snapshot. It never
// blocks a download: the honesty layer does that, this only says what the
// rules see. The route runs it on the finished run; the page on the preview
// as edited (the same function, the same rules from ids.ts STYLE_RULES).
//
// Imports ./quality.ts (the word count), ./stylePass.ts (the verbs and the
// banned words) and ./letterStyle.ts (the numbered points), so it runs in
// the browser and under node:test.
import { cvWordCount, type ProfileLike } from "./quality.ts";
import { overusedVerbs, bannedWordsIn } from "./stylePass.ts";
import { countNumberedPoints, interestReason } from "./letterStyle.ts";
import type { StyleRules } from "./formatStyles/ids.ts";

export type StyleCheckStatus = "pass" | "fail" | "na";
export type StyleCheckItem = { key: string; label: string; status: StyleCheckStatus; detail: string };
export type StyleCheckInput = {
  sections: { summary?: unknown; skills?: unknown; experience?: unknown; projects?: unknown };
  profile: ProfileLike;
  coverLetter: string;
  // The page count the document really takes (the built PDF's, else the estimate); null = not measured.
  pages: number | null;
};

const BULLET_RE = /^\s*[•\-*]\s+/;
const DATE_LINE_RE = /^\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}$|^[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}$/;
// A full stop that closes an abbreviation or an ellipsis is not a bullet's own.
const KEEP_DOT = /(?:\b(?:etc|e\.g|i\.e|vs|approx|no|ltd|inc|jr|sr|st|co)|\.)\.$/i;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const words = (t: string) => t.replace(/\*\*/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

export function documentBullets(sections: StyleCheckInput["sections"]): string[] {
  const exp = str(sections.experience)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => BULLET_RE.test(l))
    .map((l) => l.replace(BULLET_RE, "").replace(/\*\*/g, "").trim());
  const proj = sections.projects && typeof sections.projects === "object" && !Array.isArray(sections.projects)
    ? Object.values(sections.projects as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v.filter((b): b is string => typeof b === "string") : [])).map((b) => b.replace(BULLET_RE, "").replace(/\*\*/g, "").trim())
    : [];
  return [...exp, ...proj];
}

// The letter's body lines: the date line the preview adds on top is not the letter.
function letterBody(letter: string): string {
  const lines = letter.replace(/\r/g, "").split("\n");
  if (lines.length && DATE_LINE_RE.test(lines[0].trim())) return lines.slice(1).join("\n");
  return letter;
}

export function checkStyle(rules: StyleRules, input: StyleCheckInput): StyleCheckItem[] {
  const { limits, lint, render, letter: letterRules } = rules;
  const bullets = documentBullets(input.sections);
  const letter = letterBody(input.coverLetter || "");
  const items: StyleCheckItem[] = [];
  const add = (key: string, label: string, status: StyleCheckStatus, detail: string) => items.push({ key, label, status, detail });

  // Bullets in total.
  if (limits.bullets.total) {
    const { min, max } = limits.bullets.total;
    add("bullets", "Bullets in total", bullets.length >= min && bullets.length <= max ? "pass" : "fail", `${bullets.length} across experience and projects; this style wants ${min} to ${max}.`);
  }
  // Total words.
  if (limits.cv.maxWords !== null) {
    const n = cvWordCount(input.sections, input.profile, render);
    add("words", "Total words", n <= limits.cv.maxWords ? "pass" : "fail", `${n} words on the document; this style wants ${limits.cv.maxWords} or fewer.`);
  }
  // Pages.
  if (input.pages === null) add("pages", "Pages", "na", "Not measured yet.");
  else add("pages", "Pages", input.pages <= 2 ? "pass" : "fail", `${input.pages} page${input.pages === 1 ? "" : "s"}; this style wants at most 2.`);
  // The longest bullet.
  if (limits.bullets.maxWords !== null) {
    const longest = bullets.reduce<{ text: string; n: number }>((best, b) => (words(b) > best.n ? { text: b, n: words(b) } : best), { text: "", n: 0 });
    add("longest", "The longest bullet", longest.n <= limits.bullets.maxWords ? "pass" : "fail", bullets.length ? `${longest.n} words: "${longest.text.length > 90 ? `${longest.text.slice(0, 89)}…` : longest.text}"; this style wants ${limits.bullets.maxWords} or fewer.` : "No bullets.");
  }
  // Verbs used more than the cap.
  if (lint.verbCap !== null) {
    const over = overusedVerbs(bullets, lint.verbCap);
    add("verbs", `Verbs opening more than ${lint.verbCap} bullets`, over.length === 0 ? "pass" : "fail", over.length ? over.map((v) => `${v.verb} ×${v.count}`).join(", ") : "Every opening verb is used at most twice.");
  }
  // Banned words in the CV bullets.
  if (lint.bannedWords.length) {
    const found = new Map<string, number>();
    for (const b of bullets) for (const w of bannedWordsIn(b, lint.bannedWords)) found.set(w, (found.get(w) ?? 0) + 1);
    add("banned", "Banned words in the CV", found.size === 0 ? "pass" : "fail", found.size ? [...found.entries()].map(([w, n]) => `${w}${n > 1 ? ` ×${n}` : ""}`).join(", ") : "None of the style's banned words in a bullet.");
  }
  // Banned words in the letter.
  if (lint.letterBanned.length) {
    const found = letter ? bannedWordsIn(letter, lint.letterBanned) : [];
    add("letterBanned", "Banned words in the letter", !letter ? "na" : found.length === 0 ? "pass" : "fail", !letter ? "No letter." : found.length ? found.join(", ") : "None of the style's banned words in the letter.");
  }
  // Bullets ending in a full stop.
  if (!render.trailingFullStop) {
    const dotted = bullets.filter((b) => b.endsWith(".") && !KEEP_DOT.test(b));
    add("fullStops", "Bullets ending in a full stop", dotted.length === 0 ? "pass" : "fail", dotted.length ? `${dotted.length}: "${dotted[0].length > 80 ? `${dotted[0].slice(0, 79)}…` : dotted[0]}"${dotted.length > 1 ? " and more" : ""}` : "No bullet ends in a full stop.");
  }
  // Contact details printed as plain text.
  if (render.contactLinks === "addresses") {
    const p = input.profile ?? {};
    const any = !!(p.linkedin || p.github || p.website);
    add("contact", "Contact details printed as plain text", any ? "pass" : "na", any ? "LinkedIn, GitHub and portfolio addresses are printed in full, not behind a label." : "No LinkedIn, GitHub or portfolio address on the profile.");
  }
  // Letter word count.
  {
    const n = letter ? words(letter) : 0;
    add("letterWords", "Letter word count", !letter ? "na" : n >= limits.letter.minWords && n <= limits.letter.maxWords ? "pass" : "fail", !letter ? "No letter." : `${n} words; this style wants ${limits.letter.minWords} to ${limits.letter.maxWords}.`);
  }
  // The interest line, the thank-you line, the numbered points.
  if (letterRules.interestOpening) {
    const has = letter.split(/\n+/).some((l) => l.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(£$€])/).some((s) => interestReason(s, letterRules.interestOpening!) !== null));
    add("interest", "The interest line", !letter ? "na" : has ? "pass" : "fail", !letter ? "No letter." : has ? `A sentence opens "${letterRules.interestOpening}".` : `No sentence opens "${letterRules.interestOpening}" — it was not written, or its reason was not in the posting and it was removed.`);
  }
  if (letterRules.renumberPoints) {
    const thanks = letter.includes(letterRules.thanksLine);
    add("thanks", "The thank-you line", !letter ? "na" : thanks ? "pass" : "fail", !letter ? "No letter." : thanks ? `"${letterRules.thanksLine}" is there.` : `"${letterRules.thanksLine}" is missing from the close.`);
    const points = countNumberedPoints(letter);
    add("points", `${letterRules.points} numbered points`, !letter ? "na" : points === letterRules.points ? "pass" : "fail", !letter ? "No letter." : `${points} numbered point${points === 1 ? "" : "s"}; this style wants ${letterRules.points}.`);
  }
  return items;
}

export type StyleCheckSummary = { pass: number; fail: number; na: number };
export function summarizeStyleCheck(items: readonly StyleCheckItem[]): StyleCheckSummary {
  const s: StyleCheckSummary = { pass: 0, fail: 0, na: 0 };
  for (const i of items) s[i.status]++;
  return s;
}

// A stored check (the Applied snapshot, written by our own client) re-bounded
// on read: known statuses, bounded strings, at most this many items.
export const MAX_STYLE_CHECK_ITEMS = 16;
export function normalizeStyleCheck(v: unknown): StyleCheckItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: StyleCheckItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== "string" || typeof r.label !== "string" || (r.status !== "pass" && r.status !== "fail" && r.status !== "na")) continue;
    out.push({ key: r.key.slice(0, 40), label: r.label.slice(0, 80), status: r.status, detail: typeof r.detail === "string" ? r.detail.slice(0, 200) : "" });
    if (out.length >= MAX_STYLE_CHECK_ITEMS) break;
  }
  return out.length ? out : null;
}
