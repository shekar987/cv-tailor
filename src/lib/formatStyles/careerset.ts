// The CareerSet style (16 Oct 2026): the shape the owner tuned by hand in
// their university's CV tool — the attached CV scored 98/100 and the letter
// 100/100 there. Where a CareerSet rule meets an honesty rule, the honesty
// rule wins: the banned-word swaps below never claim more than the master CV
// (ABSOLUTE_RULES 10), the headline carries only the stated years and
// production-level registry skills, the availability sentence comes from
// Eligibility, and the letter's interest and numbered points come only from
// the posting, the research and the evidence map. The style changes WORDING
// and SHAPE; every honesty check, the bullet-id protocol and the credit cost
// are shared with UKJI.
import { careersetCoverLetterPrompt } from "../../prompts/steps.ts";
import { TOOLS_LEAD_SLOTS } from "../claims.ts";
import { MAX_BULLET_LINES } from "../bulletShape.ts";
import { RENDER_OPTIONS, SKILLS_SHAPE, CAREERSET_TOOL_GROUPS } from "./ids.ts";
import type { FormatStyle, SummaryFormCtx } from "./types.ts";

export const CAREERSET_BANNED_WORDS = ["contributed", "supported", "assisted", "helped", "worked on", "work in", "responsible for", "successfully", "used"] as const;
// The only automatic swaps. "applied" says no more than "used"; dropping
// "successfully" removes a grade, never a fact; "owned" is what "responsible
// for" states. "supported", "assisted", "contributed", "helped", "worked on"
// and "work in" have no plain equivalent that claims the same — a stronger
// verb would be the overclaim rule 10 forbids — so such a bullet is reported
// (the "Your master CV" notice) and left as the master CV wrote it.
export const CAREERSET_EQUIVALENCES: Readonly<Record<string, readonly string[]>> = {
  used: ["applied", "implemented"],
  successfully: [""],
  "responsible for": ["owned"],
};
export const CAREERSET_LETTER_BANNED = ["used", "assisted", "contribute", "contributed", "also", "kind of"] as const;
export const CAREERSET_FIXED_LINE = "Having read the job description, these are the four areas where I can add value from the start:";
export const CAREERSET_INTEREST_OPENING = "I am particularly interested in this role because";
export const CAREERSET_THANKS = "Thank you for considering my application.";

const BANNED_LIST = `"contributed", "supported", "assisted", "helped", "worked on", "work in", "responsible for", "successfully" or "used"`;

export function careersetSummaryForm(ctx: SummaryFormCtx): string {
  return ctx.availabilityAppended
    ? "- 3 or 4 sentences, 65 to 90 words in total, one sentence per line. The app itself adds one closing sentence on availability afterwards: never write one, and never mention a start date."
    : "- 4 sentences, 70 to 95 words in total, one sentence per line.";
}

export const CAREERSET_SKILLS_SHAPE = `  Produce these lines, in this order:
  Functional Competencies: [10-12 capabilities separated by " | " — the posting's own words first for the work the master CV shows, then the CV's other capabilities]
  Technical Tools:
  Languages & Frameworks: [tools separated by ", "]
  Databases: [tools separated by ", "]
  AI & LLM: [tools separated by ", "]
  Cloud & DevOps: [tools separated by ", "]
  Testing: [tools separated by ", "]
  Other: [tools separated by ", " — only for a tool that fits no group above]
  The "Technical Tools:" line is a label with nothing after the colon. Each group line under it lists only tools the master CV names, each tool in one group only, the job's required and keyword terms first on every line; leave out a group that would be empty, and never write more than 30 tools in total.
  A Functional Competency names work the master CV shows being done, in the CV's own terms ("REST API design", "Database query optimisation", "Automated testing"). Never a personal quality ("problem-solving", "self-directed learning") and never a work context the master CV does not show — clients, stakeholders, sales, mentoring, or a domain such as insurance (see the evidence map).`;

export const CAREERSET_VERB_RULE = `- An inflated verb in a master bullet (Spearheaded, Leveraged, Pioneered, Fostered, Revolutionised) may be swapped for the plain verb that says the same thing (Led, Built, Improved, Applied) — one substitution. "used" may become "applied" or "implemented"; "successfully" may simply go; "responsible for" may become "owned". Never swap to a verb that claims more, and never replace "supported", "assisted", "contributed", "helped", "worked on" or "work in" with a stronger verb — select a different bullet, or leave that one out.`;

export const CAREERSET_EXPERIENCE_FORMAT = `Never write a "Highlight:" line: a master highlight line is selected by its id as an ordinary bullet when it is relevant for this job, else left out. No bold anywhere — never **. No full stop at the end of a bullet. Never the words ${BANNED_LIST} (the swap rule above is the only remedy). No opening verb more than twice across the whole CV, projects included: select and order bullets so the opening verbs vary. Each bullet at most 30 words and two printed lines.`;

export const CAREERSET_PROJECTS_BULLETS = `

CAREERSET STYLE — HARD CONSTRAINTS: 2 to 4 bullets per project within the LENGTH BUDGET below; each bullet at most 30 words; no bold — never **; no full stop at the end of a bullet; never the words ${BANNED_LIST}; no opening verb more than twice across the whole CV, so vary the opening verbs across every project. A deterministic check rejects a bullet that breaks one of these.`;

export const CAREERSET_POOL_BULLETS = `For each selected project write 2 to 4 tailored bullets (What + How + Result),
fewer when its pool entry has fewer, using ONLY that project's own pool entry.
The first bullet shows what this job asks for most. Quantify only where the pool
quantifies for that project. CAREERSET STYLE — HARD CONSTRAINTS: each bullet at
most 30 words; no bold — never **; no full stop at the end of a bullet; never the
words ${BANNED_LIST}; no opening verb more than twice across the whole CV, so
vary the opening verbs.`;

export const CAREERSET: FormatStyle = {
  id: "careerset",
  label: "CareerSet",
  prompts: {
    summaryForm: careersetSummaryForm,
    skillsShape: CAREERSET_SKILLS_SHAPE,
    verbRule: CAREERSET_VERB_RULE,
    experienceFormat: CAREERSET_EXPERIENCE_FORMAT,
    projectsBullets: CAREERSET_PROJECTS_BULLETS,
    poolBullets: CAREERSET_POOL_BULLETS,
    coverLetter: careersetCoverLetterPrompt,
  },
  limits: {
    // The model writes 3-4 sentences (65-90 words); the app appends the
    // availability sentence; the cap leaves room for both.
    summary: { maxSentences: 5, maxWords: 95 },
    competencies: { max: 12 },
    tools: { max: 30, leadSlots: TOOLS_LEAD_SLOTS },
    bullets: { maxWords: 30, maxLines: MAX_BULLET_LINES, total: { min: 12, max: 20 }, perProject: { min: 2, max: 4 } },
    cv: { maxWords: 900 },
    letter: { minWords: 300, maxWords: 420 },
  },
  skills: SKILLS_SHAPE.careerset,
  lint: { bannedWords: CAREERSET_BANNED_WORDS, equivalences: CAREERSET_EQUIVALENCES, verbCap: 2, letterBanned: CAREERSET_LETTER_BANNED },
  render: RENDER_OPTIONS.careerset,
  summary: { appendAvailability: true },
  letter: {
    furniture: [/^Having read the job description, these are the four areas where I can add value from the start:?$/i, /^I am particularly interested in this role because\b/i],
    interestOpening: CAREERSET_INTEREST_OPENING,
    fixedLine: CAREERSET_FIXED_LINE,
    thanksLine: CAREERSET_THANKS,
    points: 4,
    teamSuffix: "Hiring Team",
    statementPlacement: "close_paragraph",
    renumberPoints: true,
  },
};

export const CAREERSET_GROUPS = CAREERSET_TOOL_GROUPS;
