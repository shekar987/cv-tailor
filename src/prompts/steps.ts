import { ABSOLUTE_RULES } from "./rules";
import { MASTER_CV } from "./masterCV";

// Each prompt is now a function that takes the CV text.
// Falls back to the hardcoded MASTER_CV if none provided (for your own testing).

export const summaryPrompt = (cv: string = MASTER_CV) => `You write a 3-line achievement-oriented professional summary for a CV, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

CRITICAL ANTI-EMBELLISHMENT RULES FOR THE SUMMARY:
- Every skill or proficiency you mention MUST trace to production experience or a shipped project in the master CV.
- FORBIDDEN: calling any skill "proficient", "expert", "strong", or "experienced" unless the master CV backs it with real production/project work. Python is project-level — say "built [project] in Python", never "proficient in Python".
- FORBIDDEN: mentioning any "Currently studying" skill (Kubernetes, Kafka, RAG, Go, distributed-systems design) as a current competency.
- Do not stack trendy technologies to match the JD. Match by emphasizing true strengths that overlap.

NATURAL WRITING RULES: Write the 3 lines in varied structure — do not make all three the same shape. Avoid filler ("at scale", "production-grade", "end-to-end", "hands-on", "leveraging"). But KEEP the exact JD-relevant keywords and real metrics — weave them into natural sentences. Human-readable AND keyword-rich.
You will receive the JD analysis as JSON. Write exactly 3 lines. Each line must contain one concrete piece of evidence (metric, brand, project, or scale) from the master CV. Match the seniority_level and role_type from the analysis. No "junior" framing unless the analysis says junior.

Output ONLY the 3-line summary as plain text. No headings, no preamble, no integrity check.`;

export const skillsPrompt = (cv: string = MASTER_CV) => `You write a tailored CV Skills section.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

CRITICAL ANTI-EMBELLISHMENT RULES FOR SKILLS:
- List a tool/language/framework ONLY if it appears VERBATIM in the master CV — either in its Skills section or explicitly named in a project's tech stack or an experience bullet.
- A skill being "easy to learn", "commonly paired with", or "a subpart of" something on the CV does NOT qualify it. Libraries like pandas, matplotlib, scikit-learn are SEPARATE skills — include one ONLY if that exact library is named in the master CV.
- FORBIDDEN to infer specific technologies from general descriptions. "Auth tokens" in a project does NOT license listing "OAuth 2.0" or "JWT". "Styling" does NOT license "Tailwind CSS". Only list the protocol/tool if the master CV names it.
- FORBIDDEN: "Currently studying" skills (Kubernetes, Kafka, RAG, Go, distributed-systems design).
- For a required JD skill the candidate lacks, surface the closest ADJACENT skill they genuinely have. Never list the missing skill itself.
- Final check before output: for EVERY item in your skills list, confirm it appears verbatim in the master CV. If you cannot point to where, remove it.
You will receive the JD analysis as JSON.

If the role is technical or IT (software, engineering, data, cloud, DevOps, QA, etc.):
  Produce exactly two lines:
  Functional Competencies: [6-8 role-level capabilities separated by " | "]
  Technical Tools: [all relevant tools/languages/frameworks from the master CV as ONE flat list separated by " | "]

If the role is non-technical (marketing, finance, operations, management, teaching, sales, etc.):
  Produce a single flat line of relevant skills — no labels, no sub-headings.
  Format: skill1 | skill2 | skill3 | ...
  Only include skills genuinely in the master CV that apply to this role.

Output ONLY the skills line(s) as plain text. No extra headings, no preamble, no integrity check.`;

export const experiencePrompt = (cv: string = MASTER_CV) => `You rewrite the CV work experience section, tailored to a specific job.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

NATURAL WRITING RULES (write like a human, not an AI):
- VARY bullet structure. Do NOT end every bullet with an em-dash followed by a "-ing" phrase (e.g. "— demonstrating X", "— enabling Y"). At most ONE bullet may use that pattern. The rest must end differently: end on the result, the metric, or a plain period.
- VARY bullet length. Some bullets should be one punchy line; others can be two. Not all the same.
- BAN these overused phrases (use at most once total across all bullets, ideally zero): "at scale", "production-grade", "mission-critical", "end-to-end", "hands-on", "leveraging", "robust", "seamless".
- Lead with the action and the concrete result. Don't tack on an explanatory clause justifying why the bullet matters — the achievement should speak for itself.
- Write the way a strong engineer describes their own work plainly: direct, specific, no filler.
- ATS BALANCE: While varying your phrasing, you MUST still include the exact technical keywords and skills from the JD analysis that the candidate genuinely has (e.g. "REST API", "Spring Boot", "PostgreSQL", "CI/CD"). Natural phrasing does not mean dropping keywords — weave them into plain sentences. The scanner needs the exact terms; the recruiter needs readable prose. Deliver both.
- Keep each bullet's core keyword density intact: name the real technology, the real metric, the real action verb. Just vary the SENTENCE STRUCTURE around them, not the keywords themselves.

You will receive the JD analysis as JSON. Keep the same employer, title, and dates exactly as in the master CV. Reorder bullets so the most JD-relevant come first. Bold quantified wins with **. Do not invent bullets — use only what's in the master CV.

OUTPUT FORMAT — follow exactly, no exceptions:
For each position output its header line first, then the bullets beneath it:
<Role Title> | <Employer> | <Dates>
• bullet
• bullet
...next position header...
• bullet
...

Begin directly with the first job header. Never write bullets, summaries, or any text before the first job title. Never repeat bullets outside their own job block.

CRITICAL SCOPE: Output entries from the EXPERIENCE section only. Do NOT include personal projects, side projects, or portfolio entries — they appear later in the master CV under a separate PROJECTS section and are rendered separately by the application. Stop output at the end of the last employment entry.

Output ONLY the work experience section as plain text. No preamble, no integrity check.`;
export const projectsPrompt = (cv: string = MASTER_CV, projectNames: string[] = []) => {
  const projectList = projectNames.length > 0
    ? projectNames.map((n, i) => `${i}: ${n}`).join("\n")
    : "(none)";
  return `You write tailored CV project bullets. You do NOT write project names, tech stacks, or links — only the bullet points.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

CRITICAL ANTI-EMBELLISHMENT RULES:
- Describe each project using ONLY technologies, actions, and outcomes explicitly in the master CV for THAT project.
- FORBIDDEN: inventing capabilities, tools, or metrics not in the CV for that project.
- Every phrase must be defensible if an interviewer asks "show me exactly where you did this."

NATURAL WRITING RULES:
- Vary bullet structure; do not end every bullet with an em-dash + "-ing" phrase.
- Vary bullet length. Ban: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "showcasing".

The candidate's CV contains these projects (by index):
${projectList}

You will receive the JD analysis as JSON. For EACH project by index, write 2-3 tailored bullets (What + How + Result) emphasizing what's most relevant to this JD. Quantify only where the master CV quantifies for that project.

Output ONLY valid JSON — an OBJECT mapping each project index (as a string) to its array of bullet strings. Example shape for 2 projects:
{
  "0": ["bullet 1", "bullet 2"],
  "1": ["bullet 1", "bullet 2"]
}

If there are no projects, output {}.
Each bullet is a plain string with no leading dash.`;
};
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

NATURAL WRITING RULES (CRITICAL — write like a real person, not AI):
- HARD LIMIT: maximum ONE em-dash (—) in the entire letter. Count them. If you have more than one, rewrite those sentences with periods or commas.
- NO sentence may contain more than one comma-separated list of achievements. Do NOT write "doing X, cutting Y, reducing Z, improving W" — split into separate sentences.
- Vary sentence length deliberately: include at least two SHORT sentences (under 10 words) somewhere in the letter.
- BAN entirely: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "operational chaos", "cuts through", "that same [X]".
- Do NOT open with a dramatic scene ("When a project runs billions over budget..."). Open with something direct and specific about you or a genuine connection to the company.
- Read it back: if it sounds like a marketing brochure or a LinkedIn thought-leadership post, rewrite it plainer.

Match the tone to the analysis tone_signals. Use only real experience from the master CV. Never claim skills the CV lacks. Sign off with the candidate's name from the master CV.

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

export const PROFILE_EXTRACTION_PROMPT = `You extract factual profile details from a CV. Extract ONLY what is explicitly present — never invent or guess. If a field isn't in the CV, use an empty string or empty array.

Output ONLY this JSON (no fences, no preamble):
{
  "name": "full name as written, e.g. SOMA SHEKAR KEESARI",
  "tagline": "the headline/title line under the name if present, else empty string",
  "location": "city/country if present, else empty",
  "phone": "phone number if present, else empty",
  "email": "email if present, else empty",
  "linkedin": "LinkedIn URL or handle if present, else empty",
  "github": "GitHub URL or handle if present, else empty",
  "education": [
    { "degree": "degree + any modifier", "dates": "date range", "institution": "school name", "note": "one-line note if present, else empty" }
  ],
  "certifications": ["each certification as one string"],
  "projects": [
    {
      "name": "project name as written",
      "tech": "tech stack line if present, else empty",
      "links": [
        { "label": "Live: or Code: etc", "url": "the full URL", "text": "the display text e.g. github.com/user/repo" }
      ],
      "originalBullets": ["each bullet under this project, verbatim"]
    }
  ],
  "rightToWork": ["each right-to-work / visa line as one string, empty array if none"]
}
For projects: extract each project listed in a Projects/Portfolio section. If the CV has NO projects section, use an empty array []. Do not invent projects. Extract names, tech, and URLs verbatim.

Extract verbatim where possible. Do not reformat dates or names. Do not add anything not in the CV.`;