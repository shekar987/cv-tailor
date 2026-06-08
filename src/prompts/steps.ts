import { ABSOLUTE_RULES } from "./rules";
import { MASTER_CV } from "./masterCV";

// Each prompt takes the JD analysis (and CV) as context.

export const SUMMARY_PROMPT = `You write a 3-line achievement-oriented professional summary for a CV, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${MASTER_CV}

You will receive the JD analysis as JSON. Write exactly 3 lines. Each line must contain one concrete piece of evidence (metric, brand, project, or scale) from the master CV. Match the seniority_level and role_type from the analysis. No "junior" framing unless the analysis says junior.

Output ONLY the 3-line summary as plain text. No headings, no preamble, no integrity check.`;

export const SKILLS_PROMPT = `You write a tailored CV Skills section.

${ABSOLUTE_RULES}

MASTER CV:
${MASTER_CV}

You will receive the JD analysis as JSON. Produce two subsections:
Functional Competencies: 6-8 role-level capabilities, separated by " | "
Technical Tools: grouped by category (Languages, Frontend, Backend & APIs, Databases, AI/LLM, Cloud & DevOps, Testing)

Only include skills genuinely present in the master CV. For required skills not in the CV, surface adjacent skills the CV does have. Never list a skill the CV lacks.

Output ONLY the skills section as plain text. No preamble, no integrity check.`;

export const EXPERIENCE_PROMPT = `You rewrite the CV work experience section, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${MASTER_CV}

You will receive the JD analysis as JSON. Keep the same employer, title, and dates exactly as in the master CV. Reorder bullets so the most JD-relevant come first. Inject JD-aligned language only where honest. Bold quantified wins with **. Do not invent bullets — use only what's in the master CV.

Output ONLY the work experience section as plain text. No preamble, no integrity check.`;

export const PROJECTS_PROMPT = `You rewrite the CV projects section, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${MASTER_CV}

You will receive the JD analysis as JSON. For each project: a heading with 1-line relevance to the JD, then 2-3 bullets using What+How+Result. Lead with the project most aligned to the JD. Quantify only where the master CV quantifies.

Output ONLY the projects section as plain text. No preamble, no integrity check.`;