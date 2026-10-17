// The UKJI style: the pipeline exactly as it ran before styles existed, as
// an object. Every numeric limit is IMPORTED from where it has always lived
// (one value, never a copy), and every prompt passage below is the exact text
// prompts/steps.ts carried until the prompts took their style blocks (16 Oct
// 2026) — tests/promptSnapshot.test.ts proves, byte for byte, that passing
// these blocks rebuilds the captured prompts. Change a passage here and that
// test fails: UKJI is the control group for the CareerSet comparison.
import { MAX_SUMMARY_SENTENCES, MAX_SUMMARY_WORDS, MAX_TECHNICAL_TOOLS, MAX_COMPETENCIES } from "../formatRules.ts";
import { TOOLS_LEAD_SLOTS } from "../claims.ts";
import { MAX_BULLET_LINES } from "../bulletShape.ts";
import { PROJECT_MIN_BULLETS } from "../onePage.ts";
import { coverLetterPrompt } from "../../prompts/steps.ts";
import { RENDER_OPTIONS, SKILLS_SHAPE } from "./ids.ts";
import type { FormatStyle } from "./types.ts";

// steps.ts summaryPrompt, the first FORM line.
export const UKJI_SUMMARY_FORM = "- 2 or 3 sentences, 45 to 70 words in total, one sentence per line.";
// steps.ts skillsPrompt, the technical branch's instructions.
export const UKJI_SKILLS_SHAPE = "  Produce exactly two lines:\n  Functional Competencies: [4-6 capabilities separated by \" | \"]\n  Technical Tools: [up to 15 tools/languages/frameworks from the master CV as ONE flat list separated by \" | \" — the job's required and keyword terms the master CV shows first, then other relevant ones; leave out tools that do nothing for this job]\n  A Functional Competency names work the master CV shows being done, in the CV's own terms (\"REST API design\", \"Database query optimisation\", \"Automated testing\"). Never a personal quality (\"problem-solving\", \"self-directed learning\") and never a work context the master CV does not show — clients, stakeholders, sales, mentoring, or a domain such as insurance (see the evidence map).";
// steps.ts experiencePrompt, the id protocol's verb-swap rule.
export const UKJI_VERB_RULE = "- An inflated verb in a master bullet (Spearheaded, Leveraged, Pioneered, Fostered, Revolutionised) may be swapped for the plain verb that says the same thing (Led, Used, Built, Supported, Improved) — one substitution. Never swap to a verb that claims more.";
// steps.ts experiencePrompt, the highlight-line and bold instruction.
export const UKJI_EXPERIENCE_FORMAT = "If a role has a highlight/headline line under its header in the master CV (e.g. \"Highlight: …\"), do NOT drop it — output it as that role's FIRST bullet. Bold quantified wins with **.";
// steps.ts poolProjectsPrompt, the per-project bullet paragraph.
export const UKJI_POOL_BULLETS = "For each selected project write 3 tailored bullets (What + How + Result),\nfewer when its pool entry has fewer, using ONLY that project's own pool entry.\nThe first bullet shows what this job asks for most. Quantify only where the pool\nquantifies for that project. Bold quantified wins and exact JD-matching\ntechnologies the pool genuinely shows with **.";
// The letter prompt asks for "230 to 330 words".
export const UKJI_LETTER_WORDS = { min: 230, max: 330 } as const;

export const UKJI: FormatStyle = {
  id: "ukji",
  label: "UKJI",
  prompts: {
    summaryForm: () => UKJI_SUMMARY_FORM,
    skillsShape: UKJI_SKILLS_SHAPE,
    verbRule: UKJI_VERB_RULE,
    experienceFormat: UKJI_EXPERIENCE_FORMAT,
    // projectsPrompt carries no bold or shape sentence of its own.
    projectsBullets: "",
    poolBullets: UKJI_POOL_BULLETS,
    coverLetter: (cv, claimsBlock, omitRightToWork, evidenceBlock) => coverLetterPrompt(cv, claimsBlock, omitRightToWork, evidenceBlock),
  },
  limits: {
    summary: { maxSentences: MAX_SUMMARY_SENTENCES, maxWords: MAX_SUMMARY_WORDS },
    competencies: { max: MAX_COMPETENCIES },
    tools: { max: MAX_TECHNICAL_TOOLS, leadSlots: TOOLS_LEAD_SLOTS },
    // No word cap and no total cap: lib/contentBudget and lib/onePage decide
    // by the page; projects 4/3/2 per project by count, floor PROJECT_MIN_BULLETS.
    bullets: { maxWords: null, maxLines: MAX_BULLET_LINES, total: null, perProject: { min: PROJECT_MIN_BULLETS, max: 4 } },
    cv: { maxWords: null },
    letter: { minWords: UKJI_LETTER_WORDS.min, maxWords: UKJI_LETTER_WORDS.max },
  },
  skills: SKILLS_SHAPE.ukji,
  lint: { bannedWords: [], equivalences: {}, verbCap: null, letterBanned: [] },
  render: RENDER_OPTIONS.ukji,
  summary: { appendAvailability: false },
  letter: {
    furniture: [],
    interestOpening: null,
    fixedLine: "I have read the job description and feel that I'm a great fit due to the following reasons:",
    thanksLine: "Thank you",
    points: 3,
    teamSuffix: "team",
    statementPlacement: "own_paragraph",
    renumberPoints: false,
    pointsFromEvidence: false,
    protectFurnitureInFit: false,
  },
};
