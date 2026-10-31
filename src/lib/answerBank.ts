// The answer bank for application forms (31 Oct 2026, Chunk 6): the
// questions every UK form asks — sponsorship, right to work, start date, full
// time — answered once from the user's own Eligibility answers on Customize
// (lib/knockouts), never guessed and never another user's. "Form answers" on
// /app lists them to copy, and matchQuestion() reads a question pasted from a
// form and says which stored answer fits: QUESTION_BANK holds the questions
// as Workday, SmartRecruiters, Greenhouse and People First phrase them,
// keyed by normalised text (normaliseQuestion) — an exact hit, else the
// closest by shared content words (FUZZY_MIN), else the question's parts.
// answersByQuestion() is the bank with this user's answers filled in.
//
// The wording is the confirmed one: a sponsorship Yes/No is "No" for anyone
// who can work without sponsorship (permanent or time-limited permission)
// and "Yes" for anyone who needs it; the free-text answer is "No sponsorship
// required. I am available immediately for full-time employment." with the
// start date and hours as the Eligibility answer gives them. A time-limited
// permission answering a question about "the future" carries a note to check
// it — the answer itself is not changed.
//
// Consent and criminal-conviction questions are NEVER answered: a declaration
// is the user's own to make, every time. matchQuestion() reports them as
// blocked so the panel can say so instead of offering anything.
//
// Import-free, so it runs under node:test.

export type AnswerKey = "sponsorship" | "right_to_work" | "visa_details" | "start_date" | "full_time";
export type BlockedKind = "consent" | "convictions";

export type AnswerEntry = {
  key: AnswerKey;
  label: string;
  kind: "yes_no" | "text";
  // null when the Eligibility answer it comes from is not given yet.
  answer: string | null;
};

export type QuestionMatch = { key: AnswerKey | null; blocked: BlockedKind | null; asksFuture: boolean };

// The Eligibility fields the bank reads (lib/knockouts Eligibility).
export type AnswerFacts = {
  rightToWork: { status: "full" | "time_limited" | "needs_sponsorship" | "unknown"; permissionEnds?: string | null };
  availability: { status: "now" | "from" | "unknown"; from: string | null };
  canWorkFullTime: "yes" | "no" | "unknown";
};

export const ANSWER_LABELS: Record<AnswerKey, string> = {
  sponsorship: "Do you require visa sponsorship? (Yes / No)",
  right_to_work: "Do you have the right to work in the UK? (Yes / No)",
  visa_details: "Visa / sponsorship details (free text)",
  start_date: "When can you start?",
  full_time: "Can you work full time? (Yes / No)",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthName(ym: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

// "I am available immediately for full-time employment." — from the answers alone.
function availabilityAnswer(f: AnswerFacts): string | null {
  const from = monthName(f.availability.from);
  const when = f.availability.status === "now" ? "immediately" : f.availability.status === "from" && from ? `from ${from}` : null;
  if (!when) return null;
  const hours = f.canWorkFullTime === "yes" ? " for full-time employment" : f.canWorkFullTime === "no" ? " for part-time employment" : "";
  return `I am available ${when}${hours}.`;
}

/** The stored answers, in the order a form usually asks them. */
export function buildAnswerBank(f: AnswerFacts | null | undefined): AnswerEntry[] {
  const status = f?.rightToWork.status ?? "unknown";
  const canWork = status === "full" || status === "time_limited";
  const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");
  const sponsorshipSentence = canWork ? "No sponsorship required." : status === "needs_sponsorship" ? "I will require visa sponsorship." : null;
  const availability = f ? availabilityAnswer(f) : null;
  const entries: AnswerEntry[] = [
    { key: "sponsorship", label: ANSWER_LABELS.sponsorship, kind: "yes_no", answer: yesNo(status === "unknown" ? null : !canWork) },
    { key: "right_to_work", label: ANSWER_LABELS.right_to_work, kind: "yes_no", answer: yesNo(status === "unknown" ? null : canWork) },
    { key: "visa_details", label: ANSWER_LABELS.visa_details, kind: "text", answer: sponsorshipSentence ? [sponsorshipSentence, availability].filter(Boolean).join(" ") : null },
    { key: "start_date", label: ANSWER_LABELS.start_date, kind: "text", answer: availability },
    { key: "full_time", label: ANSWER_LABELS.full_time, kind: "yes_no", answer: !f || f.canWorkFullTime === "unknown" ? null : yesNo(f.canWorkFullTime === "yes") },
  ];
  return entries;
}

// ── Reading a question ──────────────────────────────────────────────────────

// "Do you agree to relocate?" is a real question; "I agree to the privacy
// notice" is a declaration.
const CONSENT_RE =
  /\bconsent\b|\bi\s+agree\b|\bagree\s+to\s+(?:the|our|these|this)\s+(?:terms|privacy|processing|storage|policy|retention)\b|\bprivacy\s+(?:notice|policy|statement)\b|\bgdpr\b|\bdata\s+protection\b|\bprocess(?:ing)?\s+(?:of\s+)?(?:my|your)\s+(?:personal\s+)?data\b|\bterms\s+(?:and|&)\s+conditions\b|\bi\s+(?:confirm|declare|certify)\s+that\b/i;
const CONVICTIONS_RE = /\bconvict(?:ed|ions?)\b|\bcriminal\b|\boffen[cs]es?\b|\bcautions?\b|\bdbs\b|\bdisclosure\s+and\s+barring\b|\brehabilitation\s+of\s+offenders\b|\bunspent\b/i;

const SPONSOR_RE = /\bspons(?:or|orship|ored)\b|\bwork\s+(?:permit|visa)\b|\bvisa\s+(?:to\s+work|support)\b|\bneed\s+a\s+visa\b/i;
const VISA_DETAILS_RE = /\b(?:visa|immigration|residency)\s+(?:status|type|details|situation)\b|\bdescribe\b|\bdetails?\s+of\s+(?:your\s+)?(?:visa|right\s+to\s+work|immigration)\b|\bplease\s+(?:explain|provide|give|state)\b|\bwhat\s+(?:visa|type\s+of\s+visa)\b/i;
const RIGHT_TO_WORK_RE = /\bright\s+to\s+work\b|\b(?:legally\s+)?(?:eligible|entitled|authori[sz]ed|permitted|allowed)\s+to\s+work\b|\bwork\s+authori[sz]ation\b/i;
const START_RE = /\b(?:when\s+(?:can|could|would)\s+you\s+start|start\s+date|earliest\s+(?:possible\s+)?(?:start|date)|available\s+to\s+start|notice\s+period|availability\s+to\s+start|how\s+soon\s+(?:can|could)\s+you)\b/i;
const FULL_TIME_RE = /\bfull[\s-]?time\b|\b(?:37\.5|40|35)\s+hours\b/i;
const YES_NO_START_RE = /^(?:will|do|does|are|is|would|have|has|can|could|did|should)\s+you\b/i;
const TEXT_REQUEST_RE = /\bplease\s+(?:explain|provide|give|state|describe|outline|tell)\b|\bdescribe\b|\bexplain\b|\bdetails?\b|\bwhat\s+(?:is\s+your\s+)?(?:visa|type\s+of)\b/i;
const FUTURE_RE = /\b(?:in\s+the\s+future|future|now\s+or\s+(?:at\s+any\s+(?:point|time)|later)|at\s+any\s+(?:point|time)|going\s+forward|later)\b/i;

// ── The bank: questions as the forms ask them ──────────────────────────────
// Workday, SmartRecruiters, Greenhouse and the Civil Service's People First
// phrase the same few questions a few ways. Each is stored here normalised
// (normaliseQuestion) and keyed to the answer it takes; the answer itself is
// the user's own (buildAnswerBank), never stored here.

/** Lower case, British spelling folded to one form, punctuation and asides gone. */
export function normaliseQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\([^()]*\)/g, " ") // "(e.g. H-1B visa status)", "(Yes/No)"
    .replace(/authoris/g, "authoriz")
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const QUESTION_BANK: Readonly<Record<string, AnswerKey>> = Object.fromEntries(
  (
    [
      // Sponsorship, Yes / No.
      ["Will you now or in the future require sponsorship?", "sponsorship"],
      ["Will you now or in the future require sponsorship for employment visa status?", "sponsorship"],
      ["Do you require visa sponsorship?", "sponsorship"],
      ["Do you require sponsorship to work in the UK?", "sponsorship"],
      ["Will you require visa sponsorship to work in the UK?", "sponsorship"],
      ["Would you need sponsorship to take up this role?", "sponsorship"],
      ["Do you require a Certificate of Sponsorship?", "sponsorship"],
      ["Do you need a work permit to work in the UK?", "sponsorship"],
      ["Do you require a visa to work in the UK?", "sponsorship"],
      // Right to work, Yes / No.
      ["Do you have the right to work in the UK?", "right_to_work"],
      ["Do you have the legal right to work in the United Kingdom?", "right_to_work"],
      ["Are you legally authorised to work in the UK?", "right_to_work"],
      ["Are you eligible to work in the UK?", "right_to_work"],
      ["Are you legally entitled to work in the UK?", "right_to_work"],
      ["Are you eligible to work in the country where this role is based?", "right_to_work"],
      // Free text.
      ["Please provide details of your visa status", "visa_details"],
      ["Please describe your visa and sponsorship requirements", "visa_details"],
      ["What is your current immigration status?", "visa_details"],
      ["What is your right to work status?", "visa_details"],
      ["What type of visa do you hold?", "visa_details"],
      ["When can you start?", "start_date"],
      ["When are you available to start?", "start_date"],
      ["What is your notice period?", "start_date"],
      ["What is your earliest start date?", "start_date"],
      ["Are you able to work full time?", "full_time"],
      ["Can you work full time?", "full_time"],
      ["Are you available to work full time?", "full_time"],
    ] as const
  ).map(([q, key]) => [normaliseQuestion(q), key])
);

const STOP = new Set("a an the to in of for you your do does are is will would can could be this that or and now with on at by any".split(" "));
const contentTokens = (normalised: string) => new Set(normalised.split(" ").filter((t) => t && !STOP.has(t)));

// Dice coefficient over content words: 1 = the same words.
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

// A fuzzy hit needs this much of the content words in common.
export const FUZZY_MIN = 0.6;

/** Which stored answer a form's question asks for; consent and conviction questions are blocked, never answered. */
export function matchQuestion(question: string): QuestionMatch {
  const q = (question || "").replace(/\s+/g, " ").trim();
  const none: QuestionMatch = { key: null, blocked: null, asksFuture: false };
  if (!q) return none;
  if (CONVICTIONS_RE.test(q)) return { ...none, blocked: "convictions" };
  if (CONSENT_RE.test(q)) return { ...none, blocked: "consent" };
  const asksFuture = FUTURE_RE.test(q);

  // 1. The bank, exactly, then fuzzily (the closest bank question).
  const norm = normaliseQuestion(q);
  if (QUESTION_BANK[norm]) return { key: QUESTION_BANK[norm], blocked: null, asksFuture };
  const words = contentTokens(norm);
  let best: { key: AnswerKey; score: number } | null = null;
  for (const [bankQ, key] of Object.entries(QUESTION_BANK)) {
    const score = similarity(words, contentTokens(bankQ));
    if (score >= FUZZY_MIN && (!best || score > best.score)) best = { key, score };
  }
  if (best) return { key: best.key, blocked: null, asksFuture };

  // 2. The wording the bank does not hold yet, by its parts.
  if (SPONSOR_RE.test(q)) {
    // "Please give details of your visa / sponsorship needs" wants the
    // sentence; "Will you … require sponsorship for employment visa status?"
    // (Greenhouse's standard wording) is still a Yes/No.
    const yesNo = YES_NO_START_RE.test(q);
    return { key: !yesNo && TEXT_REQUEST_RE.test(q) ? "visa_details" : "sponsorship", blocked: null, asksFuture };
  }
  if (VISA_DETAILS_RE.test(q) && /\b(?:visa|immigration|right\s+to\s+work|residency)\b/i.test(q)) return { key: "visa_details", blocked: null, asksFuture };
  if (RIGHT_TO_WORK_RE.test(q)) return { key: "right_to_work", blocked: null, asksFuture };
  if (START_RE.test(q)) return { key: "start_date", blocked: null, asksFuture };
  if (FULL_TIME_RE.test(q)) return { key: "full_time", blocked: null, asksFuture };
  return none;
}

/**
 * The answers keyed by the bank's normalised question text, from the user's
 * Eligibility answers (null where the answer is not given yet).
 */
export function answersByQuestion(f: AnswerFacts | null | undefined): Record<string, string | null> {
  const bank = buildAnswerBank(f);
  return Object.fromEntries(Object.entries(QUESTION_BANK).map(([q, key]) => [q, bank.find((e) => e.key === key)?.answer ?? null]));
}

/** A pasted question's answer: the stored one, a block, or none. */
export function answerFor(question: string, f: AnswerFacts | null | undefined): { answer: string | null; key: AnswerKey | null; blocked: BlockedKind | null; note: string | null } {
  const match = matchQuestion(question);
  const answer = match.key ? (buildAnswerBank(f).find((e) => e.key === match.key)?.answer ?? null) : null;
  return { answer, key: match.key, blocked: match.blocked, note: answerNote(match, f) };
}

/** A note beside an answer that needs the user's own check, or null. */
export function answerNote(match: QuestionMatch, f: AnswerFacts | null | undefined): string | null {
  if (match.key !== "sponsorship" && match.key !== "visa_details") return null;
  if (!match.asksFuture || f?.rightToWork.status !== "time_limited") return null;
  const ends = monthName(f.rightToWork.permissionEnds ?? null);
  return `This question asks about the future, and your permission to work is time-limited${ends ? ` (until ${ends})` : ""}. Check this answer is right for you before you send it.`;
}

export const BLOCKED_MESSAGES: Record<BlockedKind, string> = {
  consent: "A consent or declaration question: answer it yourself. We never fill these in.",
  convictions: "A criminal-record question: answer it yourself. We never fill these in.",
};
