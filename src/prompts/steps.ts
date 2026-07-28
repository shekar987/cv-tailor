import { ABSOLUTE_RULES } from "./rules";

// Step 1 of the pipeline. Shared by /api/analyze (standalone JD analysis, also
// used for the pre-tailoring ATS keyword gate) and /api/tailor (Step 0 of the
// full 9-call pipeline) — one definition so the two never drift apart.
export const JD_ANALYZER_PROMPT = `You are a JD analyzer for a CV tailoring system. Extract structured data from the job description the user provides.

Output ONLY a JSON object (no prose, no markdown fences) with these fields:
{
  "role_title": "exact job title",
  "company_name": "company name",
  "seniority_level": "junior | mid | senior | staff | unspecified",
  "role_type": "backend | frontend | fullstack | ai_engineering | data_engineering | ml_engineering | devops | other",
  "location_and_mode": "e.g. London, Hybrid",
  "required_skills": ["top 10 mandatory skills, priority order"],
  "nice_to_have_skills": ["up to 8 preferred skills"],
  "top_15_ats_keywords": ["top 15 ATS keywords, priority ordered"],
  "company_values_and_culture": ["3-6 cultural signals"],
  "domain_context": "1 sentence on what the product does",
  "tone_signals": "formal | semi-formal | founder-casual | technical-dense"
}`;

// The rendered CV must fit TWO A4 pages. Page count is a product of this length
// budget and the layout density in api/download/route.ts — change one and
// re-check the other.
//
// At 10.5pt Calibri with 0.5" margins a page holds roughly 55 lines, so the two
// pages are ~110 lines total. After the header, summary, skills, projects,
// education and right-to-work sections take their share, EXPERIENCE has roughly
// 55 lines — about 22 bullets at an average of 1.5 lines each.
//
// HOW TO TRIM — this matters for honesty: cut by REMOVING whole bullets that
// matter least for this JD. Never merge two achievements into one sentence, and
// never compress by dropping the qualifier that makes a claim true. Omission is
// allowed; blurring two facts into a third is invention.
export const LENGTH_BUDGET = `LENGTH BUDGET — the finished CV must fit on TWO A4 pages:
- Most recent / most relevant role: at most 5 bullets.
- Next role: at most 4 bullets.
- Every older role: at most 3 bullets, and at most 2 once a role is more than ~8 years old or clearly unrelated to this JD.
- Keep every bullet to a maximum of two printed lines (roughly 200 characters).
- If it still runs long, DROP the least JD-relevant bullets entirely, oldest roles first.
- Trim ONLY by deleting whole bullets. Never merge two achievements into one sentence, never combine metrics, and never drop a qualifier that a claim depends on — that would state something the master CV does not support.
- Never drop a whole role, and never change any employer, title, or date.`;

export const summaryPrompt = (cv: string) => `You write a 3-line achievement-oriented professional summary for a CV, tailored to a specific job.

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

export const skillsPrompt = (cv: string) => `You write a tailored CV Skills section.

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

export const experiencePrompt = (cv: string) => `You rewrite the CV work experience section, tailored to a specific job.

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

${LENGTH_BUDGET}

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
export const projectsPrompt = (cv: string, projectNames: string[] = []) => {
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

LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and projects sit after
experience, so they are what pushes it over. Write 2 bullets per project, not 3,
whenever there are 3 or more projects. Keep each bullet to a single printed line
where possible and never more than two. Trim by dropping a whole bullet, never by
merging two achievements or combining their metrics into one sentence.

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

export const coverLetterPrompt = (cv: string) => `You write a cover letter, max 400 words.

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
- Do NOT include a date line. Do NOT write bracketed placeholders of any kind — no [Date], [Address], [Hiring Manager], etc. The app inserts today's date itself. Anything you can't fill with real information from the master CV or the analysis, omit entirely.

Match the tone to the analysis tone_signals. Use only real experience from the master CV. Never claim skills the CV lacks. Sign off with the candidate's name from the master CV.

Output ONLY the cover letter as plain text. No date line, no word count, no integrity check, no preamble.`;

export const ATS_SCORING_PROMPT = `You objectively score how well a tailored CV covers a job's ATS keywords.

${ABSOLUTE_RULES}

You will receive a JSON input containing: the JD analysis (with top_15_ats_keywords and required_skills), and the tailored sections (summary, skills, experience, projects).

For each of the top_15_ats_keywords, decide STRICTLY whether it genuinely appears in the tailored sections.
- If it appears (or is clearly represented) → it is a HIT. Put it in "hits" only.
- If it is absent → it is a MISS. Put it in "misses" only.
A keyword goes in exactly ONE array. Never put a missing keyword in "hits". Never annotate a hit as "MISSING".

CRITICAL for recommendations: NEVER recommend adding a skill, keyword, or technology the candidate does not genuinely have. NEVER recommend "(Learning)" tags or keyword-stuffing to game ATS. Honest recommendations only: surface an adjacent skill they DO have, reorder real content, or note a genuine gap they could close by actually learning the skill (as a real action, not a CV edit).

VOICE: this text is shown directly to the person whose CV it is. Write "misses", "recommendations", and "overall_assessment" addressed straight to them — "you", "your CV", "you're missing" — never in the third person ("the candidate", "the applicant", "this CV").

Output ONLY a JSON object (no fences):
{
  "keyword_coverage": "X/15",
  "required_skill_coverage": "X/10",
  "hits": ["only keywords genuinely present, each with the section it appears in"],
  "misses": ["only keywords genuinely absent, each with a brief honest reason, addressed to \"you\""],
  "recommendations": ["2-3 honest actions, addressed to \"you\" — never suggest adding skills the CV lacks or keyword-stuffing"],
  "overall_assessment": "2-3 sentences addressed to \"you\": is this submittable, and your honest competitive position"
}`;

export const PROFILE_EXTRACTION_PROMPT = `You extract factual profile details from a CV. Extract ONLY what is explicitly present — never invent or guess. If a field isn't in the CV, use an empty string or empty array.

Output ONLY this JSON (no fences, no preamble):
{
  "name": "full name as written, e.g. SOMA SHEKAR KEESARI",
  "tagline": "the professional headline/title line under the name (e.g. 'Full-Stack Engineer') if present, else empty string. Do NOT put contact details here — no email, phone, location, or LinkedIn/GitHub URLs; those belong in their own fields.",
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
  "rightToWork": ["each right-to-work / visa line as one string, empty array if none"],
  "extraSections": [
    { "title": "section heading as written, e.g. RECOGNITIONS", "bullets": ["each line or bullet under this heading, verbatim"] }
  ]
}
For projects: extract each project listed in a Projects/Portfolio section. If the CV has NO projects section, use an empty array []. Do not invent projects. Extract names, tech, and URLs verbatim.

For extraSections: capture every CV section whose content is NOT already captured by the fields above and is NOT a summary/profile, skills, experience/work history, projects, education, certifications, or right-to-work/visa section. Examples: recognitions, awards, publications, languages, volunteering, interests. Keep the heading exactly as written and each line verbatim, in original order. Empty array if none.

Extract verbatim where possible. Do not reformat dates or names. Do not add anything not in the CV.`;