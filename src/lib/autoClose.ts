// A stale to-do closes itself (4 Nov 2026, Chunk 12). Import-free, tests/autoClose.
//
// On 2 Nov Etleap's form said "Your response has been recorded", and "upload CV +
// Submit" stayed open for two more days. So a confirmation written to a row closes
// its open submission items. Three limits keep this from closing the wrong thing:
//
//   - Only NEW text counts. A row's notes keep "Application submitted" from the day
//     of applying; reading the whole text would close every later assessment the
//     moment it was added.
//   - The new text must say it happened. "Application submitted? Not yet", "Chase 7
//     days after application submitted" and "Thanks for applying. Please complete the
//     screening questions" all carry a phrase and confirm nothing.
//   - Only a submission-shaped item closes: screening questions, and a deadline whose
//     title is about submitting. Visa's screening answers are confirmed by "Your
//     response has been recorded" while its HackerRank test is still to come; SalesApe
//     has two tasks due together. Anything else stays open and is named, so the user
//     decides.

export const CONFIRMATION_PHRASES = ["your response has been recorded", "application submitted", "thanks for applying"] as const;

// The whole added text is asking for something, whatever else it says.
const ASKS_FOR_MORE_RE = /\b(?:please|next step|next steps|deadline|due|complete (?:the|your)|to complete|invited?)\b/i;
// A sentence with one of these is talking about a confirmation, not reporting one.
const NOT_DONE_RE = /\?|\b(?:not|yet|please|complete|after|once|when|until|if|before|chase|follow[- ]?up|next|need|needs|todo|will|should|must)\b/i;
const SUBMISSION_TITLE_RE = /\b(?:submit|submission|upload|apply|application|form|questions|answers|send)\b/i;

function occurrences(text: string, phrase: string): number {
  return text.toLowerCase().split(phrase).length - 1;
}

/** The first confirmation phrase in a text. */
export function confirmationIn(text: string | null | undefined): string | null {
  const t = text ?? "";
  return CONFIRMATION_PHRASES.find((p) => occurrences(t, p) > 0) ?? null;
}

// What an edit wrote: the text between what the two versions share at each end.
function addedText(before: string, after: string): string {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.slice(start, after.length - end);
}

/** The confirmation an edit added: a phrase written more times than before, and meant. */
export function confirmationAdded(before: string | null | undefined, after: string | null | undefined): string | null {
  const b = before ?? "";
  const a = after ?? "";
  const phrase = CONFIRMATION_PHRASES.find((p) => occurrences(a, p) > occurrences(b, p));
  if (!phrase) return null;
  // Widened to whole sentences, because the two versions can share part of the phrase's sentence.
  const start = Math.max(0, a.indexOf(addedText(b, a)));
  const from = Math.max(a.lastIndexOf("\n", start), a.lastIndexOf(". ", start));
  const added = addedText(b, a);
  const stretch = a.slice(from < 0 ? 0 : from + 1, start + added.length);
  const whole = occurrences(stretch, phrase) > 0 ? stretch : added;
  if (ASKS_FOR_MORE_RE.test(whole)) return null;
  const sentences = whole.split(/(?<=[.!?])\s+|\n+/);
  return sentences.some((s) => occurrences(s, phrase) > 0 && !NOT_DONE_RE.test(s)) ? phrase : null;
}

export const AUTO_CLOSE_KINDS = ["screening_questions", "deadline"] as const;

/** Whether a confirmation can close this item. */
export function closesOnConfirmation(kind: string, title: string): boolean {
  if (kind === "screening_questions") return true;
  return kind === "deadline" && SUBMISSION_TITLE_RE.test(title);
}

type Closed = { id: string; title: string };

/** The one sentence the toast shows. */
export function autoCloseMessage(closed: readonly Closed[], stillOpen: readonly string[]): string {
  const names = closed.map((c) => `"${c.title}"`).join(", ");
  const left = stillOpen.length > 0 ? ` Still open: ${stillOpen.join(", ")}.` : "";
  return closed.length > 0 ? `Your notes say this was submitted, so ${names} closed.${left}` : left.trim();
}
