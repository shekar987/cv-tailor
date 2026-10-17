// The UKJI style: the pipeline exactly as it ran before styles existed, as
// an object. Its rules are ids.ts STYLE_RULES.ukji (the values that have
// always lived in lib/formatRules, lib/claims, lib/bulletShape and
// lib/onePage — tests/formatStyles.test.ts holds them equal to those
// exports), and every prompt passage below is the exact text
// prompts/steps.ts carried until the prompts took their style blocks (16 Oct
// 2026) — tests/promptSnapshot.test.ts proves, byte for byte, that passing
// these blocks rebuilds the captured prompts. Change a passage here and that
// test fails: UKJI is the control group for the CareerSet comparison.
import { coverLetterPrompt } from "../../prompts/steps.ts";
import { STYLE_RULES } from "./ids.ts";
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
  ...STYLE_RULES.ukji,
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
};
