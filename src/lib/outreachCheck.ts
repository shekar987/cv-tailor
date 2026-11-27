// Outreach check: runs before sending a follow-up, cold email, DM or letter.
// Catches the mistakes that cost real interviews in the week of 20–25 Nov 2026:
//   - numbers not in the master CV (like "150 automated tests" on 25 Nov)
//   - retired phrases the user removed from their CV
//   - availability claims that belong on a form, not in outreach text
//   - follow-ups to closed rows or rows with a pending rejection
//   - ATS / no-reply recipients
//   - repeated stock phrases used across too many recent messages
//   - first-person experience sentences the master CV does not support
//
// Pure function, no side effects, no model call, no network. Import-free from
// external packages. The route reads the master CV and row from the database;
// this lib receives them already loaded (master text is never trusted from the body).
//
// Reuses existing guards:
//   - lib/retiredClaims  → retired phrase detection
//   - lib/rightToWorkText → availability sentence detection (mentionsAvailability)
//   - lib/claims         → figure extraction (extractFigures)
//   - lib/contactCheck   → ATS / no-reply detection (isAutomatedOrParserEmail)
//   - lib/followupsDue   → pending ending detection (hasPendingEnding)
//   - lib/tracker        → live status set (LIVE_STATUSES)
//   - lib/supportCheck   → loose content-word matching (contentOverlap, contentWords)

import { applyRetired, type RetiredClaim } from "./retiredClaims.ts";
import { mentionsAvailability } from "./rightToWorkText.ts";
import { extractFigures } from "./claims.ts";
import { isAutomatedOrParserEmail } from "./contactCheck.ts";
import { hasPendingEnding } from "./followupsDue.ts";
import { LIVE_STATUSES } from "./tracker.ts";
import { contentOverlap, contentWords } from "./supportCheck.ts";

export type OutreachKind = "follow_up" | "cold_email" | "dm" | "letter";

/** A tracker row, enough for the status/pending checks. */
export type OutreachRow = {
  status: string;
  pending_outcome?: unknown;
};

/** One issue found in the outreach text. */
export type OutreachFlag = {
  code: string;
  phrase: string;
  fix: string;
};

export type OutreachCheckInput = {
  text: string;
  kind: OutreachKind;
  /** The email address the message will be sent to. */
  recipient?: string;
  /** The tracker row being followed up on (follow_up only; not required for cold_email/dm). */
  row?: OutreachRow;
  /** Other outreach texts sent recently (for repeat detection). */
  recentTexts?: string[];
  /** The user's master CV text — read server-side, never from the body. */
  masterText: string;
  /** The user's own retired phrases (from user_settings.preferences.retiredClaims). */
  retiredClaims?: readonly RetiredClaim[];
};

export type OutreachCheckResult = {
  /** True when there are no blocking issues. Warns are still listed even when ok. */
  ok: boolean;
  blocks: OutreachFlag[];
  warns: OutreachFlag[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A numeric string is "in" the master CV when the decimal digits of the number
// appear verbatim in it. "150" matches "150 engineers", "1500" does not.
function numericPart(figKey: string, figText: string): string {
  // figKey may include a normalized unit suffix like "200 staff", "7.95 s", "40%", "£2.3m".
  const m = (figKey || figText).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}

// ── 8-word sliding-window repeat detection ────────────────────────────────────

const WINDOW = 8;

function extractWindows(text: string): string[] {
  // Normalize to lower-case word tokens.
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < WINDOW) return [];
  const windows: string[] = [];
  for (let i = 0; i <= words.length - WINDOW; i++) {
    windows.push(words.slice(i, i + WINDOW).join(" "));
  }
  return windows;
}

function countOccurrences(phrase: string, texts: readonly string[]): number {
  const p = phrase.toLowerCase();
  return texts.filter((t) => t.toLowerCase().includes(p)).length;
}

// ── First-person experience sentence detection ────────────────────────────────

// Verbs that assert a past action — not intent ("I would"), not state ("I am").
const EXPERIENCE_RE = /^I (?:built|created|developed|shipped|delivered|led|launched|wrote|designed|implemented|used|worked|ran|managed|reduced|increased|improved|automated|integrated|set up|mentored|deployed|refactored|migrated|architected|fixed|added|removed|found|made|spent|helped)/i;
const MIN_OVERLAP_OUTREACH = 0.3;

// ── Main checker ──────────────────────────────────────────────────────────────

export function checkOutreach(input: OutreachCheckInput): OutreachCheckResult {
  const { text, kind, recipient, row, recentTexts, masterText, retiredClaims = [] } = input;
  const blocks: OutreachFlag[] = [];
  const warns: OutreachFlag[] = [];

  // ── 1. Row status (follow_up only) ────────────────────────────────────────
  if (kind === "follow_up" && row) {
    const statusOk = LIVE_STATUSES.has(row.status.toLowerCase());
    const hasPending = hasPendingEnding(row.pending_outcome);
    if (!statusOk || hasPending) {
      blocks.push({
        code: "closed_row",
        phrase: row.status,
        fix: "This application is closed or waiting for your confirmation — do not send a follow-up.",
      });
    }
  }

  // ── 2. ATS / no-reply recipient ───────────────────────────────────────────
  if (recipient && isAutomatedOrParserEmail(recipient)) {
    blocks.push({
      code: "automated_recipient",
      phrase: recipient,
      fix: "This address belongs to an automated system. Find a named contact to email instead.",
    });
  }

  // ── 3. Retired claims ─────────────────────────────────────────────────────
  const { report } = applyRetired(text, retiredClaims);
  for (const phrase of report.removed) {
    blocks.push({
      code: "retired_claim",
      phrase,
      fix: `Remove "${phrase}" — it is on your never-say list.`,
    });
  }
  for (const { from, to } of report.replaced) {
    warns.push({
      code: "retired_phrasing",
      phrase: from,
      fix: `Replace "${from}" with "${to}".`,
    });
  }

  // ── 4. Availability claims ────────────────────────────────────────────────
  for (const sentence of splitSentences(text)) {
    if (mentionsAvailability(sentence)) {
      blocks.push({
        code: "availability_claim",
        phrase: sentence.slice(0, 120),
        fix: "Remove availability claims from outreach text — state them on the application form instead.",
      });
    }
  }

  // ── 5. Numbers not in master CV ───────────────────────────────────────────
  const masterClean = masterText.replace(/,/g, "");
  for (const fig of extractFigures(text)) {
    const num = numericPart(fig.key, fig.text);
    const numRe = num ? new RegExp(`(?<!\\d)${num.replace(/\./g, "\\.")}(?!\\d)`) : null;
    if (num && numRe && !numRe.test(masterClean)) {
      const display = fig.text.trim() || num;
      warns.push({
        code: "unsupported_number",
        phrase: display,
        fix: `Check "${display}" is in your main CV before sending — it was not found there.`,
      });
    }
  }

  // ── 6. Repeated stock phrases (8+ words, 3+ recent texts) ─────────────────
  if (recentTexts && recentTexts.length > 0) {
    const windows = extractWindows(text);
    const warned = new Set<string>();
    for (const win of windows) {
      if (warned.has(win)) continue;
      const count = countOccurrences(win, recentTexts);
      if (count >= 3) {
        warned.add(win);
        warns.push({
          code: "repeated_phrase",
          phrase: win.length > 80 ? win.slice(0, 80) + "…" : win,
          fix: `Rewrite this — used ${count} times in recent outreach, recruiters notice repeated lines.`,
        });
      }
    }
  }

  // ── 7. First-person experience sentences not in master CV ─────────────────
  const masterLines = masterText.split(/\n/).filter(Boolean);
  for (const sentence of splitSentences(text)) {
    if (!EXPERIENCE_RE.test(sentence.trim())) continue;
    if (contentWords(sentence).length < 4) continue;
    const overlap = contentOverlap(sentence, masterLines);
    if (overlap < MIN_OVERLAP_OUTREACH) {
      warns.push({
        code: "untraced_claim",
        phrase: sentence.slice(0, 120),
        fix: "Check this claim is in your main CV — the words do not match any line there.",
      });
    }
  }

  return { ok: blocks.length === 0, blocks, warns };
}
