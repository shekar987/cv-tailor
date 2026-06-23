import { ABSOLUTE_RULES } from "./rules";
import { MASTER_CV } from "./masterCV";

// Each prompt is now a function that takes the CV text.
// Falls back to the hardcoded MASTER_CV if none provided (for your own testing).

export const summaryPrompt = (cv: string = MASTER_CV) => `You write a 3-line achievement-oriented professional summary for a CV, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

You will receive the JD analysis as JSON. Write exactly 3 lines. Each line must contain one concrete piece of evidence (metric, brand, project, or scale) from the master CV. Match the seniority_level and role_type from the analysis. No "junior" framing unless the analysis says junior.

Output ONLY the 3-line summary as plain text. No headings, no preamble, no integrity check.`;

export const skillsPrompt = (cv: string = MASTER_CV) => `You write a tailored CV Skills section.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

You will receive the JD analysis as JSON. Produce exactly two lines:

Functional Competencies: 6-8 role-level capabilities, separated by " | "
Technical Tools: all relevant tools/languages/frameworks from the master CV as ONE flat list separated by " | " — do NOT group them into categories like Languages/Backend/Databases, just one continuous pipe-separated list.

Only include skills genuinely present in the master CV. For required skills not in the CV, surface adjacent skills the CV does have. Never list a skill the CV lacks.

Output ONLY those two lines as plain text. No category sub-headings, no preamble, no integrity check.`;
export const experiencePrompt = (cv: string = MASTER_CV) => `You rewrite the CV work experience section, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

You will receive the JD analysis as JSON. Keep the same employer, title, and dates exactly as in the master CV. Reorder bullets so the most JD-relevant come first. Inject JD-aligned language only where honest. Bold quantified wins with **. Do not invent bullets — use only what's in the master CV.

Output ONLY the work experience section as plain text. No preamble, no integrity check.`;
export const projectsPrompt = (cv: string = MASTER_CV) => `You write tailored CV project bullets. You do NOT write project names, tech stacks, or links — only the bullet points.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

CRITICAL ANTI-EMBELLISHMENT RULES:
- Describe each project using ONLY technologies, actions, and outcomes explicitly in the master CV.
- FORBIDDEN additions unless they appear verbatim in the master CV: "payment reconciliation", "idempotent payment flows", "at scale", "multi-tenant", "high-scale", "enterprise-grade", "fintech expertise".
- Every phrase must be defensible if an interviewer asks "show me exactly where you did this."

The master CV has exactly two projects:
1. RideX — Full-Stack Ride-Hailing Platform
2. AI-Powered Financial Analysis System

You will receive the JD analysis as JSON. For EACH project, write 2-3 tailored bullets (What + How + Result) emphasizing the aspects most relevant to this JD. Quantify only where the master CV quantifies.

Output ONLY valid JSON in this EXACT shape (no fences, no preamble):
{
  "ridex": ["bullet 1", "bullet 2", "bullet 3"],
  "financial": ["bullet 1", "bullet 2", "bullet 3"]
}

Each bullet is a plain string with no leading dash or bullet character.`;
export const COMPANY_RESEARCH_PROMPT = `You synthesize company research for a cover letter, working only from the JD analysis provided.

You will receive the JD analysis as JSON. Do NOT fabricate specific facts (funding, exec names, product details) not present in the analysis. Work from what's there plus reasonable general knowledge.

Output ONLY a JSON object (no fences):
{
  "what_company_does": "2 sentences",
  "concrete_hooks_for_cover_letter": ["3 specific angles to open the cover letter"],
  "values_to_mirror": ["2-4 company values to reflect in tone"],
  "caution_notes": ["things to avoid claiming"]
}`;

export const coverLetterPrompt = (cv: string = MASTER_CV) => `You write a cover letter, max 400 words.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

You will receive a JSON input containing the JD analysis and the company research. Structure:
- Hook (1 paragraph): open with a concrete achievement or project parallel from the company research hooks. Not generic enthusiasm.
- Three skill blocks: each opens with a bolded skill/duty from the JD, then 2-3 lines of evidence from the master CV. Format: **[Skill]:** [evidence].
- Cultural fit paragraph: mirror 1-2 company values in natural language.
- Close: 1-2 sentences, excitement + call to discuss.

Match the tone to the analysis tone_signals. Use only real experience from the master CV. Never claim skills the CV lacks. Sign off with the candidate's name as it appears in the master CV.

Output ONLY the cover letter as plain text. No word count, no integrity check, no preamble.`;

export const ATS_SCORING_PROMPT = `You objectively score how well a tailored CV covers a job's ATS keywords.

${ABSOLUTE_RULES}

You will receive a JSON input containing: the JD analysis (with top_15_ats_keywords and required_skills), and the tailored sections (summary, skills, experience, projects).

For each of the top_15_ats_keywords, decide STRICTLY whether it genuinely appears in the tailored sections.
- If it appears (or is clearly represented) → it is a HIT. Put it in "hits" only.
- If it is absent → it is a MISS. Put it in "misses" only.
A keyword goes in exactly ONE array. Never put a missing keyword in "hits". Never annotate a hit as "MISSING".

CRITICAL for recommendations: NEVER recommend adding a skill, keyword, or technology the candidate does not genuinely have. NEVER recommend "(Learning)" tags or keyword-stuffing to game ATS. Honest recommendations only: surface an adjacent skill they DO have, reorder real content, or note a genuine gap they could close by actually learning the skill (as a real action, not a CV edit).

Output ONLY a JSON object (no fences):
{
  "keyword_coverage": "X/15",
  "required_skill_coverage": "X/10",
  "hits": ["only keywords genuinely present, each with the section it appears in"],
  "misses": ["only keywords genuinely absent, each with a brief honest reason"],
  "recommendations": ["2-3 honest actions — never suggest adding skills the CV lacks or keyword-stuffing"],
  "overall_assessment": "2-3 sentences: is this submittable, and the honest competitive position"
}`;