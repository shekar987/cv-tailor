import { ABSOLUTE_RULES } from "./rules";
import { DEFAULT_CLAIMS_BLOCK } from "@/lib/claims";

// Every prompt that writes about the candidate takes a `claimsBlock`: the
// rendered claims registry (lib/claims renderClaimsBlock) saying what each
// skill may be called and which skills are forbidden. The default is the
// generic rule for users who have no registry yet.

// Step 1 of the pipeline. Shared by /api/analyze (standalone JD analysis, also
// used for the pre-tailoring ATS keyword gate) and /api/tailor (Step 0 of the
// full 9-call pipeline) — one definition so the two never drift apart.
export const JD_ANALYZER_PROMPT = `You are a JD analyzer for a CV tailoring system. Extract structured data from the job description the user provides.

Output ONLY a JSON object (no prose, no markdown fences) with these fields:
{
  "role_title": "exact job title",
  "company_name": "company name",
  "seniority_level": "graduate | junior | mid | senior | staff | unspecified",
  "key_responsibilities": ["up to 6 short phrases: what the person will actually do day to day, in the posting's own words"],
  "role_type": "backend | frontend | fullstack | ai_engineering | data_engineering | ml_engineering | devops | other",
  "location_and_mode": "e.g. London, Hybrid",
  "required_skills": ["top 10 mandatory skills, priority order"],
  "nice_to_have_skills": ["up to 8 preferred skills"],
  "top_15_ats_keywords": ["top 15 ATS keywords, priority ordered"],
  "company_values_and_culture": ["3-6 cultural signals"],
  "domain_context": "1 sentence on what the product does",
  "tone_signals": "formal | semi-formal | founder-casual | technical-dense",
  "hard_gates": [
    {
      "category": "sponsorship | clearance | years | location | degree | graduation | licence | employment_type",
      "requirement": "the sentence or bullet COPIED VERBATIM from the job description",
      "strictness": "must | preferred"
    }
  ]
}
seniority_level "graduate" means a new-grad, graduate-scheme or entry-level role for people finishing or just past their degree.
hard_gates are the conditions an application form screens on before anyone reads the CV: right to work / visa sponsorship, security clearance (SC, DV, BPSS, NPPV, Secret/TS), a number of years stated as a requirement, on-site / hybrid / location or relocation conditions, a required degree or degree class, WHEN the degree must have been completed ("graduated within the last year", "2025 or 2026 graduates", "final-year students") as category graduation, licences or certifications that must already be held, and contract vs permanent terms. Copy each requirement sentence exactly as written - a deterministic checker discards any entry it cannot find verbatim in the text. Use "preferred" when the posting says nice-to-have, ideally, desirable or a plus. Empty array when there are none. Never infer a gate the text does not state.`;

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

// The exact role title from the posting must appear in the summary: it is
// the highest-weighted term in a recruiter's search, and the gap list kept
// reporting it missing. lib/roleTitle checks the draft; the tailor route
// retries once with `retryBlock` when it is absent.
// asIdentity (lib/roleTitle titleAsIdentity): the title plainly describes the
// candidate's paid work ("Software Developer"), so it opens the summary as who
// they are; otherwise it is named as the job applied for, never claimed.
export const roleTitleRule = (roleTitle: string, asIdentity: boolean = false) =>
  !roleTitle
    ? ""
    : asIdentity
      ? `ROLE TITLE — HARD CONSTRAINT: open the summary with the exact role title "${roleTitle}", spelled exactly as given, as the candidate's professional identity ("${roleTitle} with …") — it plainly describes the paid work the master CV shows. Never in quotes, and never followed by a clause about the role, the team or the employer ("…where design and collaboration drive impact" is rejected). It is the highest-weighted term a recruiter searches for; a summary without it is rejected.`
      : `ROLE TITLE — HARD CONSTRAINT: the exact role title "${roleTitle}" must appear once in the summary, spelled exactly as given, as the job being applied for ("…, applying for the ${roleTitle} role") — never in quotes, never as a title the candidate has held, and never followed by a clause about the role, the team or the employer ("…role where design and collaboration drive impact" is rejected). It is the highest-weighted term a recruiter searches for; a summary without it is rejected.`;

// evidenceBlock: lib/evidenceMap renderEvidenceBlock — which of the
// posting's requirements paid work shows, which only a project shows, and
// which the master CV never shows (never claimed, never implied).
export const summaryPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, variantBlock: string = "", roleTitle: string = "", retryBlock: string = "", evidenceBlock: string = "", asIdentity: boolean = false) => `You write the professional summary at the top of a CV, tailored to one job. A recruiter reads it in seconds to decide whether to read on.

${ABSOLUTE_RULES}
${variantBlock}
${roleTitleRule(roleTitle, asIdentity)}
${retryBlock}
${evidenceBlock}
MASTER CV:
${cv}

WHAT THE SUMMARY SAYS:
- Who the candidate is professionally, in true terms: their field, the experience the master CV shows, their core stack.
- The strongest evidence for THIS job: requirements the evidence map says paid work shows, with the master CV's real figures. Lead with what the job asks for most.
- Nothing the evidence map marks as absent, and no quality the master CV does not show.

FORM:
- 2 or 3 sentences, 45 to 70 words in total, one sentence per line.
- Every sentence carries a concrete fact from the master CV: a figure, a named system, an employer or a project. Never a sentence of adjectives.
- Every figure exactly as the master CV states it, with the fact it belongs to. Never join two figures into a range ("25–30%") and never add them up.
- A project-only skill is written as something built in that project ("built Jobhuntz with X"), never as experience or proficiency.
- Education: for a graduate or entry-level role, or when the posting requires a degree, you may state the degree with its dates or expected completion exactly as the master CV writes them. A degree whose dates run into the future is in progress: "completing an MSc Computer Science (expected Jan 2027)" — never "hold", "have" or "graduated with" it. Never mention skills being learnt or planned.
- Written as a CV, not a letter: no "I", "my" or "me".
- Never mention visa, sponsorship, right to work or immigration status.
${claimsBlock}
NEVER WRITE (each reads as generated and is rejected):
- A clause about the role, the team or the employer's needs ("where technical design drives measurable impact", "ready to contribute to your mission").
- Self-assessment: "demonstrating", "proven ability", "track record", "passion for", "strong communicator", "detail-oriented", "results-driven", "self-starter".
- Filler: "at scale", "production-grade", "end-to-end", "hands-on", "leveraging", "expert", "cutting-edge", "world-class", "innovative", "dynamic", "passionate".
- More than one positioning: one field only, never two joined by a slash or a pipe.
Before you answer, reread the draft and rewrite every sentence that breaks one of these.

You will receive the JD analysis as JSON. Match its seniority_level: no "junior" framing unless it says junior or graduate.

Output ONLY the summary as plain text, one sentence per line. No headings, no preamble, no integrity check.`;

export const skillsPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, variantBlock: string = "", evidenceBlock: string = "") => `You write a tailored CV Skills section.

${ABSOLUTE_RULES}
${variantBlock}
${evidenceBlock}

MASTER CV:
${cv}

CRITICAL ANTI-EMBELLISHMENT RULES FOR SKILLS:
- List a tool/language/framework ONLY if it appears VERBATIM in the master CV — either in its Skills section or explicitly named in a project's tech stack or an experience bullet.
- A skill being "easy to learn", "commonly paired with", or "a subpart of" something on the CV does NOT qualify it. Libraries like pandas, matplotlib, scikit-learn are SEPARATE skills — include one ONLY if that exact library is named in the master CV.
- FORBIDDEN to infer specific technologies from general descriptions. "Auth tokens" in a project does NOT license listing "OAuth 2.0" or "JWT". "Styling" does NOT license "Tailwind CSS". Only list the protocol/tool if the master CV names it.
${claimsBlock}
- For a required JD skill the candidate lacks, surface the closest ADJACENT skill they genuinely have. Never list the missing skill itself.
- A requirement the evidence map says paid work or a project shows is named in the posting's own words ("API development", not a synonym for it): a recruiter searches for those exact words.
- Final check before output: for EVERY item in your skills list, confirm it appears verbatim in the master CV. If you cannot point to where, remove it.
You will receive the JD analysis as JSON.

If the role is technical or IT (software, engineering, data, cloud, DevOps, QA, etc.):
  Produce exactly two lines:
  Functional Competencies: [4-6 capabilities separated by " | "]
  Technical Tools: [up to 15 tools/languages/frameworks from the master CV as ONE flat list separated by " | " — the job's required and keyword terms the master CV shows first, then other relevant ones; leave out tools that do nothing for this job]
  A Functional Competency names work the master CV shows being done, in the CV's own terms ("REST API design", "Database query optimisation", "Automated testing"). Never a personal quality ("problem-solving", "self-directed learning") and never a work context the master CV does not show — clients, stakeholders, sales, mentoring, or a domain such as insurance (see the evidence map).

If the role is non-technical (marketing, finance, operations, management, teaching, sales, etc.):
  Produce a single flat line of relevant skills — no labels, no sub-headings.
  Format: skill1 | skill2 | skill3 | ...
  Only include skills genuinely in the master CV that apply to this role.

Output ONLY the skills line(s) as plain text. Never wrap the labels or any skills text in ** or other markdown markers. No extra headings, no preamble, no integrity check.`;

// `budget` lets /api/tailor pass an adaptive budget computed from the actual
// master CV (lib/contentBudget.ts); the fixed LENGTH_BUDGET stays the default
// so nothing else changes behaviour.
// The bullet shape every experience/projects prompt enforces, and the block
// the tailor route sends back with a section's rejected bullets for its one
// regeneration (lib/quality.ts lintBullets decides what is rejected).
export const BULLET_SHAPE_RULE = `BULLET SHAPE — HARD CONSTRAINT:
A bullet states what was built, how, and the measured result, then STOPS. It must never end with a clause explaining why it is relevant to this employer or role, and it never names the employer. Rejected shapes: "… - directly applicable to Acme's technical file review workflows", "… - the production-grade compliance Acme's regulated customers demand", "… - core patterns for Acme's scheduling agents", "… - exactly what this role needs". It also never ends by grading the work or the candidate: "…, demonstrating full-stack ownership", "… — demonstrating problem-solving and analytical thinking", "… — translating business requirements into secure architecture", "… — designed for reliability and auditability" are rejected too. Relevance is shown by which bullets you choose and the order you put them in, never by narration. A deterministic check rejects any bullet that narrates its relevance or carries a banned filler phrase, and you will be asked to rewrite it.`;

export function rejectedBulletsBlock(flags: { bullet: string; reasons: string[] }[]): string {
  if (flags.length === 0) return "";
  const lines = flags.map((f) => `- "${f.bullet.replace(/\s+/g, " ").slice(0, 220)}" → ${f.reasons.join("; ")}`);
  return `
REJECTED IN YOUR PREVIOUS DRAFT — rewrite the whole section so none of these patterns recur anywhere in it. Keep every fact; drop the offending clause or word. Do not add a different justification in its place.
${lines.join("\n")}
`;
}

// idBlock: the master CV's experience bullets numbered by lib/bulletIds. With
// it, the step SELECTS and REORDERS those bullets by id — at most two word
// substitutions each — instead of writing new ones; the route checks every
// id and reverts any bullet that changed more. Empty when the master CV's
// experience section could not be parsed (the step then writes as before).
export const experiencePrompt = (cv: string, budget: string = LENGTH_BUDGET, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, retryBlock: string = "", idBlock: string = "", evidenceBlock: string = "") => `You rewrite the CV work experience section, tailored to a specific job.

${ABSOLUTE_RULES}
${claimsBlock}
${evidenceBlock}

MASTER CV:
${cv}
${idBlock ? `
BULLET SELECTION PROTOCOL — the master CV's experience bullets are numbered below. You SELECT and REORDER them; you do not write new bullets.
${idBlock}

- Output every bullet as "• [R1.3] <text>" — the id first, then that bullet's master wording with AT MOST TWO word substitutions. A substitution swaps one word for the posting's exact term ONLY where the master CV already shows that work (e.g. "frontend" → "front-end", "tests" → "unit tests" when they were unit tests). Never add a figure, a technology, a scale or a claim; never merge two bullets.
- A checker counts the substitutions in every bullet and reverts any bullet that changed by more than two words to its master wording, drops any bullet without an id it can match, and drops an id used twice.
- Keep each bullet under the role its id belongs to. You may leave a bullet out; you may not invent one.
` : ""}
${BULLET_SHAPE_RULE}

NATURAL WRITING RULES (write like a human, not an AI):
- VARY bullet structure. Do NOT end every bullet with an em-dash followed by a "-ing" phrase (e.g. "— demonstrating X", "— enabling Y"). At most ONE bullet may use that pattern. The rest must end differently: end on the result, the metric, or a plain period.
- VARY bullet length. Some bullets should be one punchy line; others can be two. Not all the same.
- BAN these overused phrases (use at most once total across all bullets, ideally zero): "at scale", "production-grade", "mission-critical", "end-to-end", "hands-on", "leveraging", "robust", "seamless", "expert", "cutting-edge", "world-class", "innovative", "dynamic", "passionate", "results-driven".
- Lead with the OUTCOME — the result or the number — then how it was done and with what. "Cut API response time 25% by restructuring the service layer" beats "Worked with Python and FastAPI to build services". Don't tack on an explanatory clause justifying why the bullet matters.
- Prefer bullets that carry evidence from the master CV: a figure, a scale (users, requests, services, team size) or a named system. A bullet without one stays when it shows something the job asks for that no other bullet shows (testing, collaboration, ownership, delivery to users); otherwise leave it out. Never add a figure to a bullet to give it one.
- Order each role's bullets by what this job asks for most: bullets showing requirements the evidence map says paid work shows come first.
- Write the way a strong engineer describes their own work plainly: direct, specific, no filler.
- ATS BALANCE: While varying your phrasing, you MUST still include the exact technical keywords and skills from the JD analysis that the candidate genuinely has (e.g. "REST API", "Spring Boot", "PostgreSQL", "CI/CD"). Natural phrasing does not mean dropping keywords — weave them into plain sentences. The scanner needs the exact terms; the recruiter needs readable prose. Deliver both.
- Keep each bullet's core keyword density intact: name the real technology, the real metric, the real action verb. Just vary the SENTENCE STRUCTURE around them, not the keywords themselves.
- Before you answer, search your draft for each banned phrase and for any bullet whose last clause explains why it matters to the employer, and rewrite those bullets.

${budget}
${retryBlock}
You will receive the JD analysis as JSON. Keep the same employer, title, and dates exactly as in the master CV. Reorder bullets so the most JD-relevant come first. If a role has a highlight/headline line under its header in the master CV (e.g. "Highlight: …"), do NOT drop it — output it as that role's FIRST bullet. Bold quantified wins with **. Do not invent bullets — use only what's in the master CV.

OUTPUT FORMAT — follow exactly, no exceptions:
For each position output its header line first, then the bullets beneath it:
<Role Title> | <Employer> | <Dates>
• bullet
• bullet
...next position header...
• bullet
...

Begin directly with the first job header. Never write bullets, summaries, or any text before the first job title. Never repeat bullets outside their own job block. Every line under a job header MUST begin with "• " — even when the master CV lists achievements (or a highlight line) without bullet markers. Never output a plain unmarked line inside a job block.

CRITICAL SCOPE: Output entries from the EXPERIENCE section only. Do NOT include personal projects, side projects, or portfolio entries — they appear later in the master CV under a separate PROJECTS section and are rendered separately by the application. Stop output at the end of the last employment entry.

Output ONLY the work experience section as plain text. No preamble, no integrity check.`;
const DEFAULT_PROJECTS_BUDGET = `LENGTH BUDGET — the finished CV must fit on TWO A4 pages, and projects sit after
experience, so they are what pushes it over. Write 2 bullets per project, not 3,
whenever there are 3 or more projects. Keep each bullet to a single printed line
where possible and never more than two. Trim by dropping a whole bullet, never by
merging two achievements or combining their metrics into one sentence.`;

// `budget` as in experiencePrompt: /api/tailor passes the adaptive version.
export const projectsPrompt = (cv: string, projectNames: string[] = [], budget?: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, retryBlock: string = "", evidenceBlock: string = "") => {
  const projectList = projectNames.length > 0
    ? projectNames.map((n, i) => `${i}: ${n}`).join("\n")
    : "(none)";
  return `You write tailored CV project bullets. You do NOT write project names, tech stacks, or links — only the bullet points.

${ABSOLUTE_RULES}
${claimsBlock}
${evidenceBlock}

MASTER CV:
${cv}

${BULLET_SHAPE_RULE}

CRITICAL ANTI-EMBELLISHMENT RULES:
- Describe each project using ONLY technologies, actions, and outcomes explicitly in the master CV for THAT project.
- FORBIDDEN: inventing capabilities, tools, or metrics not in the CV for that project.
- Every phrase must be defensible if an interviewer asks "show me exactly where you did this."

NATURAL WRITING RULES:
- Lead with the outcome or the number, then how. Prefer bullets with evidence from that project's own text (a figure, a scale or a named system); keep one without when it shows something this job asks for, and never add a figure to give a bullet one.
- Vary bullet structure; do not end every bullet with an em-dash + "-ing" phrase.
- Vary bullet length. Ban: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "showcasing", "expert", "cutting-edge", "world-class", "innovative", "dynamic", "passionate", "results-driven".

The candidate's CV contains these projects (by index):
${projectList}

You will receive the JD analysis as JSON. For EACH project by index, write the number of bullets the LENGTH BUDGET below allows (What + How + Result), most relevant to this job first — fewer when the master CV has fewer for that project. Quantify only where the master CV quantifies for that project.

${budget ?? DEFAULT_PROJECTS_BUDGET}
${retryBlock}
Output ONLY valid JSON — an OBJECT mapping each project index (as a string) to its array of bullet strings. Example shape for 2 projects:
{
  "0": ["bullet 1", "bullet 2"],
  "1": ["bullet 1", "bullet 2"]
}

If there are no projects, output {}.
Each bullet is a plain string with no leading dash.`;
};

// Advanced customization: the user pasted their FULL project pool as free text
// (master_cvs.projects_pool). Instead of tailoring the master CV's own
// projects, this step SELECTS the 2 most relevant pool projects for the JD /
// company stack and writes their bullets. The pool is the master source for
// project claims; the CV is context only.
// coverageBlock: lib/evidenceMap poolCoverageBlock — which of the posting's
// requirements each pool project names, computed, so selection rests on
// evidence rather than on project names.
export const poolProjectsPrompt = (cv: string, pool: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, retryBlock: string = "", evidenceBlock: string = "", coverageBlock: string = "") => `You select and tailor CV projects from the candidate's full project pool.

${ABSOLUTE_RULES}
${claimsBlock}
${evidenceBlock}

MASTER CV (context only — the candidate's skills and experience):
${cv}

${BULLET_SHAPE_RULE}

PROJECT POOL — the candidate's own complete list of projects, in their own
words. For project claims THIS POOL IS the master source: every project name,
technology, metric, date, and outcome you output must appear in the pool
entry for that project.
${pool}

You will receive the JD analysis as JSON (for a company-outreach run it
describes the company's real stack rather than a posted job).

SELECTION:
- Pick EXACTLY the 2 pool projects that best show what this job asks for —
  its required skills and key responsibilities (testing, data processing,
  event-driven systems, user-facing products …) — preferring what the paid
  experience does NOT already show. Judge by genuine overlap of technologies,
  responsibilities and problem domain, never by name-matching.
${coverageBlock}
- If the pool contains only one project, pick that one alone.
- Never invent a project. Never merge two pool entries into one (rule 7): each
  selected project keeps only its own tech and outcomes.

For each selected project write 3 tailored bullets (What + How + Result),
fewer when its pool entry has fewer, using ONLY that project's own pool entry.
The first bullet shows what this job asks for most. Quantify only where the pool
quantifies for that project. Bold quantified wins and exact JD-matching
technologies the pool genuinely shows with **.

NATURAL WRITING RULES:
- Vary bullet structure; do not end every bullet with an em-dash + "-ing" phrase.
- Vary bullet length. Ban: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "showcasing".
- Prefer bullets with evidence from the pool entry (a figure, a scale or a named system); never add a figure to give a bullet one.
${retryBlock}
Output ONLY valid JSON (no fences), exactly this shape:
{
  "selected": [
    {
      "name": "project name copied verbatim from the pool — never containing ' | '",
      "date": "the project's date from the pool in a form like 'Jan 2025' or '2024 – 2025', else empty string",
      "tech": "that project's tech-stack line verbatim from the pool, else empty string",
      "bullets": ["bullet 1", "bullet 2"]
    }
  ]
}

Each bullet is a plain string with no leading dash. Order "selected" most
relevant first.`;

export const COMPANY_RESEARCH_PROMPT = `You synthesize company research for a cover letter, working only from the JD analysis provided.

You will receive the JD analysis as JSON. Do NOT fabricate specific facts (funding, exec names, product details) not present in the analysis. Work from what's there plus reasonable general knowledge.

Output ONLY a JSON object (no fences):
{
  "what_company_does": "2 sentences",
  "concrete_hooks_for_cover_letter": ["3 specific angles to open the cover letter"],
  "values_to_mirror": ["2-4 company values to reflect in tone"],
  "caution_notes": ["things to avoid claiming"]
}`;

// Stage 3 — builds the company profile from REAL scraped content (homepage,
// about page, live job-ad keywords), unlike COMPANY_RESEARCH_PROMPT above
// which synthesizes from the JD analysis alone.
export const COMPANY_PROFILE_PROMPT = `You build a factual company profile from scraped public content — the company's homepage, about page, careers signals, and keywords from their live job ads.

You will receive a JSON input: { domain, page_title, meta_description, homepage_text, about_text, website_stack, job_ad_stack_keywords, sample_job_titles }.

STRICT SOURCING: use ONLY what is in the input. Never invent funding, headcount, customers, executives, or products the text doesn't mention. If something isn't determinable from the input, use an empty string or empty array.

The engineering-stack signal: job_ad_stack_keywords come from the company's LIVE job ads and are the most reliable indicator of what their engineers build with. website_stack is only what their public website runs on — often just a marketing site. Never present website_stack items as the engineering stack unless the job ads or the text confirm them.

Output ONLY a JSON object (no fences):
{
  "company_name": "the company's name as the content states it",
  "what_they_build": "1-2 sentences: the product and the problem it solves",
  "target_audience": "who they sell to (e.g. 'Enterprise', 'SMBs', 'Consumers', 'Developers'), from the content",
  "ai_footprint": "1 sentence on their current AI usage or ambitions if the content shows any, else empty string",
  "pain_points": ["1-3 engineering problems they are visibly working on, inferred ONLY from the job ads / careers content"],
  "engineering_stack": ["consolidated stack terms — ONLY terms present in job_ad_stack_keywords or explicitly in the text"],
  "tone_words": ["2-4 words describing the company's voice, for cover-letter tone matching"]
}`;

// Stage 3 — scores the master CV against a researched company profile.
// reconcileFitScore (lib/fitScore.ts) bounds hard_skills with the
// deterministic keyword overlap and recomputes the weighted total.
export const FIT_SCORE_PROMPT = `You are a rigorous technical recruiter scoring how well a candidate fits a specific company. Honesty is the product: a padded score sends someone into a rejection pile.

${ABSOLUTE_RULES}

You will receive JSON: { company_profile, engineering_stack, master_cv }.

Score four components, each an integer 0-100 with one sentence of evidence quoting the master CV:
- hard_skills (worth 40%): do the languages, frameworks and tools in the master CV match the company's engineering_stack? Award points ONLY for stack items the master CV explicitly shows. A related-but-different technology earns partial credit only when the evidence names both sides honestly (e.g. "you have PostgreSQL; they list MySQL").
- domain (worth 30%): has the candidate worked in this company's sector or an adjacent one (FinTech, HealthTech, e-commerce, …)? Judge from real employers and projects in the CV, not job titles alone.
- scale (worth 20%): does the CV show experience at this company's kind of scale or stage — early-startup velocity vs high-traffic enterprise scaling? If the CV gives no scale signals either way, score 50 and say so in the evidence.
- product (worth 10%): does the CV demonstrate building user-facing features and product thinking, or purely backend/infrastructure work?

VOICE: "evidence", "honest_gaps" and "headline" are shown directly to the candidate — address them as "you" and "your CV", never "the candidate".

honest_gaps: 1-2 sentences naming the biggest REAL gaps between you and this company, plainly. Never soften a gap into a strength, and never suggest adding skills you don't have.

headline: one sentence, addressed to you: is applying worth your time, naming the company.

Output ONLY a JSON object (no fences):
{
  "components": {
    "hard_skills": { "score": 0, "evidence": "..." },
    "domain": { "score": 0, "evidence": "..." },
    "scale": { "score": 0, "evidence": "..." },
    "product": { "score": 0, "evidence": "..." }
  },
  "honest_gaps": "...",
  "headline": "..."
}`;

// Stage 3 high-fit extra — a 60-90 second spoken pitch (e.g. for a Loom).
export const pitchScriptPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK) => `You write a 60-90 second SPOKEN pitch script (150-220 words) the candidate will record for a specific company.

${ABSOLUTE_RULES}
${claimsBlock}

MASTER CV:
${cv}

You will receive JSON: { company_research, jd_analysis (may be absent) }.

Structure, without printing the section names:
1. A direct opening naming the company and the specific thing they build (from the research — never invented).
2. Why them: one genuine connection between the candidate's real experience and the company's product or a pain point from the research.
3. Proof: one or two concrete, verbatim-faithful achievements from the master CV that matter for this company's stack. Exact numbers only.
4. Close: one sentence asking for the conversation.

SPOKEN, NOT WRITTEN: contractions are fine, no bullet points, no headings, no stage directions or bracketed placeholders. Short sentences that can be said in one breath. First person. Ban: "leveraging", "passionate", "at scale", "end-to-end", "seamless".

Never claim a technology from the company's stack that the master CV doesn't show — name the nearest real skill instead, honestly.

Output ONLY the script as plain text.`;

// Stage 3 high-fit extra — interview prep grounded in the research.
export const talkingPointsPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK) => `You prepare interview talking points for a candidate, grounded ONLY in their master CV and the company research provided.

${ABSOLUTE_RULES}
${claimsBlock}

MASTER CV:
${cv}

You will receive JSON: { company_research, jd_analysis (may be absent) }.

VOICE: prep notes addressed straight to the candidate — "you", "your work on X" — never "the candidate".

Output plain text (no JSON, no markdown headers) in exactly this shape:

WHY THIS COMPANY
• 3-4 lines, each one specific angle connecting your real experience to their product, stack, or a pain point from the research. Each must survive the interview test: defensible from the master CV alone.

QUESTIONS TO ASK THEM
• 2-3 sharp questions about their product or engineering challenges, drawn from the research — the kind that show you did the homework.

HONEST WATCH-OUT
• 1 line: the gap they are most likely to probe, and the truthful way to address it (never a way to disguise it).

Each line starts with "• ". Nothing else.`;

// Stage 4 — the interview prep pack. One JSON call; every answer must be
// traceable to the master CV, and the route runs a deterministic tracer over
// the `evidence` lines afterwards (lib/prepPack.ts#verifyEvidence), so the
// prompt tells the model plainly that paraphrased citations will be flagged.
// Gap questions exist so the pack is honest about what the CV can't support
// instead of inventing a story for it.
export const interviewPrepPrompt = (cv: string) => `You prepare a candidate for a specific interview, grounded ONLY in their master CV and the inputs provided.

${ABSOLUTE_RULES}

MASTER CV:
${cv}

You will receive JSON: { company, role, status, job_description, tailored_cv_text (the CV they actually sent — may be absent), company_research (may be absent), matched_stack (may be absent), known_stack_gaps (may be absent — deterministic: stack items the CV does NOT show), existing_talking_points (may be absent) }.

VOICE: prep addressed straight to the candidate — "you", "your work on X" — never "the candidate". Inside STAR fields, first person is fine ("I led…") because they will say it aloud.

QUESTIONS — exactly 8 to 10, in this mix, each answered in the form named:
- 3 "behavioral": the interviewer's real question; answer = a STAR story built from ONE real role or project in the master CV, plus evidence. points = [].
- 3 "technical": ONLY technologies the job_description names AND the master CV shows (prefer matched_stack when present); never a technology the CV lacks. answer = 2-3 points (what you have actually done with it, then how you would approach their problem), plus evidence. star = null.
- 1 "role": motivation / why this role — from the job_description and the CV; no invented history with the company. answer = 2-3 points. star = null; evidence optional.
- 1 "company": ONLY when company_research is present, built from it; omit the category entirely when it is absent. answer = 2-3 points. star = null; evidence = [].
- 2 "gap": what they are most likely to probe that the CV cannot support (known_stack_gaps first, then the job_description). star = null, evidence = []. points = an honest strategy: acknowledge it plainly, name the nearest REAL adjacent experience from the CV (or say there is none), and how you would close the gap. NEVER a story that implies the experience exists.

LENGTH — this is one pass and it must fit: situation/task/action/result at most 40 words each; every point at most 40 words; whyTheyAsk at most 20 words; at most 2 evidence lines per question; at most 4 questionsToAsk. Short and specific beats long.

STAR rules: result carries a number ONLY if that exact figure is in the master CV; otherwise describe the outcome without a number. Never merge two projects (rule 7). Employers, titles and dates verbatim (rule 8).

evidence: lines COPIED VERBATIM from the MASTER CV — same words, same numbers, no trimming, no paraphrase. A deterministic checker will search the CV for each line and flag any it cannot find.

angle.headline: one honest sentence on whether this is a good match and why.
angle.whyYou: 3-5 bullets, each defensible from the master CV alone.
angle.honestGaps: 1-4 items { gap, howToAddress } — never softened into strengths.
questionsToAsk: 3-5 sharp questions about their product or engineering, from the job_description or company_research; none if there is nothing real to draw on.
opener: a spoken "tell me about yourself" of at most 90 words, from the CV only.

If status is "Screening", weight toward recruiter-screen questions; if "Interview", weight toward depth.

BAN everywhere, including gap descriptions: "leveraging", "passionate", "at scale", "end-to-end", "seamless", "synergy", bracketed placeholders of any kind.

Output ONLY a JSON object (no fences), exactly this shape:
{
  "angle": { "headline": "...", "whyYou": ["..."], "honestGaps": [{ "gap": "...", "howToAddress": "..." }] },
  "questions": [
    { "category": "behavioral|technical|role|company|gap", "question": "...", "whyTheyAsk": "...",
      "star": { "situation": "...", "task": "...", "action": "...", "result": "..." } | null,
      "points": ["..."], "evidence": ["verbatim CV line"] }
  ],
  "questionsToAsk": ["..."],
  "opener": "..."
}`;

// Stage 3 cold outreach — owner-only for now (/api/extras gates on
// profiles.is_unlimited). Speculative when no jd_analysis is supplied.
// Structure follows the UKJI (UK Jobs Insider) cold-email template the owner
// supplied — subject "Potential Opportunity at {Company}", interest → genuine
// initiative paragraph → 3-skill value line → attachment note → courteous
// close — replacing the earlier coach template wholesale. Two honesty
// departures from UKJI, both required by ABSOLUTE_RULES: the "I've been
// following…" history claim may only come from a USER-typed personal_note
// (never invented), and every skill/metric must be verbatim-defensible from
// the master CV. The closing mentions BOTH the CV and the cover letter,
// because the app generates both alongside this email.
export const coldEmailPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK) => `You write a COLD outreach email from a job seeker, grounded ONLY in their master CV, the company research, and the optional personal note provided.

${ABSOLUTE_RULES}
${claimsBlock}

MASTER CV:
${cv}

You will receive JSON: { company_research, jd_analysis (absent for a speculative approach — no posted role), recipient_name (optional), personal_note (optional — the candidate's own true words about how they know the recipient or company) }.

Subject line: exactly \`Potential Opportunity at {Company}\` — the company's name from the research — nothing else appended.

THE BODY, in exactly this order:
1. Greeting: "Hello {recipient_name}," when provided, otherwise "Hello {Company} team,".
2. "I hope this message finds you well. I'm reaching out to express my interest in the {role} role at {Company}." — take the role title from jd_analysis; when jd_analysis is absent or names no specific role, instead express interest in engineering roles at {Company}. NEVER invent a role title.
3. Genuine interest — at most 2 lines about ONE real, specific company initiative, product, or engineering problem from the research, and why it interests the candidate. If personal_note is provided, build this from it faithfully (it may carry real history like "I've been following…", because the candidate wrote it). Without a note: present-tense reactions only ("Your work on X stands out because…") — NEVER claim a history of following, watching, or admiring the company or any person.
4. EXACTLY ONE sentence, no more: "After diving deeper into {Company}'s work, I'm confident that with my {up to 3 top relevant skills/experience}, I can add substantial value to {the team or department when the research or jd_analysis names one, otherwise "your engineering team"}." — every skill verbatim-defensible from the master CV AND genuinely relevant to their stack; may include ONE quantified achievement from the CV, exact numbers only. Never name a technology from their stack that the master CV doesn't show. Do NOT add further sentences about other experience after this one.
5. The attachment note, at most 2 sentences: the candidate is applying and has attached their CV and cover letter for convenience, and would love to connect and discuss how they can contribute.
6. "In case of any questions, please do let me know. Thank you for your time and consideration."
7. "Best regards," then the candidate's full name from the CV.

HARD LIMIT: the body must be UNDER 170 words. Before answering, count the body's words; if it is 170 or more, delete whole sentences (never the fixed template lines) until it is under. Write like a person: contractions fine, short sentences, zero flattery ("huge fan"), zero begging ("it would make my day"), zero AI-tells. BAN: "leveraging", "passionate", "seamless", "at scale", "end-to-end", "I came across", "life-transforming", "mutually beneficial synergy".
No bracketed placeholders of any kind. No invented facts about the company — only what the research shows.

Output EXACTLY this format, nothing else:
Subject: <subject line>

<body>`;

// omitRightToWork: the user keeps Right to Work off the document
// (lib/preferences, the default), so the letter must not raise it either —
// the route strips any such sentence deterministically afterwards.
// The letter is evidence-first (the 20 Sep applications carried an invented
// anecdote, industry opinions and filler lessons): every statement about the
// candidate is a master-CV fact with its own employer or project; the route
// then checks each such sentence against the master CV (lib/supportCheck).
export const coverLetterPrompt = (cv: string, claimsBlock: string = DEFAULT_CLAIMS_BLOCK, omitRightToWork: boolean = false, evidenceBlock: string = "") => `You write a cover letter for one job: 200 to 300 words of plain, confident, specific English — dense with true facts, never padded.

${ABSOLUTE_RULES}
${claimsBlock}
${evidenceBlock}

MASTER CV:
${cv}

You will receive JSON: { analysis (the job — role, company, required skills, key responsibilities, seniority, tone), research (the company) }.

STRUCTURE — four short paragraphs, no headings:
1. The role by name, and one specific, true reason it fits: connect something concrete from the posting or the research (the product, a responsibility, the stack) to the candidate's real work. No invented history with the company, no flattery.
2. The strongest evidence for the job's most important requirement: one example from the master CV — what was built, how, and the result with its exact figure — named with the right employer or project.
3. A second example for another requirement or key responsibility, from a different employer or project where possible. If an essential requirement has NO evidence in the master CV (see the evidence map), you may add ONE plain sentence naming the nearest real experience: no apology, no promise to learn fast, and never implying the missing experience exists.
4. A short close: the facts the posting screens on that the master CV states (for a graduate role, the degree and its completion date as written there), then thanks.

TRUTH:
- Every statement about the candidate's past is a fact the master CV states, told with the same employer or project. No anecdotes, conversations, feelings or lessons the master CV does not state ("I spent time with the teams…", "that taught me…").
- No opinions about the employer's industry or customers ("insurance workflows are broken").
- Figures exactly as the master CV states them, each with its own fact; never join two into a range.
- A project-level skill only as work in that named project; a learning-level skill never.
- Work from a personal project is always named with its project, and the first mention says it is a personal project ("in RideX, a personal project, I …"); it must never read as work done for an employer.
- Never state the same fact twice in the letter.
- A degree whose dates in the master CV run into the future is in progress: "I am completing an MSc in Computer Science, expected January 2027" — never "I hold", "I have" or "I graduated with" it.
- A sentence-by-sentence check against the master CV runs on this letter afterwards; anything it cannot find there is removed.

SALUTATION AND SIGN-OFF: open with "Dear Hiring Manager," — or "Dear <Company> team," when the company is known; never "Dear <Company>,". End with "Kind regards," on its own line and then the candidate's full name from the master CV.

STYLE:
- At most ONE em-dash (—) in the whole letter.
- No sentence strings more than two achievements together.
- BAN: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "operational chaos", "cuts through", "passionate", "expert", "cutting-edge", "world-class", "innovative", "dynamic", "results-driven", "I am excited", "thrilled", "fast learner", "hit the ground running", "perfect fit", "dream job", "not glamorous", "fast-paced", "from day one", "solid foundation", "track record", "taught me", "demonstrated the ability", "showing a", "directly transferable", "that exact", "exactly what".
- Never tell the reader what the role needs or emphasises, and never say the candidate's work matches it ("the foundation this role needs", "the craftsmanship your role emphasises", "under that exact constraint"): state the fact and let the reader connect it. A personal project is described at its real scale — never as production traffic it did not have.
- Do not open with a dramatic scene or a general statement about engineering. Match the analysis tone_signals.
- No date line, no address block, no bracketed placeholders of any kind — the app adds today's date itself.
${omitRightToWork ? "- Do NOT mention visa, sponsorship, right to work or immigration status anywhere in the letter, even though the master CV states it. The application form asks that question.\n" : ""}
Before you answer, reread the letter: delete every sentence that is not a fact from the master CV, a fact from the posting or the research, or part of the close.

Output ONLY the cover letter as plain text. No word count, no notes, no preamble.`;

// The "Fix it" button on /app (/api/fix-claims): the sentences the claims
// check still flags after lib/claimRepair's exact trims, each rewritten once
// so the CV passes and still reads for THIS job. Every replacement is
// re-checked on its own before it is applied, and a sentence whose rewrite
// still fails is removed — so the button always ends in a CV that passes.
export const claimsRepairPrompt = (
  cv: string,
  claimsBlock: string,
  job: { title: string; keywords: string[]; required: string[] }
) => `You repair flagged sentences in a tailored CV and cover letter so that every claim matches the candidate's own records, while the text still reads well for the job below.

${ABSOLUTE_RULES}

${claimsBlock}

THE JOB
Title: ${job.title || "not stated"}
Terms a recruiter will search for: ${job.keywords.join(", ") || "none given"}
Required skills: ${job.required.join(", ") || "none given"}

You will receive a JSON list of items: {"id", "section", "sentence", "problems"}. Each sentence breaks the rules named in its problems. For each item write ONE replacement for that sentence, in the same place in the same section:
- Fix only the named problems. Keep every other fact, figure, technology and outcome in the sentence, attached to the same piece of work.
- Remove only the flagged skill's own words: for "LLM/RAG knowledge solutions" with RAG flagged, write "LLM knowledge solutions". Never move an outcome or a figure onto a different piece of work, and never merge two pieces of work into one.
- Keep every claim with its own source. Words from one job's bullets may not describe a personal project or another job, and a project's words may not describe paid work. If the replacement names a project or an employer, everything it says about it must come from that project's or that employer's own lines in the master CV. In the cover letter, when no specific true claim is left, remove the sentence rather than write a vaguer one.
- Experience: no skill registered at project or learning level may appear in it at all.
- Summary and cover letter: a project-level skill may appear only as something built in a named project the master CV shows ("built Jobhuntz with RAG"), never beside experience, expertise, proficient, skilled, strong, advanced, deep or a number of years. A learning-level skill may not appear anywhere.
- A figure the problems say is not on the master CV: use the master CV's exact figure for the same fact, or write the sentence without a figure. Never round, estimate or invent one.
- A range the problems say joins two figures: state each figure only with the fact the master CV gives it, or drop them.
- A skill the problems say the master CV never shows: remove it and any words that only carry it; never replace it with a vaguer claim to the same experience.
- A sentence the problems say states something the master CV does not: rewrite it to say only what the master CV states about the same work, or return "" when nothing true is left.
- Where a true wording uses the job's terms above, prefer it, but only terms the master CV supports for this same piece of work (rules 5 and 6). Add no skill, tool or figure that is not already in the sentence or in the master CV for this work.
- Keep the sentence's form: an experience or project bullet stays one bullet-length sentence that opens with a strong verb; a skills line keeps its "Label: item | item" form; a summary sentence stays one sentence.
- If nothing true is left to say, the replacement is "" (the sentence is removed).

MASTER CV (the only source of truth):
${cv}

Output ONLY JSON: {"edits":[{"id":"r1","replacement":"..."}]} with one entry per item. No preamble, no notes.`;

// The summary and the letter, checked sentence by sentence against the
// master CV (lib/supportCheck verifies every quote before acting on it).
export const supportCheckPrompt = (cv: string, pool: string = "") => `You check the facts in a tailored CV summary and cover letter against the candidate's own master CV. You do not judge style; you verify claims.

MASTER CV (the only source of truth about the candidate):
${cv}
${pool ? `\nPROJECT POOL (the candidate's own project descriptions — also a source):\n${pool}\n` : ""}
You will receive JSON: { "sentences": [{ "id", "section", "sentence", "problems"? }] }.

For EVERY sentence that states something about the candidate's own past — work done, systems built, results and figures, tools used, education, how they worked, what happened in a role or project — decide whether the master CV supports it. Skip sentences that only express interest in the job or company, state facts about the company or the posting, give availability, or thank the reader.

For each sentence you check, return:
- "id".
- "support": the master-CV (or pool) lines that support it, COPIED VERBATIM — whole lines or exact spans — or [] when none does. A deterministic checker searches for every line you quote and ignores paraphrases.
- "supported": true only when EVERY claim in the sentence is in those lines — the same work, the same employer or project, the same figures. A sentence that adds an anecdote, a conversation, a lesson learned, a personal quality, a figure, a scope or a context the lines do not state is NOT supported. Moving a result from one employer or project to another is NOT supported.
- "fix": only when not supported — the sentence rewritten to say only what the master CV states about the same work, keeping its place and purpose in the text; "" when nothing true is left. A fix never repeats a fact another sentence of the text already states (you receive every sentence): when the only true content left would repeat one, return "". A fix never combines facts from two projects, or from a project and an employer — each fact stays with its own named project or employer.
A sentence that arrives with "problems" was flagged by a deterministic check (it narrates its relevance to the role, or grades the candidate): it is NOT acceptable as written even when its facts are true — return "supported": false and a fix that keeps only the plain fact.
A sentence that names the role being applied for, or mixes interest in the job with a claim, keeps the role's name and the interest in its fix; drop only the unsupported part.

Output ONLY JSON: {"checks":[{"id":"s1","supported":true,"support":["…"]},{"id":"l2","supported":false,"support":[],"fix":"…"}]}`;

// A cover letter named a place that appears nowhere in the job description,
// the research or the CV ("available for on-site work in Shoreditch").
// lib/properNouns finds such names; this asks for the offending sentences
// only to be rewritten, and the route drops them if the rewrite still fails.
export const coverLetterFixPrompt = (unsupported: string[], sentences: string[]) => `You fix a cover letter. Output the FULL letter with ONLY the sentences listed below rewritten; every other sentence must stay exactly as it is.

${ABSOLUTE_RULES}

These names appear in the letter but in none of the job description, the company research or the candidate's CV, so they are invented and must go: ${unsupported.map((n) => `"${n}"`).join(", ")}.

Sentences to rewrite (rewrite each without any place, company, product or person that is not in those sources; do not replace an invented name with another name; if the sentence has nothing left to say, remove it):
${sentences.map((s) => `- ${s}`).join("\n")}

Output ONLY the full letter as plain text. No preamble, no notes.`;

// The verdict is NOT written here. lib/visibilityVerdict computes the band
// from the deterministic keyword match and hands it in as `bandBlock`; the
// model annotates the settled lists and proposes edits inside that band.
export const atsScoringPrompt = (bandBlock: string) => `You annotate a settled recruiter-search-visibility score for a tailored CV and propose edits within its band.

${ABSOLUTE_RULES}

${bandBlock}

You will receive a JSON input containing: the settled score (band, counts, present and absent terms), and the tailored sections (summary, skills, experience, projects).

The membership of every term is already decided. You may NOT move a term between present and absent, add or drop a term, or quote a different count.
- "hits": one entry per PRESENT term, in the order given, each starting with the term verbatim followed by " — " and the section it appears in.
- "misses": one entry per ABSENT term, in the order given, each starting with the term verbatim followed by " — " and a brief honest reason addressed to "you".

CRITICAL for edits: NEVER propose adding a skill, keyword, or technology the candidate does not genuinely have. NEVER propose "(Learning)" tags or keyword-stuffing. An edit surfaces something real that is already in the master CV but absent from the tailored text, reorders real content, or names a genuine gap they could close by actually learning the skill (as a real action, not a CV edit). Each edit is an action, not an opinion: never describe the CV as strong, competitive, submittable or ready — the band above already said what it is.

VOICE: this text is shown directly to the person whose CV it is. Address them as "you" / "your CV", never "the candidate". Never write "ATS": say "recruiter search" or "the role's terms".

Output ONLY a JSON object (no fences):
{
  "hits": ["term — section it appears in"],
  "misses": ["term — brief honest reason, addressed to \"you\""],
  "edits": ["actions only, as many as the band above asks for"]
}`;

export const PROFILE_EXTRACTION_PROMPT = `You extract factual profile details from a CV. Extract ONLY what is explicitly present — never invent or guess. If a field isn't in the CV, use an empty string or empty array.

Output ONLY this JSON (no fences, no preamble):
{
  "name": "full name as written, e.g. JANE DOE",
  "tagline": "the professional headline/title line under the name (e.g. 'Full-Stack Engineer') if present, else empty string. Do NOT put contact details here — no email, phone, location, or LinkedIn/GitHub URLs; those belong in their own fields.",
  "location": "city/country if present, else empty",
  "phone": "phone number if present, else empty",
  "email": "email if present, else empty",
  "linkedin": "LinkedIn URL or handle if present, else empty",
  "github": "GitHub URL or handle if present, else empty",
  "website": "personal portfolio or website URL if present (NOT LinkedIn/GitHub — those go in their own fields), else empty",
  "education": [
    { "degree": "degree + any modifier", "dates": "date range", "institution": "school name", "note": "every additional bullet point listed under this entry, verbatim and complete, one per line separated by \\n if there are multiple entries — capture ALL of them, not just the first, else empty string" }
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
  "skills": [
    { "name": "one technology, language, framework, tool or method exactly as the CV names it", "level": "production | project | learning" }
  ],
  "rightToWork": ["each right-to-work / visa line as one string, empty array if none"],
  "extraSections": [
    { "title": "section heading as written, e.g. RECOGNITIONS", "bullets": ["each line or bullet under this heading, verbatim"] }
  ]
}
For projects: extract each project listed in a Projects/Portfolio section. If the CV has NO projects section, use an empty array []. Do not invent projects. Extract names, tech, and URLs verbatim.

For extraSections: capture every CV section whose content is NOT already captured by the fields above and is NOT a summary/profile, skills, experience/work history, projects, education, certifications, or right-to-work/visa section. Examples: recognitions, awards, publications, languages, volunteering, interests. Keep the heading exactly as written and each line verbatim, in original order. Empty array if none.

For skills: list every named technology, language, framework, tool or method in the CV, each once, up to 80. level is decided ONLY by where the CV shows it used: "production" if it appears in an employment/experience bullet or a role's tech line; "project" if it appears only under a personal or side project; "learning" if the CV lists it under a heading or phrase like "currently studying", "learning", "familiar with", "exposure to", "coursework" or similar. Never promote a skill above the evidence; when unsure, use "project".

Extract verbatim where possible. Do not reformat dates or names. Do not add anything not in the CV.`;