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

export const COMPANY_RESEARCH_PROMPT = `You synthesize company research for a cover letter, working only from the JD analysis provided.

You will receive the JD analysis as JSON. Do NOT fabricate specific facts (funding, exec names, product details) not present in the analysis. Work from what's there plus reasonable general knowledge.

Output ONLY a JSON object (no fences):
{
  "what_company_does": "2 sentences",
  "concrete_hooks_for_cover_letter": ["3 specific angles to open the cover letter"],
  "values_to_mirror": ["2-4 company values to reflect in tone"],
  "caution_notes": ["things to avoid claiming"]
}`;

export const COVER_LETTER_PROMPT = `You write a cover letter, max 400 words.

${ABSOLUTE_RULES}

MASTER CV:
${MASTER_CV}

You will receive a JSON input containing the JD analysis and the company research. Structure:
- Hook (1 paragraph): open with a concrete achievement or project parallel from the company research hooks. Not generic enthusiasm.
- Three skill blocks: each opens with a bolded skill/duty from the JD, then 2-3 lines of evidence from the master CV. Format: **[Skill]:** [evidence].
- Cultural fit paragraph: mirror 1-2 company values in natural language.
- Close: 1-2 sentences, excitement + call to discuss. Sign off as "Soma Shekar Keesari".

Match the tone to the analysis tone_signals. Use only real experience from the master CV. Never claim skills the CV lacks.

Output ONLY the cover letter as plain text. No word count, no integrity check, no preamble.`;

export const ATS_SCORING_PROMPT = `You objectively score how well a tailored CV covers a job's ATS keywords.

You will receive a JSON input containing: the JD analysis (with top_15_ats_keywords and required_skills), and the tailored sections (summary, skills, experience, projects).

Count how many of the top_15_ats_keywords genuinely appear in the tailored sections. Be strict — a keyword only counts if it actually appears or is clearly represented.

Output ONLY a JSON object (no fences):
{
  "keyword_coverage": "X/15",
  "required_skill_coverage": "X/10",
  "hits": ["keywords found, with the section they appear in"],
  "misses": ["keywords absent — with brief honest reason"],
  "recommendations": ["2-3 specific, honest actions to improve — never suggest adding skills the CV lacks"],
  "overall_assessment": "2-3 sentences: is this submittable, and the honest competitive position"
}`;