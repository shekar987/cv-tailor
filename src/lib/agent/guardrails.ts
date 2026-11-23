// Local Agent (Chunk 33): the guardrails the PC worker will obey (Chunk 34+),
// defined here now so the website and the worker share one list. Import-free,
// pure (tests/agentAts covers these too).
//
// SENSITIVE_QUESTION is the set of application-form questions the worker must
// never answer on its own — it stops and asks the user (status needs_human).
// These are either legally loaded (right to work, criminal record), personal
// (date of birth, home address), commercial (salary), or explicitly meant to be
// the candidate's own words. The honesty rules of the main product apply here
// too: nothing is invented, and a human makes every call that matters.

export const LINKEDIN_BLOCKED = true;

export const LINKEDIN_BLOCKED_MESSAGE =
  "LinkedIn isn't supported — its terms forbid automated applications, and Easy Apply changes too often to drive safely. Paste the employer's own application link (Greenhouse, Lever, Ashby, Workday, Pinpoint or Workable) instead.";

export type SensitiveQuestion = {
  key: string;
  label: string;
  /** Matched case-insensitively against the question text. */
  pattern: RegExp;
};

export const SENSITIVE_QUESTIONS: readonly SensitiveQuestion[] = [
  {
    key: "right_to_work",
    label: "Right to work",
    pattern: /\b(right to work|eligible to work|authori[sz]ed to work|legally (?:allowed|entitled) to work|work permit|work authori[sz]ation)/i,
  },
  {
    key: "sponsorship",
    label: "Visa sponsorship",
    pattern: /\b(sponsor(?:ship)?|require sponsorship|need(?:ing)? sponsorship|tier 2|skilled worker visa)/i,
  },
  {
    key: "visa",
    label: "Visa / immigration status",
    pattern: /\b(visa|immigration status|residenc[ey] status|citizenship|nationality|settled status|indefinite leave)/i,
  },
  {
    key: "salary",
    label: "Salary expectations",
    pattern: /\b(salary|compensation|expected pay|pay expectation|day rate|desired (?:salary|compensation)|remuneration)/i,
  },
  {
    key: "diversity",
    label: "Equal opportunities / diversity",
    // No trailing \b: several stems are truncated ("opportunit", "disabilit").
    pattern: /\b(equal opportunit|diversity|ethnicity|gender identity|sexual orientation|disabilit|religion or belief|protected characteristic)/i,
  },
  {
    key: "criminal_record",
    label: "Criminal record",
    pattern: /\b(criminal (?:record|conviction|history)|convicted|unspent conviction|dbs check|disclosure and barring)/i,
  },
  {
    key: "date_of_birth",
    label: "Date of birth / age",
    pattern: /\b(date of birth|d\.?o\.?b\.?|year of birth|how old are you|your age)/i,
  },
  {
    key: "home_address",
    label: "Home address",
    pattern: /\b(home address|residential address|postal address|current address|where do you live|post\s?code|zip code)/i,
  },
  {
    key: "own_words",
    label: "Free-text / written answer",
    pattern: /\b(in your own words|without (?:using )?ai|cover letter|why do you want to work|tell us about yourself|motivation|personal statement|describe a time)/i,
  },
];

/** The first sensitive category the question text matches, or null. */
export function matchSensitiveQuestion(text: string): SensitiveQuestion | null {
  const t = text || "";
  for (const q of SENSITIVE_QUESTIONS) {
    if (q.pattern.test(t)) return q;
  }
  return null;
}

export function isSensitiveQuestion(text: string): boolean {
  return matchSensitiveQuestion(text) !== null;
}
