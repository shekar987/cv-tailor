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
  "tone_signals": "formal | semi-formal | founder-casual | technical-dense",
  "hard_gates": [
    {
      "category": "sponsorship | clearance | years | location | degree | licence | employment_type",
      "requirement": "the sentence or bullet COPIED VERBATIM from the job description",
      "strictness": "must | preferred"
    }
  ]
}
hard_gates are the conditions an application form screens on before anyone reads the CV: right to work / visa sponsorship, security clearance (SC, DV, BPSS, NPPV, Secret/TS), a number of years stated as a requirement, on-site / hybrid / location or relocation conditions, a required degree or degree class, licences or certifications that must already be held, and contract vs permanent terms. Copy each requirement sentence exactly as written - a deterministic checker discards any entry it cannot find verbatim in the text. Use "preferred" when the posting says nice-to-have, ideally, desirable or a plus. Empty array when there are none. Never infer a gate the text does not state.`;

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
You will receive the JD analysis as JSON. Write exactly 3 lines — three SEPARATE lines of text with a real newline between them, never one merged paragraph. Each line must contain one concrete piece of evidence (metric, brand, project, or scale) from the master CV. Match the seniority_level and role_type from the analysis. No "junior" framing unless the analysis says junior.

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

Output ONLY the skills line(s) as plain text. Never wrap the labels or any skills text in ** or other markdown markers. No extra headings, no preamble, no integrity check.`;

// `budget` lets /api/tailor pass an adaptive budget computed from the actual
// master CV (lib/contentBudget.ts); the fixed LENGTH_BUDGET stays the default
// so nothing else changes behaviour.
export const experiencePrompt = (cv: string, budget: string = LENGTH_BUDGET) => `You rewrite the CV work experience section, tailored to a specific job.

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

${budget}

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
export const projectsPrompt = (cv: string, projectNames: string[] = [], budget?: string) => {
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

${budget ?? DEFAULT_PROJECTS_BUDGET}

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
export const poolProjectsPrompt = (cv: string, pool: string) => `You select and tailor CV projects from the candidate's full project pool.

${ABSOLUTE_RULES}

MASTER CV (context only — the candidate's skills and experience):
${cv}

PROJECT POOL — the candidate's own complete list of projects, in their own
words. For project claims THIS POOL IS the master source: every project name,
technology, metric, date, and outcome you output must appear in the pool
entry for that project.
${pool}

You will receive the JD analysis as JSON (for a company-outreach run it
describes the company's real stack rather than a posted job).

SELECTION:
- Pick EXACTLY the 2 pool projects most relevant to this JD/stack — judged by
  genuine overlap of technologies and problem domain, never by name-matching.
- If the pool contains only one project, pick that one alone.
- Never invent a project. Never merge two pool entries into one (rule 7): each
  selected project keeps only its own tech and outcomes.

For each selected project write 2-3 tailored bullets (What + How + Result)
using ONLY that project's own pool entry. Quantify only where the pool
quantifies for that project. Bold quantified wins and exact JD-matching
technologies the pool genuinely shows with **.

NATURAL WRITING RULES:
- Vary bullet structure; do not end every bullet with an em-dash + "-ing" phrase.
- Vary bullet length. Ban: "at scale", "production-grade", "end-to-end", "leveraging", "robust", "seamless", "showcasing".

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
export const pitchScriptPrompt = (cv: string) => `You write a 60-90 second SPOKEN pitch script (150-220 words) the candidate will record for a specific company.

${ABSOLUTE_RULES}

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
export const talkingPointsPrompt = (cv: string) => `You prepare interview talking points for a candidate, grounded ONLY in their master CV and the company research provided.

${ABSOLUTE_RULES}

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
export const coldEmailPrompt = (cv: string) => `You write a COLD outreach email from a job seeker, grounded ONLY in their master CV, the company research, and the optional personal note provided.

${ABSOLUTE_RULES}

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

VOICE: this text is shown directly to the person whose CV it is. Write "misses", "recommendations", and "overall_assessment" addressed straight to them — "you", "your CV", "you're missing" — never in the third person ("the candidate", "the applicant", "this CV"). Never write "ATS" in any output text: the person reads this score as how visible their CV is to a recruiter searching for the role's terms — say "recruiter search" or "the role's terms" instead.

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