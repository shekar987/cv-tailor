// A stale to-do closes itself (4 Nov 2026, Chunk 12). Import-free, tests/autoClose.
//
// On 2 Nov Etleap's form said "Your response has been recorded", and "upload CV +
// Submit" stayed open for two more days. So a confirmation written to a row closes
// its open submission items. Two limits keep this from closing the wrong thing:
//
//   - Only NEW text counts. A row's notes keep "Application submitted" from the day
//     of applying; reading the whole text would close every later assessment the
//     moment it was added.
//   - Only a submission-shaped item closes. Visa's screening answers are confirmed by
//     "Your response has been recorded" while its HackerRank test is still to come;
//     SalesApe has two tasks due together. Anything else stays open and is named, so
//     the user decides.

export const CONFIRMATION_PHRASES = ["your response has been recorded", "application submitted", "thanks for applying"] as const;

/** The kinds a confirmation can close. */
export const AUTO_CLOSE_KINDS = ["screening_questions", "deadline"] as const;

function occurrences(text: string, phrase: string): number {
  return text.toLowerCase().split(phrase).length - 1;
}

/** The first confirmation phrase in a text. */
export function confirmationIn(text: string | null | undefined): string | null {
  const t = text ?? "";
  return CONFIRMATION_PHRASES.find((p) => occurrences(t, p) > 0) ?? null;
}

/** The confirmation an edit added: a phrase written more times than before. */
export function confirmationAdded(before: string | null | undefined, after: string | null | undefined): string | null {
  const b = before ?? "";
  const a = after ?? "";
  return CONFIRMATION_PHRASES.find((p) => occurrences(a, p) > occurrences(b, p)) ?? null;
}

export function closesOnConfirmation(kind: string): boolean {
  return (AUTO_CLOSE_KINDS as readonly string[]).includes(kind);
}

type Closed = { id: string; title: string };

/** The one sentence the toast shows. */
export function autoCloseMessage(closed: readonly Closed[], stillOpen: readonly string[]): string {
  const names = closed.map((c) => `"${c.title}"`).join(", ");
  const left = stillOpen.length > 0 ? ` Still open: ${stillOpen.join(", ")}.` : "";
  return closed.length > 0 ? `Your notes say this was submitted, so ${names} closed.${left}` : left.trim();
}
