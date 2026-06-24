# CV TAILOR — PROJECT STATUS (handoff)

## What this is
An honest, ATS-aware CV tailoring web app. Next.js 16 + TypeScript + Tailwind,
Anthropic API, deployed on Vercel (cv-tailor-phi-rosy.vercel.app),
repo github.com/shekar987/cv-tailor.
User: Soma Shekar Keesari (first name "Soma Shekar", last name "Keesari"), London.
Building as: personal job-hunt tool + portfolio piece + eventual SaaS for other IT job seekers.
Coaching style wanted: honest pushback, one step at a time, calls out scope drift, teaches concepts, verifies behaviour after each change.

## NON-NEGOTIABLE honesty rules
- No invention of skills/metrics/experience.
- "Currently studying" skills (Go, Kubernetes, Kafka, RAG, distributed-systems design) NEVER appear as current proficiencies.
- 8 Python/AI tutorial-level skills (FastAPI, LangChain, LlamaIndex, Azure, SQLAlchemy, PyTorch, HuggingFace, OpenAI API) kept OFF the CV.
- Python is project-level — never "proficient in Python".
- Real metrics only: 25% API response, 30% SQL query, 40% deploy time, 15% downtime, 3 juniors, 20% defects, 8+ engineers, Microsoft/Tesla/Apple.
- Job titles/employers/dates immutable.

## Architecture principle learned the hard way
TAILOR WHAT VARIES, HARDCODE WHAT DOESN'T. Project names/tech/links are fixed
metadata in code (PROJECTS_META in download route + CvPreview); only bullets are LLM-generated.
This ended ~8 rounds of whack-a-mole.

## Milestones
M1 Working chain ✅ | M2 Generalization ✅ | M3 Code pipeline ✅
M4 Web interface ✅ | M5 DOCX + ATS panel ✅
M6 IN PROGRESS — ~90% to v1.

## M6 remaining plan (locked order)
1. Editable preview + PDF/Word export ✅ DONE (works: edits flow through via blur(), links clickable, dynamic filename FirstName_Company_Role_CV)
2. Embellishment hardening 🔄 — DONE for summary + skills prompts; OPEN QUESTION: verify skills-list isn't adding unverified tools (OAuth/JWT/pandas/matplotlib/scikit-learn/Tailwind/Mockito/Postman/Linux — confirm which are真 in master CV)
3. Cover letter download — make it downloadable PDF/Word (reuse export work)
4. Rate limiting — spending guard, unlocks public URL sharing
5. Landing page
6. Multi-user generalization (the "Bhavani problem": name/contact/education hardcoded as Soma's; biggest lift, do last)

## Key files
- src/lib/claude.ts — callClaude() helper, MODELS.fast=haiku, MODELS.quality=sonnet
- src/prompts/rules.ts — ABSOLUTE_RULES (now includes anti-promotion rules)
- src/prompts/steps.ts — summaryPrompt/skillsPrompt/experiencePrompt/projectsPrompt (projects returns JSON {ridex,financial}), COMPANY_RESEARCH_PROMPT, coverLetterPrompt, ATS_SCORING_PROMPT
- src/app/api/tailor/route.ts — 2-wave orchestrator
- src/app/api/download/route.ts — Word .docx generation, PROJECTS_META fixed data
- src/app/CvPreview.tsx — editable preview, downloadPdf (html2pdf.js), downloadWord (reads edited DOM); blur() before downloads
- src/app/page.tsx — main UI, ATS panel, renders CvPreview with computed fileBaseName

## Notes
- The Claude.ai manual chain doc (in project knowledge) is STALE vs the app prompts — ignore it for app work.
- Don't share the public URL widely until rate limiting (step 4) is done.
- Reply CV produced earlier had embellishment ("Proficient in Python", Kubernetes/Kafka/RAG) — fixed by hardening; hand-edit any older generated CVs before submitting.