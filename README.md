# Jobhuntz

**An honest AI career platform for engineers.** It tailors a CV and cover letter to each job, without inventing anything.

Live at **[jobhuntz.app](https://www.jobhuntz.app/)**. I designed, built and run it on my own.

> The codebase is still called `cv-tailor`; the product was renamed Jobhuntz.

## Why I built it

When I started applying for jobs in the UK, I tried AI CV tools, and they added skills I didn't have just to match the job advert. That's a problem the moment an interviewer asks about it. Jobhuntz works on one rule:

**The AI writes, and the code checks.** Every skill, figure and sentence in a tailored CV has to trace back to the user's own master CV. If it can't, the download is locked until it's fixed.

## What it does

1. **Check:** a free pre-check reads the job advert before any credit is spent. It shows the keyword match, the eligibility gates (right to work, clearance, years, location, degree) and whether the role sits above your level.
2. **Tailor:** it writes the CV (summary, skills, experience, projects) and a cover letter for that job, then scores how easily a recruiter's search would find the CV.
3. **Track:** an application tracker keeps a snapshot of every CV you sent, with status, follow-up dates and a "What's working" view of which applications move forward.
4. **Prepare:** it builds an interview prep pack and runs a spoken mock interview for each tracked application.

## How it works

```
Job advert ─▶ JD analysis ─▶ ┬─ company research ─┐
                             ├─ summary           │
                             ├─ skills            ├─▶ format rules + claims repair ─▶ ┬─ cover letter      ─┐
                             ├─ experience        │                                   └─ score annotation  ─┴─▶ fact check ─▶ CV + letter
                             └─ projects          ┘
```

- **A multi-step LLM pipeline:** one analysis step, five writing steps in parallel, then the cover letter and score notes. Each step returns a fixed format (JSON where code reads it), and one failing step doesn't take down the rest.
- **Checks in code, not just in the prompt:**
  - Skills are registered at production, project or learning level, and a skill is only described at its real level.
  - Experience bullets are *selected* from the master CV by id, with at most two words changed.
  - Every figure must appear in the master CV.
  - A fact-check step (Claude Sonnet) needs a quote from the CV for each sentence.
  - Together these cut the sentences that could not be traced to the source from **28% to 6%** across ten real job adverts.
- **A deterministic score:** a keyword matcher, not the model, counts how many of the role's terms the CV contains and sets the band. An earlier version let the model judge, and it called a 3/15 match "strong".
- **Provider-agnostic routing:** Claude by default, and OpenRouter on the user's own key, behind one call function. When the shared account can't serve a run, it falls back once and refunds the credit.
- **Security:**
  - Supabase Auth and row-level security on every table.
  - Users' API keys encrypted with AES-256-GCM.
  - Usage quotas enforced in SECURITY DEFINER Postgres functions that fail closed.
  - Burst rate limiting on every model route.
  - A pre-launch security review with all eight findings fixed.
- **Real PDFs:** CVs are drawn with a real text layer (jsPDF), and every download is checked by reading its text back before it's sent.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres, Auth, RLS, Storage) · Anthropic Claude API · OpenRouter · docx · jsPDF · Vercel

## Testing

- **About 400 unit tests** (`node:test`, zero dependencies) cover the matcher, the claims registry, the eligibility gates, the bullet checks, the PDF text-layer gate and more.
- **An evaluation harness** in `eval/` runs fixed synthetic CVs and job adverts through the real pipeline before and after every prompt change, and asserts no invented figures, no invented tools, two pages and per-job bullet ordering.

## Running it locally

```bash
npm install
# create .env.local with the variables listed under "Commands" in CLAUDE.md
# (Supabase URL + publishable key, ANTHROPIC_API_KEY, KEY_ENCRYPTION_SECRET)
npm run dev                  # http://localhost:3000
npm test                     # unit tests
npm run build                # production build + type check
```

The schema lives in `supabase/migrations/`. `CLAUDE.md` documents the architecture, the honesty rules and the known gotchas in detail.

## Author

**Soma Shekar Keesari**, full stack & AI engineer, London · [LinkedIn](https://www.linkedin.com/in/shekar-keesari/) · [Portfolio](https://shekar-portfolio-eight.vercel.app/)
