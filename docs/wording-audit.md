# Wording audit — Chunk 25 (12 Nov 2026)

Status: **applied.** Steps 1 and 2 produced this file; the owner reviewed it on 12 Nov 2026 and Step 3 changed the code to match. The tables below are the record of what changed.

- 3281 user-facing strings were read from 91 files. 539 were changed; the rest stay.
- Every "current text" was read out of the source by `scripts/wording-extract.mjs` (the TypeScript parser, not a search by eye). The line number is where the string started on `main` at e403175, before this chunk.
- Rules for the new text: British English; short sentences; one idea per sentence; a button says what happens next; no idioms; a term that must stay is explained once in brackets. No proposed string contains an em dash.

## 1. What was read, and what was not

Read: the landing page, sign in / sign up, the top navigation, the first-run guide and banner, Schedule (`/app/next`), To do (`/app/actions`), My CV (`/customize`), Tailor (`/app`) in all its states with both previews, the waiting popup and the form answers, Applications (`/applications`) with every panel, Settings, the interview pack and mock interview pages, `/interviews`, and the `src/lib` files whose sentences those pages show.

Not changed in this chunk:

- **Privacy and terms.** They still say "tracker", "prep pack", "credits" and "provider keys". Legal text is the owner's to change.
- **Error text written inside the API routes**, and the answers the tracker API gives to scripts (the sweeps read them).
- **The generated documents** (CV, cover letter, interview pack PDF).
- **Text that is sent to the AI model**, not shown to a person (prompts, repair instructions). It is listed where the extractor found it, with no change.
- The Clean-up panel: only the owner sees it.

Limits of the extraction: a sentence that the page builds from several pieces shows as several rows; a value the code fills in shows as `{code}`.

## 2. The problems named in the brief, checked against the code as it was

| Quoted in the brief | What the code really said | Where |
|---|---|---|
| "bring your own key" on landing, sign-up and Tailor | Only sign-up said it. Landing said "Then your own free key". Tailor said "Add your own key to keep going — it takes 2 minutes and the tool stays free." | auth/login 223; (home)/page 338; app/app/page 2538 |
| "Anthropic key" | **Not in any screen text.** The word Anthropic appears to users only in the privacy notice. Tailor said "Your API key needs to be re-entered." | app/app/page 2523 |
| "Free tailors today: 3 of 3 · Claude credits: 3 of 3" | Real, on Tailor. Settings said "Free Claude credits: … left (lifetime)". | app/app/page 2179, 2184; settings 318, 323 |
| "three tailored CVs" | Sign-up said it. Landing said "Three tailors on us, no card" and "Three a day, whoever pays." | auth/login 223; (home)/page 330, 335 |
| Nav has "Actions" and "What's next"; "Customise" hides CV upload | Real. | AppHeader 30–35 |
| "Claims registry", "Positioning", "Project pool", "Re-run extraction", "JD triage" | All real. | customize/page; TriageBadge 21 |
| "out of your criteria" | Real, and the confirm "This JD looks out of criteria: …. Tailor anyway?" | TriageBadge 11; app/app/page 1318 |
| "2 more stored as Applied count under Assessment: a test is open." | Real (built from three pieces). | applications/page 3494 |
| "11 Data to fix · 0 status, 11 JD/CV" | Real. | AttentionStrip 92 |
| "too few to judge" | Real, as "Too few to judge" and "· too few to judge". | applications/page 240; PipelineChart 110; app/next/page 622 |
| "Does the score predict the outcome?" shown to a small account | Real. It showed as soon as one scored application had a result. | applications/page 3562 |
| "Company research … uses one tailor credit" | Real. | app/app/page 2587 |

## 3. One name per thing (as approved)

| Thing | Words used before | The one name now |
|---|---|---|
| The user's own CV, saved once | "master CV" (54), "saved CV", "full CV" | **main CV**; the page that holds it is **My CV** |
| The job advert's text | "job description" (23), "posting" (28), "JD" (14), "job ad" | **job description**; the job itself is "the job" |
| The free allowance | "free tailors", "Claude credits", "free credits", "tailor credit", "on us" | **free tailored CVs** (3 in total); the per-day number is the **daily limit** (3 a day). Something else that uses one "counts as 1 tailored CV". |
| The user's own API key | "your own key", "provider keys", "OpenRouter key", "bring your own key" | **your own API key**. OpenRouter is explained once, where the key is added (Settings), and named on the landing page only for the honest note about training. "OpenRouter key" stays only where it must be told apart from a Gemini key. |
| The action | "tailor", "a tailor", "tailors", "run", "full tailoring" | **tailor** (verb, and the page **Tailor**); the result is a **tailored CV** |
| The applications list | "tracker" (18), "sheet", "spreadsheet", "row" (67) | **Applications**; one line of it is an **application** |

| Before | Now |
|---|---|
| Customise | **My CV** (the address `/customize` is unchanged) |
| Actions / Action Centre | **To do** |
| What's next | **Schedule** ("your plan" is now "your schedule"; the first view is "List") |
| pre-check | **free check** |
| Claims registry | **Skill levels** |
| Positioning / variant | **Headlines** / headline |
| Project pool | **Project list** |
| Re-run extraction / extracted | **Read my CV again** / "read from your CV" |
| JD triage | **Job check** (Apply, Review, Skip stay) |
| Prep pack | **Interview pack** |
| Long shot / Likely auto-rejected | **Low chance** / Likely to be rejected automatically |
| Eligibility gates | Requirements in this job |
| core gap | "main requirement not in your CV" |
| decided / outcome | "with a result" / result |
| Too few to judge / No signal / Weak signal / Signal | **Not enough results yet** / No link found / Weak link / Clear link |
| Reply owed | **You need to reply** |
| T+7 | "7 days after applying" |
| Snooze 1 day / Snoozed / Bring back | **Hide for 1 day** / Hidden for now / Show again |
| Ghosted | **No reply** (on screen and in the CSV export; the API still answers "Ghosted") |
| Re-check now | **Check again** |
| Missing JD (badge) | Missing job description |

Kept on purpose: **Jobhuntz**, **Tailor**, **Applications**, **Interview**, **Settings**, **Recruiter search visibility** (never "ATS"; its explanation is now in plain words), **Eligibility**, **Fit Score**, **Ready to submit**, **Follow-up**, **Screening**, **Wins**, **Reapply rule**, **Knockout** (the red gate label on Applications).

## 4. Changes that are more than a new string

**4a. Navigation.** To do · Schedule · Tailor · Applications · Interview · My CV. Renamed only; the two pages were not merged.

**4b. The main button on Tailor.** The first button is "Check this job (free)". After the check, the second is "Tailor my CV →", or "Tailor anyway (uses 1 tailored CV) →" when the check advises against.

**4c. The usage line.** Tailor: "Free tailored CVs: 3 of 3 left · Today: 3 of 3 left". Settings shows the same two lines, total first.

**4d. Insights on Applications.** The two analytics cards are one section, **Insights**. It is folded until 10 applications have a result (`lib/insights` `INSIGHTS_OPEN_AT`), and while folded it says "Opens when 10 of your applications have a result. You have {n}." It can be opened by hand.

**4e. Two sentences were wrong as well as unclear, and were corrected.**

- On the interview pack and mock interview pages, a user who had reached the daily limit was told to "add your own key in Settings to keep going". The daily limit applies on the user's own key too, so that could not help. They now say the limit is reached and when to come back.
- When our free AI service and the user's own key both failed, the message told every user about "the Anthropic Console, not a Claude.ai plan". Only the owner can act on that. It now says both things that failed, in plain words.

**4f. Tests and scripts.** The unit tests and browser scripts that asserted on the old text assert on the new text. `scripts/e2e-action-centre.mjs` pasted an email with a fixed date (8 Nov 2026) that had passed; it now uses a date five days ahead.


## 5. Every proposed change

Reason codes: **N1** One name: “main CV” · **N2** One name: “job description” · **N3** Free allowance said plainly (“free tailored CVs”, no “credit”) · **N4** One name: “your own OpenRouter key” · **N5** One name: “tailor” (verb), “tailored CV” (noun); no “run” · **N6** One name: “Applications” / “application”; no “tracker”, “row”, “sheet” · **N7** Page renamed “My CV” · **N8** “free check” for “pre-check” · **N9** “Skill levels” for “Claims registry” · **N10** “Headlines” for “Positioning / variant” · **N11** “Project list” for “Project pool” · **N12** “read your CV” for “extraction” · **N13** “Job check” for “JD triage” · **N14** Nav: “To do” and “Schedule” · **N16** “Interview pack” for “Prep pack” · **GH** “No reply” for “Ghosted” (display and CSV export only; the API keeps “Ghosted”) · **N15** “result” for “decided / outcome”; “not enough results yet” · **PL** Plain words · **ID** Idiom or jargon removed · **BT** The button says what happens next · **SS** Short sentences, one idea each.

Text in `{braces}` is a value the code fills in. A row whose current text is a fragment is one piece of a sentence that the page joins together.

| File | Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|---|
| app/(home)/page.tsx | 88 | Landing page — message | A free pre-check before any credit is spent. | A free check before you use a tailored CV. | N8 N3 |
| app/(home)/page.tsx | 89 | Landing page — message | Paste a posting. Its eligibility conditions are read against your own answers, your keyword match is counted, and the tracker says whether you have applied to this company before. | Paste a job description. We compare its requirements with your own answers. We count how many of its key words your CV has. We tell you if you have applied to this company before. | N2 N6 SS |
| app/(home)/page.tsx | 91 | Landing page — message | The pre-check: a notice that you have already applied to this company three times, then the read "Apply" and a rough keyword match of 6/10. | The free check: a notice that you have already applied to this company three times, then the advice "Apply" and a rough keyword match of 6/10. | N8 PL |
| app/(home)/page.tsx | 103 | Landing page — message | A prep pack for the job: the questions it will ask, STAR answers built only from your CV, and every line marked as traced to your CV or flagged for you to rephrase. | An interview pack for the job: the questions it will ask, STAR answers built only from your CV, and every line marked as traced to your CV or flagged for you to rephrase. | N16 |
| app/(home)/page.tsx | 187 | Landing page — text | See the journey ↓ | See how it works ↓ | ID |
| app/(home)/page.tsx | 265 | Landing page — text | Rewriting your CV properly for one role — rereading the posting, hunting the right phrasing, reformatting — takes about an hour. Most people stop customising after the third application and start mass-applying with one generic version instead. | Rewriting your CV properly for one role takes about an hour. You reread the job description, look for the right phrasing and reformat. Most people stop customising after the third application and start mass-applying with one generic version instead. | N2 SS |
| app/(home)/page.tsx | 275 | Landing page — text | The whole journey | How it works | ID |
| app/(home)/page.tsx | 308 | Landing page — text | The score is a count of the job's terms your CV carries — never an inflated percentage. Your tracker then measures whether that score predicts which applications progress, and says so plainly when it doesn't. | The score is a count of the job's key words that your CV has. It is never an inflated percentage. Your applications list then shows whether higher scores really get further, and says so plainly when they do not. | N6 SS PL |
| app/(home)/page.tsx | 314 | Landing page — heading | A tracker built in | Your applications, in one list | N6 |
| app/(home)/page.tsx | 316 | Landing page — text | Click Applied and the run lands in your tracker — the exact CV you sent, the job description you sent it for, and a follow-up date, ready for the week the recruiter calls back. | Click Applied and it is saved to your applications list: the exact CV you sent, the job description, and a follow-up date. | N6 N5 ID |
| app/(home)/page.tsx | 330 | Landing page — text | Three tailors on us, no card | 3 free tailored CVs. No payment card needed. | N3 ID |
| app/(home)/page.tsx | 331 | Landing page — text | Your first three runs are on Claude — CV, cover letter and search-visibility score. | Your first 3 tailored CVs are free. That is 3 in total, not 3 a day. Each one comes with a cover letter and a keyword score. They are written by Claude (an AI model), and we pay for it. | N3 N5 SS |
| app/(home)/page.tsx | 334 | Landing page — text | The cap | The daily limit | PL |
| app/(home)/page.tsx | 335 | Landing page — text | Three a day, whoever pays. | 3 tailored CVs a day. The limit is the same on the free ones and on your own API key. | N3 N4 ID |
| app/(home)/page.tsx | 338 | Landing page — text | Then your own free key | After that: your own free API key | N4 |
| app/(home)/page.tsx | 340 | Landing page — text | Add a free OpenRouter key in Settings and keep going at no cost. One honest note: OpenRouter's free models may train on what you send — Settings says how to check that in your OpenRouter account. | Add your own free API key in Settings and keep tailoring at no cost. Settings shows how to get one from OpenRouter, a service with free AI models. One honest note: OpenRouter's free models may train on what you send. Settings says how to check that in your OpenRouter account. | N4 SS |
| app/CvPreview.tsx | 721 | Tailor: CV preview — screen-reader label | Saved to tracker | Saved to Applications | N6 |
| app/CvPreview.tsx | 722 | Tailor: CV preview — button | Saved to tracker ✓ | Saved to Applications ✓ | N6 |
| app/CvPreview.tsx | 750 | Tailor: CV preview — text | Customise | My CV | N7 |
| app/CvUpload.tsx | 133 | CV upload box — text | Extracting the text — this usually takes a few seconds. | Reading the text. This usually takes a few seconds. | N12 |
| app/FormAnswers.tsx | 36 | Tailor: form answers — text | Customise | My CV | N7 |
| app/FormAnswers.tsx | 39 | Tailor: form answers — text | Answer the Eligibility questions on Customise and your form answers appear here. | Answer the Eligibility questions on My CV and your form answers appear here. | N7 |
| app/FormAnswers.tsx | 53 | Tailor: form answers — text | Not answered on Customise | Not answered on My CV | N7 |
| app/FormAnswers.tsx | 84 | Tailor: form answers — text | ” question, which your Eligibility answers on Customise don't cover yet. | ” question, which your Eligibility answers on My CV don't cover yet. | N7 |
| app/TriageBadge.tsx | 11 | Job check badge (Tailor, Applications) — message | Nothing in the posting is out of your criteria (years, clearance, right to work, contract, languages). | Nothing in this job description rules you out. We checked years of experience, security clearance, right to work, contract type and programming languages. | N2 PL |
| app/TriageBadge.tsx | 21 | Job check badge (Tailor, Applications) — text | JD triage | Job check | N13 |
| app/TriageBadge.tsx | 27 | Job check badge (Tailor, Applications) — text | Where the posting says so | Where the job description says so | N2 |
| app/app/PoolRunLine.tsx | 34 | Tailor: projects line — text | For this run. Change the defaults on | For this CV. Change the defaults on | N5 |
| app/app/PoolRunLine.tsx | 34 | Tailor: projects line — text | Customise | My CV | N7 |
| app/app/actions/layout.tsx | 5 | To do (/app/actions) — message | Action Centre · Jobhuntz | To do · Jobhuntz | N14 |
| app/app/actions/page.tsx | 60 | To do (/app/actions) — message | Couldn't refresh your actions, so this may be out of date. | Couldn't refresh your to-do list, so this may be out of date. | N14 |
| app/app/actions/page.tsx | 61 | To do (/app/actions) — message | Could not load your actions. | Could not load your to-do list. | N14 |
| app/app/actions/page.tsx | 71 | To do (/app/actions) — message | Couldn't refresh your actions, so this may be out of date. | Couldn't refresh your to-do list, so this may be out of date. | N14 |
| app/app/actions/page.tsx | 132 | To do (/app/actions) — message | Snoozed for a day. The deadline itself has not moved. | Hidden for a day. The deadline itself has not moved. | ID |
| app/app/actions/page.tsx | 154 | To do (/app/actions) — message | Could not save that to the row's notes. | Could not save that to the application's notes. | N6 |
| app/app/actions/page.tsx | 203 | To do (/app/actions) — text | Snoozed until | Hidden until | ID |
| app/app/actions/page.tsx | 211 | To do (/app/actions) — button | Bring back | Show again | ID |
| app/app/actions/page.tsx | 221 | To do (/app/actions) — button | Snooze 1 day | Hide for 1 day | ID BT |
| app/app/actions/page.tsx | 238 | To do (/app/actions) — title | Action Centre | To do | N14 |
| app/app/actions/page.tsx | 240 | To do (/app/actions) — label | Loading your actions | Loading your to-do list | N14 |
| app/app/actions/page.tsx | 242 | To do (/app/actions) — text | Sign in again to see your actions. | Sign in again to see your to-do list. | N14 |
| app/app/actions/page.tsx | 255 | To do (/app/actions) — text | , {lists.snoozed.length} snoozed | , {lists.snoozed.length} hidden for now | ID |
| app/app/actions/page.tsx | 289 | To do (/app/actions) — heading | Snoozed | Hidden for now | ID |
| app/app/next/EventCard.tsx | 54 | Schedule: event card — text | None of the slots still open is free: each clashes with something on your plan or falls too close to it. | None of the slots still open is free: each clashes with something on your schedule or falls too close to it. | N14 |
| app/app/next/EventCard.tsx | 142 | Schedule: event card — text | Prep pack | Interview pack | N16 |
| app/app/next/EventForm.tsx | 220 | Add / change event form — message | The event is saved, but {application.company_name} did not move to {STATUS_LABELS[movesTo]}, so it stays off your plan.{detail.error ? ` ${detail.error}` : ""} Saving again will not add a second event. | The event is saved, but {application.company_name} did not move to {STATUS_LABELS[movesTo]}, so it stays off your schedule.{detail.error ? ` ${detail.error}` : ""} Saving again will not add a second event. | N14 |
| app/app/next/EventForm.tsx | 233 | Add / change event form — message | Event saved. It stays off your plan until {application?.company_name} reaches Screening or later. | Event saved. It stays off your schedule until {application?.company_name} reaches Screening or later. | N14 |
| app/app/next/EventForm.tsx | 375 | Add / change event form — field label | , so this shows on your plan. | , so this shows on your schedule. | N14 |
| app/app/next/EventForm.tsx | 380 | Add / change event form — text | This stays off your plan until | This stays off your schedule until | N14 |
| app/app/next/PipelineChart.tsx | 33 | Schedule: Pipeline view — text | Nothing has moved past Applied yet, so there is nothing to map. | Nothing has moved past Applied yet, so there is nothing to show. | ID |
| app/app/next/PipelineChart.tsx | 44 | Schedule: Pipeline view — screen-reader label | {payload.name}: {payload.total}. Show on the tracker. | {payload.name}: {payload.total}. Show on Applications. | N6 |
| app/app/next/PipelineChart.tsx | 93 | Schedule: Pipeline view — text | Select a stage to see those applications on the tracker. Stages have been recorded only since 3 November 2026, so an earlier rejection counts at Applied whatever stage it reached, and an earlier row shows only its current stage. The share who went further is out of those with an outcome from that stage; someone still there is not counted. | Select a stage to see those applications. Stages are recorded from 3 November 2026. An earlier rejection counts at Applied, and an earlier application shows only its current stage. The share that went further counts only applications with a result from that stage. | N6 SS |
| app/app/next/PipelineChart.tsx | 100 | Schedule: Pipeline view — text | Ghosted here | No reply here | GH |
| app/app/next/PipelineChart.tsx | 100 | Schedule: Pipeline view — text | Went further, of those decided | Went further, of those with a result | N15 |
| app/app/next/PipelineChart.tsx | 110 | Schedule: Pipeline view — text | Too few to judge | Not enough results yet | N15 |
| app/app/next/layout.tsx | 5 | Schedule (/app/next) — message | What's next · Jobhuntz | Schedule · Jobhuntz | N14 |
| app/app/next/page.tsx | 127 | Schedule (/app/next) — message | Couldn't refresh your plan, so this may be out of date. | Couldn't refresh your schedule, so this may be out of date. | N14 |
| app/app/next/page.tsx | 137 | Schedule (/app/next) — message | Could not load your plan. | Could not load your schedule. | N14 |
| app/app/next/page.tsx | 212 | Schedule (/app/next) — message | This row's notes changed since, so nothing was saved. Open it on Applications to change it there. | This application's notes changed since, so nothing was saved. Open it on Applications to change it there. | N6 |
| app/app/next/page.tsx | 217 | Schedule (/app/next) — message | This row is closed. | This application is closed. | N6 |
| app/app/next/page.tsx | 418 | Schedule (/app/next) — text | T+{nudge}: {nudge === 7 ? "send a first follow-up" :} | {nudge} days after applying: {send a first / second / last follow-up} | ID |
| app/app/next/page.tsx | 418 | Schedule (/app/next) — text | send a last follow-up, then consider Ghosted | send a last follow-up, then mark it No reply | ID |
| app/app/next/page.tsx | 419 | Schedule (/app/next) — text | T+{nudge} from applying: if you have heard nothing, follow up | {nudge} days after applying: if you have heard nothing, send a follow-up | ID |
| app/app/next/page.tsx | 450 | Schedule (/app/next) — message | {application.company_name} moved to Ghosted. | {application.company_name} moved to No reply. | GH |
| app/app/next/page.tsx | 450 | Schedule (/app/next) — button | Ghosted | No reply | GH |
| app/app/next/page.tsx | 456 | Schedule (/app/next) — heading | Reply owed | You need to reply | ID |
| app/app/next/page.tsx | 457 | Schedule (/app/next) — text | They spoke last, so the next move is yours. | They wrote last, so you need to reply. | ID |
| app/app/next/page.tsx | 477 | Schedule (/app/next) — title | What's next | Schedule | N14 |
| app/app/next/page.tsx | 482 | Schedule (/app/next) — label | Loading your plan | Loading your schedule | N14 |
| app/app/next/page.tsx | 487 | Schedule (/app/next) — text | Sign in again to see your plan. | Sign in again to see your schedule. | N14 |
| app/app/next/page.tsx | 516 | Schedule (/app/next) — button | Plan | List | N14 |
| app/app/next/page.tsx | 573 | Schedule (/app/next) — text | They are waiting on a time from you. An unanswered offer can lose the interview. | They are waiting for you to choose a time. If you do not answer, you can lose the interview. | PL |
| app/app/next/page.tsx | 622 | Schedule (/app/next) — text | · too few to judge | · not enough results yet | N15 |
| app/app/next/page.tsx | 622 | Schedule (/app/next) — text | · {Math.round((n.furtherRate ?? 0) * 100)}% of those decided went further | · {Math.round((n.furtherRate ?? 0) * 100)}% of those with a result went further | N15 |
| app/app/next/page.tsx | 628 | Schedule (/app/next) — text | ghosted · | no reply · | GH |
| app/app/next/page.tsx | 628 | Schedule (/app/next) — button | see the map | see the chart | ID |
| app/app/next/page.tsx | 631 | Schedule (/app/next) — text | Stages are recorded from 3 Nov 2026: an earlier rejection counts at Applied, and an earlier row shows only its current stage. | Stages are recorded from 3 Nov 2026: an earlier rejection counts at Applied, and an earlier application shows only its current stage. | N6 |
| app/app/page.tsx | 253 | Tailor (/app) — message | Press Fix it to correct it for you (no tailor credit is used), or edit that sentence in the CV preview and click outside the text: the re-check runs in your browser and unlocks the download. | Press Fix it and we correct it for you. This is free. Or edit that sentence in the CV preview and click outside the text. The check runs again in your browser and unlocks the download. | N3 SS |
| app/app/page.tsx | 301 | Tailor (/app) — message | Long shot | Low chance | ID |
| app/app/page.tsx | 302 | Tailor (/app) — message | Likely auto-rejected | Likely to be rejected automatically | PL |
| app/app/page.tsx | 335 | Tailor (/app) — message | This result was tailored before the fact check ran on free models, so the summary and letter were never checked against your master CV. | This result was tailored before the fact check ran on free models, so the summary and letter were never checked against your main CV. | N1 |
| app/app/page.tsx | 336 | Tailor (/app) — message | The run had no time left for the fact check (free models are slow), so the summary and letter were not checked against your master CV. | There was no time left for the fact check (free models are slow), so the summary and letter were not checked against your main CV. | N5 N1 |
| app/app/page.tsx | 337 | Tailor (/app) — message | The fact check of the summary and letter gave no usable answer, so they were not checked against your master CV. | The fact check of the summary and letter gave no usable answer, so they were not checked against your main CV. | N1 |
| app/app/page.tsx | 343 | Tailor (/app) — message | The fact check read {r.checked} sentence{r.checked === 1 ? "" : "s"} of the summary and letter against your master CV. | The fact check read {r.checked} sentence{r.checked === 1 ? "" : "s"} of the summary and letter against your main CV. | N1 |
| app/app/page.tsx | 776 | Tailor (/app) — message | Add your master CV in Customise first — the Fit Score compares the company against it. | Add your main CV on My CV first. The Fit Score compares the company with it. | N1 N7 SS |
| app/app/page.tsx | 919 | Tailor (/app) — message | Add your master CV in Customise first. | Add your main CV on My CV first. | N1 N7 |
| app/app/page.tsx | 989 | Tailor (/app) — message | The pre-check failed on the server (HTTP {res.status}). Try again; you can also tailor without it. | The free check failed on the server (HTTP {res.status}). Try again; you can also tailor without it. | N8 |
| app/app/page.tsx | 1104 | Tailor (/app) — message | {n.figure} isn't on your master CV: "{n.sentence.length > 100 ? `${n.sentence.}". {FREE_FIX} | {n.figure} isn't on your main CV: "{n.sentence.length > 100 ? `${n.sentence.}". {FREE_FIX} | N1 |
| app/app/page.tsx | 1318 | Tailor (/app) — message | This JD looks out of criteria: {shownTriage.reasons.join("; ")}. Tailor anyway? | This job may not suit you: {shownTriage.reasons.join("; ")}. Tailor anyway? | N13 N2 PL |
| app/app/page.tsx | 1556 | Tailor (/app) — message | Left off its tech line, because your claims registry holds them as learning: {data.techLeftOut.join(", ")}. | Left off its tech line, because your skill levels list marks them as learning: {data.techLeftOut.join(", ")}. | N9 |
| app/app/page.tsx | 1688 | Tailor (/app) — message | The box already holds a job description. Replace it with the posting imported from {job.source}? | The box already holds a job description. Replace it with the job description imported from {job.source}? | N2 |
| app/app/page.tsx | 1831 | Tailor (/app) — message | Couldn't save to the tracker. Try again. | Couldn't save to Applications. Try again. | N6 |
| app/app/page.tsx | 2048 | Tailor (/app) — message | The {empty.join(", ")} {empty.length > 1 ? "sections" : "section} came back empty this run. | The {sections} section(s) came back empty this time. | N5 |
| app/app/page.tsx | 2055 | Tailor (/app) — message | Project selection from your pool didn't complete this run — showing your master CV's projects instead. | We could not choose projects from your project list this time. Your main CV's projects are shown instead. | N11 N1 N5 SS |
| app/app/page.tsx | 2085 | Tailor (/app) — page tagline | Honest tailoring. Every claim traces back to your real CV — nothing invented. | Paste a job description and get a CV written for that job. Everything in it comes from your main CV. Nothing is invented. | N1 PL |
| app/app/page.tsx | 2091 | Tailor (/app) — text | Master CV | Main CV | N1 |
| app/app/page.tsx | 2104 | Tailor (/app) — title | Start with your master CV | First, add your main CV | N1 |
| app/app/page.tsx | 2105 | Tailor (/app) — button | Add your CV in Customise → | Add my CV → | N7 BT |
| app/app/page.tsx | 2107 | Tailor (/app) — text | Add it once and it's reused for every job you tailor for here. Paste it or upload a PDF or Word file. | Add it once. Jobhuntz uses it for every job. Paste it, or upload a PDF or Word file. | SS |
| app/app/page.tsx | 2119 | Tailor (/app) — help text | Lever, Ashby, Greenhouse, Workable, SmartRecruiters, BambooHR or LinkedIn. We read the posting into the box below; check it before you tailor. | Lever, Ashby, Greenhouse, Workable, SmartRecruiters, BambooHR or LinkedIn. We read the job description into the box below; check it before you tailor. | N2 |
| app/app/page.tsx | 2179 | Tailor (/app) — text | Free tailors today: | Today: | N3 |
| app/app/page.tsx | 2184 | Tailor (/app) — text | Claude credits: | Free tailored CVs: | N3 |
| app/app/page.tsx | 2198 | Tailor (/app) — button | Checking keyword match… | Checking this job… | PL |
| app/app/page.tsx | 2198 | Tailor (/app) — button | Tailor my CV | Check this job (free) | BT |
| app/app/page.tsx | 2243 | Tailor (/app) — text | , so your research won't be applied to this run. | , so your research won't be applied to this CV. | N5 |
| app/app/page.tsx | 2261 | Tailor (/app) — text | — if that's not the job you meant, fix the JD above before continuing. | . If that is not the job you meant, fix the job description above before you continue. | N2 SS |
| app/app/page.tsx | 2267 | Tailor (/app) — text | will be used in this run. | will be used in this CV. | N5 |
| app/app/page.tsx | 2272 | Tailor (/app) — text | — the research won't be applied to this run. | . The research will not be applied to this CV. | N5 SS |
| app/app/page.tsx | 2278 | Tailor (/app) — text | won't be applied to this run. | won't be applied to this CV. | N5 |
| app/app/page.tsx | 2325 | Tailor (/app) — message | the posting's level | the job description's level | N2 |
| app/app/page.tsx | 2332 | Tailor (/app) — text | Read on this application | Our advice for this job | PL |
| app/app/page.tsx | 2340 | Tailor (/app) — text | Set up your eligibility answers in | Answer the Eligibility questions on | PL |
| app/app/page.tsx | 2341 | Tailor (/app) — text | Customise | My CV | N7 |
| app/app/page.tsx | 2341 | Tailor (/app) — text | (about 2 minutes) and this check turns each job's eligibility conditions into pass or fail before you spend a tailor. | (about 2 minutes). This check then tells you if you meet each job's requirements, before you use a tailored CV. | N3 SS |
| app/app/page.tsx | 2349 | Tailor (/app) — text | Eligibility gates ( | Requirements in this job ( | PL |
| app/app/page.tsx | 2377 | Tailor (/app) — text | Below the usual 10-keyword mark for your CV as-is — tailoring can still genuinely help by surfacing real adjacent skills, though a gap this size may be honest too. | Your CV has fewer than 10 of this job's key words. Tailoring can help by showing related skills you really have. A gap this big can also mean the job is not a good match. | SS PL |
| app/app/page.tsx | 2378 | Tailor (/app) — text | terms, counted the same way as the search-visibility score after tailoring, but read here over your master CV as saved; after tailoring, the score card shows this figure again under the new one. | terms. We count them the same way as the score after tailoring, but here we count them in your main CV. After tailoring, the score card shows both numbers. | N1 SS |
| app/app/page.tsx | 2390 | Tailor (/app) — text | Every required skill the posting names is in your CV. | Every required skill the job description names is in your CV. | N2 |
| app/app/page.tsx | 2397 | Tailor (/app) — text | What the posting asks for, and where your CV shows it | What the job description asks for, and where your CV shows it | N2 |
| app/app/page.tsx | 2415 | Tailor (/app) — text | . If that is the same work, you can name it that way in your master CV. | . If that is the same work, you can name it that way in your main CV. | N1 |
| app/app/page.tsx | 2419 | Tailor (/app) — text | . A core gap: no evidence in your CV. It won't be claimed; the letter may name your nearest real experience instead. | . Your CV does not show this at all. The tailored CV will not claim it. The letter may name your closest real experience instead. | PL SS |
| app/app/page.tsx | 2430 | Tailor (/app) — text | Tailoring anyway spends a credit on an application they said they won't take. | The company said it will not accept this application. Tailoring anyway still uses 1 tailored CV. | N3 PL |
| app/app/page.tsx | 2436 | Tailor (/app) — text | Tailoring anyway spends a credit. | Tailoring anyway uses 1 tailored CV. | N3 |
| app/app/page.tsx | 2441 | Tailor (/app) — button | Tailor anyway (uses a credit) → | Tailor anyway (uses 1 tailored CV) → | N3 |
| app/app/page.tsx | 2441 | Tailor (/app) — button | Continue to full tailoring → | Tailor my CV → | BT N5 |
| app/app/page.tsx | 2445 | Tailor (/app) — field label | Positioning | Headline | N10 |
| app/app/page.tsx | 2509 | Tailor (/app) — text | The pre-check | The free check | N8 |
| app/app/page.tsx | 2511 | Tailor (/app) — text | The shared Claude account has run out of credit — this isn't your account, and you haven't been charged a tailor. Add your own free OpenRouter key and | Our free AI service is not available right now. This is not a problem with your account, and it did not use one of your tailored CVs. Add your own free API key and | N3 N4 PL |
| app/app/page.tsx | 2512 | Tailor (/app) — text | the pre-check and tailoring run | the free check and tailoring run | N8 |
| app/app/page.tsx | 2512 | Tailor (/app) — text | on it instead, starting immediately. | on your key instead, straight away. | PL |
| app/app/page.tsx | 2516 | Tailor (/app) — button | Add your key in Settings → | Add my API key → | N4 BT |
| app/app/page.tsx | 2523 | Tailor (/app) — text | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| app/app/page.tsx | 2536 | Tailor (/app) — text | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| app/app/page.tsx | 2538 | Tailor (/app) — text | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| app/app/page.tsx | 2541 | Tailor (/app) — button | Add your key in Settings → | Add my API key → | N4 BT |
| app/app/page.tsx | 2549 | Tailor (/app) — text | Your Gemini key can't run a tailor. | Your Gemini key cannot tailor a CV. | N5 |
| app/app/page.tsx | 2551 | Tailor (/app) — text | Gemini's free tier allows 5 requests per minute, and one tailoring run makes 8 — so it can't finish even once. Add an OpenRouter key instead; its free tier handles a full run. | Gemini's free plan allows 5 requests a minute. Tailoring one CV needs 8, so it cannot finish. Add an OpenRouter key in Settings instead. | N5 SS |
| app/app/page.tsx | 2564 | Tailor (/app) — text | Your OpenRouter key has hit its limit. | Your API key has reached today's limit. | N4 ID |
| app/app/page.tsx | 2566 | Tailor (/app) — text | Your key's free quota resets daily — come back tomorrow to continue. | The free limit on your key starts again each day. Try again tomorrow. | PL |
| app/app/page.tsx | 2587 | Tailor (/app) — help text | Paste the company's website and we'll read their site and live job ads, then score how well your real CV fits before you spend a tailor. Uses one tailor credit — repeat lookups of the same company are free for 7 days. | Paste the company's website. We read the site and its job adverts, then score how well your CV fits the company. This counts as 1 tailored CV: it uses one of your free ones, and one of today's 3. Looking up the same company again is free for 7 days. | N3 SS |
| app/app/page.tsx | 2683 | Tailor (/app) — text | ✓ = already evidenced in your master CV. | ✓ = already evidenced in your main CV. | N1 |
| app/app/page.tsx | 2719 | Tailor (/app) — text | Use as JD ↓ | Use this job ↓ | N2 |
| app/app/page.tsx | 2742 | Tailor (/app) — text | Cold outreach — no job posting needed | Contact the company directly (no job advert needed) | ID N2 |
| app/app/page.tsx | 2846 | Tailor (/app) — text | s — a full run usually takes under a minute. | s. This usually takes under a minute. | N5 |
| app/app/page.tsx | 2862 | Tailor (/app) — text | · positioned as | · headline: | N10 |
| app/app/page.tsx | 2884 | Tailor (/app) — text | Downloads are held until the text above matches the posting this was tailored for (Applied still saves the run with the posting it was tailored from). Restore that text, or clear this result and tailor the new posting. | You cannot download until the text above matches the job description this CV was tailored for. (Applied still saves it with the job description it was tailored from.) Restore that text, or clear this result and tailor for the new job. | N2 N5 SS |
| app/app/page.tsx | 2900 | Tailor (/app) — text | Re-running the same job description retries those steps (it counts as a new run). | Tailoring the same job description again retries those steps. It counts as a new tailored CV. | N5 N3 |
| app/app/page.tsx | 2921 | Tailor (/app) — text | : the posting asks for it, but your master CV never shows it — | : the job description asks for it, but your main CV never shows it. The text says: | N1 N2 SS |
| app/app/page.tsx | 2921 | Tailor (/app) — text | . Remove it, or add it to your master CV first if you have really done it. | . Remove it, or add it to your main CV first if you have really done it. | N1 |
| app/app/page.tsx | 2926 | Tailor (/app) — text | in your registry, and it appears in the | in your skill levels list, and it appears in the | N9 |
| app/app/page.tsx | 2932 | Tailor (/app) — text | . Raise its level in Customise only if you have used it at work. | . Raise its level on My CV only if you have used it at work. | N7 |
| app/app/page.tsx | 2946 | Tailor (/app) — text | isn't on your master CV | isn't on your main CV | N1 |
| app/app/page.tsx | 2948 | Tailor (/app) — text | joins two separate figures into a range your master CV never states | joins two separate figures into a range your main CV never states | N1 |
| app/app/page.tsx | 2958 | Tailor (/app) — text | Press Fix it and the flagged words are corrected for you, with the job description in view — no tailor credit is used. Or edit the highlighted text in the preview below, then click outside it or press Re-check now. Download and Applied unlock when it passes. | Press Fix it and we correct the marked words for you. This is free. Or edit the highlighted text in the preview below, then click outside it or press Check again. Download and Applied unlock when the check passes. | N3 SS |
| app/app/page.tsx | 2961 | Tailor (/app) — text | Save a master CV in Customise and its skills become blocking checks. | Save your main CV on My CV. Its skills are then checked on every tailored CV. | N1 N7 PL |
| app/app/page.tsx | 2971 | Tailor (/app) — button | Re-check now | Check again | PL |
| app/app/page.tsx | 3019 | Tailor (/app) — text | No tailor credit was used. Read the changes, then download. | This was free. Read the changes, then download. | N3 |
| app/app/page.tsx | 3031 | Tailor (/app) — text | Checked against your master CV | Checked against your main CV | N1 |
| app/app/page.tsx | 3035 | Tailor (/app) — text | The deterministic checks still ran | The automatic checks still ran | PL |
| app/app/page.tsx | 3041 | Tailor (/app) — text | Every sentence about your past in the summary and the letter was checked against your master CV. | Every sentence about your past in the summary and the letter was checked against your main CV. | N1 |
| app/app/page.tsx | 3103 | Tailor (/app) — text | Dropped from Technical Tools because your master CV never names them: | Dropped from Technical Tools because your main CV never names them: | N1 |
| app/app/page.tsx | 3111 | Tailor (/app) — text | Dropped from Functional Competencies because your master CV shows no such work: | Dropped from Functional Competencies because your main CV shows no such work: | N1 |
| app/app/page.tsx | 3119 | Tailor (/app) — text | Put back on Technical Tools because the posting asks for them and your master CV lists them: | Put back on Technical Tools because the job description asks for them and your main CV lists them: | N1 N2 |
| app/app/page.tsx | 3182 | Tailor (/app) — text | Every swap stays within the two-word budget a master bullet allows. | Every swap stays within the two words that a main CV bullet may change. | N1 PL |
| app/app/page.tsx | 3212 | Tailor (/app) — text | Lead skills skipped | Skills not shown first | ID |
| app/app/page.tsx | 3214 | Tailor (/app) — text | Change the level on Customise if it is production work, or take it out of the variant. | Change the level on My CV if it is production work, or remove it from the headline's skills. | N7 N10 |
| app/app/page.tsx | 3228 | Tailor (/app) — text | Free models are slow, so the four polish retries were skipped: the role-title retry, the bullet-lint retry, the claims rewrite and the letter's name rewrite (a sentence naming a place or product your sources don't was removed instead). Every deterministic check ran. | Free models are slow, so four second attempts were skipped: the job title in the summary, weak bullets, the claims rewrite, and names in the letter (a sentence naming a place or product that your sources do not name was removed instead). Every automatic check still ran. | PL |
| app/app/page.tsx | 3238 | Tailor (/app) — text | This posting is screened on the degree first, so Education sits under the summary for this run. Your saved section order is unchanged. | This job is screened on the degree first, so Education sits under the summary for this CV. Your saved section order is unchanged. | N2 N5 |
| app/app/page.tsx | 3243 | Tailor (/app) — button | Use my standard order for this run | Use my standard order for this CV | N5 |
| app/app/page.tsx | 3257 | Tailor (/app) — message | Filled to two pages from your master CV | Filled to two pages from your main CV | N1 |
| app/app/page.tsx | 3263 | Tailor (/app) — text | You chose a one-page CV on Customise, so the download is laid out to one. | You chose a one-page CV on My CV, so the download is laid out to one. | N7 |
| app/app/page.tsx | 3265 | Tailor (/app) — text | These bullets from your master CV were put back to fill the second page: | These bullets from your main CV were put back to fill the second page: | N1 |
| app/app/page.tsx | 3320 | Tailor (/app) — text | Removed — it told the reader their own posting back: “ | Removed. It told the reader their own job description back: “ | N2 SS |
| app/app/page.tsx | 3343 | Tailor (/app) — text | The posting asks for | The job description asks for | N2 |
| app/app/page.tsx | 3344 | Tailor (/app) — text | , which your master CV never shows, and the letter does not say so. One plain sentence naming the gap and your nearest real experience reads better than silence — add it in the preview if you agree. | , which your main CV never shows, and the letter does not say so. One plain sentence that names the gap and your nearest real experience reads better than silence. Add it in the preview if you agree. | N1 SS |
| app/app/page.tsx | 3375 | Tailor (/app) — text | Removed, because it is not an answer you gave on Customise: | Removed, because it is not an answer you gave on My CV: | N7 |
| app/app/page.tsx | 3387 | Tailor (/app) — text | Customise | My CV | N7 |
| app/app/page.tsx | 3418 | Tailor (/app) — button | Re-check now | Check again | PL |
| app/app/page.tsx | 3426 | Tailor (/app) — text | Your master CV | Your main CV | N1 |
| app/app/page.tsx | 3429 | Tailor (/app) — text | style that the tailoring may not fix for you — it never changes a master CV bullet by more than two words. Edit them on | style that the tailoring may not fix for you. It never changes a main CV bullet by more than two words. Edit them on | N1 SS |
| app/app/page.tsx | 3430 | Tailor (/app) — text | Customise | My CV | N7 |
| app/app/page.tsx | 3474 | Tailor (/app) — text | — over the one page you chose on Customise. | . That is over the one page you chose on My CV. | N7 SS |
| app/app/page.tsx | 3528 | Tailor (/app) — text | Filler a recruiter reads straight past: | Empty words that recruiters skip: | ID |
| app/app/page.tsx | 3540 | Tailor (/app) — text | . That clause is the clearest sign of a tool at work; cut it and let the bullet stop on the result. | . This kind of ending looks machine-written. Cut it and end the bullet on the result. | ID PL |
| app/app/page.tsx | 3549 | Tailor (/app) — button | Re-check now | Check again | PL |
| app/app/page.tsx | 3564 | Tailor (/app) — text | /100 against your real CV — worth going beyond the CV. Both are built only from your master CV and the research; nothing invented. | /100 against your real CV, so it is worth doing more than the CV. Both are built only from your main CV and the research. Nothing is invented. | N1 SS ID |
| app/app/page.tsx | 3594 | Tailor (/app) — text | Saved into the tracker row's notes when you click Applied below. | Saved in the application's notes when you click Applied below. | N6 |
| app/app/page.tsx | 3609 | Tailor (/app) — text | Fix the flagged claims above first — press Fix it, or edit the preview. No credit is used. | Fix the marked claims above first. Press Fix it, or edit the preview. This is free. | N3 SS |
| app/app/page.tsx | 3615 | Tailor (/app) — text | Before this goes in the tracker as applied: | Before you save this as applied: | N6 |
| app/app/page.tsx | 3636 | Tailor (/app) — text | From your list on Customise: | From your list on My CV: | N7 |
| app/app/page.tsx | 3675 | Tailor (/app) — text | Changed since you saved it. The tracker keeps the CV and letter as they were when you clicked Applied; the downloads here give this version. | Changed since you saved it. Applications keeps the CV and letter as they were when you clicked Applied. The downloads here give this version. | N6 SS |
| app/app/page.tsx | 3686 | Tailor (/app) — appliedLabel | Saved to tracker ✓ | Saved to Applications ✓ | N6 |
| app/app/page.tsx | 3688 | Tailor (/app) — appliedLabel | Already in tracker | Already in Applications | N6 |
| app/app/page.tsx | 3689 | Tailor (/app) — appliedLabel | Applied — save to tracker | I applied. Save to Applications | N6 BT |
| app/app/page.tsx | 3729 | Tailor (/app) — text | Left off the tech lines, because your claims registry holds them as learning: {result.poolFit!.techLeftOut!.join(", ")}. | Left off the tech lines, because your skill levels list marks them as learning: {result.poolFit!.techLeftOut!.join(", ")}. | N9 |
| app/app/page.tsx | 3739 | Tailor (/app) — text | Changes vs master CV | Changes from your main CV | N1 PL |
| app/app/page.tsx | 3744 | Tailor (/app) — text | , {result.bulletChanges.experience.added} not in the master CV | , {result.bulletChanges.experience.added} not in the main CV | N1 |
| app/app/page.tsx | 3749 | Tailor (/app) — text | Every experience bullet is one of the master CV's, chosen and reordered for this posting, with at most two words changed. | Every experience bullet is one from your main CV, chosen and reordered for this job, with at most two words changed. | N1 N2 |
| app/app/page.tsx | 3750 | Tailor (/app) — text | Ids were checked on this run. | Each bullet was matched to your main CV by its number. | PL |
| app/app/page.tsx | 3750 | Tailor (/app) — text | This run came back without bullet ids, so the comparison below is by closest match. | The bullets came back without numbers, so the comparison below is by closest match. | PL |
| app/app/page.tsx | 3751 | Tailor (/app) — text | . Role titles, employers and dates are the master CV's, verbatim | . Role titles, employers and dates are the main CV's, verbatim | N1 |
| app/app/page.tsx | 3780 | Tailor (/app) — text | reverted to master | reverted to your main CV | N1 |
| app/app/page.tsx | 3780 | Tailor (/app) — text | not in master | not in your main CV | N1 |
| app/app/page.tsx | 3858 | Tailor (/app) — text | How likely a recruiter searching their pipeline for this role's terms is to surface your CV — the count is how many of those terms the tailored text carries. | Recruiters search their list of applicants by key words. This score counts how many of this job's key words are in your tailored CV. More matches make your CV more likely to appear in their search. | PL SS |
| app/app/page.tsx | 3884 | Tailor (/app) — text | ”. If it is the same work, you can name it that way in your master CV. | ”. If it is the same work, you can name it that way in your main CV. | N1 |
| app/app/page.tsx | 3887 | Tailor (/app) — text | Core gap: no evidence in your master CV. | Not in your main CV at all. | N1 PL |
| app/app/page.tsx | 3912 | Tailor (/app) — text | Needs your evidence ( | We could not confirm these from your CV ( | PL |
| app/applications/AttentionStrip.tsx | 92 | Applications: needs-attention cards — text | Data to fix | Applications to fix | PL |
| app/applications/AttentionStrip.tsx | 92 | Applications: needs-attention cards — text | Data to fix · {counts.statusToFix} status, {counts.attachmentsToFix} JD/CV | Applications to fix · {counts.statusToFix} with the wrong status, {counts.attachmentsToFix} with no job description or CV | PL N2 |
| app/applications/CleanupPanel.tsx | 145 | Applications: Clean-up (owner only) — label | Reading your tracker | Reading your applications list | N6 |
| app/applications/ClosedSection.tsx | 110 | Applications: Closed section — text | Nothing closed yet. A row you move to Closed stays here, with how far it got. | Nothing closed yet. An application you move to Closed stays here, with how far it got. | N6 |
| app/applications/RowFlags.tsx | 66 | Applications: badges under a company — button | Add JD to check | Add a job description to check | N2 |
| app/applications/WinsView.tsx | 41 | Applications: Wins tab — text | Too few | Not enough yet | N15 |
| app/applications/WinsView.tsx | 70 | Applications: Wins tab — note | Rows with no style recorded are counted here and never read as either style. | Applications with no style recorded are counted here and never read as either style. | N6 |
| app/applications/page.tsx | 240 | Applications (/applications) — message | Too few to judge | Not enough results yet | N15 |
| app/applications/page.tsx | 240 | Applications (/applications) — message | No signal | No link found | PL |
| app/applications/page.tsx | 240 | Applications (/applications) — message | Weak signal | Weak link | PL |
| app/applications/page.tsx | 240 | Applications (/applications) — label | Signal | Clear link | PL |
| app/applications/page.tsx | 258 | Applications (/applications) — message | Your {s.topN} highest-scoring decided applications were all rejected. | Your {s.topN} highest-scoring applications with a result were all rejected. | N15 |
| app/applications/page.tsx | 259 | Applications (/applications) — message | Of your {s.topN} highest-scoring decided applications, {topProgressed} progressed. | Of your {s.topN} highest-scoring applications with a result, {topProgressed} progressed. | N15 |
| app/applications/page.tsx | 262 | Applications (/applications) — message | {s.points.length} scored application{s.points.length === 1 ? " has" : "s have} an outcome{s.auc === null ? ", all of one kind" : "}; a read needs {MIN_FOR_VERDICT} with both outcomes. | {n} scored application(s) have a result{, all of one kind}. We need {MIN_FOR_VERDICT}, with both kinds of result, before we can say. | N15 PL |
| app/applications/page.tsx | 264 | Applications (/applications) — message | The score does not predict the outcome so far. Treat it as a checklist of the role's terms, not a forecast. | So far, a higher score has not meant a better result. Use the score as a checklist of the job's key words, not as a prediction. | PL |
| app/applications/page.tsx | 274 | Applications (/applications) — text | of the time. 50% would be a coin flip. | of the time. 50% would mean the score tells you nothing. | ID |
| app/applications/page.tsx | 311 | Applications (/applications) — text | decided application | application with a result | N15 |
| app/applications/page.tsx | 377 | Applications (/applications) — message | {l.decided} of {MIN_DECIDED} decided needed | {l.decided} of {MIN_DECIDED} results needed | N15 |
| app/applications/page.tsx | 377 | Applications (/applications) — message | {pct(l.rate)} of {l.decided} decided | {pct(l.rate)} of {l.decided} with a result | N15 |
| app/applications/page.tsx | 379 | Applications (/applications) — text | . Read off each row's title. | . Read off each application's title. | N6 |
| app/applications/page.tsx | 397 | Applications (/applications) — text | Format style: too few to judge | Format style: not enough results yet | N15 |
| app/applications/page.tsx | 401 | Applications (/applications) — message | {b.progressed + b.rejected} of {MIN_DECIDED} decided needed | {b.progressed + b.rejected} of {MIN_DECIDED} results needed | N15 |
| app/applications/page.tsx | 401 | Applications (/applications) — message | {pct(b.rate)} of {b.progressed + b.rejected} decided | {pct(b.rate)} of {b.progressed + b.rejected} with a result | N15 |
| app/applications/page.tsx | 418 | Applications (/applications) — text | Progressed past the screen | Reached screening or further | ID |
| app/applications/page.tsx | 421 | Applications (/applications) — text | {insights.decided} of the {MIN_DECIDED} decided applications the rate needs | {insights.decided} of the {MIN_DECIDED} results needed | N15 |
| app/applications/page.tsx | 422 | Applications (/applications) — text | {insights.progressed} of {insights.decided} decided | {insights.progressed} of {insights.decided} with a result | N15 |
| app/applications/page.tsx | 427 | Applications (/applications) — text | Still open | Still waiting | PL |
| app/applications/page.tsx | 441 | Applications (/applications) — text | kept from the next tailored run you save | kept from the next tailored CV you save | N5 |
| app/applications/page.tsx | 452 | Applications (/applications) — text | . Nothing can be read from them — add them from the row's JD and CV cells. | . We cannot learn anything from them. Add the job description and the CV on each application. | N6 N2 |
| app/applications/page.tsx | 476 | Applications (/applications) — message | too few decided ({decided}) | not enough results yet ({decided}) | N15 |
| app/applications/page.tsx | 962 | Applications (/applications) — message | Couldn't load your next steps, so stages show the stored status. | Couldn't load your next steps, so each application shows its saved status. | PL |
| app/applications/page.tsx | 970 | Applications (/applications) — message | Couldn't load your next steps, so stages show the stored status. | Couldn't load your next steps, so each application shows its saved status. | PL |
| app/applications/page.tsx | 1271 | Applications (/applications) — message | This application changed since this page loaded, so nothing was saved. Its row now shows where it stands. | This application changed after this page loaded, so nothing was saved. The list now shows where it stands. | PL |
| app/applications/page.tsx | 1323 | Applications (/applications) — message | Reapply rule saved for {previous.company_name}. JD triage now checks it before any credit. | Reapply rule saved for {previous.company_name}. The job check now uses it before you tailor. | N13 N3 |
| app/applications/page.tsx | 1375 | Applications (/applications) — message | Moved {notSubmitted.length} row{notSubmitted.length === 1 ? "" : "s"} to Ready to submit. | Moved {notSubmitted.length} application{notSubmitted.length === 1 ? "" : "s"} to Ready to submit. | N6 |
| app/applications/page.tsx | 1526 | Applications (/applications) — message | Only if it never got that far and you picked it by mistake. It comes off this row's record and any count that relied on it, and the row's notes will say: "{note}". | Only if it never got that far and you picked it by mistake. It comes off this application's record and any count that used it. The application's notes will say: "{note}". | N6 SS |
| app/applications/page.tsx | 1884 | Applications (/applications) — message | Recorded: they wrote. It shows as Reply owed after a day without your reply. | Recorded: they wrote. It shows “You need to reply” after a day without your reply. | ID |
| app/applications/page.tsx | 2057 | Applications (/applications) — text | characters — the sheet and insights work best with the job title alone; put the rest in Notes. | characters. Applications works best with the job title alone; put the rest in Notes. | N6 |
| app/applications/page.tsx | 2104 | Applications (/applications) — text | Eligibility read | Free check's advice | PL |
| app/applications/page.tsx | 2178 | Applications (/applications) — message | Snoozed on the Action Centre for a day. The deadline itself has not moved. | Hidden on To do for a day. The deadline itself has not moved. | ID N14 |
| app/applications/page.tsx | 2211 | Applications (/applications) — message | This removes the row, its events and any CV file kept with it. It can't be undone. | This removes the application, its events and any CV file kept with it. It can't be undone. | N6 |
| app/applications/page.tsx | 2231 | Applications (/applications) — message | Snooze 1 day | Hide for 1 day | ID BT |
| app/applications/page.tsx | 2233 | Applications (/applications) — message | Edit row | Edit application | N6 |
| app/applications/page.tsx | 2254 | Applications (/applications) — message | View JD | View job description | N2 |
| app/applications/page.tsx | 2254 | Applications (/applications) — message | Add JD | Add job description | N2 |
| app/applications/page.tsx | 2256 | Applications (/applications) — message | Prep pack ✓ | Interview pack ✓ | N16 |
| app/applications/page.tsx | 2256 | Applications (/applications) — message | Prep pack | Interview pack | N16 |
| app/applications/page.tsx | 2258 | Applications (/applications) — message | Run JD check | Check this job | N2 BT |
| app/applications/page.tsx | 2341 | Applications (/applications) — text | Reply owed | You need to reply | ID |
| app/applications/page.tsx | 2474 | Applications (/applications) — text | No CV snapshot is stored for this application — it was saved before CV snapshots existed. | No copy of the CV is saved for this application. It was saved before Jobhuntz kept copies. | PL |
| app/applications/page.tsx | 2586 | Applications (/applications) — placeholder | Paste the job posting — you'll want it for interview prep weeks from now. | Paste the job description. You will want it for interview prep weeks from now. | N2 SS |
| app/applications/page.tsx | 2720 | Applications (/applications) — message | Reapply rule saved for {rule.company_name}. JD triage checks it before any credit. | Reapply rule saved for {rule.company_name}. The job check uses it before you tailor. | N13 N3 |
| app/applications/page.tsx | 2783 | Applications (/applications) — tooltip / title | Export these {visible.length} rows as a CSV | Export these {visible.length} applications as a CSV | N6 |
| app/applications/page.tsx | 2993 | Applications (/applications) — text | These rows would move to | These applications would move to | N6 |
| app/applications/page.tsx | 3027 | Applications (/applications) — button | + Add row | + Add application | N6 |
| app/applications/page.tsx | 3032 | Applications (/applications) — text | to track it here, or add a row for one you sent through another channel. | to save it here. You can also add an application you sent another way. | N6 ID |
| app/applications/page.tsx | 3042 | Applications (/applications) — text | Nothing live at this stage. | No open applications at this stage. | ID |
| app/applications/page.tsx | 3242 | Applications (/applications) — text | ). Save anyway only if this is a different posting. | ). Save anyway only if this is a different job. | N2 |
| app/applications/page.tsx | 3248 | Applications (/applications) — text | ) — the sheet and insights work best with the job title alone; put the rest in Notes. | ). Applications works best with the job title alone; put the rest in Notes. | N6 |
| app/applications/page.tsx | 3278 | Applications (/applications) — text | Reply owed | You need to reply | ID |
| app/applications/page.tsx | 3339 | Applications (/applications) — button | View JD | View job description | N2 |
| app/applications/page.tsx | 3339 | Applications (/applications) — button | Add JD | Add job description | N2 |
| app/applications/page.tsx | 3418 | Applications (/applications) — tooltip / title | Open your prep pack | Open your interview pack | N16 |
| app/applications/page.tsx | 3459 | Applications (/applications) — text | rows a page | applications a page | N6 |
| app/applications/page.tsx | 3490 | Applications (/applications) — text | ghosted | no reply | GH |
| app/applications/page.tsx | 3494 | Applications (/applications) — text | more stored as | more with the status | PL |
| app/applications/page.tsx | 3494 | Applications (/applications) — text | under Assessment: a test is open. | shown under Assessment, because a test is waiting. | PL |
| app/applications/page.tsx | 3515 | Applications (/applications) — button | Open as spreadsheet → | Open as a table → | PL |
| app/applications/page.tsx | 3525 | Applications (/applications) — text | What's working | Insights | N15 |
| app/applications/page.tsx | 3532 | Applications (/applications) — button | Show breakdown | Show details | PL |
| app/applications/page.tsx | 3540 | Applications (/applications) — tooltip / title | By eligibility read at the pre-check | By the free check's advice | N8 PL |
| app/applications/page.tsx | 3544 | Applications (/applications) — tooltip / title | By how the row was made | By how the application was added | N6 |
| app/applications/page.tsx | 3547 | Applications (/applications) — tooltip / title | By posting age when you applied | By the age of the job advert when you applied | N2 |
| app/applications/page.tsx | 3551 | Applications (/applications) — text | Score and eligibility bands appear once applications saved from a tailored run have outcomes. | Score and eligibility groups appear when applications saved from Tailor have a result. | N5 N15 |
| app/applications/page.tsx | 3562 | Applications (/applications) — text | Does the score predict the outcome? | Do higher scores get further? | PL |
| app/auth/login/page.tsx | 197 | Sign in / sign up — text | Almost there | One more step | ID |
| app/auth/login/page.tsx | 222 | Sign in / sign up — text | Sign in to pick up your master CV and applications. | Sign in to open your CV and your applications. | N1 ID |
| app/auth/login/page.tsx | 223 | Sign in / sign up — text | Free to start — three tailored CVs on us, then bring your own key. | Free to start. You get 3 free tailored CVs in total. After that, add your own free API key and keep going at no cost. We show you how. | N3 N4 ID |
| app/customize/ProjectPoolEditor.tsx | 127 | My CV: project list editor — message | That removes every project. To remove the pool, use Remove pool. | That removes every project. To remove the project list, use Remove project list. | N11 |
| app/customize/ProjectPoolEditor.tsx | 189 | My CV: project list editor — text | These apply once your projects are saved as cards below. You can change them for one run on the tailoring page. | These apply once your projects are saved as cards below. You can change them for one CV on the Tailor page. | N5 |
| app/customize/layout.tsx | 7 | My CV (/customize) — label | Customise | My CV | N7 |
| app/customize/page.tsx | 174 | My CV (/customize) — message | Master CV | Main CV | N1 |
| app/customize/page.tsx | 182 | My CV (/customize) — message | Claims registry | Skill levels | N9 |
| app/customize/page.tsx | 183 | My CV (/customize) — label | Positioning | Headlines | N10 |
| app/customize/page.tsx | 193 | My CV (/customize) — message | Project pool | Project list | N11 |
| app/customize/page.tsx | 439 | My CV (/customize) — message | Saved — every CV you tailor from now on uses the CareerSet style unless you switch it per run. | Saved. Every CV you tailor from now on uses the CareerSet style, unless you change it for one CV. | N5 SS |
| app/customize/page.tsx | 729 | My CV (/customize) — message | Your cards are saved and tailoring uses them, but the pool's text didn't update. Save again when you're back online. | Your cards are saved and tailoring uses them, but the project list's text didn't update. Save again when you're back online. | N11 |
| app/customize/page.tsx | 747 | My CV (/customize) — message | Paste your projects first, or use Remove pool to switch this off. | Paste your projects first, or use Remove project list to switch this off. | N11 |
| app/customize/page.tsx | 751 | My CV (/customize) — message | Project pool is too long ({pool.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()} characters). | Project list is too long ({pool.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()} characters). | N11 |
| app/customize/page.tsx | 758 | My CV (/customize) — message | Pool removed. | Project list removed. | N11 |
| app/customize/page.tsx | 772 | My CV (/customize) — message | Pool removed. Tailoring uses the projects from your master CV again. | Project list removed. Tailoring uses the projects from your main CV again. | N11 N1 |
| app/customize/page.tsx | 777 | My CV (/customize) — message | Couldn't save the pool. Check your connection and try again. | Couldn't save the project list. Check your connection and try again. | N11 |
| app/customize/page.tsx | 827 | My CV (/customize) — message | Removed {r.removed.length === 1 ? "one line" : `$} from your master CV. Forms, the letter and the document now use your Eligibility answer. | Removed {r.removed.length === 1 ? "one line" : `$} from your main CV. Forms, the letter and the document now use your Eligibility answer. | N1 |
| app/customize/page.tsx | 848 | My CV (/customize) — text | No line of your master CV reads as a right-to-work status; only the extracted details are cleared. | No line of your main CV looks like a right-to-work status. Only the details we read from it are cleared. | N1 N12 |
| app/customize/page.tsx | 849 | My CV (/customize) — text | Remove {rtwLinesToRemove.length === 1 ? "this li} from your saved master CV? | Remove {rtwLinesToRemove.length === 1 ? "this li} from your saved main CV? | N1 |
| app/customize/page.tsx | 864 | My CV (/customize) — button | Remove from master CV | Remove from main CV | N1 |
| app/customize/page.tsx | 889 | My CV (/customize) — message | Saved. The pre-check on the tailoring page now compares each job's eligibility conditions against these answers. | Saved. The free check on the Tailor page now compares each job's eligibility conditions against these answers. | N8 N5 |
| app/customize/page.tsx | 995 | My CV (/customize) — message | Saved with no variants — tailoring uses your CV's own positioning. | Saved with no headlines. Tailoring uses your CV's own headline. | N10 |
| app/customize/page.tsx | 996 | My CV (/customize) — message | Saved {saved.length} variant{saved.length === 1 ? "" : "s"}{dropped ? ` (${dropped} without a name d}. The pre-check picks one by the posting's role type; you can override it per run. | Saved {n} headline(s){dropped}. The free check picks one by the kind of job. You can change it for one CV. | N10 N8 N5 |
| app/customize/page.tsx | 996 | My CV (/customize) — message | ({dropped} without a name dropped) | ({dropped} without a name removed) | PL |
| app/customize/page.tsx | 1131 | My CV (/customize) — message | Extraction worked, but the result couldn't be stored. Try again. | We read your CV, but could not save the result. Try again. | N12 |
| app/customize/page.tsx | 1136 | My CV (/customize) — message | Re-running extraction failed: {data.error} | We could not read your CV: {data.error} | N12 |
| app/customize/page.tsx | 1137 | My CV (/customize) — message | Re-running extraction failed. Try again. | We could not read your CV. Try again. | N12 |
| app/customize/page.tsx | 1141 | My CV (/customize) — message | Couldn't reach the server to re-run extraction. Try again. | Couldn't reach the server to read your CV. Try again. | N12 |
| app/customize/page.tsx | 1205 | My CV (/customize) — title | Customise | My CV | N7 |
| app/customize/page.tsx | 1206 | My CV (/customize) — page tagline | Manage your master CV, your details, and how your tailored CV is laid out. | Your main CV, your details, and how each tailored CV looks. | N1 PL |
| app/customize/page.tsx | 1239 | My CV (/customize) — text | Master CV | Main CV | N1 |
| app/customize/page.tsx | 1244 | My CV (/customize) — label | Master CV | Main CV | N1 |
| app/customize/page.tsx | 1246 | My CV (/customize) — help text | Add your full CV once. It's saved to your account and reused for every job — you'll only need to paste the job description on the main page each time. | Add your full CV once. We save it in your account and use it for every job. After that you only paste the job description on the Tailor page. | SS N5 |
| app/customize/page.tsx | 1258 | My CV (/customize) — message | Text extracted from {meta.filename} ({meta.characters.toLocaleString()} characters). | Text read from {meta.filename} ({meta.characters.toLocaleString()} characters). | N12 |
| app/customize/page.tsx | 1287 | My CV (/customize) — button | Save master CV | Save my CV | N1 BT |
| app/customize/page.tsx | 1297 | My CV (/customize) — text | Master CV | Main CV | N1 |
| app/customize/page.tsx | 1300 | My CV (/customize) — text | ✓ Master CV saved | ✓ Main CV saved | N1 |
| app/customize/page.tsx | 1308 | My CV (/customize) — text | Delete your saved CV and extracted details? Your project pool is kept. | Delete your main CV and the details we read from it? Your project list is kept. | N1 N11 N12 |
| app/customize/page.tsx | 1331 | My CV (/customize) — text | — extracting… | (reading your CV…) | N12 |
| app/customize/page.tsx | 1338 | My CV (/customize) — text | Pulled from your CV. Check these are right — they appear in your tailored CV's header and sections. | We read these from your CV. Check that they are right. They appear at the top of every tailored CV. | ID SS |
| app/customize/page.tsx | 1346 | My CV (/customize) — text | ). A headline naming two roles halves the impact of both — keep one here, and put the other on a positioning variant below; the tailored CV's header is built from the variant, never from this line. | ). A headline with two job titles is weaker than a headline with one. Keep one here, and add the other under Headlines below. | N10 SS |
| app/customize/page.tsx | 1366 | My CV (/customize) — text | extracted. Check the list below; if something is missing, re-run extraction. | were read. Check the list below. If something is missing, press Read my CV again. | N12 |
| app/customize/page.tsx | 1376 | My CV (/customize) — text | Also extracted from your CV | Also read from your CV | N12 |
| app/customize/page.tsx | 1413 | My CV (/customize) — text | This just shows what was read out of your CV — the wording itself is edited inline on the tailored CV preview. | This list shows what we read from your CV. To change the wording, edit the tailored CV preview. | PL |
| app/customize/page.tsx | 1421 | My CV (/customize) — text | Your CV is saved, but no details have been extracted from it yet — run the extraction below. | Your CV is saved, but we have not read your details from it yet. Press Read my CV again below. | N12 |
| app/customize/page.tsx | 1426 | My CV (/customize) — text | No details yet — add your master CV above and these will be extracted automatically. | No details yet. Add your main CV above and we read them from it automatically. | N1 N12 |
| app/customize/page.tsx | 1433 | My CV (/customize) — text | Re-running uses one AI call — continue? | We will read your CV again. This takes a few seconds. Continue? | N12 PL |
| app/customize/page.tsx | 1435 | My CV (/customize) — button | Yes, re-run | Yes, read it again | N12 |
| app/customize/page.tsx | 1447 | My CV (/customize) — button | Re-running extraction… | Reading your CV… | N12 |
| app/customize/page.tsx | 1447 | My CV (/customize) — button | Re-run extraction | Read my CV again | N12 BT |
| app/customize/page.tsx | 1467 | My CV (/customize) — section summary | Not set — the pre-check can't warn you | Not set. The free check cannot warn you. | N8 SS |
| app/customize/page.tsx | 1471 | My CV (/customize) — text | The questions an application form asks before anyone reads your CV: right to work, clearance, years, location, degree and graduation date, licences, contract type. Answer once; the pre-check on the tailoring page then warns when a job has a condition you'd fail, before a tailor is spent. Nothing here is guessed from your CV — leave anything you're unsure of as "Not set". | These are the questions an application form asks before anyone reads your CV: right to work, clearance, years, location, degree and graduation date, licences, contract type. Answer once. The free check on the Tailor page then warns you when a job has a condition you do not meet, before you use a tailored CV. Nothing here is guessed from your CV. Leave anything you are unsure of as "Not set". | N8 N3 SS |
| app/customize/page.tsx | 1493 | My CV (/customize) — text | A time-limited visa needs its end month: without it the pre-check cannot tell whether a posting's start date falls inside your permission, and the statement for forms cannot say when sponsorship would be needed. | A time-limited visa needs its end month. Without it, the free check cannot tell if a job's start date is inside your permission, and the statement for forms cannot say when you would need sponsorship. | N8 N2 SS |
| app/customize/page.tsx | 1501 | My CV (/customize) — text | "Full right to work" means settled status, indefinite leave to remain or citizenship. On a Student, Graduate or Skilled Worker visa, choose "Time-limited visa" instead: postings that ask for permanent right to work are then flagged before a credit is spent, and the answer stays true when a form asks whether you will ever need sponsorship. | "Full right to work" means settled status, indefinite leave to remain or citizenship. On a Student, Graduate or Skilled Worker visa, choose "Time-limited visa". Jobs that ask for permanent right to work are then marked before you use a tailored CV. Your answer also stays true when a form asks if you will ever need sponsorship. | N2 N3 SS |
| app/customize/page.tsx | 1646 | My CV (/customize) — text | Set this. The pre-check's “this reads as mid-level” warning compares the posting with it, and a mid-level or senior read is held until it is set. | Set this. The free check compares each job's level with it. A mid-level or senior job is held until it is set. | N8 SS |
| app/customize/page.tsx | 1661 | My CV (/customize) — text | The pre-check then holds every posting that reads as mid-level or senior, whatever your years say. | The free check then holds every job that looks mid-level or senior, whatever your years say. | N8 N2 |
| app/customize/page.tsx | 1826 | My CV (/customize) — title | Claims registry | Skill levels | N9 |
| app/customize/page.tsx | 1832 | My CV (/customize) — section summary | Seeded when your CV is extracted | Made when we read your CV | N12 ID |
| app/customize/page.tsx | 1841 | My CV (/customize) — text | = never appears in any CV, letter or email. Click a skill to change its level. Figures in generated text are checked against your master CV automatically. | = never appears in any CV, letter or email. Click a skill to change its level. Figures in generated text are checked against your main CV automatically. | N1 |
| app/customize/page.tsx | 1846 | My CV (/customize) — text | No skills registered yet — re-run extraction above to seed the list from your CV. | No skills yet. Press Read my CV again above to fill this list from your CV. | N12 ID |
| app/customize/page.tsx | 1852 | My CV (/customize) — text | Your CV changed since this list was seeded — re-run extraction above to refresh it. Levels you've confirmed are kept. | Your CV changed after this list was made. Press Read my CV again above to update it. Levels you confirmed are kept. | N12 ID |
| app/customize/page.tsx | 1884 | My CV (/customize) — text | Levels were read from your CV and are already enforced: a result that claims a skill above its level, or a figure that isn't on your CV, blocks the download. Confirm once you've reviewed them. | We read these levels from your CV and already use them. If a tailored CV claims a skill above its level, or a number that is not in your CV, you cannot download it until it is fixed. Press Confirm when you have checked the levels. | SS PL |
| app/customize/page.tsx | 1952 | My CV (/customize) — title | Positioning | Headlines | N10 |
| app/customize/page.tsx | 1957 | My CV (/customize) — section summary | None — your CV's own positioning | None. Your CV's own headline is used. | N10 SS |
| app/customize/page.tsx | 1958 | My CV (/customize) — section summary | {variantsDraft.length} variant{variantsDraft.length === 1 ? "" : "s"} | {variantsDraft.length} headline{variantsDraft.length === 1 ? "" : "s"} | N10 |
| app/customize/page.tsx | 1962 | My CV (/customize) — text | A headline naming two roles ("Full Stack Engineer \| AI Engineer") halves the impact of both. Set one positioning per kind of role: the summary opens with that headline and the skills section leads with those skills, drawn from your master CV as always. The pre-check picks the variant whose role types match the posting and says why; you can override it for any run. | A headline with two job titles ("Full Stack Engineer \| AI Engineer") is weaker than a headline with one. Set one headline for each kind of job. The summary opens with it, and the skills section starts with the skills you choose. The free check picks the headline that fits the job. You can change it for one CV. | N10 N8 SS |
| app/customize/page.tsx | 1977 | My CV (/customize) — field label | Variant name | Name | N10 |
| app/customize/page.tsx | 1981 | My CV (/customize) — field label | Headline (one positioning) | Headline (one job title) | N10 |
| app/customize/page.tsx | 1985 | My CV (/customize) — field label | Lead with these skills (comma-separated, production-level on your claims registry) | Skills to show first (separate with commas; only skills at production level in Skill levels) | N10 N9 ID |
| app/customize/page.tsx | 2019 | My CV (/customize) — button | Remove variant | Remove headline | N10 |
| app/customize/page.tsx | 2026 | My CV (/customize) — button | Add a variant | Add a headline | N10 |
| app/customize/page.tsx | 2029 | My CV (/customize) — button | Save variants | Save headlines | N10 |
| app/customize/page.tsx | 2147 | My CV (/customize) — text | Two pages is the default: the tailored CV keeps your master CV's content, and when the tailoring leaves a bullet out and there is room, the most relevant ones are put back so both pages are used; the built PDF's own page count is checked, never an estimate. One page trims the least relevant bullets to fit, and the results page lists every one. (The UK Jobs Insider method prefers one page for graduate-scheme applications — choose it per your own rule.) | Two pages is the default. The tailored CV keeps your main CV's content. When tailoring leaves a bullet out and there is room, the most relevant ones are put back, so both pages are used. We check the page count of the real PDF, never an estimate. One page cuts the least relevant bullets to fit, and the results page lists every one. (The UK Jobs Insider method prefers one page for graduate schemes. Choose by your own rule.) | N1 SS |
| app/customize/page.tsx | 2176 | My CV (/customize) — text | Format style. UKJI is the shape every CV has had. CareerSet is the shape tuned by hand in the university's CV tool: printed contact addresses, grouped tool lines, no bold and no full stops on bullets, a four-point letter. Both run the same honesty checks and cost the same credit. This is the default; the Style control on the tailoring page overrides it per run. | Format style. UKJI is the shape every CV has had. CareerSet is the shape tuned by hand in the university's CV tool. It prints contact addresses, groups the tool lines, and uses no bold and no full stops on bullets. Both run the same honesty checks and count as 1 tailored CV. This is the default. The Style control on the Tailor page changes it for one CV. | N3 N5 SS |
| app/customize/page.tsx | 2211 | My CV (/customize) — text | Off by default. A reviewer who sees your immigration status before reading a line of your experience screens on it, and the application form asks the same question in a better place. The wording comes from your Eligibility answers above, never from the CV text: it is offered as a copy block beside the download buttons for pasting into forms, and it closes the cover letter only when this is on. Turn it on only for a posting that asks for it on the document itself. | Off by default. A reviewer who sees your immigration status first may judge you on it, and the application form asks the same question in a better place. The wording comes from your Eligibility answers above, never from your CV's text. You get it as a block to copy into forms, beside the download buttons. It closes the cover letter only when this is on. Turn it on only when a job asks for it on the CV itself. | N2 SS |
| app/customize/page.tsx | 2261 | My CV (/customize) — text | The GitHub repository and live site shown under each project on every CV you tailor: in the preview, the Word file, the PDF and the copy saved to your tracker. The address itself is printed, not just the word "GitHub", so a recruiter's system that keeps only the text still has it. Where your CV or project pool already writes a link, it is filled in for you. | The GitHub repository and live site shown under each project on every tailored CV: in the preview, the Word file, the PDF and the copy saved on Applications. The address itself is printed, not only the word "GitHub", so a recruiter's system that keeps only text still has it. A link that your CV or project list already writes is filled in for you. | N6 N11 SS |
| app/customize/page.tsx | 2273 | My CV (/customize) — text | Your projects appear here once your master CV is saved. | Your projects appear here once your main CV is saved. | N1 |
| app/customize/page.tsx | 2394 | My CV (/customize) — title | Project pool | Project list | N11 |
| app/customize/page.tsx | 2425 | My CV (/customize) — label | Project pool | Project list | N11 |
| app/customize/page.tsx | 2426 | My CV (/customize) — help text | Paste ALL your projects here, in your own words — names, dates, tech, and what you did. Once saved they read into cards you can check, pin and order. Until then, on every tailor run the 2 most relevant to that job (1 if you only add one) are selected and get tailored bullets, replacing the projects from your master CV for that run. Remove the pool to switch back. Replacing your master CV keeps the pool. | Paste ALL your projects here, in your own words: names, dates, tech, and what you did. After you save, each project becomes a card that you can check, order, or mark "Always include". Until then, each tailored CV uses the 2 projects that best fit the job, in place of the projects in your main CV. Remove the project list to go back. Replacing your main CV keeps the project list. | N11 N1 N5 SS |
| app/customize/page.tsx | 2440 | My CV (/customize) — button | Save project pool | Save project list | N11 |
| app/customize/page.tsx | 2452 | My CV (/customize) — text | Delete your whole project pool? | Delete your whole project list? | N11 |
| app/customize/page.tsx | 2453 | My CV (/customize) — button | Keep pool | Keep it | N11 |
| app/customize/page.tsx | 2457 | My CV (/customize) — button | Remove pool | Remove project list | N11 |
| app/settings/page.tsx | 23 | Settings — message | Your account, your usage, and the provider keys that keep tailoring running after the free credits. | Your account, how much you have used, and your own API key for after the 3 free tailored CVs. | N3 N4 |
| app/settings/page.tsx | 46 | Settings — message | Runs your tailoring once your free credits are used. A free OpenRouter account is enough — its free tier handles full runs. | OpenRouter is a service that gives free access to AI models. Jobhuntz uses your key from it after your 3 free tailored CVs. A free OpenRouter account is enough. | N3 N4 SS |
| app/settings/page.tsx | 48 | Settings — message | Heads up: free OpenRouter models may use what you send for training. If that matters for your CV, check the privacy settings in your OpenRouter account. | Note: free OpenRouter models may use what you send for training. If that matters for your CV, check the privacy settings in your OpenRouter account. | ID |
| app/settings/page.tsx | 64 | Settings — message | Optional — not used for tailoring yet. Gemini's free tier allows 5 requests a minute and a full run makes 8, so a run can't finish on it. | Optional. Jobhuntz does not use it for tailoring yet. Gemini's free plan allows 5 requests a minute and one CV needs 8, so it cannot finish. | N5 SS |
| app/settings/page.tsx | 318 | Settings — text | Free tailors today: | Today: | N3 |
| app/settings/page.tsx | 323 | Settings — text | Free Claude credits: | Free tailored CVs: | N3 |
| app/settings/page.tsx | 324 | Settings — text | left (lifetime) | left ({usage.claudeLimit} in total) | N3 PL |
| app/settings/page.tsx | 471 | Settings — text | Everything in your account — CV, answers, applications, prep packs, interview transcripts — as one JSON file, or gone for good. What is stored and who processes it is in the | Everything in your account as one JSON file: CV, answers, applications, interview packs and interview transcripts. Or delete it all for good. What is stored and who processes it is in the | N16 SS |
| app/settings/page.tsx | 489 | Settings — text | Your account, your CV, every application, every uploaded file, every prep pack and interview transcript are deleted immediately. Download your data first if you want to keep it. | Your account, your CV, every application, every uploaded file, every interview pack and interview transcript are deleted immediately. Download your data first if you want to keep it. | N16 |
| components/FirstRunBanner.tsx | 84 | “Start here” banner — text | Everything here is built from your master CV, and nothing goes in that it doesn't say. Add it once on Customise. | Jobhuntz builds everything from your main CV. It never adds anything your CV does not say. Add your CV once on My CV. | N1 N7 SS |
| components/FirstRunGuide.tsx | 57 | First-run guide (Schedule, My CV) — message | Couldn't save your answer. Check your connection and try again, or answer under Eligibility on Customise. | Couldn't save your answer. Check your connection and try again, or answer under Eligibility on My CV. | N7 |
| components/FirstRunGuide.tsx | 76 | First-run guide (Schedule, My CV) — text | Saved. Every tailored CV is built from it, and nothing goes in that it doesn't say. | Saved. We build every tailored CV from it. We never add anything it does not say. | SS |
| components/FirstRunGuide.tsx | 77 | First-run guide (Schedule, My CV) — text | Your full CV, once: a PDF, a Word file or pasted text. Every tailored CV is built from it, and nothing goes in that it doesn't say. | Add your main CV once: a PDF, a Word file or pasted text. We build every tailored CV from it. We never add anything it does not say. | N1 SS |
| components/FirstRunGuide.tsx | 91 | First-run guide (Schedule, My CV) — text | Confirm your right to work and sponsorship | Answer one question about your right to work | PL |
| components/FirstRunGuide.tsx | 95 | First-run guide (Schedule, My CV) — text | Eligibility on Customise | Eligibility on My CV | N7 |
| components/FirstRunGuide.tsx | 99 | First-run guide (Schedule, My CV) — text | Most UK application forms ask this, usually near the start. It is never worked out from your CV: choose the one that is true for you, or skip it and your form answers stay “Not answered” until you do. | Most UK application forms ask this near the start. We never guess it from your CV. Choose the answer that is true for you. If you skip it, your form answers say “Not answered” until you choose. | SS PL |
| components/FirstRunGuide.tsx | 125 | First-run guide (Schedule, My CV) — button | Answer on Customise | Answer on My CV | N7 |
| components/FirstRunGuide.tsx | 136 | First-run guide (Schedule, My CV) — text | A job description or a link to the posting, on Tailor. A free check runs first and says how well you match before anything is spent. | Paste a job description, or a link to the job, on the Tailor page. A free check runs first. It tells you how well you match before you use a tailored CV. | N2 N3 SS |
| components/ui/AppHeader.tsx | 30 | Top navigation (every signed-in page) — label | Actions | To do | N14 |
| components/ui/AppHeader.tsx | 31 | Top navigation (every signed-in page) — message | What's next | Schedule | N14 |
| components/ui/AppHeader.tsx | 35 | Top navigation (every signed-in page) — label | Customise | My CV | N7 |
| lib/closing.ts | 116 | Applications: closing and reopening — label | Ghosted | No reply | GH |
| lib/fallbackRoute.ts | 33 | Tailor: notice when another AI service was used — message | Your OpenRouter key has used today's 50 free-model requests (a tailor is about 10). Add $10 of credit at openrouter.ai for 1,000 a day, or try again tomorrow. | Your API key has used today's 50 free requests at OpenRouter. One tailored CV needs about 10. Add $10 of credit at openrouter.ai for 1,000 a day, or try again tomorrow. | N4 N5 SS |
| lib/fallbackRoute.ts | 34 | Tailor: notice when another AI service was used — message | Your OpenRouter key has hit its usage limit. Try again later. | Your API key has reached its limit. Try again later. | N4 ID |
| lib/fallbackRoute.ts | 42 | Tailor: notice when another AI service was used — message | The shared Claude account is still out of credit (the top-up has to land on the API key this app uses, in the Anthropic Console, not a Claude.ai plan), so the run fell back to your OpenRouter key. | Our free AI service is not available, so Jobhuntz tried your own API key. | N4 PL |
| lib/fallbackRoute.ts | 43 | Tailor: notice when another AI service was used — message | The shared Claude account is being rate-limited, so the run fell back to your OpenRouter key. | Our free AI service is busy, so Jobhuntz tried your own API key. | N4 PL |
| lib/fallbackRoute.ts | 48 | Tailor: notice when another AI service was used — message | the shared Claude account is out of credit | our free AI service is not available right now | PL |
| lib/fallbackRoute.ts | 48 | Tailor: notice when another AI service was used — message | the shared Claude account is being rate-limited | our free AI service is busy | PL |
| lib/fallbackRoute.ts | 49 | Tailor: notice when another AI service was used — message | your OpenRouter key | your own API key | N4 |
| lib/fallbackRoute.ts | 50 | Tailor: notice when another AI service was used — message | This run used {on} because {why}. Nothing was charged to your free tailors. | This CV was written with {on} because {why}. It did not use one of your free tailored CVs. | N3 N5 |
| lib/firstRun.ts | 76 | First-run guide: right-to-work choices — message | A Student, Graduate or similar visa: no sponsorship to start, but needed later. | A Student, Graduate or similar visa. You can start without sponsorship (an employer supporting your visa), but you will need it later. | PL |
| lib/gapCheck.ts | 276 | Tailor: free check, missing requirements — message | {terms.length} core {terms.length === 1 ? "gap" : "gaps"}: {shown}{more}.{blocks ? " This role may not suit you." }{caveat} | {n} main requirement(s) not in your CV: {shown}{more}. This job may not suit you.{caveat} | PL N2 |
| lib/gapCheck.ts | 276 | Tailor: free check, missing requirements — message | This role may not suit you. | This job may not suit you. | N2 |
| lib/insights.ts | 198 | Applications: Insights groups — message | Read: apply | Advice: apply | PL |
| lib/insights.ts | 198 | Applications: Insights groups — message | Read: long shot | Advice: low chance | PL ID |
| lib/insights.ts | 198 | Applications: Insights groups — message | Read: likely auto-rejected | Advice: likely to be rejected automatically | PL |
| lib/knockouts.ts | 148 | Tailor: requirements check — message | Long shot | Low chance | ID |
| lib/knockouts.ts | 148 | Tailor: requirements check — message | Long shot: {q} | Low chance: {q} | ID |
| lib/knockouts.ts | 148 | Tailor: requirements check — message | Long shot: a condition was borderline. | Low chance: you only partly meet one condition. | ID PL |
| lib/knockouts.ts | 856 | Tailor: requirements check — message | Set your right-to-work status in Customise to check this. | Set your right-to-work status on My CV to check this. | N7 |
| lib/knockouts.ts | 860 | Tailor: requirements check — message | The posting asks about your right to work without saying whether it sponsors. | The job description asks about your right to work without saying whether it sponsors. | N2 |
| lib/knockouts.ts | 883 | Tailor: requirements check — message | Set your clearance status in Customise to check this. | Set your clearance status on My CV to check this. | N7 |
| lib/knockouts.ts | 893 | Tailor: requirements check — message | The role asks that you can obtain {label} clearance; say in Customise whether you're eligible. | The role asks that you can obtain {label} clearance; say on My CV whether you're eligible. | N7 |
| lib/knockouts.ts | 897 | Tailor: requirements check — message | Add your years of experience in Customise to check this. | Add your years of experience on My CV to check this. | N7 |
| lib/knockouts.ts | 913 | Tailor: requirements check — message | Remote but restricted to {place}; add your base location in Customise to check. | Remote but restricted to {place}; add your base location on My CV to check. | N7 |
| lib/knockouts.ts | 919 | Tailor: requirements check — message | Relocation is required; say in Customise whether you'd relocate. | Relocation is required; say on My CV whether you'd relocate. | N7 |
| lib/knockouts.ts | 924 | Tailor: requirements check — message | {cap(modeLabel)} in {place}; add your base location in Customise to check the commute. | {cap(modeLabel)} in {place}; add your base location on My CV to check the commute. | N7 |
| lib/knockouts.ts | 934 | Tailor: requirements check — message | {cap(modeLabel)} in {place}; say in Customise whether you'd relocate. | {cap(modeLabel)} in {place}; say on My CV whether you'd relocate. | N7 |
| lib/knockouts.ts | 939 | Tailor: requirements check — message | {cap(modeLabel)} role; say in Customise whether that works for you. | {cap(modeLabel)} role; say on My CV whether that works for you. | N7 |
| lib/knockouts.ts | 943 | Tailor: requirements check — message | Add your highest degree in Customise to check this. | Add your highest degree on My CV to check this. | N7 |
| lib/knockouts.ts | 948 | Tailor: requirements check — message | Point to the equivalent experience the posting allows, specifically. | Point to the equivalent experience the job description allows, specifically. | N2 |
| lib/knockouts.ts | 952 | Tailor: requirements check — message | Asks for a {val.classification}; add your degree classification in Customise. | Asks for a {val.classification}; add your degree classification on My CV. | N7 |
| lib/knockouts.ts | 961 | Tailor: requirements check — message | Add your graduation dates in Customise (Eligibility) to check this. | Add your graduation dates on My CV (Eligibility) to check this. | N7 |
| lib/knockouts.ts | 999 | Tailor: requirements check — message | Asks for a recent graduate; {facts}. "Recent" isn't defined in the posting, so check what they mean before applying. | Asks for a recent graduate; {facts}. "Recent" isn't defined in the job description, so check what they mean before applying. | N2 |
| lib/knockouts.ts | 1002 | Tailor: requirements check — message | Asks that you hold {val.name}; list your licences and certifications in Customise to check. | Asks that you hold {val.name}; list your licences and certifications on My CV to check. | N7 |
| lib/limits.ts | 51 | Tailor: input checks — message | This looks like part of a posting (under 1,500 characters). Eligibility conditions usually sit at the bottom of the ad, and tailoring against a fragment gives a generic CV. Paste the whole posting before spending a tailor. | This looks like only part of a job description (under 1,500 characters). The requirements are usually at the bottom of the advert. Tailoring from part of one gives a general CV. Paste the whole job description before you use a tailored CV. | N2 N3 SS |
| lib/limits.ts | 55 | Tailor: input checks — message | Project pool is too long (max ~15,000 characters). | Project list is too long (max ~15,000 characters). | N11 |
| lib/llmRouting.ts | 208 | Tailor: limit and key errors — message | You've reached your daily tailoring limit ({DAILY_TAILOR_LIMIT} per 24 hours). Resets in {remaining}. | You have reached today's limit ({DAILY_TAILOR_LIMIT} tailored CVs in 24 hours). You can tailor again in {remaining}. | N3 PL |
| lib/llmRouting.ts | 291 | Tailor: limit and key errors — message | Your saved API key couldn't be read — it may need to be re-entered. Go to Settings and replace it. | We could not read your saved API key. Go to Settings and enter it again. | N4 |
| lib/llmRouting.ts | 307 | Tailor: limit and key errors — message | Your Gemini key can't complete a tailoring run — Gemini's free tier allows 5 requests per minute and one run makes 8. Add an OpenRouter key in Settings to continue. | Your Gemini key cannot tailor a CV. Gemini's free plan allows 5 requests a minute and one CV needs 8. Add an OpenRouter key in Settings to continue. | N5 |
| lib/llmRouting.ts | 318 | Tailor: limit and key errors — message | You've used all free tailors. Add your own API key in Settings to continue. | You have used your 3 free tailored CVs. Add your own API key in Settings to continue. | N3 N4 |
| lib/plan.ts | 511 | Schedule: groups, replies, kinds — label | Ghosted | No reply | GH |
| lib/routingText.ts | 28 | Settings: usage sentence — message | Tailoring runs on the free credits first, then on your OpenRouter key. | Jobhuntz uses your free tailored CVs first, then your own API key. | N3 N4 |
| lib/routingText.ts | 28 | Settings: usage sentence — message | Tailoring runs on the free credits first; an OpenRouter key keeps it running after them. | Jobhuntz uses your free tailored CVs first. After them you need your own API key. | N3 N4 |
| lib/routingText.ts | 37 | Settings: usage sentence — message | This account is unlimited: no daily cap and no credit count. {usage.dailyUsed} tailor{usage.dailyUsed === 1 ? "" : "s"} so far today. | This account is unlimited: no daily limit and no count of free tailored CVs. {usage.dailyUsed} tailored CV{s} so far today. | N3 N5 |
| lib/routingText.ts | 38 | Settings: usage sentence — message | The next run uses {label}{chosenProvider ? " (the provider picked }. | Your next tailored CV uses {label}{ (the provider picked on the Tailor page)}. | N5 |
| lib/routingText.ts | 38 | Settings: usage sentence — message | (the provider picked on the tailoring page) | (the provider picked on the Tailor page) | N5 |
| lib/routingText.ts | 44 | Settings: usage sentence — message | The daily cap is reached: {usage.dailyLimit} tailors a day, on every path — your own key included. | You have reached today's limit: {usage.dailyLimit} tailored CVs a day. The limit also applies on your own API key. | N3 N4 PL |
| lib/routingText.ts | 45 | Settings: usage sentence — message | The next run waits for the daily window to reset. | You can tailor again when the limit resets. | N5 PL |
| lib/routingText.ts | 51 | Settings: usage sentence — message | {dailyLeft} of {usage.dailyLimit} tailors left today; {claudeLeft} of {usage.claudeLimit} free Claude credit{usage.claudeLimit === 1 ? "" : "s"} left. | {dailyLeft} of {usage.dailyLimit} left today. {claudeLeft} of {usage.claudeLimit} free tailored CVs left in total. | N3 |
| lib/routingText.ts | 53 | Settings: usage sentence — message | The next run uses a free Claude credit. When those are used, your OpenRouter key takes over — the daily cap still applies. | Your next tailored CV is a free one. When the free ones are used, Jobhuntz uses your own API key. The daily limit still applies. | N3 N4 |
| lib/routingText.ts | 54 | Settings: usage sentence — message | The next run uses a free Claude credit. When those are used you will need an OpenRouter key; the daily cap applies either way. | Your next tailored CV is a free one. When the free ones are used, you will need your own API key. The daily limit applies in both cases. | N3 N4 |
| lib/routingText.ts | 60 | Settings: usage sentence — message | {dailyLeft} of {usage.dailyLimit} tailors left today; your free Claude credits are used. | {dailyLeft} of {usage.dailyLimit} left today. Your free tailored CVs are used. | N3 |
| lib/routingText.ts | 61 | Settings: usage sentence — message | The next run uses your OpenRouter key. Free models are slower and the run skips the polish retries; every honesty check still runs. | Your next tailored CV uses your own API key. Free models are slower, and some second attempts at wording are skipped. Every honesty check still runs. | N4 N5 PL |
| lib/routingText.ts | 66 | Settings: usage sentence — message | {dailyLeft} of {usage.dailyLimit} tailors left today, but your free Claude credits are used and there is no OpenRouter key. | {dailyLeft} of {usage.dailyLimit} left today, but your free tailored CVs are used and you have no API key. | N3 N4 |
| lib/routingText.ts | 67 | Settings: usage sentence — message | Add a free OpenRouter key below to keep tailoring. | Add your own API key below to keep tailoring. | N4 |
| lib/scoreChange.ts | 48 | Score card: before tailoring — message | Before tailoring: {c.before.matched}/{c.before.total} in your master CV. | Before tailoring: {c.before.matched}/{c.before.total} in your main CV. | N1 |
| lib/scoreChange.ts | 54 | Score card: before tailoring — message | No longer counted: {list(c.lost)} (in your master CV, but not in the tailored summary, skills, experience or projects, which are what this score reads). | No longer counted: {list(c.lost)} (in your main CV, but not in the tailored summary, skills, experience or projects, which are what this score reads). | N1 |
| lib/seniority.ts | 221 | Tailor: free check, level warning — message | The posting doesn't say which level it is written for. | The job description does not say which level it is for. | N2 |
| lib/seniority.ts | 222 | Tailor: free check, level warning — message | This reads as {label}. | This looks like a {label} job. | PL |
| lib/seniority.ts | 224 | Tailor: free check, level warning — message | This reads as {label} — tailoring anyway will spend a credit. You look for junior and early-career roles only (Customise → Eligibility). | This looks like a {label} job. Tailoring anyway uses 1 tailored CV. You said you look for junior and early-career roles only (My CV → Eligibility). | N3 N7 PL |
| lib/seniority.ts | 228 | Tailor: free check, level warning — message | This reads as {label} (roles at this level usually expect {need}+ years) and your years of experience are not set in Customise → Eligibility, so it cannot be checked — set them. Tailoring anyway spends a credit. | This looks like a {label} job. Jobs at this level usually expect {need}+ years. Set your years of experience in My CV → Eligibility so we can check. Tailoring anyway uses 1 tailored CV. | N3 N7 SS |
| lib/seniority.ts | 230 | Tailor: free check, level warning — message | This reads as {label}; your {yearsExperience} years cover it. | This looks like a {label} job. Your {yearsExperience} years cover it. | PL |
| lib/seniority.ts | 234 | Tailor: free check, level warning — message | This reads as {label} — tailoring anyway will spend a credit. Roles at this level usually expect {need}+ years; you have {yearsExperience}. | This looks like a {label} job. Tailoring anyway uses 1 tailored CV. Jobs at this level usually expect {need}+ years; you have {yearsExperience}. | N3 PL |
| lib/tracker.ts | 31 | Status names (Applications, Plan) — label | Ghosted | No reply | GH |
| lib/tracker.ts | 283 | Status names (Applications, Plan) — message | Missing JD | Missing job description | N2 |
| lib/tracker.ts | 330 | Status names (Applications, Plan) — message | The search-visibility score is weak: fewer than half of the role's terms are in this CV. | The search-visibility score is weak: fewer than half of the job's key words are in this CV. | PL |
| lib/tracker.ts | 331 | Status names (Applications, Plan) — message | The eligibility read was "likely auto-rejected": the posting screens on a condition this profile does not meet. | The free check's advice was "likely to be rejected automatically": the job description screens on a condition you do not meet. | N8 N2 PL |
| lib/tracker.ts | 332 | Status names (Applications, Plan) — message | The eligibility read was "long shot": one of the posting's conditions is a stretch for this profile. | The free check's advice was "low chance": you only partly meet one of the job's conditions. | N8 ID |
| lib/tracker.ts | 337 | Status names (Applications, Plan) — message | You already have {d.company_name} — {d.role}{when}{status} in the tracker. | You already have {d.company_name}: {d.role}{when}{status} in Applications. | N6 SS |
| lib/variants.ts | 55 | Tailor: which headline was picked — message | Only production-level skills can lead. Skipped: {dropped.map((d) => `${d.skill} (${word(d}. | Only production-level skills can be shown first. Skipped: {list}. | ID |
| lib/variants.ts | 119 | Tailor: which headline was picked — message | No positioning variants saved. | No headlines saved. | N10 |
| lib/variants.ts | 120 | Tailor: which headline was picked — message | No variant applied (your choice for this run). | No headline used (your choice for this CV). | N10 N5 |
| lib/variants.ts | 123 | Tailor: which headline was picked — message | {v.name} (your choice for this run). | {v.name} (your choice for this CV). | N5 |
| lib/variants.ts | 127 | Tailor: which headline was picked — message | {byRole.name} - the posting reads as {ROLE_TYPE_LABEL[rt as RoleType] ?? rt}. | {byRole.name} - this looks like a {role type} job. | N2 PL |
| lib/variants.ts | 129 | Tailor: which headline was picked — message | {variants[0].name} - your only variant, set for every role type. | {variants[0].name} - your only headline, set for every kind of job. | N10 |
| lib/variants.ts | 132 | Tailor: which headline was picked — message | None of your variants is set for a {ROLE_TYPE_LABEL[rt as RoleType] ?? rt} role - tailoring uses your CV's own positioning. | None of your headlines is set for a {role type} job - tailoring uses your CV's own headline. | N10 |
| lib/variants.ts | 132 | Tailor: which headline was picked — message | The posting's role type wasn't read - tailoring uses your CV's own positioning. | We could not tell what kind of job this is - tailoring uses your CV's own headline. | N10 N2 |
| lib/visibilityVerdict.ts | 22 | Score card verdict — message | Weak match. Do not send as-is. | Weak match. Do not send it yet. | ID |
| lib/visibilityVerdict.ts | 122 | Score card verdict — message | Weak fit. Company research scored {figure} (low match) against your CV; do not send as-is. | Weak fit. Company research scored {figure} (low match) against your CV. Do not send it yet. | ID |
| app/applications/[id]/interview/InterviewRoom.tsx | 388 | Mock interview — text | Leave before answering anything? Your credit has been used. | Leave before answering anything? This interview has already counted as 1 tailored CV. | N3 |
| app/applications/[id]/interview/page.tsx | 281 | Mock interview — message | Save your master CV first. | Save your main CV first. | N1 |
| app/applications/[id]/interview/page.tsx | 281 | Mock interview — message | Go to Customise → | Go to My CV → | N7 |
| app/applications/[id]/interview/page.tsx | 282 | Mock interview — message | The interview is built from it. Paste it into this application in the tracker, then come back. | The interview is built from it. Paste it into this application in Applications, then come back. | N6 |
| app/applications/[id]/interview/page.tsx | 282 | Mock interview — message | Open the tracker → | Open your applications list → | N6 |
| app/applications/[id]/interview/page.tsx | 284 | Mock interview — message | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| app/applications/[id]/interview/page.tsx | 284 | Mock interview — message | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| app/applications/[id]/interview/page.tsx | 284 | Mock interview — message | Add your key in Settings → | Add my API key → | N4 BT |
| app/applications/[id]/interview/page.tsx | 285 | Mock interview — message | Your Gemini key can't run mock interviews. | Your Gemini key cannot run a mock interview. | PL |
| app/applications/[id]/interview/page.tsx | 285 | Mock interview — message | Once your free Claude credits are used, interviews run on an OpenRouter key. Add one in Settings to continue. | After your free tailored CVs are used, a mock interview needs an OpenRouter key. Add one in Settings to continue. | N3 |
| app/applications/[id]/interview/page.tsx | 286 | Mock interview — message | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| app/applications/[id]/interview/page.tsx | 287 | Mock interview — message | Your key's daily limit is reached. | Your API key has reached today's limit. | N4 |
| app/applications/[id]/interview/page.tsx | 305 | Mock interview — text | Prep pack | Interview pack | N16 |
| app/applications/[id]/interview/page.tsx | 323 | Mock interview — button | Open the tracker | Open your applications list | N6 |
| app/applications/[id]/interview/page.tsx | 324 | Mock interview — text | The interviewer's questions come from the job description. Paste it into this application in the tracker, then come back. | The interviewer's questions come from the job description. Paste it into this application in Applications, then come back. | N6 |
| app/applications/[id]/interview/page.tsx | 476 | Mock interview — button | Start interview · uses 1 credit | Start interview · counts as 1 tailored CV | N3 |
| app/applications/[id]/interview/page.tsx | 480 | Mock interview — text | You've used today's credits. Add your own key in Settings to keep going. | You have reached today's limit of 3. You can start an interview tomorrow. | N3 PL |
| app/applications/[id]/prep/PrepPackView.tsx | 282 | Applications (/applications) — text | {pack.check.sentences} sentence{pack.check.sentences === 1 ? "" : "s"} checked against your master CV — {pack.check.flagged} marked as not from it{pack.check.removed > 0 ? `, ${pack.check}. | {n} sentence(s) checked against your main CV. {flagged} marked as not from it{, removed …}. | N1 SS |
| app/applications/[id]/prep/page.tsx | 26 | Applications (/applications) — message | Your session has expired — sign in again to see your prep pack. | Your session has expired. Sign in again to see your interview pack. | N16 SS |
| app/applications/[id]/prep/page.tsx | 152 | Applications (/applications) — message | Couldn't build your prep pack. Try again. | Couldn't build your interview pack. Try again. | N16 |
| app/applications/[id]/prep/page.tsx | 157 | Applications (/applications) — message | The prep pack came back in an unexpected shape. Try again. | The interview pack came back in an unexpected shape. Try again. | N16 |
| app/applications/[id]/prep/page.tsx | 189 | Applications (/applications) — message | The prep pack came back in an unexpected shape. Try again. | The interview pack came back in an unexpected shape. Try again. | N16 |
| app/applications/[id]/prep/page.tsx | 237 | Applications (/applications) — text | Save your master CV first. | Save your main CV first. | N1 |
| app/applications/[id]/prep/page.tsx | 239 | Applications (/applications) — button | Go to Customise → | Go to My CV → | N7 |
| app/applications/[id]/prep/page.tsx | 246 | Applications (/applications) — text | The prep pack is built from it. Paste it into this application in the tracker, then come back. | The interview pack is built from it. Paste it into this application on Applications, then come back. | N16 N6 |
| app/applications/[id]/prep/page.tsx | 247 | Applications (/applications) — button | Open the tracker → | Open your applications list → | N6 |
| app/applications/[id]/prep/page.tsx | 253 | Applications (/applications) — text | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| app/applications/[id]/prep/page.tsx | 254 | Applications (/applications) — text | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| app/applications/[id]/prep/page.tsx | 255 | Applications (/applications) — button | Add your key in Settings → | Add my API key → | N4 BT |
| app/applications/[id]/prep/page.tsx | 261 | Applications (/applications) — text | Your Gemini key can't run interview prep. | Your Gemini key cannot make an interview pack. | N16 |
| app/applications/[id]/prep/page.tsx | 262 | Applications (/applications) — text | Once your free Claude credits are used, prep runs on an OpenRouter key. Add one in Settings to continue. | After your free tailored CVs are used, an interview pack needs an OpenRouter key. Add one in Settings to continue. | N3 |
| app/applications/[id]/prep/page.tsx | 269 | Applications (/applications) — text | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| app/applications/[id]/prep/page.tsx | 277 | Applications (/applications) — text | Your key's daily limit is reached. | Your API key has reached today's limit. | N4 |
| app/applications/[id]/prep/page.tsx | 315 | Applications (/applications) — label | Loading your prep pack | Loading your interview pack | N16 |
| app/applications/[id]/prep/page.tsx | 344 | Applications (/applications) — button | Open the tracker | Open your applications list | N6 |
| app/applications/[id]/prep/page.tsx | 345 | Applications (/applications) — text | The prep pack is built from the job description. Paste it into this application's JD cell in the tracker, then come back here. | The interview pack is built from the job description. Add the job description to this application on Applications, then come back here. | N16 N6 |
| app/applications/[id]/prep/page.tsx | 355 | Applications (/applications) — text | A STAR answer for each, built from your master CV and checked sentence by sentence: the CV lines it came from with a ✓ when they trace verbatim, and a mark on any sentence the check couldn't trace, with one click to rewrite it from CV facts alone. | A STAR answer for each, built from your main CV and checked sentence by sentence: the CV lines it came from with a ✓ when they trace verbatim, and a mark on any sentence the check couldn't trace, with one click to rewrite it from CV facts alone. | N1 |
| app/applications/[id]/prep/page.tsx | 363 | Applications (/applications) — button | Generate prep pack | Make my interview pack | N16 BT |
| app/applications/[id]/prep/page.tsx | 368 | Applications (/applications) — text | Uses 1 tailor credit · saved to this application, so opening it again is free. | Counts as 1 tailored CV · saved with this application, so opening it again is free. | N3 |
| app/applications/[id]/prep/page.tsx | 369 | Applications (/applications) — text | {remaining} of {usage.dailyLimit} tailors left today. | {remaining} of {usage.dailyLimit} tailored CVs left today. | N5 |
| app/applications/[id]/prep/page.tsx | 373 | Applications (/applications) — text | You've used today's | You have reached today's limit of | N3 PL |
| app/applications/[id]/prep/page.tsx | 373 | Applications (/applications) — text | tailors — come back tomorrow, or add your own key in Settings. | . You can make an interview pack tomorrow. | N3 N16 SS |
| app/applications/[id]/prep/page.tsx | 390 | Applications (/applications) — text | Regenerating uses 1 credit and resets your ratings. | Making it again counts as 1 tailored CV and resets your ratings. | N3 PL |
| app/interviews/page.tsx | 21 | Interview (/interviews) — message | Every mock interview and every prep pack, across all your applications. | Every mock interview and every interview pack, across all your applications. | N16 |
| app/interviews/page.tsx | 92 | Interview (/interviews) — button | Open the tracker | Open your applications list | N6 |
| app/interviews/page.tsx | 93 | Interview (/interviews) — text | Each tracker row has an Interview button: pick the UK round, and an interviewer built from that job and your CV asks the questions out loud. One tailor credit each. | Each application has an Interview button. Pick the UK round, and an interviewer built from that job and your CV asks the questions out loud. Each interview counts as 1 tailored CV. | N3 SS |
| app/interviews/page.tsx | 122 | Interview (/interviews) — text | Prep packs | Interview packs | N16 |
| app/interviews/page.tsx | 124 | Interview (/interviews) — label | Loading your prep packs | Loading your interview packs | N16 |
| app/interviews/page.tsx | 126 | Interview (/interviews) — title | No prep packs yet | No interview packs yet | N16 |
| app/interviews/page.tsx | 126 | Interview (/interviews) — button | Open the tracker | Open your applications list | N6 |
| app/interviews/page.tsx | 127 | Interview (/interviews) — text | Each tracker row has a Prep button: the likely questions for that job with answers built only from your CV, each line traced back to it. | Each application has a Prep button: the likely questions for that job with answers built only from your CV, each line traced back to it. | N6 |
| lib/companyRules.ts | 348 | Reapply rules — message | Your tracker: {String(before.company_name)}, {String(before.role ?? "")}{when}, {STATUS_LABELS[status]}. | your applications list: {String(before.company_name)}, {String(before.role ?? "")}{when}, {STATUS_LABELS[status]}. | N6 |
| lib/factGuard.ts | 455 | Tailor: check-before-download notice — message | Removed, as your master CV describes the role differently: | Removed, as your main CV describes the role differently: | N1 |
| lib/factGuard.ts | 456 | Tailor: check-before-download notice — message | Kept as written; check these against your master CV (Customize → Claims registry → "Wording your CV must never say" keeps a phrase out for good): | Kept as written. Check these against your main CV. (My CV → Skill levels → "Wording your CV must never say" keeps a phrase out for good.) | N1 N7 N9 SS |
| lib/factGuard.ts | 457 | Tailor: check-before-download notice — message | Summary lines copied from the job ad, check they are true: | Summary lines copied from the job description. Check they are true: | N2 SS |
| lib/factGuard.ts | 458 | Tailor: check-before-download notice — message | Removed tools not in your master CV: | Removed tools not in your main CV: | N1 |
| lib/factGuard.ts | 459 | Tailor: check-before-download notice — message | Degree name corrected to your master CV: | Degree name corrected to your main CV: | N1 |
| lib/projectPool.ts | 92 | Project list messages — message | That is {cards.length} projects, and the pool holds {MAX_POOL_CARDS}. Remove {cards.length - MAX_POOL_CARDS} to save. | That is {cards.length} projects, and the project list holds {MAX_POOL_CARDS}. Remove {cards.length - MAX_POOL_CARDS} to save. | N11 |
| lib/suggestionCheck.ts | 259 | Score card: suggestions — message | {term}: your CV may show the work as “{shown}”. If it is the same work, name it in your master CV in your own words; the suggested line goes further than that. | {term}: your CV may show the work as “{shown}”. If it is the same work, name it in your main CV in your own words; the suggested line goes further than that. | N1 |
| lib/suggestionCheck.ts | 261 | Score card: suggestions — message | {term}: your master CV doesn't show this. Add it only with real work you can point to. | {term}: your main CV doesn't show this. Add it only with real work you can point to. | N1 |
| lib/suggestionCheck.ts | 263 | Score card: suggestions — message | A suggestion moved project work into a paid role, so it isn't listed. Your master CV shows that work in a project. | A suggestion moved project work into a paid role, so it isn't listed. Your main CV shows that work in a project. | N1 |
| lib/suggestionCheck.ts | 264 | Score card: suggestions — message | A suggestion went beyond what your master CV shows, so it isn't listed. Add only what you can point to. | A suggestion went beyond what your main CV shows, so it isn't listed. Add only what you can point to. | N1 |
| lib/postingAge.ts | 67 | Applications: Insights groups — message | Applied within 3 days of posting | Applied within 3 days of the job being posted | N2 |
| lib/postingAge.ts | 68 | Applications: Insights groups — message | Applied 4–14 days after posting | Applied 4–14 days after the job was posted | N2 |
| lib/postingAge.ts | 69 | Applications: Insights groups — message | Applied 15+ days after posting | Applied 15+ days after the job was posted | N2 |
| lib/retiredClaims.ts | 262 | Download refused: wording list — message | This still says {list}, which your list on Customise rules out. Edit it in the preview, then download. | This still says {list}, which your list on My CV rules out. Edit it in the preview, then download. | N7 |
| lib/importJob/fetchJob.ts | 34 | Tailor: job link import messages — message | That link is too long to be a job posting. | That link is too long to be a job link. | N2 |
| lib/importJob/fetchJob.ts | 45 | Tailor: job link import messages — message | We couldn't reach {label} just now, or that link leads off {label}. Paste the posting's own link instead. | We couldn't reach {label} just now, or that link leads off {label}. Paste the job's own link instead. | N2 |
| lib/importJob/fetchJob.ts | 46 | Tailor: job link import messages — message | {label} has no posting at that link. It may have closed. | {label} has no job at that link. It may have closed. | N2 |
| lib/importJob/fetchJob.ts | 55 | Tailor: job link import messages — message | We couldn't reach {label} just now. Try again in a minute. | We couldn't reach {label} just now, or that link leads off {label}. Paste the job's own link instead. | N2 |
| lib/importJob/fetchJob.ts | 56 | Tailor: job link import messages — message | {label} has no posting at that link. It may have closed. | {label} has no job at that link. It may have closed. | N2 |
| lib/importJob/fetchJob.ts | 59 | Tailor: job link import messages — message | LinkedIn wouldn't show us that posting just now. | LinkedIn wouldn't show us that job just now. | N2 |

## 6. Full inventory

Every user-facing string found, in file order. An empty “Proposed text” means: keep as it is.

### app/(home)/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 88 | message | A free pre-check before any credit is spent. | A free check before you use a tailored CV. | N8 N3 |
| 89 | message | Paste a posting. Its eligibility conditions are read against your own answers, your keyword match is counted, and the tracker says whether you have applied to this company before. | Paste a job description. We compare its requirements with your own answers. We count how many of its key words your CV has. We tell you if you have applied to this company before. | N2 N6 SS |
| 91 | message | The pre-check: a notice that you have already applied to this company three times, then the read "Apply" and a rough keyword match of 6/10. | The free check: a notice that you have already applied to this company three times, then the advice "Apply" and a rough keyword match of 6/10. | N8 PL |
| 95 | message | A tailored CV, and a score that is a count. |  |  |
| 96 | message | Summary, skills, experience and projects are selected from your own bullets; titles, employers and dates are never touched. The score is how many of the role's terms the text carries — 6 of 10 reads "Borderline", never "strong". |  |  |
| 98 | message | Recruiter search visibility: 6/10, "Borderline. Fix these before sending.", required skills 3 of 4, then the matched list. |  |  |
| 102 | message | Interview answers traced, line by line, to your CV. |  |  |
| 103 | message | A prep pack for the job: the questions it will ask, STAR answers built only from your CV, and every line marked as traced to your CV or flagged for you to rephrase. | An interview pack for the job: the questions it will ask, STAR answers built only from your CV, and every line marked as traced to your CV or flagged for you to rephrase. | N16 |
| 105 | message | One prep question with its STAR answer — situation, task, action, result — and under it the CV line it was traced to, ticked. |  |  |
| 109 | message | Then a UK interview, out loud. |  |  |
| 110 | message | Pick the round — screening, competency, strengths-based, technical, hiring manager, final — and an interviewer built from the same job asks the questions aloud and checks each answer against your CV. In your browser; no video, no upload. |  |  |
| 112 | message | The round picker: a screening call with a talent acquisition partner, and the competency interview selected, with its length and question count. |  |  |
| 151 | text | Your account and everything in it have been deleted. Thank you for trying Jobhuntz. |  |  |
| 159 | text | Open the app → |  |  |
| 162 | text | Sign in |  |  |
| 163 | text | Open the tool |  |  |
| 177 | heading | Honest CVs. |  |  |
| 178 | heading | Real interview practice. |  |  |
| 181 | text | Paste your CV and a job description. Every claim in what comes back is checked against your CV before you see it. Then an interviewer built from the same job asks you the questions out loud, UK round by UK round. |  |  |
| 186 | button | Tailor my CV → |  |  |
| 187 | text | See the journey ↓ | See how it works ↓ | ID |
| 191 | screen-reader label | A worked example of a tailored CV |  |  |
| 192 | text | JORDAN REYES |  |  |
| 193 | text | London · jordan@email.com · linkedin.com/in/jordanreyes |  |  |
| 194 | text | Professional summary |  |  |
| 196 | text | Senior Backend Engineer with six years on payments systems in |  |  |
| 196 | text | Python |  |  |
| 196 | text | — distributed services on PostgreSQL and Kubernetes, with a figure behind each claim. |  |  |
| 199 | text | Experience |  |  |
| 201 | text | Senior Backend Engineer, Northwind Systems |  |  |
| 202 | text | 2022 — Present |  |  |
| 205 | text | Redesigned the payments service using |  |  |
| 205 | text | PostgreSQL |  |  |
| 205 | text | and event-driven queues, cutting checkout latency 40%. |  |  |
| 206 | text | Led migration to |  |  |
| 206 | text | Kubernetes |  |  |
| 206 | text | , reducing deploy time from 25 minutes to under 3. |  |  |
| 207 | text | Built internal tooling in Python to catch schema drift before it reached production. |  |  |
| 212 | screen-reader label | The worked example's recruiter search visibility |  |  |
| 214 | text | Recruiter search visibility |  |  |
| 216 | text | Ready to send. Required skills in the tailored CV: 8/10 — not present: Go, Kafka. |  |  |
| 219 | text | Matched (12) |  |  |
| 221 | text | PostgreSQL — Experience |  |  |
| 222 | text | Kubernetes — Experience |  |  |
| 223 | text | Python — Summary |  |  |
| 224 | text | Payments — Experience |  |  |
| 225 | text | Event-driven — Experience |  |  |
| 226 | text | Distributed systems — Summary |  |  |
| 227 | text | Backend — Title |  |  |
| 228 | text | Senior engineer — Title |  |  |
| 229 | text | Deployment — Experience |  |  |
| 230 | text | Latency — Experience |  |  |
| 231 | text | Schema — Experience |  |  |
| 232 | text | Internal tooling — Experience |  |  |
| 236 | text | Missing (3) |  |  |
| 238 | text | GraphQL — not in your CV |  |  |
| 239 | text | Go — not in your CV |  |  |
| 240 | text | Kafka — not in your CV |  |  |
| 243 | text | A worked example — Jordan and Northwind are made up; the layout, the score and the lists are exactly what the tool produces. |  |  |
| 251 | text | The problem |  |  |
| 252 | heading | You've got two options right now, and both cost you something. |  |  |
| 255 | heading | The AI tools embellish |  |  |
| 257 | text | Ask one to tailor your CV and it'll add "Terraform" because the job wants it — never mind that you've never touched it. Fine, until an interviewer asks you a real question about it. |  |  |
| 263 | heading | Doing it by hand works, but it's slow |  |  |
| 265 | text | Rewriting your CV properly for one role — rereading the posting, hunting the right phrasing, reformatting — takes about an hour. Most people stop customising after the third application and start mass-applying with one generic version instead. | Rewriting your CV properly for one role takes about an hour. You reread the job description, look for the right phrasing and reformat. Most people stop customising after the third application and start mass-applying with one generic version instead. | N2 SS |
| 275 | text | The whole journey | How it works | ID |
| 276 | heading | From one saved CV to the interview, in one place. |  |  |
| 293 | text | Why it's different |  |  |
| 294 | heading | Built around one constraint: nothing invented. |  |  |
| 297 | heading | Checked, not trusted |  |  |
| 299 | text | Every figure is checked against your CV, every skill against the level you set for it, and every sentence of the summary and letter against the line it came from. If the job wants something you don't have, you see the gap — we don't invent the skill. |  |  |
| 306 | heading | It tells you when it's wrong |  |  |
| 308 | text | The score is a count of the job's terms your CV carries — never an inflated percentage. Your tracker then measures whether that score predicts which applications progress, and says so plainly when it doesn't. | The score is a count of the job's key words that your CV has. It is never an inflated percentage. Your applications list then shows whether higher scores really get further, and says so plainly when they do not. | N6 SS PL |
| 314 | heading | A tracker built in | Your applications, in one list | N6 |
| 316 | text | Click Applied and the run lands in your tracker — the exact CV you sent, the job description you sent it for, and a follow-up date, ready for the week the recruiter calls back. | Click Applied and it is saved to your applications list: the exact CV you sent, the job description, and a follow-up date. | N6 N5 ID |
| 326 | text | What it costs |  |  |
| 327 | heading | Free to start. Honest about what happens after. |  |  |
| 330 | text | Three tailors on us, no card | 3 free tailored CVs. No payment card needed. | N3 ID |
| 331 | text | Your first three runs are on Claude — CV, cover letter and search-visibility score. | Your first 3 tailored CVs are free. That is 3 in total, not 3 a day. Each one comes with a cover letter and a keyword score. They are written by Claude (an AI model), and we pay for it. | N3 N5 SS |
| 334 | text | The cap | The daily limit | PL |
| 335 | text | Three a day, whoever pays. | 3 tailored CVs a day. The limit is the same on the free ones and on your own API key. | N3 N4 ID |
| 338 | text | Then your own free key | After that: your own free API key | N4 |
| 340 | text | Add a free OpenRouter key in Settings and keep going at no cost. One honest note: OpenRouter's free models may train on what you send — Settings says how to check that in your OpenRouter account. | Add your own free API key in Settings and keep tailoring at no cost. Settings shows how to get one from OpenRouter, a service with free AI models. One honest note: OpenRouter's free models may train on what you send. Settings says how to check that in your OpenRouter account. | N4 SS |
| 350 | heading | Honest beats impressive. |  |  |
| 352 | text | A CV with ten skills you can defend beats one with twenty that fall apart under questioning. |  |  |
| 354 | button | Tailor my CV → |  |  |
| 362 | text | Your CV stays in your account and is processed only by the AI provider that runs your tailoring. The screenshots above are real screens from a test account; Jordan Reyes and every company shown are made up. |  |  |
| 366 | text | Built by Soma Shekar Keesari · |  |  |
| 366 | text | The code on GitHub |  |  |
| 367 | text | Privacy |  |  |
| 369 | screen-reader label | Footer |  |  |
| 370 | text | Sign in |  |  |
| 371 | text | Tailor my CV |  |  |
| 372 | text | See an example |  |  |
| 373 | text | Privacy |  |  |
| 374 | text | Terms |  |  |

### app/CoverLetterPreview.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 99 | message | This file can't be built yet. |  |  |
| 113 | message | Could not build the document |  |  |
| 121 | message | Could not build the document |  |  |
| 129 | message | PDF generation failed. Try the Word download, or retry. |  |  |
| 141 | message | Word download failed. Please retry. |  |  |
| 145 | message | Word download failed. Check your connection and retry. |  |  |
| 156 | label | Download letter |  |  |
| 156 | disabledReason | Fix the flagged claims first |  |  |
| 166 | text | This letter was not fact-checked |  |  |
| 168 | text | Read every sentence against what your CV really says before you send it. |  |  |
| 174 | text | “ |  |  |
| 174 | text | ” |  |  |
| 181 | field label | I've read every sentence of this letter and it's true |  |  |
| 186 | text | Click any text to edit your cover letter. Changes are included when you download. |  |  |

### app/CvPreview.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 151 | message | YOUR NAME |  |  |
| 318 | message | Could not build the document |  |  |
| 326 | message | Could not build the document |  |  |
| 334 | message | PDF generation failed. Try the Word download, or retry. |  |  |
| 397 | message | - {txt} |  |  |
| 552 | message | This file can't be built yet. |  |  |
| 564 | message | Word download failed. Please retry. |  |  |
| 568 | message | Word download failed. Check your connection and retry. |  |  |
| 586 | heading | Professional Summary |  |  |
| 594 | heading | Skills |  |  |
| 618 | heading | Experience |  |  |
| 626 | heading | Projects |  |  |
| 664 | text | {l.label}: |  |  |
| 683 | heading | Education |  |  |
| 714 | label | Download CV |  |  |
| 714 | disabledReason | Fix the flagged claims first |  |  |
| 717 | button | Fixing… |  |  |
| 717 | button | Fix it |  |  |
| 721 | screen-reader label | {(appliedLabel ?? "Saved to tracker").rep}. Open this application on Applications. |  |  |
| 721 | screen-reader label | Saved to tracker | Saved to Applications | N6 |
| 722 | button | Saved to tracker ✓ | Saved to Applications ✓ | N6 |
| 748 | text | Right to work — for application forms (not on the CV) |  |  |
| 750 | text | Answer your right to work and availability under Eligibility on |  |  |
| 750 | text | Customise | My CV | N7 |
| 750 | text | to get a statement in your own words to paste into forms. |  |  |
| 759 | text | Right to work — for application forms (not on the CV) |  |  |
| 763 | button | Copied |  |  |
| 763 | button | Copy |  |  |
| 768 | text | Click any text to edit it. Your changes are included when you download. |  |  |
| 789 | text | LinkedIn |  |  |
| 792 | text | GitHub |  |  |
| 795 | text | Portfolio |  |  |
| 818 | heading | Certifications |  |  |
| 829 | heading | Right to Work |  |  |

### app/CvUpload.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 38 | message | Upload a PDF, Word (.docx) or .txt file. |  |  |
| 63 | message | Something went wrong reading that file. Please try again. |  |  |
| 68 | message | Could not read that file. Please paste your CV text instead. |  |  |
| 72 | message | No text could be read from that file. Please paste your CV text instead. |  |  |
| 79 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 132 | text | Reading your CV… |  |  |
| 133 | text | Extracting the text — this usually takes a few seconds. | Reading the text. This usually takes a few seconds. | N12 |
| 144 | button | Upload a file |  |  |
| 146 | text | or drag it here |  |  |
| 148 | text | PDF, Word (.docx) or .txt — up to 4MB |  |  |

### app/DownloadButton.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 69 | button | Generating… |  |  |
| 75 | button | PDF document |  |  |
| 78 | button | Word (.docx) |  |  |

### app/FeedbackWidget.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 61 | message | Could not submit your feedback. Try again. |  |  |
| 69 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 82 | button | Feedback |  |  |
| 84 | text | Bugs, ideas, anything — goes straight to the team. |  |  |
| 88 | text | Feedback |  |  |
| 88 | help text | What's working, what's not, what you'd like to see. |  |  |
| 93 | placeholder | What's working, what's not, what you'd like to see… |  |  |
| 110 | button | Sending… |  |  |
| 110 | button | Send feedback |  |  |
| 112 | text | Thanks — got it. |  |  |

### app/FormAnswers.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 34 | heading | Form answers |  |  |
| 36 | text | From your Eligibility answers on |  |  |
| 36 | text | Customise | My CV | N7 |
| 36 | text | . Copy them into the application form. Consent and criminal-record questions are never filled in: answer those yourself. |  |  |
| 39 | text | Answer the Eligibility questions on Customise and your form answers appear here. | Answer the Eligibility questions on My CV and your form answers appear here. | N7 |
| 49 | button | Copied |  |  |
| 49 | button | Copy |  |  |
| 53 | text | Not answered on Customise | Not answered on My CV | N7 |
| 60 | text | Paste a question from the form |  |  |
| 65 | placeholder | Will you now or in the future require sponsorship? |  |  |
| 78 | button | Copied |  |  |
| 78 | button | Copy |  |  |
| 84 | text | That is the “ |  |  |
| 84 | text | ” question, which your Eligibility answers on Customise don't cover yet. | ” question, which your Eligibility answers on My CV don't cover yet. | N7 |
| 86 | text | No stored answer fits that question. Answer it yourself. |  |  |

### app/TailorGamePopup.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 308 | message | Taking a little longer than usual… |  |  |
| 308 | message | Usually under a minute. Play while you wait. |  |  |
| 325 | heading | Tailoring your CV |  |  |
| 327 | screen-reader label | Close. Tailoring carries on. |  |  |
| 327 | tooltip / title | Close. Tailoring carries on. |  |  |
| 333 | screen-reader label | Tailoring progress |  |  |
| 351 | screen-reader label | Optional mini game: fly a man wearing a jetpack over the rooftops, between chimneys, masts and crane loads. |  |  |
| 352 | screen-reader label | Optional mini game: walk a man in a suit along a city street — jump puddles and cones, climb crates and walls. |  |  |
| 358 | button | Play |  |  |
| 370 | text | Your CV has been tailored successfully! |  |  |
| 370 | text | You can now go back. |  |  |
| 373 | button | Back to my CV |  |  |
| 378 | text | Tailoring didn't finish. |  |  |
| 381 | button | Back |  |  |
| 393 | screen-reader label | Move left |  |  |
| 396 | screen-reader label | Move right |  |  |
| 402 | screen-reader label | Fire the jetpack (hold) |  |  |
| 402 | screen-reader label | Jump, or climb |  |  |
| 408 | text | Hold Space, ↑ or W (or press and hold) to fire the jetpack; let go to drop. |  |  |
| 409 | text | ← → or A D to run. Space, ↑ or W to jump — against a wall or crates, to climb. |  |  |

### app/TriageBadge.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 11 | message | Nothing in the posting is out of your criteria (years, clearance, right to work, contract, languages). | Nothing in this job description rules you out. We checked years of experience, security clearance, right to work, contract type and programming languages. | N2 PL |
| 21 | text | JD triage | Job check | N13 |
| 27 | text | Where each reason comes from |  |  |
| 27 | text | Where the posting says so | Where the job description says so | N2 |
| 31 | text | (review) |  |  |
| 31 | text | “ |  |  |
| 31 | text | ” |  |  |

### app/app/PoolRunLine.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 11 | text | Projects: |  |  |
| 12 | button | edit |  |  |
| 17 | screen-reader label | Projects on this CV |  |  |
| 22 | choice | Auto |  |  |
| 26 | screen-reader label | Order of the projects on this CV |  |  |
| 31 | choice | Most relevant first |  |  |
| 32 | choice | Newest first |  |  |
| 34 | text | For this run. Change the defaults on | For this CV. Change the defaults on | N5 |
| 34 | text | Customise | My CV | N7 |

### app/app/ProjectsUsed.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 14 | message | (matches: {p.matches.slice(0, MAX_MATCHES_SHOWN).jo}) |  |  |
| 31 | text | Projects used |  |  |
| 39 | screen-reader label | Swap {p.name} for another project |  |  |
| 45 | choice | Swapping… |  |  |
| 45 | choice | Swap |  |  |

### app/app/actions/QuickAdd.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 19 | label | Gmail |  |  |
| 20 | message | AIApply inbox |  |  |
| 21 | message | Somewhere else |  |  |
| 70 | message | Could not load your applications. |  |  |
| 73 | message | Could not load your applications. |  |  |
| 87 | screen-reader label | Add from an email |  |  |
| 88 | field label | Paste the email |  |  |
| 94 | placeholder | Paste the email's text. It is read in your browser and never saved. |  |  |
| 103 | text | It arrived |  |  |
| 110 | text | Which inbox |  |  |
| 120 | text | Reads as |  |  |
| 120 | text | (approximate: check it) |  |  |
| 120 | text | , from " |  |  |
| 120 | text | ". |  |  |
| 121 | text | No date found in this. You can enter one on the next step. |  |  |
| 127 | text | This reads as a confirmation (" |  |  |
| 127 | text | "), not a new task. Pick the application to close its open submission items. |  |  |
| 130 | screen-reader label | Application |  |  |
| 131 | choice | Choose an application |  |  |
| 131 | choice | Loading your applications… |  |  |
| 134 | button | Closing… |  |  |
| 134 | button | Close its items |  |  |
| 141 | button | Next: check and save |  |  |
| 142 | button | Close |  |  |

### app/app/actions/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 5 | message | Action Centre · Jobhuntz | To do · Jobhuntz | N14 |

### app/app/actions/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 29 | label | Gmail |  |  |
| 29 | message | AIApply inbox |  |  |
| 29 | label | Calendar |  |  |
| 60 | message | Couldn't refresh your actions, so this may be out of date. | Couldn't refresh your to-do list, so this may be out of date. | N14 |
| 61 | message | Could not load your actions. | Could not load your to-do list. | N14 |
| 71 | message | Couldn't refresh your actions, so this may be out of date. | Couldn't refresh your to-do list, so this may be out of date. | N14 |
| 72 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 105 | message | Could not save that change. |  |  |
| 107 | message | Couldn't reach the server. Your change was not saved. |  |  |
| 120 | message | Done: {event.title}. |  |  |
| 120 | message | Marked missed: {event.title}. |  |  |
| 132 | message | Snoozed for a day. The deadline itself has not moved. | Hidden for a day. The deadline itself has not moved. | ID |
| 151 | message | Confirmation pasted: "{phrase}" |  |  |
| 154 | message | Could not save that to the row's notes. | Could not save that to the application's notes. | N6 |
| 156 | message | Saved to the notes. Nothing was closed. |  |  |
| 161 | message | Couldn't reach the server. Nothing was saved. |  |  |
| 200 | text | No date yet |  |  |
| 203 | text | Snoozed until | Hidden until | ID |
| 203 | text | . It comes back sooner if it falls due within 24 hours. |  |  |
| 204 | text | The email is in |  |  |
| 208 | button | Mark done |  |  |
| 209 | text | Open link |  |  |
| 211 | button | Bring back | Show again | ID |
| 217 | tooltip / title | Due within 24 hours, so it stays here. |  |  |
| 221 | button | Snooze 1 day | Hide for 1 day | ID BT |
| 224 | button | Set a date |  |  |
| 224 | button | Edit |  |  |
| 225 | button | Mark missed |  |  |
| 238 | title | Action Centre | To do | N14 |
| 238 | page tagline | Every assessment, interview and deadline still to do, soonest first. |  |  |
| 240 | label | Loading your actions | Loading your to-do list | N14 |
| 242 | title | You've been signed out |  |  |
| 242 | button | Sign in |  |  |
| 242 | text | Sign in again to see your actions. | Sign in again to see your to-do list. | N14 |
| 248 | button | Try again |  |  |
| 255 | text | 1 thing to do |  |  |
| 255 | text | {lists.due.length} things to do |  |  |
| 255 | text | , {lists.snoozed.length} snoozed | , {lists.snoozed.length} hidden for now | ID |
| 257 | button | Add from an email |  |  |
| 258 | button | New event |  |  |
| 277 | title | Nothing to do |  |  |
| 278 | button | Add from an email |  |  |
| 280 | text | When an email gives you a test, a video or a deadline, paste it here and it lines up by date. |  |  |
| 289 | heading | Snoozed | Hidden for now | ID |
| 296 | heading | Closed by a confirmation in your notes |  |  |
| 300 | text | No application |  |  |
| 301 | button | Undo |  |  |
| 340 | button | Undo |  |  |
| 343 | screen-reader label | Dismiss |  |  |

### app/app/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 7 | label | Tailor |  |  |

### app/app/next/EventCard.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 37 | button | Copied |  |  |
| 37 | button | Couldn't copy |  |  |
| 51 | text | No free time in the next two weeks. Add your free times in the Week view. |  |  |
| 53 | text | Every slot they offered has passed. |  |  |
| 54 | text | None of the slots still open is free: each clashes with something on your plan or falls too close to it. | None of the slots still open is free: each clashes with something on your schedule or falls too close to it. | N14 |
| 58 | text | You have no free times saved, so these are weekdays from 09:00 to 17:30. Add yours in the Week view. |  |  |
| 62 | text | to {clockTime(s.end, tz)} |  |  |
| 63 | button | Book this |  |  |
| 67 | label | Copy reply |  |  |
| 120 | text | Slots offered: reply to book |  |  |
| 120 | text | Not booked yet: reply with your times |  |  |
| 136 | label | Copy |  |  |
| 139 | text | With |  |  |
| 142 | text | Prep pack | Interview pack | N16 |
| 149 | button | Suggest replies |  |  |
| 151 | button | Mark done |  |  |
| 153 | button | Set a time |  |  |
| 153 | button | Reschedule |  |  |
| 154 | button | Cancel |  |  |
| 155 | button | Add next round |  |  |
| 158 | screen-reader label | Outcome for {heading} |  |  |
| 159 | button | Pass |  |  |
| 160 | button | Rejected |  |  |
| 161 | button | Offer |  |  |
| 164 | button | Set outcome |  |  |

### app/app/next/EventForm.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 44 | message | Within {Math.round(c.gapMinutes)} minutes of {label}. |  |  |
| 44 | message | Inside {label} ({c.window.start_time.slice(0, 5)} to {c.window.end_time.slice(0, 5)}). |  |  |
| 49 | message | Overlaps {name} ({at}). |  |  |
| 49 | message | Only {Math.round(c.gapMinutes)} minutes from {name} ({at}). |  |  |
| 128 | message | Could not load your applications. |  |  |
| 130 | message | Could not load your applications. |  |  |
| 175 | message | Give each offered slot a date and a time. |  |  |
| 180 | message | Pick a date. |  |  |
| 182 | message | Pick a time, or tick that no time was given. |  |  |
| 186 | message | Pick a time. |  |  |
| 195 | message | Pick the application this event belongs to. |  |  |
| 207 | message | Could not save that event. |  |  |
| 220 | message | The event is saved, but {application.company_name} did not move to {STATUS_LABELS[movesTo]}, so it stays off your plan.{detail.error ? ` ${detail.error}` : ""} Saving again will not add a second event. | The event is saved, but {application.company_name} did not move to {STATUS_LABELS[movesTo]}, so it stays off your schedule.{detail.error ? ` ${detail.error}` : ""} Saving again will not add a second event. | N14 |
| 229 | message | Event updated. |  |  |
| 231 | message | Event added, and {application?.company_name} moved to {STATUS_LABELS[movesTo]}. |  |  |
| 233 | message | Event saved. It stays off your plan until {application?.company_name} reaches Screening or later. | Event saved. It stays off your schedule until {application?.company_name} reaches Screening or later. | N14 |
| 234 | message | Event added. |  |  |
| 237 | message | The event is saved, but the application could not be moved: couldn't reach the server. Saving again will not add a second event. |  |  |
| 237 | message | Couldn't reach the server. Try again. |  |  |
| 246 | heading | Change this event |  |  |
| 246 | heading | New event |  |  |
| 250 | field label | Application |  |  |
| 255 | button | Change |  |  |
| 259 | placeholder | Search your applications |  |  |
| 272 | text | A networking call needs no application. |  |  |
| 280 | field label | Kind |  |  |
| 290 | field label | Stage (optional) |  |  |
| 291 | placeholder | Round 2: technical |  |  |
| 294 | field label | Title |  |  |
| 299 | text | When |  |  |
| 303 | field label | A set time |  |  |
| 303 | field label | A deadline |  |  |
| 303 | field label | Still to book |  |  |
| 311 | field label | Date |  |  |
| 315 | field label | Time |  |  |
| 323 | field label | They gave a date but no time |  |  |
| 328 | field label | Length (minutes) |  |  |
| 329 | placeholder | Not stated |  |  |
| 333 | field label | Time zone |  |  |
| 335 | text | Europe/Paris |  |  |
| 335 | text | UTC |  |  |
| 335 | text | America/New_York |  |  |
| 341 | text | Slots they offered (optional) |  |  |
| 344 | screen-reader label | Slot {i + 1} date |  |  |
| 345 | screen-reader label | Slot {i + 1} time |  |  |
| 346 | button | Remove |  |  |
| 349 | button | Add a slot |  |  |
| 354 | field label | Meeting link or place |  |  |
| 355 | placeholder | https://… or an address |  |  |
| 358 | field label | Contact (optional) |  |  |
| 362 | field label | Prep notes (optional) |  |  |
| 369 | text | You can still save it. |  |  |
| 375 | field label | is |  |  |
| 375 | field label | . Move it to |  |  |
| 375 | field label | , so this shows on your plan. | , so this shows on your schedule. | N14 |
| 380 | text | This stays off your plan until | This stays off your schedule until | N14 |
| 380 | text | reaches Screening or later. |  |  |
| 386 | button | Saving… |  |  |
| 386 | button | Save event |  |  |
| 387 | button | Cancel |  |  |

### app/app/next/PipelineChart.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 33 | text | Nothing has moved past Applied yet, so there is nothing to map. | Nothing has moved past Applied yet, so there is nothing to show. | ID |
| 44 | screen-reader label | {payload.name}: {payload.total}. Show on the tracker. | {payload.name}: {payload.total}. Show on Applications. | N6 |
| 49 | text | {payload.name}: {payload.total} |  |  |
| 71 | text | {payload.source.name} to {payload.target.name}: {payload.value} |  |  |
| 93 | text | Select a stage to see those applications on the tracker. Stages have been recorded only since 3 November 2026, so an earlier rejection counts at Applied whatever stage it reached, and an earlier row shows only its current stage. The share who went further is out of those with an outcome from that stage; someone still there is not counted. | Select a stage to see those applications. Stages are recorded from 3 November 2026. An earlier rejection counts at Applied, and an earlier application shows only its current stage. The share that went further counts only applications with a result from that stage. | N6 SS |
| 94 | text | {funnel.excluded} unsent or withdrawn {funnel.excluded === 1 ? "application is"} left out of the share at the stage they stopped at, though every stage they reached still counts. |  |  |
| 94 | text | application is |  |  |
| 94 | text | applications are |  |  |
| 97 | text | As a table |  |  |
| 100 | text | Stage |  |  |
| 100 | text | Reached |  |  |
| 100 | text | Here now |  |  |
| 100 | text | Rejected here |  |  |
| 100 | text | Ghosted here | No reply here | GH |
| 100 | text | Went further, of those decided | Went further, of those with a result | N15 |
| 110 | text | Too few to judge | Not enough results yet | N15 |
| 110 | text | {Math.round((n.furtherRate ?? 0) * 100)}% |  |  |

### app/app/next/WeekView.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 80 | message | {nameOf(e)} (offered) |  |  |
| 87 | message | {nameOf(e)}: {e.title} due |  |  |
| 90 | message | {nameOf(e)}: {e.title} due |  |  |
| 151 | message | Could not save that time. |  |  |
| 155 | message | Couldn't reach the server. Try again. |  |  |
| 164 | message | Could not delete that time. |  |  |
| 173 | button | Previous week |  |  |
| 174 | text | to |  |  |
| 175 | button | Next week |  |  |
| 176 | button | This week |  |  |
| 179 | screen-reader label | Your week |  |  |
| 200 | tooltip / title | {b.time} {b.label}{b.clash ? " (clash)" : ""} |  |  |
| 200 | tooltip / title | (clash) |  |  |
| 202 | text | · clash |  |  |
| 210 | text | Solid: booked. Dashed: slots offered, not booked. Striped: busy. Green tint: free. |  |  |
| 214 | heading | Your free and busy times |  |  |
| 215 | text | Shifts, university, the gym: anything an interview should not land on. Clash checks and suggested replies read these. |  |  |
| 217 | screen-reader label | Free or busy |  |  |
| 218 | choice | Busy |  |  |
| 219 | choice | Free |  |  |
| 221 | screen-reader label | One day or every week |  |  |
| 222 | choice | One day |  |  |
| 223 | choice | Every week |  |  |
| 226 | screen-reader label | Date |  |  |
| 228 | screen-reader label | Day of the week |  |  |
| 232 | screen-reader label | From |  |  |
| 233 | screen-reader label | To |  |  |
| 234 | screen-reader label | Label |  |  |
| 234 | placeholder | Label, e.g. Shift |  |  |
| 235 | button | Adding… |  |  |
| 235 | button | Add |  |  |
| 242 | text | Busy |  |  |
| 242 | text | Free |  |  |
| 243 | text | Every {WEEKDAY_NAMES[(w.weekday ?? 1) - 1]} |  |  |
| 243 | text | to |  |  |
| 243 | text | · {w.label} |  |  |
| 244 | button | Delete |  |  |

### app/app/next/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 5 | message | What's next · Jobhuntz | Schedule · Jobhuntz | N14 |

### app/app/next/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 39 | label | Loading the pipeline |  |  |
| 58 | message | {today.slice(0, 7)}-01 |  |  |
| 65 | screen-reader label | Calendar |  |  |
| 67 | screen-reader label | Previous month |  |  |
| 67 | message | {addDays(month, -1).slice(0, 7)}-01 |  |  |
| 69 | screen-reader label | Next month |  |  |
| 85 | screen-reader label | {shortDay(d)}{count ? `, ${count} event${count === 1 ?} |  |  |
| 85 | screen-reader label | , {count} event{count === 1 ? "" : "s"} |  |  |
| 127 | message | Couldn't refresh your plan, so this may be out of date. | Couldn't refresh your schedule, so this may be out of date. | N14 |
| 137 | message | Could not load your plan. | Could not load your schedule. | N14 |
| 144 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 188 | message | Next up: {nextName}, {timing.left}. |  |  |
| 201 | message | Could not save that change. Try again. |  |  |
| 212 | message | This row's notes changed since, so nothing was saved. Open it on Applications to change it there. | This application's notes changed since, so nothing was saved. Open it on Applications to change it there. | N6 |
| 212 | message | Could not save that change. Try again. |  |  |
| 217 | message | This row is closed. | This application is closed. | N6 |
| 285 | message | Moved to Closed |  |  |
| 296 | message | Marked done: {item.application?.company_name ?? item.e}. |  |  |
| 297 | message | Cancelled: {item.application?.company_name ?? item.e}. |  |  |
| 305 | message | {application.company_name} moved to Rejected. Its events are hidden. |  |  |
| 321 | message | {application.company_name} moved to Offer. |  |  |
| 323 | message | Passed: {application.company_name} moved to {next === "interview" ? "Interview" : nex}. |  |  |
| 323 | message | Passed: {application.company_name}. |  |  |
| 337 | message | Booked {formatWhen(slot.start, tz)}. {copied ? "A reply is copied: send it to } |  |  |
| 337 | message | A reply is copied: send it to confirm. |  |  |
| 337 | message | Reply to them to confirm. |  |  |
| 408 | text | They wrote today |  |  |
| 408 | text | They wrote yesterday |  |  |
| 408 | text | They wrote {days} days ago |  |  |
| 410 | text | In touch today |  |  |
| 410 | text | 1 day since contact |  |  |
| 410 | text | {days} days since contact |  |  |
| 411 | text | No contact recorded |  |  |
| 411 | text | Applied today; no contact recorded |  |  |
| 411 | text | Applied yesterday; no contact recorded |  |  |
| 411 | text | Applied {days} days ago; no contact recorded |  |  |
| 412 | text | · follow-up {formatDate(application.followup_date)} |  |  |
| 418 | text | T+{nudge}: {nudge === 7 ? "send a first follow-up" :} | {nudge} days after applying: {send a first / second / last follow-up} | ID |
| 418 | text | send a first follow-up |  |  |
| 418 | text | send a second follow-up |  |  |
| 418 | text | send a last follow-up, then consider Ghosted | send a last follow-up, then mark it No reply | ID |
| 419 | text | T+{nudge} from applying: if you have heard nothing, follow up | {nudge} days after applying: if you have heard nothing, send a follow-up | ID |
| 425 | button | Add date/time |  |  |
| 436 | message | Recorded: you replied to {application.company_name} today. |  |  |
| 436 | message | Recorded: you followed up with {application.company_name} today. |  |  |
| 447 | button | I replied today |  |  |
| 447 | button | Followed up today |  |  |
| 449 | message | {application.company_name} moved to Rejected. |  |  |
| 449 | button | Rejected |  |  |
| 450 | message | {application.company_name} moved to Ghosted. | {application.company_name} moved to No reply. | GH |
| 450 | button | Ghosted | No reply | GH |
| 456 | heading | Reply owed | You need to reply | ID |
| 457 | text | They spoke last, so the next move is yours. | They wrote last, so you need to reply. | ID |
| 477 | title | What's next | Schedule | N14 |
| 477 | page tagline | Every screening, interview, assessment and deadline, most urgent first. |  |  |
| 482 | label | Loading your plan | Loading your schedule | N14 |
| 483 | label | Loading your calendar |  |  |
| 487 | title | You've been signed out |  |  |
| 487 | button | Sign in |  |  |
| 487 | text | Sign in again to see your plan. | Sign in again to see your schedule. | N14 |
| 495 | button | Try again |  |  |
| 503 | text | Next up |  |  |
| 513 | screen-reader label | View |  |  |
| 516 | button | Plan | List | N14 |
| 516 | button | Week |  |  |
| 516 | button | Pipeline |  |  |
| 521 | button | New event |  |  |
| 537 | text | Already have an interview or a deadline? |  |  |
| 538 | button | Add it here |  |  |
| 549 | title | Nothing to do yet |  |  |
| 550 | button | Add an interview or deadline |  |  |
| 550 | button | Tailor a CV |  |  |
| 552 | text | When an application reaches screening, its calls, assessments and deadlines line up here, most urgent first. |  |  |
| 559 | text | Showing |  |  |
| 559 | button | Show everything |  |  |
| 573 | text | They are waiting on a time from you. An unanswered offer can lose the interview. | They are waiting for you to choose a time. If you do not answer, you can lose the interview. | PL |
| 583 | heading | Waiting on them |  |  |
| 589 | text | Keys: |  |  |
| 589 | text | n |  |  |
| 589 | text | new event, |  |  |
| 589 | text | j |  |  |
| 589 | text | k |  |  |
| 589 | text | move, |  |  |
| 589 | text | d |  |  |
| 589 | text | done. |  |  |
| 598 | screen-reader label | Calendar, clashes and pipeline |  |  |
| 601 | heading | Clashes |  |  |
| 603 | text | Nothing overlaps. |  |  |
| 608 | text | ({formatWhen(Date.parse(c.a.starts_at), tz}) |  |  |
| 615 | heading | Pipeline |  |  |
| 622 | text | here now |  |  |
| 622 | text | · too few to judge | · not enough results yet | N15 |
| 622 | text | · {Math.round((n.furtherRate ?? 0) * 100)}% of those decided went further | · {Math.round((n.furtherRate ?? 0) * 100)}% of those with a result went further | N15 |
| 628 | text | rejected · |  |  |
| 628 | text | ghosted · | no reply · | GH |
| 628 | button | see the map | see the chart | ID |
| 631 | text | Stages are recorded from 3 Nov 2026: an earlier rejection counts at Applied, and an earlier row shows only its current stage. | Stages are recorded from 3 Nov 2026: an earlier rejection counts at Applied, and an earlier application shows only its current stage. | N6 |
| 679 | button | Undo |  |  |
| 682 | screen-reader label | Dismiss |  |  |

### app/app/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 82 | label | Claude |  |  |
| 83 | label | Gemini |  |  |
| 84 | label | OpenRouter |  |  |
| 253 | message | Press Fix it to correct it for you (no tailor credit is used), or edit that sentence in the CV preview and click outside the text: the re-check runs in your browser and unlocks the download. | Press Fix it and we correct it for you. This is free. Or edit that sentence in the CV preview and click outside the text. The check runs again in your browser and unlocks the download. | N3 SS |
| 294 | message | listed, not shown in use |  |  |
| 295 | message | marked learning — never claimed |  |  |
| 296 | message | not in your CV |  |  |
| 300 | label | Apply |  |  |
| 301 | message | Long shot | Low chance | ID |
| 302 | message | Likely auto-rejected | Likely to be rejected automatically | PL |
| 329 | message | {t.slice(0, n - 1)}… |  |  |
| 332 | message | The job description changed since this CV was tailored — restore it or clear the result. |  |  |
| 335 | message | This result was tailored before the fact check ran on free models, so the summary and letter were never checked against your master CV. | This result was tailored before the fact check ran on free models, so the summary and letter were never checked against your main CV. | N1 |
| 336 | message | The run had no time left for the fact check (free models are slow), so the summary and letter were not checked against your master CV. | There was no time left for the fact check (free models are slow), so the summary and letter were not checked against your main CV. | N5 N1 |
| 337 | message | The fact check of the summary and letter gave no usable answer, so they were not checked against your master CV. | The fact check of the summary and letter gave no usable answer, so they were not checked against your main CV. | N1 |
| 342 | message | The fact check of the summary and letter did not run — the cover letter's download is held until you confirm you have read it. |  |  |
| 343 | message | The fact check read {r.checked} sentence{r.checked === 1 ? "" : "s"} of the summary and letter against your master CV. | The fact check read {r.checked} sentence{r.checked === 1 ? "" : "s"} of the summary and letter against your main CV. | N1 |
| 383 | message | Low match |  |  |
| 384 | message | Potential match |  |  |
| 385 | message | Highly positive fit |  |  |
| 389 | message | Hard skills |  |  |
| 390 | message | Domain experience |  |  |
| 391 | message | Complexity & scale |  |  |
| 392 | message | Product empathy |  |  |
| 411 | message | Each skill now sits on one line: capabilities under Functional Competencies, named technologies under Technical Tools. |  |  |
| 412 | message | Moved to Functional Competencies: {f.moved.join(", ")}. |  |  |
| 413 | message | Taken off Technical Tools, already under Functional Competencies: {f.removedFromTools.join(", ")}. |  |  |
| 414 | message | Taken off Functional Competencies, already under Technical Tools: {f.removedFromCompetencies.join(", ")}. |  |  |
| 435 | message | We couldn't read that link — paste the description instead. |  |  |
| 776 | message | Add your master CV in Customise first — the Fit Score compares the company against it. | Add your main CV on My CV first. The Fit Score compares the company with it. | N1 N7 SS |
| 781 | message | Paste the company's website URL first. |  |  |
| 799 | message | Research failed. Try again. |  |  |
| 805 | message | Couldn't reach the server. Try again. |  |  |
| 819 | message | Couldn't copy — select the text and copy it manually. |  |  |
| 835 | message | Speculative application to {p.company_name \|\| "this company"} — no posted job. Target built from real research: |  |  |
| 837 | message | What they build: {p.what_they_build} |  |  |
| 838 | message | Audience: {p.target_audience} |  |  |
| 839 | message | Engineering stack (from their live job ads): {stack} |  |  |
| 840 | message | Engineering problems they're visibly working on: {p.pain_points.join("; ")} |  |  |
| 841 | message | AI footprint: {p.ai_footprint} |  |  |
| 843 | message | Role target: software engineering roles matching the stack above. |  |  |
| 897 | message | Couldn't generate that just now. Try again. |  |  |
| 908 | message | Couldn't reach the server. Try again. |  |  |
| 919 | message | Add your master CV in Customise first. | Add your main CV on My CV first. | N1 N7 |
| 931 | message | Paste a job description to get started. |  |  |
| 989 | message | The pre-check failed on the server (HTTP {res.status}). Try again; you can also tailor without it. | The free check failed on the server (HTTP {res.status}). Try again; you can also tailor without it. | N8 |
| 991 | message | Couldn't check keyword match. You can still tailor without it. |  |  |
| 1029 | message | Couldn't reach the server for the keyword check. You can still tailor without it. |  |  |
| 1102 | message | {s.skill}: {s.claim \|\| `appears in the ${WHERE_LABEL} — {SKILL_RULE_TEXT[s.rule]}. {FREE_FIX} |  |  |
| 1102 | message | appears in the {WHERE_LABEL[s.where]} |  |  |
| 1104 | message | {n.figure} isn't on your master CV: "{n.sentence.length > 100 ? `${n.sentence.}". {FREE_FIX} | {n.figure} isn't on your main CV: "{n.sentence.length > 100 ? `${n.sentence.}". {FREE_FIX} | N1 |
| 1104 | message | {n.sentence.slice(0, 99)}… |  |  |
| 1117 | message | The fact check did not run on this letter — read every sentence and tick the box to confirm it is true. |  |  |
| 1236 | message | Something went wrong. Try again. |  |  |
| 1299 | message | Couldn't reach the server. Check it's running and try again. |  |  |
| 1301 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 1317 | message | Tailor anyway? |  |  |
| 1318 | message | This JD looks out of criteria: {shownTriage.reasons.join("; ")}. Tailor anyway? | This job may not suit you: {shownTriage.reasons.join("; ")}. Tailor anyway? | N13 N2 PL |
| 1319 | message | Tailor anyway |  |  |
| 1320 | message | Don't tailor |  |  |
| 1345 | message | This research came back without company details — use "research again" first. |  |  |
| 1475 | message | Couldn't fix the flagged claims just now. Edit the highlighted text instead — the re-check is free. |  |  |
| 1502 | message | Couldn't reach the server to fix the claims. Edit the highlighted text instead — the re-check is free. |  |  |
| 1535 | message | Couldn't swap that project. Your CV is unchanged. |  |  |
| 1556 | message | Left off its tech line, because your claims registry holds them as learning: {data.techLeftOut.join(", ")}. | Left off its tech line, because your skill levels list marks them as learning: {data.techLeftOut.join(", ")}. | N9 |
| 1557 | message | {typeof data.modelError === "string" ? `$}Swapped in {data.used.name}.{techLeftOut} Your edits to the summary, skills, experience, bullets and letter are kept; edits to your header or project titles go back. Your cover letter was not rewritten, so check what it says about your projects. |  |  |
| 1559 | message | Couldn't reach the server. Your CV is unchanged. |  |  |
| 1687 | message | Replace the job description? |  |  |
| 1688 | message | The box already holds a job description. Replace it with the posting imported from {job.source}? | The box already holds a job description. Replace it with the job description imported from {job.source}? | N2 |
| 1689 | label | Replace |  |  |
| 1690 | message | Keep mine |  |  |
| 1767 | message | Unknown company |  |  |
| 1768 | message | Unknown role |  |  |
| 1782 | message | — Interview talking points — {talkingPoints} |  |  |
| 1831 | message | Couldn't save to the tracker. Try again. | Couldn't save to Applications. Try again. | N6 |
| 1847 | message | Unknown company |  |  |
| 1848 | message | Unknown role |  |  |
| 1849 | label | Applied |  |  |
| 1855 | message | Couldn't reach the server. Try again. |  |  |
| 2048 | message | The {empty.join(", ")} {empty.length > 1 ? "sections" : "section} came back empty this run. | The {sections} section(s) came back empty this time. | N5 |
| 2050 | message | Search-visibility scoring didn't complete. |  |  |
| 2055 | message | Project selection from your pool didn't complete this run — showing your master CV's projects instead. | We could not choose projects from your project list this time. Your main CV's projects are shown instead. | N11 N1 N5 SS |
| 2084 | title | Tailor your CV |  |  |
| 2085 | page tagline | Honest tailoring. Every claim traces back to your real CV — nothing invented. | Paste a job description and get a CV written for that job. Everything in it comes from your main CV. Nothing is invented. | N1 PL |
| 2091 | text | Master CV | Main CV | N1 |
| 2092 | label | Loading your CV |  |  |
| 2104 | title | Start with your master CV | First, add your main CV | N1 |
| 2105 | button | Add your CV in Customise → | Add my CV → | N7 BT |
| 2107 | text | Add it once and it's reused for every job you tailor for here. Paste it or upload a PDF or Word file. | Add it once. Jobhuntz uses it for every job. Paste it, or upload a PDF or Word file. | SS |
| 2117 | label | Paste a job link |  |  |
| 2119 | help text | Lever, Ashby, Greenhouse, Workable, SmartRecruiters, BambooHR or LinkedIn. We read the posting into the box below; check it before you tailor. | Lever, Ashby, Greenhouse, Workable, SmartRecruiters, BambooHR or LinkedIn. We read the job description into the box below; check it before you tailor. | N2 |
| 2137 | placeholder | e.g. https://jobs.lever.co/company/… |  |  |
| 2145 | button | Importing… |  |  |
| 2145 | button | Import |  |  |
| 2152 | text | {importError.detail} |  |  |
| 2157 | text | Imported from |  |  |
| 2158 | text | : {importedJob.title} |  |  |
| 2159 | text | at {importedJob.company} |  |  |
| 2163 | label | Job description |  |  |
| 2168 | placeholder | Paste the job description for the role you're applying to… |  |  |
| 2179 | text | Free tailors today: | Today: | N3 |
| 2180 | text | of |  |  |
| 2184 | text | Claude credits: | Free tailored CVs: | N3 |
| 2185 | text | of |  |  |
| 2198 | button | Checking keyword match… | Checking this job… | PL |
| 2198 | button | Tailor my CV | Check this job (free) | BT |
| 2203 | field label | Provider |  |  |
| 2210 | choice | Claude |  |  |
| 2211 | choice | OpenRouter |  |  |
| 2219 | field label | Style |  |  |
| 2242 | text | Without the check we can't confirm this job is at |  |  |
| 2243 | text | , so your research won't be applied to this run. | , so your research won't be applied to this CV. | N5 |
| 2248 | button | Tailoring… |  |  |
| 2248 | button | Tailor without the check → |  |  |
| 2259 | text | Looks like: |  |  |
| 2259 | text | this role |  |  |
| 2260 | text | at |  |  |
| 2261 | text | — if that's not the job you meant, fix the JD above before continuing. | . If that is not the job you meant, fix the job description above before you continue. | N2 SS |
| 2267 | text | Company research for |  |  |
| 2267 | text | will be used in this run. | will be used in this CV. | N5 |
| 2271 | text | Your research is for |  |  |
| 2271 | text | ; this job looks like |  |  |
| 2272 | text | — the research won't be applied to this run. | . The research will not be applied to this CV. | N5 SS |
| 2277 | text | Couldn't tell which company this job is at, so your research for |  |  |
| 2278 | text | won't be applied to this run. | won't be applied to this CV. | N5 |
| 2285 | text | You already saved this exact job description: |  |  |
| 2289 | text | applied {formatDay(d.date_applied)} |  |  |
| 2289 | text | not sent yet |  |  |
| 2292 | text | . Continue only if this is a genuinely new application. |  |  |
| 2297 | text | You have already applied to |  |  |
| 2298 | text | {gateExtras.sameCompany.count} times |  |  |
| 2299 | text | (last: |  |  |
| 2299 | text | , {formatDay(gateExtras.sameCompany.last.da} |  |  |
| 2300 | text | , {statusLabel(gateExtras.sameCompany.last.} |  |  |
| 2300 | text | ). Recruiters see every application to their company in one screen; apply again only for a genuinely different role. |  |  |
| 2325 | text | Read from: |  |  |
| 2325 | message | {s.kind === "title" ? "title" : s.kind ==} ({s.text}) |  |  |
| 2325 | message | the posting's level | the job description's level | N2 |
| 2332 | text | Read on this application | Our advice for this job | PL |
| 2340 | text | Set up your eligibility answers in | Answer the Eligibility questions on | PL |
| 2341 | text | Customise | My CV | N7 |
| 2341 | text | (about 2 minutes) and this check turns each job's eligibility conditions into pass or fail before you spend a tailor. | (about 2 minutes). This check then tells you if you meet each job's requirements, before you use a tailored CV. | N3 SS |
| 2349 | text | Eligibility gates ( | Requirements in this job ( | PL |
| 2358 | text | “ |  |  |
| 2358 | text | ” — |  |  |
| 2359 | text | Say: |  |  |
| 2369 | text | Rough keyword match, before tailoring |  |  |
| 2376 | text | Good overlap with this role's top keywords, from your CV as it stands today. |  |  |
| 2377 | text | Below the usual 10-keyword mark for your CV as-is — tailoring can still genuinely help by surfacing real adjacent skills, though a gap this size may be honest too. | Your CV has fewer than 10 of this job's key words. Tailoring can help by showing related skills you really have. A gap this big can also mean the job is not a good match. | SS PL |
| 2378 | text | The same |  |  |
| 2378 | text | terms, counted the same way as the search-visibility score after tailoring, but read here over your master CV as saved; after tailoring, the score card shows this figure again under the new one. | terms. We count them the same way as the score after tailoring, but here we count them in your main CV. After tailoring, the score card shows both numbers. | N1 SS |
| 2382 | text | Required skills in your CV |  |  |
| 2389 | text | Not in your CV as it stands: {gateExtras.required.missedKeywords.join(}. |  |  |
| 2390 | text | Every required skill the posting names is in your CV. | Every required skill the job description names is in your CV. | N2 |
| 2397 | text | What the posting asks for, and where your CV shows it | What the job description asks for, and where your CV shows it | N2 |
| 2411 | text | (required) |  |  |
| 2411 | text | (preferred) |  |  |
| 2411 | text | not named in your CV |  |  |
| 2412 | text | : {i.where} |  |  |
| 2415 | text | . Your CV may show it as “ |  |  |
| 2415 | text | ” |  |  |
| 2415 | text | ({gap.where}) |  |  |
| 2415 | text | . If that is the same work, you can name it that way in your master CV. | . If that is the same work, you can name it that way in your main CV. | N1 |
| 2418 | text | . Your CV never says it in words; show it with a real example if you have one. |  |  |
| 2419 | text | . A core gap: no evidence in your CV. It won't be claimed; the letter may name your nearest real experience instead. | . Your CV does not show this at all. The tailored CV will not claim it. The letter may name your closest real experience instead. | PL SS |
| 2429 | text | Skip |  |  |
| 2429 | text | Review |  |  |
| 2430 | text | Tailoring anyway spends a credit on an application they said they won't take. | The company said it will not accept this application. Tailoring anyway still uses 1 tailored CV. | N3 PL |
| 2436 | text | Tailoring anyway spends a credit. | Tailoring anyway uses 1 tailored CV. | N3 |
| 2441 | button | Tailoring… |  |  |
| 2441 | button | Tailor anyway (uses a credit) → | Tailor anyway (uses 1 tailored CV) → | N3 |
| 2441 | button | Continue to full tailoring → | Tailor my CV → | BT N5 |
| 2445 | field label | Positioning | Headline | N10 |
| 2453 | choice | Auto |  |  |
| 2453 | choice | — {variantPick.variant.name} |  |  |
| 2453 | choice | — none |  |  |
| 2457 | choice | None |  |  |
| 2464 | field label | Provider |  |  |
| 2471 | choice | Claude |  |  |
| 2472 | choice | OpenRouter |  |  |
| 2475 | text | ran on |  |  |
| 2497 | text | Fix your contact details before tailoring. |  |  |
| 2499 | text | Every CV and download is held until it is fixed. |  |  |
| 2502 | button | Open Your details → |  |  |
| 2509 | text | The pre-check | The free check | N8 |
| 2509 | text | Tailoring |  |  |
| 2509 | text | is temporarily unavailable. |  |  |
| 2511 | text | The shared Claude account has run out of credit — this isn't your account, and you haven't been charged a tailor. Add your own free OpenRouter key and | Our free AI service is not available right now. This is not a problem with your account, and it did not use one of your tailored CVs. Add your own free API key and | N3 N4 PL |
| 2512 | text | the pre-check and tailoring run | the free check and tailoring run | N8 |
| 2512 | text | tailoring runs |  |  |
| 2512 | text | on it instead, starting immediately. | on your key instead, straight away. | PL |
| 2516 | button | Add your key in Settings → | Add my API key → | N4 BT |
| 2523 | text | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| 2525 | text | Your saved key can no longer be read. Please go to Settings and replace it. |  |  |
| 2528 | button | Go to Settings → |  |  |
| 2536 | text | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| 2538 | text | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| 2541 | button | Add your key in Settings → | Add my API key → | N4 BT |
| 2549 | text | Your Gemini key can't run a tailor. | Your Gemini key cannot tailor a CV. | N5 |
| 2551 | text | Gemini's free tier allows 5 requests per minute, and one tailoring run makes 8 — so it can't finish even once. Add an OpenRouter key instead; its free tier handles a full run. | Gemini's free plan allows 5 requests a minute. Tailoring one CV needs 8, so it cannot finish. Add an OpenRouter key in Settings instead. | N5 SS |
| 2556 | button | Add an OpenRouter key → |  |  |
| 2564 | text | Your OpenRouter key has hit its limit. | Your API key has reached today's limit. | N4 ID |
| 2566 | text | Your key's free quota resets daily — come back tomorrow to continue. | The free limit on your key starts again each day. Try again tomorrow. | PL |
| 2569 | text | A subscription plan with higher limits is on the way. |  |  |
| 2585 | label | Company research (optional) |  |  |
| 2587 | help text | Paste the company's website and we'll read their site and live job ads, then score how well your real CV fits before you spend a tailor. Uses one tailor credit — repeat lookups of the same company are free for 7 days. | Paste the company's website. We read the site and its job adverts, then score how well your CV fits the company. This counts as 1 tailored CV: it uses one of your free ones, and one of today's 3. Looking up the same company again is free for 7 days. | N3 SS |
| 2594 | placeholder | e.g. deliveroo.co.uk |  |  |
| 2599 | button | Researching… |  |  |
| 2599 | button | Research company |  |  |
| 2611 | text | Company profile |  |  |
| 2616 | button | Saved result — research again |  |  |
| 2616 | button | Research again |  |  |
| 2622 | text | Audience: |  |  |
| 2647 | text | · weighs |  |  |
| 2650 | screen-reader label | {label}: {c.score} out of 100 |  |  |
| 2660 | text | Honest gaps: |  |  |
| 2669 | text | Engineering stack — from |  |  |
| 2669 | text | live job ads |  |  |
| 2683 | text | ✓ = already evidenced in your master CV. | ✓ = already evidenced in your main CV. | N1 |
| 2689 | text | Their website runs on |  |  |
| 2696 | text | Website tech ≠ engineering stack — the job ads above are the real hiring signal. |  |  |
| 2704 | text | Open roles ( |  |  |
| 2705 | text | — via |  |  |
| 2715 | tooltip / title | Use this job ad as the job description below |  |  |
| 2719 | text | Use as JD ↓ | Use this job ↓ | N2 |
| 2730 | button | Show fewer |  |  |
| 2730 | button | Show all {research.openings.length} roles |  |  |
| 2742 | text | Cold outreach — no job posting needed | Contact the company directly (no job advert needed) | ID N2 |
| 2744 | text | Tailors your CV and cover letter to |  |  |
| 2744 | text | this company |  |  |
| 2744 | text | 's real stack from the research — completely separate from the job-description box below. |  |  |
| 2750 | button | Tailoring… |  |  |
| 2752 | button | Tailor CV + cover letter + cold email |  |  |
| 2753 | button | Tailor CV + cover letter for this company |  |  |
| 2763 | placeholder | Recipient's name (optional) |  |  |
| 2770 | placeholder | One TRUE line about how you know them (optional) |  |  |
| 2776 | text | Left empty, the email skips the personal line — it never invents a connection. |  |  |
| 2784 | button | Writing… |  |  |
| 2784 | button | Rewrite cold email |  |  |
| 2784 | button | Cold email draft |  |  |
| 2788 | text | No role selected — it pitches speculatively. |  |  |
| 2790 | text | References the tailored role. |  |  |
| 2791 | text | The tailored role is for a different company — it pitches speculatively. |  |  |
| 2799 | text | Ready to send — attach your downloaded CV |  |  |
| 2803 | text | Claims check: |  |  |
| 2805 | message | {s.skill} is marked learning |  |  |
| 2807 | message | {n.figure} isn't on your CV |  |  |
| 2807 | message | {n.figure} is used in a different context |  |  |
| 2810 | text | . Rewrite the email or edit before sending. |  |  |
| 2814 | button | Copied ✓ |  |  |
| 2814 | button | Copy email |  |  |
| 2824 | text | This research came back without company details, so tailoring and outreach are unavailable for it — use "research again" above to refresh. |  |  |
| 2840 | text | Analysing the job description |  |  |
| 2841 | text | Using your research for {runResearchCompany} |  |  |
| 2841 | text | Researching the company |  |  |
| 2842 | text | Tailoring summary, skills, experience, projects |  |  |
| 2843 | text | Writing your cover letter |  |  |
| 2844 | text | Scoring recruiter search visibility |  |  |
| 2846 | text | s — a full run usually takes under a minute. | s. This usually takes under a minute. | N5 |
| 2854 | text | Tailored result |  |  |
| 2858 | text | Tailored for |  |  |
| 2858 | text | this role |  |  |
| 2859 | text | at |  |  |
| 2862 | text | · positioned as | · headline: | N10 |
| 2876 | button | Back to the job description ↑ |  |  |
| 2882 | text | The job description changed since this CV was tailored |  |  |
| 2884 | text | Downloads are held until the text above matches the posting this was tailored for (Applied still saves the run with the posting it was tailored from). Restore that text, or clear this result and tailor the new posting. | You cannot download until the text above matches the job description this CV was tailored for. (Applied still saves it with the job description it was tailored from.) Restore that text, or clear this result and tailor for the new job. | N2 N5 SS |
| 2890 | button | Restore that job description |  |  |
| 2893 | button | Clear this result |  |  |
| 2900 | text | Re-running the same job description retries those steps (it counts as a new run). | Tailoring the same job description again retries those steps. It counts as a new tailored CV. | N5 N3 |
| 2908 | text | Claims check: {claimIssues === 1 ? "1 thing" : `${claim} to fix before you can download |  |  |
| 2908 | text | 1 thing |  |  |
| 2908 | text | {claimIssues} things |  |  |
| 2909 | text | Claims check: {claimIssues === 1 ? "1 thing" : `${claim} to look at |  |  |
| 2909 | text | 1 thing |  |  |
| 2909 | text | {claimIssues} things |  |  |
| 2921 | text | : the posting asks for it, but your master CV never shows it — | : the job description asks for it, but your main CV never shows it. The text says: | N1 N2 SS |
| 2921 | text | . Remove it, or add it to your master CV first if you have really done it. | . Remove it, or add it to your main CV first if you have really done it. | N1 |
| 2926 | text | is marked |  |  |
| 2926 | text | learning |  |  |
| 2926 | text | in your registry, and it appears in the | in your skill levels list, and it appears in the | N9 |
| 2927 | text | : “ |  |  |
| 2927 | text | ” |  |  |
| 2931 | text | is registered as |  |  |
| 2931 | text | project-only |  |  |
| 2931 | text | , but the |  |  |
| 2931 | text | claims more — |  |  |
| 2931 | text | . Rule: |  |  |
| 2932 | text | . Raise its level in Customise only if you have used it at work. | . Raise its level on My CV only if you have used it at work. | N7 |
| 2946 | text | isn't on your master CV | isn't on your main CV | N1 |
| 2948 | text | joins two separate figures into a range your master CV never states | joins two separate figures into a range your main CV never states | N1 |
| 2949 | text | is on your CV in a different context |  |  |
| 2950 | text | — in the |  |  |
| 2951 | text | : “ |  |  |
| 2951 | text | {n.sentence.slice(0, 139)}… |  |  |
| 2951 | text | ” |  |  |
| 2958 | text | Press Fix it and the flagged words are corrected for you, with the job description in view — no tailor credit is used. Or edit the highlighted text in the preview below, then click outside it or press Re-check now. Download and Applied unlock when it passes. | Press Fix it and we correct the marked words for you. This is free. Or edit the highlighted text in the preview below, then click outside it or press Check again. Download and Applied unlock when the check passes. | N3 SS |
| 2960 | text | Warnings don't block downloads; a figure missing from your CV or a skill claimed above its level would. |  |  |
| 2961 | text | Save a master CV in Customise and its skills become blocking checks. | Save your main CV on My CV. Its skills are then checked on every tailored CV. | N1 N7 PL |
| 2968 | button | Fixing… |  |  |
| 2968 | button | Fix it |  |  |
| 2971 | button | Re-check now | Check again | PL |
| 2978 | text | Fixed — the claims check passes |  |  |
| 2978 | text | Partly fixed — see the claims check above |  |  |
| 2982 | text | Nothing needed changing. |  |  |
| 2993 | text | took out “ |  |  |
| 2993 | text | ”: “ |  |  |
| 2993 | text | ” |  |  |
| 3001 | text | : “ |  |  |
| 3001 | text | ” |  |  |
| 3004 | text | : “ |  |  |
| 3004 | text | ” |  |  |
| 3005 | text | (was “ |  |  |
| 3005 | text | ”) |  |  |
| 3015 | text | The AI rewrite wasn't available just now, so the sentences it would have reworded were removed instead. Undo to get them back and edit them by hand. |  |  |
| 3017 | text | {claimFixReport.model.rejected === 1 ? "O} still broke a rule, so {claimFixReport.model.rejected === 1 ? "t} removed instead. |  |  |
| 3017 | text | One AI rewrite |  |  |
| 3017 | text | {claimFixReport.model.rejected} AI rewrites |  |  |
| 3017 | text | that sentence was |  |  |
| 3017 | text | those sentences were |  |  |
| 3018 | text | Only the flagged words were changed; everything else is as it was. |  |  |
| 3019 | text | No tailor credit was used. Read the changes, then download. | This was free. Read the changes, then download. | N3 |
| 3024 | button | Undo fix |  |  |
| 3031 | text | The fact check did not run |  |  |
| 3031 | text | Checked against your master CV | Checked against your main CV | N1 |
| 3035 | text | The deterministic checks still ran | The automatic checks still ran | PL |
| 3036 | text | and changed the sentences below |  |  |
| 3036 | text | . The cover letter's download is held until you confirm you have read it; the unchecked sentences are listed beside the letter. |  |  |
| 3041 | text | Every sentence about your past in the summary and the letter was checked against your master CV. | Every sentence about your past in the summary and the letter was checked against your main CV. | N1 |
| 3042 | text | One said |  |  |
| 3042 | text | {result.supportCheck.changed.length} said |  |  |
| 3043 | text | something it doesn't show: |  |  |
| 3048 | text | One sentence |  |  |
| 3048 | text | {result.supportCheck.unverified.length} sentences |  |  |
| 3049 | text | the check could not trace to a line of your CV — read |  |  |
| 3049 | text | yourself before sending: |  |  |
| 3052 | text | “ |  |  |
| 3052 | text | ” |  |  |
| 3063 | text | Summary |  |  |
| 3063 | text | Cover letter |  |  |
| 3063 | text | : “ |  |  |
| 3063 | text | ” |  |  |
| 3064 | text | (now “ |  |  |
| 3064 | text | ”) |  |  |
| 3075 | text | Formatting rules applied |  |  |
| 3082 | text | Technical Tools ran to |  |  |
| 3082 | text | ; kept the |  |  |
| 3083 | text | most relevant to this role and dropped: |  |  |
| 3084 | text | . Add one back in the preview if it matters more than a term shown. |  |  |
| 3093 | text | The summary came back at {result.formatFixes.summary.words} words; kept the first {result.formatFixes.summary.kept} sentences so it reads in seconds. |  |  |
| 3094 | text | The summary came back as {result.formatFixes.summary.sentences} sentences; kept the first {result.formatFixes.summary.kept}, one per line. |  |  |
| 3095 | text | Check they still carry the role title and your strongest figure. |  |  |
| 3103 | text | Dropped from Technical Tools because your master CV never names them: | Dropped from Technical Tools because your main CV never names them: | N1 |
| 3111 | text | Dropped from Functional Competencies because your master CV shows no such work: | Dropped from Functional Competencies because your main CV shows no such work: | N1 |
| 3119 | text | Put back on Technical Tools because the posting asks for them and your master CV lists them: | Put back on Technical Tools because the job description asks for them and your main CV lists them: | N1 N2 |
| 3127 | text | Moved out of the first 8 Technical Tools: |  |  |
| 3128 | text | Left off Technical Tools, which is too short to hold it after the first 8: |  |  |
| 3142 | text | The PDF ran to |  |  |
| 3142 | text | pages against the |  |  |
| 3142 | text | -page limit |  |  |
| 3144 | text | , so the {result.formatFixes.pageOverflow.dropped.} left out: {result.formatFixes.pageOverflow.dropped }{result.formatFixes.pageOverflow.dropped.} |  |  |
| 3144 | text | least relevant bullet was |  |  |
| 3144 | text | {result.formatFixes.pageOverflow.dropped.} least relevant bullets were |  |  |
| 3146 | message | “{clip(d.bullet, 70)}” ({d.owner}) |  |  |
| 3147 | text | and more |  |  |
| 3149 | text | . It now fits on {result.formatFixes.pageOverflow.pagesAft}. |  |  |
| 3149 | text | . It still runs to {result.formatFixes.pageOverflow.pagesAft} — cut more in the preview. |  |  |
| 3156 | text | The summary no longer names the job you are applying for (“…, applying for the … role”): the clause came out of |  |  |
| 3156 | text | one sentence |  |  |
| 3156 | text | {result.formatFixes.appliedFor!.length} sentences |  |  |
| 3163 | text | British spelling throughout: |  |  |
| 3163 | text | one word |  |  |
| 3163 | text | {result.formatFixes.spelling.count} words |  |  |
| 3163 | text | changed |  |  |
| 3164 | text | ({result.formatFixes.spelling.examples.joi}) |  |  |
| 3164 | text | . Recruiter searches match either spelling. |  |  |
| 3173 | text | style: |  |  |
| 3175 | text | bold removed from {result.formatFixes.style.debolded} bullet{result.formatFixes.style.debolded === 1 } |  |  |
| 3176 | text | {result.formatFixes.style.highlightsStrip} “Highlight:” prefix{result.formatFixes.style.highlightsStrip} dropped |  |  |
| 3177 | text | the full stop taken off {result.formatFixes.style.fullStopsStripp} bullet{result.formatFixes.style.fullStopsStripp} |  |  |
| 3178 | text | {result.formatFixes.style.swapped.map((s)} |  |  |
| 3178 | message | “{s.from}” → “{s.to \|\| "(dropped)"}” |  |  |
| 3182 | text | Every swap stays within the two-word budget a master bullet allows. | Every swap stays within the two words that a main CV bullet may change. | N1 PL |
| 3190 | text | A line |  |  |
| 3190 | text | {result.formatFixes.strayLines.length} lines |  |  |
| 3190 | text | under the skills labels |  |  |
| 3191 | text | not skills and |  |  |
| 3191 | text | dropped: |  |  |
| 3192 | message | “{clip(l, 80)}” |  |  |
| 3193 | text | and {result.formatFixes.strayLines.length - 3} more |  |  |
| 3201 | text | A skills line was written twice; the later copy was dropped: |  |  |
| 3202 | message | “{clip(l, 80)}” |  |  |
| 3212 | text | Lead skills skipped | Skills not shown first | ID |
| 3214 | text | Change the level on Customise if it is production work, or take it out of the variant. | Change the level on My CV if it is production work, or remove it from the headline's skills. | N7 N10 |
| 3220 | text | Ran on OpenRouter |  |  |
| 3226 | text | What ran on the free model |  |  |
| 3228 | text | Free models are slow, so the four polish retries were skipped: the role-title retry, the bullet-lint retry, the claims rewrite and the letter's name rewrite (a sentence naming a place or product your sources don't was removed instead). Every deterministic check ran. | Free models are slow, so four second attempts were skipped: the job title in the summary, weak bullets, the claims rewrite, and names in the letter (a sentence naming a place or product that your sources do not name was removed instead). Every automatic check still ran. | PL |
| 3236 | text | Graduate-scheme layout |  |  |
| 3238 | text | This posting is screened on the degree first, so Education sits under the summary for this run. Your saved section order is unchanged. | This job is screened on the degree first, so Education sits under the summary for this CV. Your saved section order is unchanged. | N2 N5 |
| 3243 | button | Use my standard order for this run | Use my standard order for this CV | N5 |
| 3256 | message | Fitted to one page |  |  |
| 3256 | message | Could not fit one page |  |  |
| 3257 | message | Could not fit two pages |  |  |
| 3257 | message | Filled to two pages from your master CV | Filled to two pages from your main CV | N1 |
| 3257 | message | Fitted to two pages |  |  |
| 3263 | text | You chose a one-page CV on Customise, so the download is laid out to one. | You chose a one-page CV on My CV, so the download is laid out to one. | N7 |
| 3264 | text | The download is laid out to two pages. |  |  |
| 3265 | text | These bullets from your master CV were put back to fill the second page: | These bullets from your main CV were put back to fill the second page: | N1 |
| 3266 | text | Left out for length — paste one back into the preview if it matters more than what stayed: |  |  |
| 3267 | text | Nothing had to be left out. |  |  |
| 3268 | text | Even at the tightest spacing it still runs over: shorten the remaining bullets in the preview. |  |  |
| 3271 | text | {r.section}: |  |  |
| 3274 | text | Summary: |  |  |
| 3276 | text | Technical Tools: |  |  |
| 3278 | text | {e.role}: |  |  |
| 3290 | text | Right to Work kept off the document |  |  |
| 3292 | text | Your setting keeps immigration status off the CV, so these sentences were removed |  |  |
| 3294 | text | from the CV and the cover letter |  |  |
| 3296 | text | from the CV |  |  |
| 3297 | text | from the cover letter |  |  |
| 3298 | text | . The wording is still in the copy block below for application forms. |  |  |
| 3314 | text | Cover letter shape |  |  |
| 3320 | text | Removed — it told the reader their own posting back: “ | Removed. It told the reader their own job description back: “ | N2 SS |
| 3320 | text | ” |  |  |
| 3326 | text | Removed — it narrated what the reader gets instead of stating a fact: “ |  |  |
| 3326 | text | ” |  |  |
| 3333 | text | Fitted to one page: |  |  |
| 3333 | text | sentence |  |  |
| 3333 | text | removed from the longest paragraph |  |  |
| 3334 | text | — it still runs over; shorten it in the preview |  |  |
| 3334 | text | (“ |  |  |
| 3334 | text | ” |  |  |
| 3335 | text | and more |  |  |
| 3343 | text | The posting asks for | The job description asks for | N2 |
| 3344 | text | and more |  |  |
| 3344 | text | , which your master CV never shows, and the letter does not say so. One plain sentence naming the gap and your nearest real experience reads better than silence — add it in the preview if you agree. | , which your main CV never shows, and the letter does not say so. One plain sentence that names the gap and your nearest real experience reads better than silence. Add it in the preview if you agree. | N1 SS |
| 3356 | text | Right to work and availability come from your Eligibility answers |  |  |
| 3360 | text | The summary ends with your availability, written from your Eligibility answers: “ |  |  |
| 3360 | text | ” |  |  |
| 3365 | text | The letter closes with your right-to-work statement: “ |  |  |
| 3365 | text | ” |  |  |
| 3370 | text | “ |  |  |
| 3370 | text | ” became your own answer: “ |  |  |
| 3370 | text | ” |  |  |
| 3375 | text | Removed, because it is not an answer you gave on Customise: | Removed, because it is not an answer you gave on My CV: | N7 |
| 3381 | text | Answer |  |  |
| 3383 | text | your right to work and your availability |  |  |
| 3385 | text | your right to work |  |  |
| 3386 | text | your availability |  |  |
| 3387 | text | under Eligibility on |  |  |
| 3387 | text | Customise | My CV | N7 |
| 3387 | text | , so the letter can state it in your words. |  |  |
| 3397 | text | format check |  |  |
| 3400 | text | Our own check of the |  |  |
| 3400 | text | style's rules on the document as it stands — not a score from anywhere, and it never holds a download. |  |  |
| 3415 | text | Edit the preview below; this read updates when you click away or re-check. |  |  |
| 3418 | button | Re-check now | Check again | PL |
| 3426 | text | Your master CV | Your main CV | N1 |
| 3429 | text | These bullets break a rule of the |  |  |
| 3429 | text | style that the tailoring may not fix for you — it never changes a master CV bullet by more than two words. Edit them on | style that the tailoring may not fix for you. It never changes a main CV bullet by more than two words. Edit them on | N1 SS |
| 3430 | text | Customise | My CV | N7 |
| 3447 | text | Before you send |  |  |
| 3454 | text | Template text left in the document: |  |  |
| 3456 | text | and more |  |  |
| 3456 | text | . Write the real figure from your CV, or reword the line without one, before you send it. |  |  |
| 3465 | text | About |  |  |
| 3465 | text | pages |  |  |
| 3465 | text | — over the two-page limit even at the tightest spacing. Cut the least relevant bullets in the preview below. |  |  |
| 3474 | text | About |  |  |
| 3474 | text | pages |  |  |
| 3474 | text | — over the one page you chose on Customise. | . That is over the one page you chose on My CV. | N7 SS |
| 3475 | text | Cut the least relevant bullets and projects in the preview below, or switch the CV length back to two pages. |  |  |
| 3483 | text | One bullet runs |  |  |
| 3483 | text | {quality.longBullets.length} bullets run |  |  |
| 3483 | text | past two printed lines: |  |  |
| 3485 | text | and more |  |  |
| 3485 | text | . Cut words, never facts. |  |  |
| 3493 | text | One bullet repeats |  |  |
| 3493 | text | {quality.repeats.length} bullets repeat |  |  |
| 3493 | text | a word: |  |  |
| 3494 | text | in “ |  |  |
| 3494 | text | ” |  |  |
| 3495 | text | and more |  |  |
| 3495 | text | . Say it once. |  |  |
| 3505 | text | is a project and also appears under Experience — keep it in one place. |  |  |
| 3507 | text | is a project and also appears under Education — keep it in one place. |  |  |
| 3508 | text | appears twice. |  |  |
| 3516 | text | One bullet carries |  |  |
| 3516 | text | {quality.weakBullets.length} bullets carry |  |  |
| 3517 | text | no number, scale or named system: “ |  |  |
| 3519 | text | ” |  |  |
| 3520 | text | and more |  |  |
| 3520 | text | . Add the evidence from your CV, or cut it. |  |  |
| 3528 | text | Filler a recruiter reads straight past: | Empty words that recruiters skip: | ID |
| 3529 | message | {h.word}{h.count > 1 ? ` ×${h.count}` : ""} |  |  |
| 3529 | text | . Cut or replace with what you did. |  |  |
| 3537 | text | One bullet ends |  |  |
| 3537 | text | {quality.boltOns.length} bullets end |  |  |
| 3538 | text | by explaining why it matters to the employer: “… |  |  |
| 3539 | text | ” |  |  |
| 3540 | text | and more |  |  |
| 3540 | text | . That clause is the clearest sign of a tool at work; cut it and let the bullet stop on the result. | . This kind of ending looks machine-written. Cut it and end the bullet on the result. | ID PL |
| 3546 | text | Edit the preview below; this read updates when you click away or re-check. |  |  |
| 3549 | button | Re-check now | Check again | PL |
| 3561 | text | 🔥 High-fit extras for |  |  |
| 3561 | text | this company |  |  |
| 3564 | text | This company scored |  |  |
| 3564 | text | /100 against your real CV — worth going beyond the CV. Both are built only from your master CV and the research; nothing invented. | /100 against your real CV, so it is worth doing more than the CV. Both are built only from your main CV and the research. Nothing is invented. | N1 SS ID |
| 3573 | button | Writing… |  |  |
| 3573 | button | Rewrite pitch script |  |  |
| 3573 | button | 60-second pitch script |  |  |
| 3580 | button | Preparing… |  |  |
| 3580 | button | Redo talking points |  |  |
| 3580 | button | Interview talking points |  |  |
| 3586 | text | Pitch script — 60-90 seconds, spoken |  |  |
| 3592 | text | Interview talking points |  |  |
| 3594 | text | Saved into the tracker row's notes when you click Applied below. | Saved in the application's notes when you click Applied below. | N6 |
| 3609 | text | Fix the flagged claims above first — press Fix it, or edit the preview. No credit is used. | Fix the marked claims above first. Press Fix it, or edit the preview. This is free. | N3 SS |
| 3615 | text | Send anyway? |  |  |
| 3615 | text | Before this goes in the tracker as applied: | Before you save this as applied: | N6 |
| 3623 | button | Save anyway |  |  |
| 3626 | button | Not yet |  |  |
| 3636 | text | From your list on Customise: | From your list on My CV: | N7 |
| 3638 | message | "{r.from}" now reads "{r.to}" |  |  |
| 3639 | message | the line saying "{p}" was removed |  |  |
| 3645 | text | Check these before you download |  |  |
| 3652 | text | “{item}” |  |  |
| 3657 | screen-reader label | OK: {item} |  |  |
| 3660 | button | OK |  |  |
| 3675 | text | Changed since you saved it. The tracker keeps the CV and letter as they were when you clicked Applied; the downloads here give this version. | Changed since you saved it. Applications keeps the CV and letter as they were when you clicked Applied. The downloads here give this version. | N6 SS |
| 3682 | appliedLabel | Checking… |  |  |
| 3684 | appliedLabel | Saving… |  |  |
| 3686 | appliedLabel | Saved to tracker ✓ | Saved to Applications ✓ | N6 |
| 3688 | appliedLabel | Already in tracker | Already in Applications | N6 |
| 3689 | appliedLabel | Applied — save to tracker | I applied. Save to Applications | N6 BT |
| 3692 | appliedTitle | Fix the flagged claims first |  |  |
| 3698 | newJobLabel | Start a new job |  |  |
| 3701 | pagesNote | About {quality.pages.pages} {quality.pages.pages === 1 ? "page" : "pa} at the download's spacing{quality.pages.overBudget ? " — over the } |  |  |
| 3702 | pagesNote | — over the two-page limit |  |  |
| 3702 | pagesNote | — over the one page you chose |  |  |
| 3729 | text | Left off the tech lines, because your claims registry holds them as learning: {result.poolFit!.techLeftOut!.join(", ")}. | Left off the tech lines, because your skill levels list marks them as learning: {result.poolFit!.techLeftOut!.join(", ")}. | N9 |
| 3739 | text | Changes vs master CV | Changes from your main CV | N1 PL |
| 3742 | text | kept, |  |  |
| 3742 | text | edited, |  |  |
| 3743 | text | left out |  |  |
| 3744 | text | , {result.bulletChanges.experience.added} not in the master CV | , {result.bulletChanges.experience.added} not in the main CV | N1 |
| 3749 | text | Every experience bullet is one of the master CV's, chosen and reordered for this posting, with at most two words changed. | Every experience bullet is one from your main CV, chosen and reordered for this job, with at most two words changed. | N1 N2 |
| 3750 | text | Ids were checked on this run. | Each bullet was matched to your main CV by its number. | PL |
| 3750 | text | This run came back without bullet ids, so the comparison below is by closest match. | The bullets came back without numbers, so the comparison below is by closest match. | PL |
| 3751 | text | Roles run newest first |  |  |
| 3751 | text | (reordered by date) |  |  |
| 3751 | text | . Role titles, employers and dates are the master CV's, verbatim | . Role titles, employers and dates are the main CV's, verbatim | N1 |
| 3753 | text | ({[ result.bulletChanges.headers.locked.le}) |  |  |
| 3754 | text | {result.bulletChanges.headers.locked.leng} restored |  |  |
| 3755 | text | {result.bulletChanges.headers.droppedEmpt} invented role{result.bulletChanges.headers.droppedEmpt} removed |  |  |
| 3766 | text | “ |  |  |
| 3766 | text | ” |  |  |
| 3775 | text | reordered |  |  |
| 3780 | text | reverted to master | reverted to your main CV | N1 |
| 3780 | text | not in master | not in your main CV | N1 |
| 3793 | text | left out |  |  |
| 3804 | heading | Cover Letter |  |  |
| 3827 | screen-reader label | Your recruiter search visibility |  |  |
| 3831 | text | Recruiter search visibility, after tailoring |  |  |
| 3851 | text | Required skills in the tailored CV: |  |  |
| 3853 | text | — not present: {result.atsScore.required_misses!.join(",} |  |  |
| 3858 | text | How likely a recruiter searching their pipeline for this role's terms is to surface your CV — the count is how many of those terms the tailored text carries. | Recruiters search their list of applicants by key words. This score counts how many of this job's key words are in your tailored CV. More matches make your CV more likely to appear in their search. | PL SS |
| 3863 | text | Matched ( |  |  |
| 3874 | text | Missing ( |  |  |
| 3884 | text | Your CV may show this as “ |  |  |
| 3884 | text | ”. If it is the same work, you can name it that way in your master CV. | ”. If it is the same work, you can name it that way in your main CV. | N1 |
| 3887 | text | Being learnt: never claimed. |  |  |
| 3887 | text | Core gap: no evidence in your master CV. | Not in your main CV at all. | N1 PL |
| 3900 | text | Fix first |  |  |
| 3900 | text | Fix before sending |  |  |
| 3900 | text | Optional edits |  |  |
| 3912 | text | Needs your evidence ( | We could not confirm these from your CV ( | PL |

### app/applications/AttentionStrip.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 21 | screen-reader label | Counting |  |  |
| 41 | screen-reader label | Needs attention |  |  |
| 69 | text | Follow-ups due today |  |  |
| 70 | text | dated today · |  |  |
| 70 | text | overdue |  |  |
| 81 | text | Follow-ups due this week |  |  |
| 92 | text | Data to fix | Applications to fix | PL |
| 92 | text | Data to fix · {counts.statusToFix} status, {counts.attachmentsToFix} JD/CV | Applications to fix · {counts.statusToFix} with the wrong status, {counts.attachmentsToFix} with no job description or CV | PL N2 |
| 105 | text | Cold emails missing a follow-up date |  |  |
| 111 | text | Referral · since |  |  |
| 116 | button | more |  |  |

### app/applications/CleanupPanel.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 25 | message | Connection error. Please try again. |  |  |
| 39 | text | no role |  |  |
| 40 | text | · {i.days} days |  |  |
| 69 | message | The dry run failed. |  |  |
| 95 | message | clear the follow-up date on {tickedA} row{tickedA === 1 ? "" : "s"} (the status stays Applied) |  |  |
| 96 | message | merge {tickedB} duplicate{tickedB === 1 ? "" : "s"} into the row kept and delete {tickedB === 1 ? "it" : "them"} |  |  |
| 99 | message | Apply the clean-up? |  |  |
| 100 | message | This will {parts.join(", and ")}.{tickedB ? " A deleted row cannot be rest} |  |  |
| 100 | message | A deleted row cannot be restored; its notes are kept on the row it merged into. |  |  |
| 101 | message | Apply {ticked.size} |  |  |
| 114 | message | {total.applied.length} were applied before it stopped. |  |  |
| 115 | message | Some of those rows are at Screening or later; nothing in that batch was applied. |  |  |
| 115 | message | The clean-up failed. |  |  |
| 132 | heading | Clean-up · dry run |  |  |
| 133 | button | Close |  |  |
| 136 | text | Nothing has changed. Tick what to apply; everything else stays exactly as it is. Rows at Screening or later are never touched. |  |  |
| 141 | text | Applied |  |  |
| 141 | text | Skipped {result.skipped.length}: {[...new Set(result.skipped.map((s) => s.}. |  |  |
| 142 | text | Check {result.warnings.length}: {[...new Set(result.warnings.map((s) => s}. |  |  |
| 145 | label | Reading your tracker | Reading your applications list | N6 |
| 150 | heading | Close finished cadences |  |  |
| 164 | button | Untick all |  |  |
| 164 | button | Tick all |  |  |
| 169 | text | Applied more than |  |  |
| 169 | text | days ago, and the follow-up date has passed. Ticked: the follow-up date is cleared and the notes say “cadence closed |  |  |
| 169 | text | ”. The status stays Applied. |  |  |
| 178 | text | applied |  |  |
| 178 | text | days) · follow-up |  |  |
| 185 | heading | Duplicates |  |  |
| 187 | text | The same company and role. Ticked: its notes are joined into the row kept, which takes the most advanced status and the earliest applied date, and the duplicate is deleted. |  |  |
| 192 | text | Keep |  |  |
| 198 | text | Merge by hand: |  |  |
| 202 | text | Merge and delete |  |  |
| 207 | text | · the kept row becomes {statusLabel(d.newKeepStatus)} |  |  |
| 208 | text | · its date becomes {formatDate(d.newKeepDate)} |  |  |
| 218 | heading | Report only |  |  |
| 219 | tooltip / title | Ready to submit for more than 3 days |  |  |
| 219 | note | Ready to submit for over {READY_STALE_DAYS} days: submit them this week, or withdraw them. |  |  |
| 220 | tooltip / title | Generic roles |  |  |
| 220 | note | “Cold email…” and “Speculative…” rows: no role to search for. |  |  |
| 221 | tooltip / title | Role not shown |  |  |
| 221 | note | Fill the role in from the portal, or leave it as unknown. |  |  |
| 226 | button | Applying… |  |  |
| 226 | button | Apply {ticked.size} ticked |  |  |
| 226 | button | Tick rows to apply |  |  |
| 228 | button | Close without changes |  |  |

### app/applications/ClosedSection.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 56 | screen-reader label | Lesson from {row.company_name} |  |  |
| 108 | text | Closed after |  |  |
| 108 | text | · {asking} with new activity |  |  |
| 110 | text | Nothing closed yet. A row you move to Closed stays here, with how far it got. | Nothing closed yet. An application you move to Closed stays here, with how far it got. | N6 |
| 122 | label | Actions for {row.company_name} |  |  |
| 122 | items | Reopen |  |  |
| 129 | button | Reopen |  |  |
| 130 | button | Not true / dismiss |  |  |

### app/applications/CompanyRulesBlock.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 38 | message | Could not save that rule. |  |  |
| 41 | message | Connection error. The rule was not saved. |  |  |
| 57 | text | Reapply rules need migration 20261110120000_safe_notes_cooldowns_deadlines.sql in the Supabase SQL editor. |  |  |
| 72 | message | Could not save that rule. |  |  |
| 85 | message | Could not change that rule. |  |  |
| 91 | text | Reapply rules for |  |  |
| 98 | text | Your notes say: “ |  |  |
| 98 | text | ” |  |  |
| 103 | text | No new applications until (check the email) |  |  |
| 114 | button | Saving… |  |  |
| 114 | button | Save: wait {d.value} days |  |  |
| 114 | button | Save: not {role \|\| "this role"} again |  |  |
| 114 | button | this role |  |  |
| 114 | button | Save this rule |  |  |
| 128 | text | (switched off) |  |  |
| 128 | text | (ended) |  |  |
| 130 | text | “ |  |  |
| 130 | text | ” |  |  |
| 132 | button | Switch on |  |  |
| 132 | button | Switch off |  |  |
| 141 | button | Add a reapply rule |  |  |
| 152 | screen-reader label | Kind of rule |  |  |
| 156 | placeholder | Days, e.g. 365 |  |  |
| 156 | screen-reader label | Days to wait |  |  |
| 158 | screen-reader label | No new applications until |  |  |
| 159 | placeholder | The role |  |  |
| 159 | screen-reader label | The role |  |  |
| 160 | placeholder | What they said, e.g. wait at least one year |  |  |
| 160 | screen-reader label | What they said |  |  |
| 161 | button | Saving… |  |  |
| 161 | button | Save rule |  |  |
| 162 | button | Cancel |  |  |

### app/applications/DeadlineRadar.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 29 | heading | Due in the next |  |  |
| 29 | heading | hours |  |  |
| 34 | message | {item.company_name}: {item.action} |  |  |
| 41 | button | Open |  |  |
| 45 | button | Saving… |  |  |
| 45 | button | Done |  |  |
| 78 | message | Enter a real date and time. |  |  |
| 94 | message | Deadline cleared. |  |  |
| 100 | text | Next deadline |  |  |
| 103 | text | Date |  |  |
| 107 | text | Time (UK) |  |  |
| 111 | text | What is due |  |  |
| 118 | placeholder | Complete the {row.company_name} assessment |  |  |
| 123 | text | Applied from (email address) |  |  |
| 124 | placeholder | The inbox the application used |  |  |
| 129 | button | Saving… |  |  |
| 129 | button | Save |  |  |
| 133 | button | Clear deadline |  |  |
| 142 | text | A date with no time is due at 23:59. It shows in the red strip from 48 hours before. |  |  |

### app/applications/NextStepCell.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 18 | text | Due soon: |  |  |
| 19 | text | No date yet |  |  |
| 25 | text | Deadline |  |  |

### app/applications/NotesHistory.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 28 | message | Could not load the earlier versions. |  |  |
| 33 | message | Connection error. Try again. |  |  |
| 49 | text | Restore previous notes |  |  |
| 50 | text | Loading earlier versions… |  |  |
| 55 | button | Try again |  |  |
| 63 | text | Every earlier version, newest first. |  |  |
| 65 | text | The changes that took text out of these notes, newest first. |  |  |
| 67 | text | No change has taken text out of these notes: every earlier version is still inside them. |  |  |
| 68 | text | No earlier versions yet. Every change from now on is kept here. |  |  |
| 73 | button | Show every version ( |  |  |
| 86 | text | Before |  |  |
| 88 | text | (kept whole by the next change) |  |  |
| 90 | text | characters) |  |  |
| 95 | button | Restore this version |  |  |

### app/applications/ReferralAsks.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 52 | field label | A referral is in play |  |  |
| 57 | text | Who is referring you |  |  |
| 61 | text | Req ID |  |  |
| 65 | text | Status |  |  |
| 78 | button | Saving… |  |  |
| 78 | button | Save referral |  |  |

### app/applications/RowFlags.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 39 | tooltip / title | {loggedBy} through the API, not by you on this page |  |  |
| 53 | text | : {check.reasons[0].replace(/\s*\(.*$/, "")} |  |  |
| 57 | text | Not checked |  |  |
| 60 | screen-reader label | Run check on {row.company_name} |  |  |
| 61 | button | Checking… |  |  |
| 61 | button | Run check |  |  |
| 65 | screen-reader label | Add a job description to check {row.company_name} |  |  |
| 66 | button | Add JD to check | Add a job description to check | N2 |

### app/applications/SentCvBlock.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 26 | label | Word |  |  |
| 26 | label | Text |  |  |
| 71 | message | Upload a PDF, Word (.docx) or .txt file. |  |  |
| 93 | message | Could not upload that file. Try again. |  |  |
| 99 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 116 | message | Could not download that file. Try again. |  |  |
| 121 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 135 | message | Could not remove that file. Try again. |  |  |
| 141 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 168 | text | CV you sent |  |  |
| 168 | text | Cover letter you sent |  |  |
| 178 | text | uploaded {uploadedOn(sentCv.uploadedAt)} |  |  |
| 186 | text | Remove this file? |  |  |
| 188 | button | Removing… |  |  |
| 188 | button | Remove |  |  |
| 191 | button | Keep |  |  |
| 197 | button | Downloading… |  |  |
| 197 | button | Download |  |  |
| 200 | button | Uploading… |  |  |
| 200 | button | Replace |  |  |
| 203 | button | Remove |  |  |
| 214 | text | Text read from the file |  |  |
| 221 | text | Sent a cover letter? |  |  |
| 223 | button | Uploading… |  |  |
| 223 | button | Upload the letter you sent |  |  |
| 225 | text | to keep it with this application. |  |  |
| 230 | text | Sent a different version? |  |  |
| 232 | button | Uploading… |  |  |
| 232 | button | Upload the file you sent |  |  |
| 234 | text | to keep it with this application. |  |  |
| 264 | text | Uploading your CV… |  |  |
| 265 | text | Reading its text and storing it privately. |  |  |
| 271 | button | Upload the CV you sent |  |  |
| 273 | text | or drag it here |  |  |
| 276 | text | The file you sent |  |  |
| 276 | text | to {company} |  |  |
| 276 | text | for this application |  |  |
| 276 | text | : PDF, Word (.docx) or .txt, up to 4MB. Kept privately with this application. |  |  |

### app/applications/StageTabs.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 43 | screen-reader label | Applications by stage |  |  |
| 65 | button | All |  |  |
| 65 | button | Wins |  |  |

### app/applications/WinsView.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 31 | text | Group |  |  |
| 32 | text | Reached screening |  |  |
| 33 | text | Rate |  |  |
| 40 | text | of |  |  |
| 41 | text | Too few | Not enough yet | N15 |
| 41 | text | {g.rate}% |  |  |
| 63 | text | % of the step before |  |  |
| 69 | tooltip / title | By source |  |  |
| 70 | tooltip / title | By CV style |  |  |
| 70 | note | Rows with no style recorded are counted here and never read as either style. | Applications with no style recorded are counted here and never read as either style. | N6 |
| 74 | heading | Reached next round ( |  |  |
| 76 | text | Nothing yet. Every application that reaches screening or further is listed here for good, whatever happens next. |  |  |
| 82 | text | Company |  |  |
| 83 | text | Role |  |  |
| 84 | text | Highest stage |  |  |
| 85 | text | Result |  |  |
| 86 | text | Source |  |  |
| 87 | text | CV style |  |  |
| 88 | text | Lesson |  |  |

### app/applications/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 7 | label | Applications |  |  |

### app/applications/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 240 | message | Too few to judge | Not enough results yet | N15 |
| 240 | message | No signal | No link found | PL |
| 240 | message | Weak signal | Weak link | PL |
| 240 | label | Signal | Clear link | PL |
| 242 | label | Ready |  |  |
| 243 | label | Borderline |  |  |
| 244 | label | Weak |  |  |
| 244 | message | under 50% |  |  |
| 247 | message | {Math.round(v * 100)}% |  |  |
| 258 | message | Your {s.topN} highest-scoring decided applications were all rejected. | Your {s.topN} highest-scoring applications with a result were all rejected. | N15 |
| 259 | message | Of your {s.topN} highest-scoring decided applications, {topProgressed} progressed. | Of your {s.topN} highest-scoring applications with a result, {topProgressed} progressed. | N15 |
| 262 | message | {s.points.length} scored application{s.points.length === 1 ? " has" : "s have} an outcome{s.auc === null ? ", all of one kind" : "}; a read needs {MIN_FOR_VERDICT} with both outcomes. | {n} scored application(s) have a result{, all of one kind}. We need {MIN_FOR_VERDICT}, with both kinds of result, before we can say. | N15 PL |
| 262 | message | , all of one kind |  |  |
| 264 | message | The score does not predict the outcome so far. Treat it as a checklist of the role's terms, not a forecast. | So far, a higher score has not meant a better result. Use the score as a checklist of the job's key words, not as a prediction. | PL |
| 266 | message | A weak relationship at best: higher scores progressed slightly more often. |  |  |
| 267 | message | Higher scores have progressed more often. |  |  |
| 273 | text | Pick one progressed and one rejected application at random: the progressed one has the higher score |  |  |
| 274 | text | of the time. 50% would be a coin flip. | of the time. 50% would mean the score tells you nothing. | ID |
| 278 | text | {topLine} |  |  |
| 280 | screen-reader label | Decided applications by search-visibility band: progressed against rejected |  |  |
| 282 | text | Progressed ( |  |  |
| 283 | text | Rejected ( |  |  |
| 295 | tooltip / title | {n} {o} with a {c.label.toLowerCase()} score |  |  |
| 307 | text | Mean score: rejected |  |  |
| 307 | text | across |  |  |
| 307 | text | ; progressed |  |  |
| 307 | text | across |  |  |
| 311 | text | decided application | application with a result | N15 |
| 311 | text | s have |  |  |
| 311 | text | no stored score and |  |  |
| 311 | text | not counted here. |  |  |
| 314 | text | scored application |  |  |
| 314 | text | s are |  |  |
| 314 | text | still open. |  |  |
| 317 | text | As a table |  |  |
| 321 | text | Company |  |  |
| 322 | text | Role |  |  |
| 323 | text | Score |  |  |
| 324 | text | Outcome |  |  |
| 348 | message | Junior / graduate titles |  |  |
| 348 | message | Mid-level titles |  |  |
| 348 | message | Senior titles |  |  |
| 370 | message | {Math.round(r * 100)}% |  |  |
| 374 | text | progress most |  |  |
| 377 | message | {LANE_LABEL[l.level].replace(" titles", "}: {l.rate === null ? `${l.decided} of ${MIN} ({l.applied} applied) |  |  |
| 377 | message | {l.decided} of {MIN_DECIDED} decided needed | {l.decided} of {MIN_DECIDED} results needed | N15 |
| 377 | message | {pct(l.rate)} of {l.decided} decided | {pct(l.rate)} of {l.decided} with a result | N15 |
| 379 | text | . Read off each row's title. | . Read off each application's title. | N6 |
| 390 | message | {Math.round(r * 100)}% |  |  |
| 397 | text | {best!.label} style progresses most |  |  |
| 397 | text | {best.label} style, so far |  |  |
| 397 | text | Format style: too few to judge | Format style: not enough results yet | N15 |
| 401 | message | {b.label}: {b.rate === null ? `${b.progressed + b.re} ({b.n} applied) |  |  |
| 401 | message | {b.progressed + b.rejected} of {MIN_DECIDED} decided needed | {b.progressed + b.rejected} of {MIN_DECIDED} results needed | N15 |
| 401 | message | {pct(b.rate)} of {b.progressed + b.rejected} decided | {pct(b.rate)} of {b.progressed + b.rejected} with a result | N15 |
| 403 | text | · {insights.styleNotRecorded} with no recorded style, not compared |  |  |
| 417 | text | {Math.round(insights.overallRate * 100)}% |  |  |
| 418 | text | Progressed past the screen | Reached screening or further | ID |
| 421 | text | {insights.decided} of the {MIN_DECIDED} decided applications the rate needs | {insights.decided} of the {MIN_DECIDED} results needed | N15 |
| 422 | text | {insights.progressed} of {insights.decided} decided | {insights.progressed} of {insights.decided} with a result | N15 |
| 427 | text | Still open | Still waiting | PL |
| 429 | text | rejected · |  |  |
| 429 | text | progressed |  |  |
| 430 | text | · {insights.readyToSubmit} ready to submit, not counted |  |  |
| 438 | text | With a search-visibility score |  |  |
| 441 | text | kept from the next tailored run you save | kept from the next tailored CV you save | N5 |
| 442 | text | {insights.gated > 0 ? `${insights.gated} }{unscored > 0 ? `; ${unscored} count in t} |  |  |
| 442 | text | {insights.gated} with an eligibility read |  |  |
| 442 | text | no eligibility reads yet |  |  |
| 442 | text | ; {unscored} count in the rate only |  |  |
| 448 | text | Without a job description |  |  |
| 448 | text | Added by hand, no CV file |  |  |
| 450 | text | {withoutJd} application{withoutJd === 1 ? " has" : "s have"} no job description |  |  |
| 450 | text | s have |  |  |
| 452 | text | {withoutCv} added by hand {withoutCv === 1 ? "has" : "have"} no CV file |  |  |
| 452 | text | . Nothing can be read from them — add them from the row's JD and CV cells. | . We cannot learn anything from them. Add the job description and the CV on each application. | N6 N2 |
| 476 | message | too few decided ({decided}) | not enough results yet ({decided}) | N15 |
| 477 | message | {Math.round(b.rate * 100)}% progressed ({b.progressed} of {decided}) |  |  |
| 482 | text | application |  |  |
| 502 | message | Company name |  |  |
| 503 | label | Role |  |  |
| 504 | label | Salary |  |  |
| 505 | message | Date applied |  |  |
| 506 | message | Follow-up date |  |  |
| 514 | message | Company Name |  |  |
| 515 | label | Role |  |  |
| 518 | label | Gate |  |  |
| 519 | label | Status |  |  |
| 520 | label | Salary |  |  |
| 521 | message | Applied on |  |  |
| 522 | label | Follow-up |  |  |
| 523 | label | Notes |  |  |
| 578 | message | Any time |  |  |
| 579 | label | Today |  |  |
| 580 | message | This week |  |  |
| 581 | message | This month |  |  |
| 618 | message | Connection error. Please try again. |  |  |
| 622 | message | Your session has expired — sign in again to see your applications. |  |  |
| 637 | message | Could not load your applications. |  |  |
| 655 | message | Company name is required. |  |  |
| 656 | message | Role is required. |  |  |
| 658 | message | Enter the date applied. |  |  |
| 660 | message | Follow-up date can't be earlier than the date applied. |  |  |
| 856 | label | Applied |  |  |
| 962 | message | Couldn't load your next steps, so stages show the stored status. | Couldn't load your next steps, so each application shows its saved status. | PL |
| 970 | message | Couldn't load your next steps, so stages show the stored status. | Couldn't load your next steps, so each application shows its saved status. | PL |
| 1245 | message | Could not save that change. |  |  |
| 1260 | message | Application not found |  |  |
| 1271 | message | This application changed since this page loaded, so nothing was saved. Its row now shows where it stands. | This application changed after this page loaded, so nothing was saved. The list now shows where it stands. | PL |
| 1279 | message | Could not save that change. |  |  |
| 1305 | message | Follow-up cleared — the date is kept in the notes. |  |  |
| 1323 | message | Reapply rule saved for {previous.company_name}. JD triage now checks it before any credit. | Reapply rule saved for {previous.company_name}. The job check now uses it before you tailor. | N13 N3 |
| 1369 | message | {row.company_name}: {message} |  |  |
| 1375 | message | Moved {notSubmitted.length} row{notSubmitted.length === 1 ? "" : "s"} to Ready to submit. | Moved {notSubmitted.length} application{notSubmitted.length === 1 ? "" : "s"} to Ready to submit. | N6 |
| 1396 | message | Company name is required. |  |  |
| 1397 | message | Role is required. |  |  |
| 1398 | message | Enter the date applied. |  |  |
| 1402 | message | Follow-up date can't be earlier than the date applied. |  |  |
| 1481 | message | Moved to Closed |  |  |
| 1488 | message | Could not undo that. |  |  |
| 1508 | message | {row.company_name} is back at {STATUS_LABELS[stage]}. |  |  |
| 1516 | message | {row.company_name} is back at {STATUS_LABELS[stage]}. |  |  |
| 1525 | message | Remove {STATUS_LABELS[stage]} from {row.company_name}? |  |  |
| 1526 | message | Only if it never got that far and you picked it by mistake. It comes off this row's record and any count that relied on it, and the row's notes will say: "{note}". | Only if it never got that far and you picked it by mistake. It comes off this application's record and any count that used it. The application's notes will say: "{note}". | N6 SS |
| 1527 | message | Remove stage |  |  |
| 1538 | message | Could not remove that stage. |  |  |
| 1546 | message | {STATUS_LABELS[stage]} removed from {row.company_name}. Its notes say so. |  |  |
| 1561 | message | Could not save that. Try again. |  |  |
| 1580 | message | Move {row.company_name} back to {STATUS_LABELS[status]}? |  |  |
| 1581 | message | It reached {furthest ? HIGHEST_STAGE_LABELS[furthest}, and that stays on its record and in your count. This only changes where it stands now. To end the application, use Move to Closed. |  |  |
| 1582 | message | Move it back |  |  |
| 1642 | message | Could not load this application. |  |  |
| 1663 | message | Could not load that CV. |  |  |
| 1676 | message | CV saved with this application. |  |  |
| 1676 | message | CV file removed. |  |  |
| 1682 | message | Cover letter saved with this application. |  |  |
| 1682 | message | Cover letter file removed. |  |  |
| 1693 | message | Could not check that application. |  |  |
| 1728 | message | Notes are too long (max {MAX_NOTES} characters). |  |  |
| 1740 | message | These notes changed since you opened them, and they could not be read again. Nothing was saved; try again. |  |  |
| 1747 | message | These notes changed again while saving. Nothing was saved; try again. |  |  |
| 1784 | message | Restore the notes from before {label}? |  |  |
| 1785 | message | {unsaved ? "Your unsaved changes in the b}The notes as they are now are kept under Restore previous notes, so this can be undone the same way. |  |  |
| 1785 | message | Your unsaved changes in the box will be replaced too. |  |  |
| 1786 | label | Restore |  |  |
| 1791 | message | Notes restored from before {label}. |  |  |
| 1861 | message | Done: {item.action} (was due {item.when.split(" · ")[0]}) |  |  |
| 1874 | message | Done: {item.company_name}. The deadline is cleared and the notes say so. |  |  |
| 1874 | message | Done: {item.company_name}. The deadline is cleared; the notes are full, so no line was added. |  |  |
| 1884 | message | Reply recorded. |  |  |
| 1884 | message | Recorded: they wrote. It shows as Reply owed after a day without your reply. | Recorded: they wrote. It shows “You need to reply” after a day without your reply. | ID |
| 1892 | message | Referral: {REFERRAL_STATUS_LABELS[status].toLowerCa}. |  |  |
| 1898 | message | Referral saved. |  |  |
| 1898 | message | Referral removed. |  |  |
| 1923 | message | Could not export your applications. |  |  |
| 1930 | message | Connection error. Please try again. |  |  |
| 1978 | message | Could not save that application. |  |  |
| 1986 | message | Application added. |  |  |
| 2018 | message | Could not delete that application. |  |  |
| 2057 | text | characters — the sheet and insights work best with the job title alone; put the rest in Notes. | characters. Applications works best with the job title alone; put the rest in Notes. | N6 |
| 2071 | tooltip / title | Follow-up due — click to edit |  |  |
| 2071 | tooltip / title | Click to edit |  |  |
| 2072 | screen-reader label | {CELL_LABELS[field]}: empty, click to edit |  |  |
| 2085 | text | Edit |  |  |
| 2086 | button | Close |  |  |
| 2089 | text | Salary |  |  |
| 2090 | text | Applied on |  |  |
| 2091 | text | Follow-up |  |  |
| 2094 | text | CV style |  |  |
| 2098 | screen-reader label | Format style of the CV sent to {row.company_name} |  |  |
| 2104 | text | Eligibility read | Free check's advice | PL |
| 2111 | message | Deadline saved for {row.company_name}. |  |  |
| 2111 | message | Saved for {row.company_name}. |  |  |
| 2117 | field label | Rejection reason |  |  |
| 2121 | placeholder | Optional |  |  |
| 2141 | button | Copied |  |  |
| 2141 | button | Ask for feedback |  |  |
| 2156 | message | Could not save that change. |  |  |
| 2158 | message | Connection error. Your change was not saved. |  |  |
| 2167 | message | Done: {event.title}. |  |  |
| 2178 | message | Snoozed on the Action Centre for a day. The deadline itself has not moved. | Hidden on To do for a day. The deadline itself has not moved. | ID N14 |
| 2188 | message | Mark {row.company_name} as submitted? |  |  |
| 2189 | message | It moves to Applied, dated today. Do this once you have actually sent it. |  |  |
| 2190 | message | Mark as submitted |  |  |
| 2199 | message | {row.company_name} moved to Applied. |  |  |
| 2210 | message | Delete {row.company_name}? |  |  |
| 2211 | message | This removes the row, its events and any CV file kept with it. It can't be undone. | This removes the application, its events and any CV file kept with it. It can't be undone. | N6 |
| 2212 | label | Delete |  |  |
| 2226 | message | Edit date/time |  |  |
| 2227 | message | Add date/time |  |  |
| 2230 | message | Mark done |  |  |
| 2231 | message | Snooze 1 day | Hide for 1 day | ID BT |
| 2231 | message | Due within 24 hours, so it stays on your list. |  |  |
| 2233 | message | Edit row | Edit application | N6 |
| 2237 | message | Move to Closed |  |  |
| 2239 | message | Update status to {STATUS_LABELS[toMatch]} |  |  |
| 2242 | message | Update status |  |  |
| 2253 | message | View CV |  |  |
| 2253 | message | Add CV |  |  |
| 2254 | message | View JD | View job description | N2 |
| 2254 | message | Add JD | Add job description | N2 |
| 2255 | message | Add notes |  |  |
| 2256 | message | Prep pack ✓ | Interview pack ✓ | N16 |
| 2256 | message | Prep pack | Interview pack | N16 |
| 2257 | message | Mock interview |  |  |
| 2258 | message | Run JD check | Check this job | N2 BT |
| 2259 | message | Mark {REFERRAL_STATUS_LABELS[referralNext].toL} |  |  |
| 2261 | label | Delete |  |  |
| 2286 | screen-reader label | CV sent to {row.company_name} |  |  |
| 2290 | button | Loading… |  |  |
| 2290 | button | CV |  |  |
| 2294 | screen-reader label | Letter sent to {row.company_name} |  |  |
| 2295 | button | Letter |  |  |
| 2315 | message | Follow-up {formatDate(row.followup_date)} |  |  |
| 2316 | message | Referral: {nextReferralAction(row)} |  |  |
| 2317 | message | To {row.contact_email} |  |  |
| 2318 | message | Last contact {formatDate(row.last_contact_at.slice(0, } |  |  |
| 2319 | message | referred by {row.referrer_name} |  |  |
| 2341 | tooltip / title | They wrote on {formatDate(row.last_contact_at?.slice(0,} and no reply is recorded since. |  |  |
| 2341 | text | Reply owed | You need to reply | ID |
| 2342 | screen-reader label | I replied to {row.company_name} |  |  |
| 2342 | button | I replied |  |  |
| 2356 | screen-reader label | Status for {row.company_name}, shown as {STAGE_LABELS[stage]} |  |  |
| 2367 | button | Add next step |  |  |
| 2372 | screen-reader label | Prep for {row.company_name} |  |  |
| 2372 | text | Prep |  |  |
| 2374 | text | Open test |  |  |
| 2374 | text | Add test link |  |  |
| 2375 | text | Record |  |  |
| 2375 | text | Add video link |  |  |
| 2376 | button | Submit |  |  |
| 2377 | label | Actions for {row.company_name} |  |  |
| 2387 | button | Reopen |  |  |
| 2389 | button | Move back |  |  |
| 2391 | button | Move to Closed |  |  |
| 2393 | button | Not true / dismiss |  |  |
| 2422 | text | Tailored CV{row.cv_reference ? ` · ${row.cv_referenc} |  |  |
| 2422 | text | · {row.cv_reference} |  |  |
| 2422 | text | CV you sent |  |  |
| 2424 | button | Close |  |  |
| 2465 | button | Try again |  |  |
| 2470 | text | Loading the CV… |  |  |
| 2474 | text | No CV snapshot is stored for this application — it was saved before CV snapshots existed. | No copy of the CV is saved for this application. It was saved before Jobhuntz kept copies. | PL |
| 2492 | text | Format style: |  |  |
| 2493 | text | · format check at save: {sum.pass} of {sum.pass + sum.fail} rules kept{sum.fail > 0 ? ` (${check!.filter((i) =>} |  |  |
| 2493 | text | ({check!.filter((i) => i.status === "fail"}) |  |  |
| 2507 | text | Recruiter search visibility · saved CV |  |  |
| 2511 | text | of the role's terms |  |  |
| 2517 | text | required skills |  |  |
| 2522 | text | How likely a recruiter searching their pipeline for this role's terms is to surface your CV. Scored from this saved document when you clicked Applied. |  |  |
| 2539 | text | Cover letter · as sent |  |  |
| 2558 | text | Job description |  |  |
| 2562 | button | Checking… |  |  |
| 2562 | button | Check again |  |  |
| 2562 | button | Run check |  |  |
| 2575 | button | Edit |  |  |
| 2578 | button | Close |  |  |
| 2586 | placeholder | Paste the job posting — you'll want it for interview prep weeks from now. | Paste the job description. You will want it for interview prep weeks from now. | N2 SS |
| 2589 | screen-reader label | Job description |  |  |
| 2596 | button | Saving… |  |  |
| 2596 | button | Save |  |  |
| 2603 | button | Cancel |  |  |
| 2612 | button | Try again |  |  |
| 2637 | text | Notes |  |  |
| 2638 | button | Close |  |  |
| 2648 | placeholder | Recruiter name, referral, what you emphasised, next steps… |  |  |
| 2648 | placeholder | Loading your notes… |  |  |
| 2651 | screen-reader label | Notes |  |  |
| 2660 | button | Try again |  |  |
| 2665 | text | These notes changed since you opened them, so nothing was saved. Your text is still in the box. The notes as saved now: |  |  |
| 2666 | text | (empty) |  |  |
| 2677 | button | Use the saved notes |  |  |
| 2680 | button | Save mine over them |  |  |
| 2683 | text | Saving yours over them keeps the notes as saved now under Restore previous notes. |  |  |
| 2688 | button | Saving… |  |  |
| 2688 | button | Save |  |  |
| 2690 | button | Cancel |  |  |
| 2697 | text | Last contact: |  |  |
| 2699 | text | {row.last_contact_from === "them" ? "they} on {formatDate(row.last_contact_at.slice(0, } |  |  |
| 2699 | text | they wrote |  |  |
| 2699 | text | you replied |  |  |
| 2700 | text | not recorded |  |  |
| 2703 | button | They wrote |  |  |
| 2706 | button | I replied |  |  |
| 2720 | message | Rule switched off. |  |  |
| 2720 | message | Reapply rule saved for {rule.company_name}. JD triage checks it before any credit. | Reapply rule saved for {rule.company_name}. The job check uses it before you tailor. | N13 N3 |
| 2732 | title | Applications |  |  |
| 2733 | label | Loading your applications |  |  |
| 2751 | text | tracked · |  |  |
| 2751 | text | applied · |  |  |
| 2751 | text | in progress |  |  |
| 2755 | text | tracked · |  |  |
| 2755 | text | applied · |  |  |
| 2755 | text | in progress · |  |  |
| 2755 | text | rejected |  |  |
| 2769 | message | due in the next {DUE_WINDOW_HOURS} hours |  |  |
| 2769 | message | in {TAB_LABELS[tabNow]} |  |  |
| 2778 | title | Applications |  |  |
| 2783 | tooltip / title | Export these {visible.length} rows as a CSV | Export these {visible.length} applications as a CSV | N6 |
| 2784 | button | Exporting… |  |  |
| 2784 | button | Export |  |  |
| 2789 | button | Clean-up |  |  |
| 2792 | button | + Add application |  |  |
| 2803 | text | Sign in |  |  |
| 2817 | text | Saved from Tailor: |  |  |
| 2817 | text | Just saved: |  |  |
| 2817 | text | your application |  |  |
| 2818 | text | — {savedRow?.role \|\| justSaved.role} |  |  |
| 2821 | button | Open its CV |  |  |
| 2824 | button | Open its letter |  |  |
| 2826 | button | Dismiss |  |  |
| 2833 | button | Dismiss |  |  |
| 2841 | text | New activity on |  |  |
| 2842 | button | Show |  |  |
| 2852 | dueLabel | Due by {tomorrowName} night |  |  |
| 2896 | placeholder | Search company or role |  |  |
| 2897 | screen-reader label | Search applications by company, role or date applied |  |  |
| 2905 | screen-reader label | Clear search |  |  |
| 2908 | screen-reader label | Period applied in |  |  |
| 2921 | button | Filters |  |  |
| 2921 | button | ({activeFilters}) |  |  |
| 2924 | screen-reader label | Filters |  |  |
| 2927 | text | CV style |  |  |
| 2929 | choice | Any |  |  |
| 2935 | text | Sort by |  |  |
| 2937 | choice | Next step |  |  |
| 2938 | choice | Company |  |  |
| 2939 | choice | Last contact |  |  |
| 2940 | choice | Date applied |  |  |
| 2945 | field label | Include past stages |  |  |
| 2963 | text | Sign in |  |  |
| 2987 | text | One application's notes say it was not submitted, but its status is Applied. |  |  |
| 2987 | text | {notSubmitted.length} applications' notes say they were not submitted, but their status is Applied. |  |  |
| 2988 | button | Review |  |  |
| 2989 | button | Dismiss |  |  |
| 2993 | text | These rows would move to | These applications would move to | N6 |
| 2993 | text | Ready to submit |  |  |
| 2993 | text | (not counted as applications until you move them back): |  |  |
| 3004 | button | Moving… |  |  |
| 3004 | button | Move {notSubmitted.length} to Ready to submit |  |  |
| 3007 | button | Leave them |  |  |
| 3024 | title | No applications yet |  |  |
| 3027 | button | + Add row | + Add application | N6 |
| 3028 | button | Tailor a CV |  |  |
| 3032 | text | Tailor a CV and click |  |  |
| 3032 | text | Applied |  |  |
| 3032 | text | to track it here, or add a row for one you sent through another channel. | to save it here. You can also add an application you sent another way. | N6 ID |
| 3039 | label | Loading these applications |  |  |
| 3042 | text | Nothing live at this stage. | No open applications at this stage. | ID |
| 3049 | text | No applications |  |  |
| 3050 | text | {PERIODS.find((p) => p.key === periodFilt} |  |  |
| 3051 | text | in {TAB_LABELS[tabNow]} |  |  |
| 3052 | text | under {viewLabel} |  |  |
| 3053 | text | in the {ROW_STYLE_LABELS[styleFilter]} style |  |  |
| 3054 | text | matching “{searchTerm}” |  |  |
| 3062 | button | Clear filters |  |  |
| 3079 | text | Company |  |  |
| 3080 | text | Stage |  |  |
| 3081 | text | Next step |  |  |
| 3082 | text | Actions |  |  |
| 3116 | text | Actions |  |  |
| 3131 | placeholder | Company |  |  |
| 3133 | screen-reader label | Company name |  |  |
| 3143 | placeholder | Role |  |  |
| 3145 | screen-reader label | Role |  |  |
| 3156 | screen-reader label | Format style of the CV sent |  |  |
| 3157 | tooltip / title | The format style of the CV you sent |  |  |
| 3169 | text | after save |  |  |
| 3177 | screen-reader label | Status |  |  |
| 3191 | placeholder | Optional |  |  |
| 3193 | screen-reader label | Salary |  |  |
| 3204 | screen-reader label | Date applied |  |  |
| 3216 | screen-reader label | Follow-up date |  |  |
| 3220 | text | after save |  |  |
| 3223 | button | Saving… |  |  |
| 3223 | button | Save |  |  |
| 3226 | button | Cancel |  |  |
| 3242 | text | You already have |  |  |
| 3242 | text | ). Save anyway only if this is a different posting. | ). Save anyway only if this is a different job. | N2 |
| 3248 | text | characters is long for a role (over |  |  |
| 3248 | text | ) — the sheet and insights work best with the job title alone; put the rest in Notes. | ). Applications works best with the job title alone; put the rest in Notes. | N6 |
| 3276 | tooltip / title | They wrote on {formatDate(row.last_contact_at?.slice(0,} and no reply is recorded since. |  |  |
| 3278 | text | Reply owed | You need to reply | ID |
| 3284 | screen-reader label | I replied to {row.company_name} |  |  |
| 3287 | button | I replied |  |  |
| 3308 | button | Loading… |  |  |
| 3308 | button | View CV |  |  |
| 3308 | button | Add CV |  |  |
| 3323 | screen-reader label | Format style of the CV sent to {row.company_name} |  |  |
| 3324 | tooltip / title | The format style of the CV you sent |  |  |
| 3339 | button | View JD | View job description | N2 |
| 3339 | button | Add JD | Add job description | N2 |
| 3367 | screen-reader label | Status for {row.company_name} |  |  |
| 3383 | tooltip / title | {row.notes_preview}{row.notes_more ? "…" : ""} |  |  |
| 3385 | button | Notes… |  |  |
| 3385 | button | Add notes |  |  |
| 3391 | text | Delete? |  |  |
| 3398 | button | Deleting… |  |  |
| 3398 | button | Confirm |  |  |
| 3406 | button | Cancel |  |  |
| 3417 | screen-reader label | Interview prep for {row.company_name} |  |  |
| 3418 | tooltip / title | Open your prep pack | Open your interview pack | N16 |
| 3418 | tooltip / title | Prepare for the interview |  |  |
| 3420 | text | Prep ✓ |  |  |
| 3420 | text | Prep |  |  |
| 3425 | screen-reader label | Mock interview for {row.company_name} |  |  |
| 3426 | tooltip / title | Practise out loud with an AI interviewer |  |  |
| 3428 | text | Interview |  |  |
| 3434 | screen-reader label | Delete {row.company_name} |  |  |
| 3435 | tooltip / title | Delete |  |  |
| 3454 | screen-reader label | Pages of applications |  |  |
| 3456 | button | ← Previous |  |  |
| 3459 | text | Page |  |  |
| 3459 | text | of |  |  |
| 3459 | text | rows a page | applications a page | N6 |
| 3462 | button | Next → |  |  |
| 3486 | text | Showing {sheet.from}–{sheet.to} of {visible.length} {viewLabel} |  |  |
| 3486 | text | Showing {visible.length} of {Math.max(viewTotal, visible.length)} {viewLabel} |  |  |
| 3487 | text | · loading the rest |  |  |
| 3490 | text | rejected · |  |  |
| 3490 | text | withdrawn · |  |  |
| 3490 | text | ghosted | no reply | GH |
| 3494 | text | more stored as | more with the status | PL |
| 3494 | text | under Assessment: a test is open. | shown under Assessment, because a test is waiting. | PL |
| 3499 | screen-reader label | Pages of applications |  |  |
| 3500 | button | ← Previous |  |  |
| 3501 | text | Page |  |  |
| 3501 | text | of |  |  |
| 3502 | button | Next → |  |  |
| 3515 | button | ← Back to the list |  |  |
| 3515 | button | Open as spreadsheet → | Open as a table → | PL |
| 3525 | text | What's working | Insights | N15 |
| 3532 | button | Hide |  |  |
| 3532 | button | Show breakdown | Show details | PL |
| 3538 | tooltip / title | By search visibility of the saved CV |  |  |
| 3539 | tooltip / title | By required-skill coverage |  |  |
| 3540 | tooltip / title | By eligibility read at the pre-check | By the free check's advice | N8 PL |
| 3541 | tooltip / title | By role seniority |  |  |
| 3542 | tooltip / title | By role |  |  |
| 3543 | tooltip / title | By company |  |  |
| 3544 | tooltip / title | By how the row was made | By how the application was added | N6 |
| 3545 | tooltip / title | By follow-up date |  |  |
| 3546 | tooltip / title | By page count of the CV sent |  |  |
| 3547 | tooltip / title | By posting age when you applied | By the age of the job advert when you applied | N2 |
| 3548 | tooltip / title | By format style |  |  |
| 3551 | text | Score and eligibility bands appear once applications saved from a tailored run have outcomes. | Score and eligibility groups appear when applications saved from Tailor have a result. | N5 N15 |
| 3562 | text | Does the score predict the outcome? | Do higher scores get further? | PL |
| 3605 | button | Undo |  |  |
| 3608 | screen-reader label | Dismiss |  |  |

### app/auth/error/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 5 | message | You cancelled the login or the app doesn't have permission from the provider. |  |  |
| 6 | message | The login link was incomplete or has already been used. |  |  |
| 11 | message | That sign-in link has expired or was already used. Please try signing in again. |  |  |
| 24 | message | Something went wrong signing you in. Please try again. |  |  |
| 25 | message | Something went wrong during sign-in. Please try again. |  |  |
| 33 | text | Sign-in error |  |  |
| 34 | heading | We couldn't sign you in |  |  |
| 37 | button | Back to sign in |  |  |
| 42 | text | If this keeps happening, make sure you're using the right account. |  |  |

### app/auth/login/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 18 | message | Incorrect email or password. |  |  |
| 21 | message | An account with this email already exists — try signing in instead. |  |  |
| 23 | message | Password is too weak. Use at least 8 characters with a mix of letters and numbers. |  |  |
| 25 | message | Please confirm your email address before signing in. |  |  |
| 27 | message | New sign-ups are temporarily disabled. Please try again later. |  |  |
| 30 | message | Too many attempts. Please wait a minute and try again. |  |  |
| 32 | message | Please enter a valid email address. |  |  |
| 34 | message | Something went wrong. Please try again. |  |  |
| 63 | message | Enter your email address above first, then choose "Forgot password?". |  |  |
| 97 | message | Enter your email and password. |  |  |
| 161 | message | Could not sign in with {provider === 'google' ? 'Google' : 'GitH}. Please try email instead. |  |  |
| 173 | text | Password reset |  |  |
| 174 | heading | Check your inbox |  |  |
| 176 | text | If an account exists for |  |  |
| 176 | text | , we've sent a link to choose a new password. It expires after a short while, so use it soon. |  |  |
| 184 | button | Back to sign in |  |  |
| 197 | text | Almost there | One more step | ID |
| 198 | heading | Check your inbox |  |  |
| 200 | text | We sent a confirmation link to |  |  |
| 200 | text | . Click it to activate your account and sign in. |  |  |
| 207 | button | Back to sign in |  |  |
| 219 | heading | Welcome back |  |  |
| 219 | heading | Create your account |  |  |
| 222 | text | Sign in to pick up your master CV and applications. | Sign in to open your CV and your applications. | N1 ID |
| 223 | text | Free to start — three tailored CVs on us, then bring your own key. | Free to start. You get 3 free tailored CVs in total. After that, add your own free API key and keep going at no cost. We show you how. | N3 N4 ID |
| 227 | screen-reader label | Sign in or create an account |  |  |
| 234 | button | Sign in |  |  |
| 242 | button | Create account |  |  |
| 248 | field label | Email |  |  |
| 254 | placeholder | you@example.com |  |  |
| 261 | field label | Password |  |  |
| 269 | button | Sending reset link… |  |  |
| 269 | button | Forgot password? |  |  |
| 280 | placeholder | At least 8 characters |  |  |
| 297 | button | Signing in… |  |  |
| 297 | button | Creating account… |  |  |
| 298 | button | Sign in |  |  |
| 298 | button | Create account |  |  |
| 305 | text | or continue with |  |  |
| 316 | button | Redirecting… |  |  |
| 316 | button | Google |  |  |
| 324 | button | Redirecting… |  |  |
| 324 | button | GitHub |  |  |
| 329 | text | By continuing you agree to the |  |  |
| 329 | text | terms of use |  |  |
| 329 | text | and the |  |  |
| 330 | text | privacy notice |  |  |

### app/auth/update-password/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 41 | message | Use at least {MIN_PASSWORD} characters. |  |  |
| 45 | message | Those two passwords don't match. |  |  |
| 56 | message | That is already your password — choose a different one. |  |  |
| 58 | message | Password is too weak. Use at least 8 characters with a mix of letters and numbers. |  |  |
| 59 | message | Could not update your password. Please try again. |  |  |
| 72 | text | Link expired |  |  |
| 73 | heading | This reset link no longer works |  |  |
| 75 | text | Recovery links are single-use and expire after a short while. Request a new one from the sign-in page. |  |  |
| 78 | button | Back to sign in |  |  |
| 89 | text | Password updated |  |  |
| 90 | heading | You're all set |  |  |
| 91 | text | Your new password is saved. Taking you to the app… |  |  |
| 92 | button | Open the app |  |  |
| 102 | text | Password reset |  |  |
| 103 | heading | Choose a new password |  |  |
| 104 | text | At least |  |  |
| 104 | text | characters. You'll stay signed in on this device. |  |  |
| 108 | field label | New password |  |  |
| 114 | placeholder | At least {MIN_PASSWORD} characters |  |  |
| 121 | field label | Confirm new password |  |  |
| 141 | button | Saving… |  |  |
| 141 | button | Save new password |  |  |

### app/customize/ProjectPoolEditor.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 34 | text | New project |  |  |
| 37 | text | Project name |  |  |
| 42 | field label | Always include |  |  |
| 47 | text | Start |  |  |
| 48 | placeholder | Jan 2025 |  |  |
| 51 | text | End |  |  |
| 52 | placeholder | Ongoing |  |  |
| 52 | placeholder | Sep 2026 |  |  |
| 56 | field label | Ongoing |  |  |
| 59 | text | Add dates to sort by date. |  |  |
| 61 | text | Tech |  |  |
| 65 | placeholder | React, Node.js, PostgreSQL |  |  |
| 72 | text | Label (optional) |  |  |
| 73 | placeholder | Personal portfolio project modelled on a real-world brief |  |  |
| 74 | text | Printed on your CV every time, exactly as written. |  |  |
| 77 | text | What you did, in your own words |  |  |
| 80 | text | Links: {links} |  |  |
| 80 | text | No links yet. |  |  |
| 80 | text | Change them under Project links. |  |  |
| 81 | text | Link lines from your text: |  |  |
| 83 | button | Remove this project |  |  |
| 127 | message | That removes every project. To remove the pool, use Remove pool. | That removes every project. To remove the project list, use Remove project list. | N11 |
| 131 | message | Give each project a name, or remove it. |  |  |
| 142 | message | That is too long ({size.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()} characters). |  |  |
| 152 | text | Projects on the CV |  |  |
| 164 | button | Auto ({autoCount}) |  |  |
| 170 | text | Order |  |  |
| 182 | button | Most relevant first |  |  |
| 182 | button | Newest first |  |  |
| 189 | text | These apply once your projects are saved as cards below. You can change them for one run on the tailoring page. | These apply once your projects are saved as cards below. You can change them for one CV on the Tailor page. | N5 |
| 193 | text | We found |  |  |
| 193 | text | , check them. Your text stays in use until you confirm. |  |  |
| 194 | button | Keep the text box for now |  |  |
| 199 | text | These lines did not belong to a project, so they are not on a card: |  |  |
| 204 | text | We can read this into |  |  |
| 205 | button | Check them |  |  |
| 227 | button | Saving… |  |  |
| 227 | button | Save projects |  |  |
| 227 | button | Confirm {shown.length} {shown.length === 1 ? "project" : "projec} |  |  |
| 230 | button | Add a project |  |  |
| 232 | button | Discard changes |  |  |
| 238 | button | Hide your original text |  |  |
| 238 | button | Show your original text |  |  |

### app/customize/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 7 | label | Customise | My CV | N7 |

### app/customize/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 72 | message | We couldn't read your saved settings, so this wasn't saved. Reload the page and try again. |  |  |
| 172 | message | Your CV |  |  |
| 174 | message | Master CV | Main CV | N1 |
| 175 | message | Your details |  |  |
| 179 | label | Tailoring |  |  |
| 181 | label | Eligibility |  |  |
| 182 | message | Claims registry | Skill levels | N9 |
| 183 | label | Positioning | Headlines | N10 |
| 187 | label | Document |  |  |
| 189 | message | Section order |  |  |
| 190 | message | CV length |  |  |
| 191 | message | Right to Work |  |  |
| 192 | message | Project links |  |  |
| 193 | message | Project pool | Project list | N11 |
| 203 | message | LinkedIn link |  |  |
| 203 | message | GitHub link |  |  |
| 208 | message | your {CONTACT_FIX_LABELS[f.field] ?? f.field} as {f.to}{typeof f.from === "string" && f.from ? `} |  |  |
| 208 | message | (the CV showed '{f.from}') |  |  |
| 209 | message | Read {lines.join(", ")}. Check it is right. |  |  |
| 422 | message | Couldn't save. Check your connection and try again. |  |  |
| 429 | message | Saved — Right to Work will appear on the CV document. |  |  |
| 429 | message | Saved — Right to Work stays off the CV document. |  |  |
| 439 | message | Saved — every CV you tailor from now on uses the CareerSet style unless you switch it per run. | Saved. Every CV you tailor from now on uses the CareerSet style, unless you change it for one CV. | N5 SS |
| 440 | message | Saved — every CV you tailor from now on uses the UKJI style. |  |  |
| 448 | message | Saved — every CV you tailor from now on is fitted to one page. |  |  |
| 449 | message | Saved — every CV you tailor from now on is fitted to two pages. |  |  |
| 473 | message | Saved — these links appear under your projects on every CV you tailor from now on. |  |  |
| 680 | message | Couldn't save that change. Check your connection and try again. |  |  |
| 718 | message | Saved {cards.length} {cards.length === 1 ? "project" : "projec}. |  |  |
| 729 | message | Your cards are saved and tailoring uses them, but the pool's text didn't update. Save again when you're back online. | Your cards are saved and tailoring uses them, but the project list's text didn't update. Save again when you're back online. | N11 |
| 747 | message | Paste your projects first, or use Remove pool to switch this off. | Paste your projects first, or use Remove project list to switch this off. | N11 |
| 751 | message | Project pool is too long ({pool.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()} characters). | Project list is too long ({pool.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()} characters). | N11 |
| 758 | message | Pool removed. | Project list removed. | N11 |
| 772 | message | Pool removed. Tailoring uses the projects from your master CV again. | Project list removed. Tailoring uses the projects from your main CV again. | N11 N1 |
| 773 | message | Saved. Your projects below can now be checked as cards. |  |  |
| 777 | message | Couldn't save the pool. Check your connection and try again. | Couldn't save the project list. Check your connection and try again. | N11 |
| 810 | message | Couldn't save the CV. Check your connection and try again. |  |  |
| 822 | message | The CV was updated, but your details couldn't be stored. Reload and try again. |  |  |
| 827 | message | Removed {r.removed.length === 1 ? "one line" : `$} from your master CV. Forms, the letter and the document now use your Eligibility answer. | Removed {r.removed.length === 1 ? "one line" : `$} from your main CV. Forms, the letter and the document now use your Eligibility answer. | N1 |
| 827 | message | {r.removed.length} lines |  |  |
| 838 | text | Your CV and your Eligibility answer disagree |  |  |
| 840 | text | Your CV's right-to-work text reads as |  |  |
| 840 | text | , but Eligibility says |  |  |
| 840 | text | . Forms, the cover letter and the CV document are answered from Eligibility — fix whichever is wrong. |  |  |
| 848 | text | No line of your master CV reads as a right-to-work status; only the extracted details are cleared. | No line of your main CV looks like a right-to-work status. Only the details we read from it are cleared. | N1 N12 |
| 849 | text | Remove {rtwLinesToRemove.length === 1 ? "this li} from your saved master CV? | Remove {rtwLinesToRemove.length === 1 ? "this li} from your saved main CV? | N1 |
| 849 | text | this line |  |  |
| 849 | text | these {rtwLinesToRemove.length} lines |  |  |
| 859 | button | Removing… |  |  |
| 859 | button | Yes, remove |  |  |
| 861 | button | Keep it |  |  |
| 864 | button | Remove from master CV | Remove from main CV | N1 |
| 889 | message | Saved. The pre-check on the tailoring page now compares each job's eligibility conditions against these answers. | Saved. The free check on the Tailor page now compares each job's eligibility conditions against these answers. | N8 N5 |
| 894 | message | Couldn't save. Check your connection and try again. |  |  |
| 939 | message | Couldn't save that change. Check your connection and try again. |  |  |
| 960 | message | Levels confirmed. From now on a figure that isn't on your CV, or a learning skill in the output, blocks the download until you fix it. |  |  |
| 995 | message | Saved with no variants — tailoring uses your CV's own positioning. | Saved with no headlines. Tailoring uses your CV's own headline. | N10 |
| 996 | message | Saved {saved.length} variant{saved.length === 1 ? "" : "s"}{dropped ? ` (${dropped} without a name d}. The pre-check picks one by the posting's role type; you can override it per run. | Saved {n} headline(s){dropped}. The free check picks one by the kind of job. You can change it for one CV. | N10 N8 N5 |
| 996 | message | ({dropped} without a name dropped) | ({dropped} without a name removed) | PL |
| 1002 | message | Couldn't save. Check your connection and try again. |  |  |
| 1016 | message | Paste your CV before saving. |  |  |
| 1021 | message | Your CV is {draft.length.toLocaleString()} characters — the limit is {MAX_CV_CHARS.toLocaleString()}. Trim it, or keep just the sections that matter. |  |  |
| 1030 | message | Couldn't save your CV. Check your connection and try again. |  |  |
| 1054 | message | Your CV is saved, but your details couldn't be stored. Reload and try Edit → Save again. |  |  |
| 1058 | message | Your CV is saved, but reading your details out of it failed: {data.error} |  |  |
| 1059 | message | Your CV is saved, but your details couldn't be read out of it. Try Edit → Save again. |  |  |
| 1062 | message | Your CV is saved, but the server couldn't be reached to read your details. Try Edit → Save again. |  |  |
| 1131 | message | Extraction worked, but the result couldn't be stored. Try again. | We read your CV, but could not save the result. Try again. | N12 |
| 1136 | message | Re-running extraction failed: {data.error} | We could not read your CV: {data.error} | N12 |
| 1137 | message | Re-running extraction failed. Try again. | We could not read your CV. Try again. | N12 |
| 1141 | message | Couldn't reach the server to re-run extraction. Try again. | Couldn't reach the server to read your CV. Try again. | N12 |
| 1170 | message | Could not save. Please try again. |  |  |
| 1174 | message | Saved — you're back on the standard order. |  |  |
| 1175 | message | Saved. Every CV you tailor from now on uses this order. |  |  |
| 1179 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 1205 | title | Customise | My CV | N7 |
| 1206 | page tagline | Manage your master CV, your details, and how your tailored CV is laid out. | Your main CV, your details, and how each tailored CV looks. | N1 PL |
| 1210 | text | We couldn't read your saved settings. What you see may be out of date, and changes won't save until you reload the page. |  |  |
| 1215 | screen-reader label | Sections |  |  |
| 1239 | text | Master CV | Main CV | N1 |
| 1240 | label | Loading your CV |  |  |
| 1244 | label | Master CV | Main CV | N1 |
| 1246 | help text | Add your full CV once. It's saved to your account and reused for every job — you'll only need to paste the job description on the main page each time. | Add your full CV once. We save it in your account and use it for every job. After that you only paste the job description on the Tailor page. | SS N5 |
| 1258 | message | Text extracted from {meta.filename} ({meta.characters.toLocaleString()} characters). | Text read from {meta.filename} ({meta.characters.toLocaleString()} characters). | N12 |
| 1259 | message | Check it below before saving — PDFs and Word files can lose formatting, so fix any run-together |  |  |
| 1260 | message | lines or missing headings now. |  |  |
| 1265 | text | or paste it below |  |  |
| 1278 | placeholder | Paste your full CV here… |  |  |
| 1287 | button | Saving… |  |  |
| 1287 | button | Save master CV | Save my CV | N1 BT |
| 1290 | button | Cancel |  |  |
| 1297 | text | Master CV | Main CV | N1 |
| 1300 | text | ✓ Master CV saved | ✓ Main CV saved | N1 |
| 1302 | text | Last updated |  |  |
| 1308 | text | Delete your saved CV and extracted details? Your project pool is kept. | Delete your main CV and the details we read from it? Your project list is kept. | N1 N11 N12 |
| 1310 | button | Yes, replace |  |  |
| 1312 | button | Keep it |  |  |
| 1316 | button | Edit |  |  |
| 1317 | button | Replace |  |  |
| 1331 | text | Your details |  |  |
| 1331 | text | — extracting… | (reading your CV…) | N12 |
| 1335 | label | Loading your details |  |  |
| 1338 | text | Pulled from your CV. Check these are right — they appear in your tailored CV's header and sections. | We read these from your CV. Check that they are right. They appear at the top of every tailored CV. | ID SS |
| 1340 | field label | Name |  |  |
| 1342 | field label | Tagline |  |  |
| 1346 | text | This names |  |  |
| 1346 | text | roles ( |  |  |
| 1346 | text | ). A headline naming two roles halves the impact of both — keep one here, and put the other on a positioning variant below; the tailored CV's header is built from the variant, never from this line. | ). A headline with two job titles is weaker than a headline with one. Keep one here, and add the other under Headlines below. | N10 SS |
| 1351 | field label | Location |  |  |
| 1352 | field label | Phone |  |  |
| 1353 | field label | Email |  |  |
| 1354 | field label | LinkedIn |  |  |
| 1355 | field label | GitHub |  |  |
| 1356 | field label | Website |  |  |
| 1365 | text | Your CV's |  |  |
| 1365 | text | section seems to list |  |  |
| 1365 | text | entries, but |  |  |
| 1366 | text | extracted. Check the list below; if something is missing, re-run extraction. | were read. Check the list below. If something is missing, press Read my CV again. | N12 |
| 1376 | text | Also extracted from your CV | Also read from your CV | N12 |
| 1380 | text | Projects ( |  |  |
| 1391 | text | Education ( |  |  |
| 1401 | text | Certifications ( |  |  |
| 1407 | text | Extra sections |  |  |
| 1413 | text | This just shows what was read out of your CV — the wording itself is edited inline on the tailored CV preview. | This list shows what we read from your CV. To change the wording, edit the tailored CV preview. | PL |
| 1421 | text | Your CV is saved, but no details have been extracted from it yet — run the extraction below. | Your CV is saved, but we have not read your details from it yet. Press Read my CV again below. | N12 |
| 1426 | text | No details yet — add your master CV above and these will be extracted automatically. | No details yet. Add your main CV above and we read them from it automatically. | N1 N12 |
| 1433 | text | Re-running uses one AI call — continue? | We will read your CV again. This takes a few seconds. Continue? | N12 PL |
| 1435 | button | Yes, re-run | Yes, read it again | N12 |
| 1438 | button | Cancel |  |  |
| 1447 | button | Re-running extraction… | Reading your CV… | N12 |
| 1447 | button | Re-run extraction | Read my CV again | N12 BT |
| 1460 | title | Eligibility |  |  |
| 1466 | section summary | {eligAnswered} of {ELIGIBILITY_QUESTIONS} answered |  |  |
| 1467 | section summary | Not set — the pre-check can't warn you | Not set. The free check cannot warn you. | N8 SS |
| 1471 | text | The questions an application form asks before anyone reads your CV: right to work, clearance, years, location, degree and graduation date, licences, contract type. Answer once; the pre-check on the tailoring page then warns when a job has a condition you'd fail, before a tailor is spent. Nothing here is guessed from your CV — leave anything you're unsure of as "Not set". | These are the questions an application form asks before anyone reads your CV: right to work, clearance, years, location, degree and graduation date, licences, contract type. Answer once. The free check on the Tailor page then warns you when a job has a condition you do not meet, before you use a tailored CV. Nothing here is guessed from your CV. Leave anything you are unsure of as "Not set". | N8 N3 SS |
| 1477 | label | Loading your eligibility answers |  |  |
| 1487 | text | Your CV says: |  |  |
| 1493 | text | A time-limited visa needs its end month: without it the pre-check cannot tell whether a posting's start date falls inside your permission, and the statement for forms cannot say when sponsorship would be needed. | A time-limited visa needs its end month. Without it, the free check cannot tell if a job's start date is inside your permission, and the statement for forms cannot say when you would need sponsorship. | N8 N2 SS |
| 1499 | text | Is your right to work permanent? |  |  |
| 1501 | text | "Full right to work" means settled status, indefinite leave to remain or citizenship. On a Student, Graduate or Skilled Worker visa, choose "Time-limited visa" instead: postings that ask for permanent right to work are then flagged before a credit is spent, and the answer stays true when a form asks whether you will ever need sponsorship. | "Full right to work" means settled status, indefinite leave to remain or citizenship. On a Student, Graduate or Skilled Worker visa, choose "Time-limited visa". Jobs that ask for permanent right to work are then marked before you use a tailored CV. Your answer also stays true when a form asks if you will ever need sponsorship. | N2 N3 SS |
| 1519 | button | Mine is permanent |  |  |
| 1526 | field label | Right to work |  |  |
| 1535 | choice | Not set |  |  |
| 1536 | choice | Full right to work — permanent, no sponsorship ever needed |  |  |
| 1537 | choice | Time-limited visa — no sponsorship needed to start, will need it later |  |  |
| 1538 | choice | I need visa sponsorship |  |  |
| 1542 | field label | Countries you can work in |  |  |
| 1543 | placeholder | e.g. UK, Ireland |  |  |
| 1547 | field label | Current permission ends (month/year, optional) |  |  |
| 1559 | field label | Available to start |  |  |
| 1569 | choice | Not set |  |  |
| 1570 | choice | Immediately |  |  |
| 1571 | choice | From a month |  |  |
| 1576 | field label | Available from (month/year) |  |  |
| 1589 | field label | Can you work full time now? |  |  |
| 1599 | choice | Not set |  |  |
| 1600 | choice | Yes |  |  |
| 1601 | choice | No |  |  |
| 1605 | field label | Security clearance held |  |  |
| 1614 | choice | Not set |  |  |
| 1615 | choice | None |  |  |
| 1616 | choice | BPSS |  |  |
| 1617 | choice | CTC |  |  |
| 1618 | choice | SC |  |  |
| 1619 | choice | DV |  |  |
| 1623 | field label | Eligible to be cleared (e.g. 5 years UK residency) |  |  |
| 1629 | choice | Not set |  |  |
| 1630 | choice | Yes |  |  |
| 1631 | choice | No |  |  |
| 1635 | field label | Years of professional experience |  |  |
| 1642 | placeholder | Not set |  |  |
| 1646 | text | Set this. The pre-check's “this reads as mid-level” warning compares the posting with it, and a mid-level or senior read is held until it is set. | Set this. The free check compares each job's level with it. A mid-level or senior job is held until it is set. | N8 SS |
| 1658 | field label | I look for junior and early-career roles only |  |  |
| 1661 | text | The pre-check then holds every posting that reads as mid-level or senior, whatever your years say. | The free check then holds every job that looks mid-level or senior, whatever your years say. | N8 N2 |
| 1665 | field label | Base location(s) |  |  |
| 1666 | placeholder | e.g. London |  |  |
| 1669 | field label | On-site roles |  |  |
| 1671 | choice | Not set |  |  |
| 1672 | choice | Fine with me |  |  |
| 1673 | choice | Rather not |  |  |
| 1677 | field label | Hybrid roles |  |  |
| 1679 | choice | Not set |  |  |
| 1680 | choice | Fine with me |  |  |
| 1681 | choice | Rather not |  |  |
| 1685 | field label | Willing to relocate |  |  |
| 1687 | choice | Not set |  |  |
| 1688 | choice | Yes |  |  |
| 1689 | choice | No |  |  |
| 1693 | field label | Highest degree |  |  |
| 1699 | choice | Not set |  |  |
| 1700 | choice | No degree |  |  |
| 1701 | choice | Bachelor's |  |  |
| 1702 | choice | Master's |  |  |
| 1703 | choice | PhD |  |  |
| 1707 | field label | Degree classification |  |  |
| 1713 | choice | Not set |  |  |
| 1714 | choice | First |  |  |
| 1717 | choice | Other / not on the UK scale |  |  |
| 1723 | text | Your CV mentions |  |  |
| 1723 | text | but this says |  |  |
| 1723 | text | . Check whichever is wrong — nothing is changed for you. |  |  |
| 1729 | field label | Last degree completed (month and year) |  |  |
| 1741 | field label | Degree you're studying completes (if any) |  |  |
| 1759 | text | Graduate roles often screen on when you graduated. |  |  |
| 1765 | button | Use my CV's dates |  |  |
| 1766 | button | (completed {fromCv.completed} |  |  |
| 1768 | button | completes {fromCv.expected} |  |  |
| 1774 | field label | Licences and certifications you hold |  |  |
| 1775 | placeholder | e.g. Full UK driving licence, AWS Solutions Architect |  |  |
| 1779 | text | Contract types you'd take (leave all unticked for no preference) |  |  |
| 1782 | text | Permanent |  |  |
| 1783 | text | Contract |  |  |
| 1784 | text | Fixed-term |  |  |
| 1785 | text | Internship |  |  |
| 1786 | text | Part-time |  |  |
| 1807 | button | Saving… |  |  |
| 1807 | button | Save eligibility |  |  |
| 1810 | text | Last saved |  |  |
| 1826 | title | Claims registry | Skill levels | N9 |
| 1832 | section summary | Seeded when your CV is extracted | Made when we read your CV | N12 ID |
| 1834 | section summary | {claimsTotal} skills — {claimsUnconfirmed} to confirm |  |  |
| 1835 | section summary | {claimsTotal} skills confirmed |  |  |
| 1839 | text | Tailoring may describe a skill only at the level you set here. |  |  |
| 1839 | text | Production |  |  |
| 1839 | text | = used in paid work; |  |  |
| 1840 | text | project |  |  |
| 1840 | text | = personal projects only (written as "built X with it", never "proficient in it"); |  |  |
| 1841 | text | learning |  |  |
| 1841 | text | = never appears in any CV, letter or email. Click a skill to change its level. Figures in generated text are checked against your master CV automatically. | = never appears in any CV, letter or email. Click a skill to change its level. Figures in generated text are checked against your main CV automatically. | N1 |
| 1846 | text | No skills registered yet — re-run extraction above to seed the list from your CV. | No skills yet. Press Read my CV again above to fill this list from your CV. | N12 ID |
| 1852 | text | Your CV changed since this list was seeded — re-run extraction above to refresh it. Levels you've confirmed are kept. | Your CV changed after this list was made. Press Read my CV again above to update it. Levels you confirmed are kept. | N12 ID |
| 1857 | text | production |  |  |
| 1858 | text | project |  |  |
| 1859 | text | learning |  |  |
| 1860 | text | not confirmed yet |  |  |
| 1869 | tooltip / title | {s.level}{s.confirmed ? "" : " (not confirmed)"} — click to change |  |  |
| 1869 | tooltip / title | (not confirmed) |  |  |
| 1881 | button | Saving… |  |  |
| 1881 | button | Confirm levels ({unconfirmedCount}) |  |  |
| 1884 | text | Levels were read from your CV and are already enforced: a result that claims a skill above its level, or a figure that isn't on your CV, blocks the download. Confirm once you've reviewed them. | We read these levels from your CV and already use them. If a tailored CV claims a skill above its level, or a number that is not in your CV, you cannot download it until it is fixed. Press Confirm when you have checked the levels. | SS PL |
| 1890 | text | ✓ Levels reviewed — a figure that isn't on your CV, a learning skill in the output, or a project-only skill written as work experience blocks the download until you fix it. |  |  |
| 1897 | button | Hide |  |  |
| 1897 | button | Show |  |  |
| 1897 | button | the |  |  |
| 1897 | button | figures the checker knows from your CV |  |  |
| 1903 | text | No quantified figures found in your CV. |  |  |
| 1914 | field label | Wording your CV must never say |  |  |
| 1916 | text | One phrase a line, up to |  |  |
| 1916 | text | . Write |  |  |
| 1916 | text | phrase => what to say instead |  |  |
| 1916 | text | to replace it; with nothing after the arrow, the sentence or bullet that says it is removed. A tailored CV or letter that still says one can't be downloaded. |  |  |
| 1933 | message | Saved: {rules.length} on your list. |  |  |
| 1936 | button | Save the list |  |  |
| 1952 | title | Positioning | Headlines | N10 |
| 1957 | section summary | None — your CV's own positioning | None. Your CV's own headline is used. | N10 SS |
| 1958 | section summary | {variantsDraft.length} variant{variantsDraft.length === 1 ? "" : "s"} | {variantsDraft.length} headline{variantsDraft.length === 1 ? "" : "s"} | N10 |
| 1962 | text | A headline naming two roles ("Full Stack Engineer \| AI Engineer") halves the impact of both. Set one positioning per kind of role: the summary opens with that headline and the skills section leads with those skills, drawn from your master CV as always. The pre-check picks the variant whose role types match the posting and says why; you can override it for any run. | A headline with two job titles ("Full Stack Engineer \| AI Engineer") is weaker than a headline with one. Set one headline for each kind of job. The summary opens with it, and the skills section starts with the skills you choose. The free check picks the headline that fits the job. You can change it for one CV. | N10 N8 SS |
| 1977 | field label | Variant name | Name | N10 |
| 1978 | placeholder | e.g. Backend |  |  |
| 1981 | field label | Headline (one positioning) | Headline (one job title) | N10 |
| 1982 | placeholder | e.g. Backend engineer (Java, Spring Boot) |  |  |
| 1985 | field label | Lead with these skills (comma-separated, production-level on your claims registry) | Skills to show first (separate with commas; only skills at production level in Skill levels) | N10 N9 ID |
| 1989 | placeholder | e.g. Java, Spring Boot, PostgreSQL |  |  |
| 2002 | text | Use for these kinds of role |  |  |
| 2019 | button | Remove variant | Remove headline | N10 |
| 2026 | button | Add a variant | Add a headline | N10 |
| 2029 | button | Saving… |  |  |
| 2029 | button | Save variants | Save headlines | N10 |
| 2041 | title | Section order |  |  |
| 2044 | section summary | Custom order |  |  |
| 2044 | section summary | Standard order |  |  |
| 2047 | label | Section order |  |  |
| 2048 | help text | Drag a section, or use the arrows. This changes the order only — how many bullets each section gets is still decided by the tailoring for each specific job. |  |  |
| 2051 | label | Loading your layout |  |  |
| 2089 | screen-reader label | Move {SECTION_LABELS[id]} up |  |  |
| 2098 | screen-reader label | Move {SECTION_LABELS[id]} down |  |  |
| 2109 | button | Saving… |  |  |
| 2109 | button | Save order |  |  |
| 2116 | button | Reset to standard |  |  |
| 2128 | text | Not affected by this: your name and contact details stay at the top, and certifications and any extra sections from your CV stay after the sections above, in that order. Right to Work is a separate switch. |  |  |
| 2141 | title | CV length |  |  |
| 2144 | section summary | {prefs.cvLength === "one" ? "One page" : }{isOwner ? ` · ${FORMAT_STYLE_LABELS[pref} |  |  |
| 2144 | section summary | One page |  |  |
| 2144 | section summary | Two pages, filled |  |  |
| 2144 | section summary | · {FORMAT_STYLE_LABELS[prefs.formatStyle]} style |  |  |
| 2147 | text | Two pages is the default: the tailored CV keeps your master CV's content, and when the tailoring leaves a bullet out and there is room, the most relevant ones are put back so both pages are used; the built PDF's own page count is checked, never an estimate. One page trims the least relevant bullets to fit, and the results page lists every one. (The UK Jobs Insider method prefers one page for graduate-scheme applications — choose it per your own rule.) | Two pages is the default. The tailored CV keeps your main CV's content. When tailoring leaves a bullet out and there is room, the most relevant ones are put back, so both pages are used. We check the page count of the real PDF, never an estimate. One page cuts the least relevant bullets to fit, and the results page lists every one. (The UK Jobs Insider method prefers one page for graduate schemes. Choose by your own rule.) | N1 SS |
| 2159 | screen-reader label | CV length |  |  |
| 2162 | field label | Two pages — fill both with your strongest real content (default) |  |  |
| 2166 | field label | One page — trim the least relevant bullets to fit |  |  |
| 2176 | text | Format style. UKJI is the shape every CV has had. CareerSet is the shape tuned by hand in the university's CV tool: printed contact addresses, grouped tool lines, no bold and no full stops on bullets, a four-point letter. Both run the same honesty checks and cost the same credit. This is the default; the Style control on the tailoring page overrides it per run. | Format style. UKJI is the shape every CV has had. CareerSet is the shape tuned by hand in the university's CV tool. It prints contact addresses, groups the tool lines, and uses no bold and no full stops on bullets. Both run the same honesty checks and count as 1 tailored CV. This is the default. The Style control on the Tailor page changes it for one CV. | N3 N5 SS |
| 2181 | screen-reader label | Format style |  |  |
| 2184 | field label | (default) |  |  |
| 2205 | title | Right to Work |  |  |
| 2208 | section summary | Shown on the CV |  |  |
| 2208 | section summary | Off the CV — offered for forms |  |  |
| 2211 | text | Off by default. A reviewer who sees your immigration status before reading a line of your experience screens on it, and the application form asks the same question in a better place. The wording comes from your Eligibility answers above, never from the CV text: it is offered as a copy block beside the download buttons for pasting into forms, and it closes the cover letter only when this is on. Turn it on only for a posting that asks for it on the document itself. | Off by default. A reviewer who sees your immigration status first may judge you on it, and the application form asks the same question in a better place. The wording comes from your Eligibility answers above, never from your CV's text. You get it as a block to copy into forms, beside the download buttons. It closes the cover letter only when this is on. Turn it on only when a job asks for it on the CV itself. | N2 SS |
| 2218 | text | Your CV says: |  |  |
| 2235 | field label | Include Right to Work on the CV |  |  |
| 2251 | title | Project links |  |  |
| 2256 | section summary | No projects yet |  |  |
| 2257 | section summary | {linkedProjects} of {linkRows.length} {linkRows.length === 1 ? "project has" : } links |  |  |
| 2257 | section summary | project has |  |  |
| 2257 | section summary | projects have |  |  |
| 2261 | text | The GitHub repository and live site shown under each project on every CV you tailor: in the preview, the Word file, the PDF and the copy saved to your tracker. The address itself is printed, not just the word "GitHub", so a recruiter's system that keeps only the text still has it. Where your CV or project pool already writes a link, it is filled in for you. | The GitHub repository and live site shown under each project on every tailored CV: in the preview, the Word file, the PDF and the copy saved on Applications. The address itself is printed, not only the word "GitHub", so a recruiter's system that keeps only text still has it. A link that your CV or project list already writes is filled in for you. | N6 N11 SS |
| 2273 | text | Your projects appear here once your master CV is saved. | Your projects appear here once your main CV is saved. | N1 |
| 2289 | field label | GitHub repository |  |  |
| 2293 | placeholder | github.com/you/project |  |  |
| 2302 | field label | Live site |  |  |
| 2306 | placeholder | yourproject.app |  |  |
| 2317 | text | That isn't a web address. Use the form github.com/you/project or yourproject.app. |  |  |
| 2321 | text | On your CV: {shown} |  |  |
| 2321 | text | No links on your CV for this project. |  |  |
| 2322 | text | (found in your CV) |  |  |
| 2327 | text | Which link is correct? |  |  |
| 2340 | field label | No links on this project |  |  |
| 2350 | field label | No links on this project |  |  |
| 2352 | text | Your choice is used everywhere once you save. |  |  |
| 2357 | text | answered "not found". Check the address. |  |  |
| 2372 | button | Saving… |  |  |
| 2372 | button | Save links |  |  |
| 2376 | button | Discard changes |  |  |
| 2381 | text | Some links couldn't be checked just now. That says nothing about the links themselves. |  |  |
| 2394 | title | Project pool | Project list | N11 |
| 2399 | section summary | {poolLength.toLocaleString()} characters saved |  |  |
| 2400 | section summary | Not set — tailoring uses your CV's projects |  |  |
| 2425 | label | Project pool | Project list | N11 |
| 2426 | help text | Paste ALL your projects here, in your own words — names, dates, tech, and what you did. Once saved they read into cards you can check, pin and order. Until then, on every tailor run the 2 most relevant to that job (1 if you only add one) are selected and get tailored bullets, replacing the projects from your master CV for that run. Remove the pool to switch back. Replacing your master CV keeps the pool. | Paste ALL your projects here, in your own words: names, dates, tech, and what you did. After you save, each project becomes a card that you can check, order, or mark "Always include". Until then, each tailored CV uses the 2 projects that best fit the job, in place of the projects in your main CV. Remove the project list to go back. Replacing your main CV keeps the project list. | N11 N1 N5 SS |
| 2432 | placeholder | Project name \| Jan 2025 Tech: React, Node.js, PostgreSQL - What you built and the outcome Next project… |  |  |
| 2440 | button | Saving… |  |  |
| 2440 | button | Save project pool | Save project list | N11 |
| 2443 | button | Close |  |  |
| 2452 | text | Delete your whole project pool? | Delete your whole project list? | N11 |
| 2453 | button | Keep pool | Keep it | N11 |
| 2454 | button | Delete it |  |  |
| 2457 | button | Remove pool | Remove project list | N11 |

### app/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 14 | message | Honest CV tailoring. Every claim traces back to your real CV — nothing invented. |  |  |
| 19 | message | Jobhuntz — honest CV tailoring |  |  |
| 24 | label | Jobhuntz |  |  |
| 27 | label | Jobhuntz |  |  |
| 32 | label | Jobhuntz |  |  |

### app/settings/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 23 | message | Your account, your usage, and the provider keys that keep tailoring running after the free credits. | Your account, how much you have used, and your own API key for after the 3 free tailored CVs. | N3 N4 |
| 45 | label | OpenRouter |  |  |
| 46 | message | Runs your tailoring once your free credits are used. A free OpenRouter account is enough — its free tier handles full runs. | OpenRouter is a service that gives free access to AI models. Jobhuntz uses your key from it after your 3 free tailored CVs. A free OpenRouter account is enough. | N3 N4 SS |
| 48 | message | Heads up: free OpenRouter models may use what you send for training. If that matters for your CV, check the privacy settings in your OpenRouter account. | Note: free OpenRouter models may use what you send for training. If that matters for your CV, check the privacy settings in your OpenRouter account. | ID |
| 51 | label | OpenRouter |  |  |
| 53 | message | Go to openrouter.ai and sign in (or create a free account) |  |  |
| 54 | message | Click your avatar in the top-right → "Keys" |  |  |
| 55 | message | Click "Create key", give it a name (e.g. "Jobhuntz") |  |  |
| 56 | message | Copy the key — it starts with sk-or-v1- |  |  |
| 57 | message | Paste it in the field below |  |  |
| 60 | message | Open OpenRouter → |  |  |
| 63 | message | Google Gemini |  |  |
| 64 | message | Optional — not used for tailoring yet. Gemini's free tier allows 5 requests a minute and a full run makes 8, so a run can't finish on it. | Optional. Jobhuntz does not use it for tailoring yet. Gemini's free plan allows 5 requests a minute and one CV needs 8, so it cannot finish. | N5 SS |
| 68 | message | Google AI Studio (Gemini) |  |  |
| 70 | message | Open Google AI Studio at aistudio.google.com/app/apikey |  |  |
| 71 | message | Sign in with your Google account |  |  |
| 72 | message | Click "Create API key" and select a project (or create one) |  |  |
| 73 | message | Copy the key — it typically starts with AIza… or AQ… |  |  |
| 74 | message | Paste it in the field below |  |  |
| 77 | message | Open Google AI Studio → |  |  |
| 88 | message | resets in {h}h {m}m |  |  |
| 88 | message | resets in {m}m |  |  |
| 137 | message | Your session has expired — sign in again. |  |  |
| 137 | message | Could not export your data. |  |  |
| 143 | message | Connection error. Please try again. |  |  |
| 161 | message | Could not delete your account. |  |  |
| 173 | message | Connection error. Your account is unchanged. |  |  |
| 197 | message | Couldn't load your saved keys. Refresh the page to try again. |  |  |
| 230 | message | Failed to save key. |  |  |
| 240 | message | Connection error. Please try again. |  |  |
| 255 | message | Failed to remove key. |  |  |
| 265 | message | Connection error. Please try again. |  |  |
| 280 | title | Settings |  |  |
| 282 | label | Loading your account |  |  |
| 283 | label | Loading your keys |  |  |
| 284 | label | Loading your keys |  |  |
| 301 | title | Settings |  |  |
| 308 | text | Account & usage |  |  |
| 312 | label | Loading your usage |  |  |
| 318 | text | Free tailors today: | Today: | N3 |
| 319 | text | of |  |  |
| 319 | text | left |  |  |
| 323 | text | Free Claude credits: | Free tailored CVs: | N3 |
| 324 | text | of |  |  |
| 324 | text | left (lifetime) | left ({usage.claudeLimit} in total) | N3 PL |
| 348 | text | ✓ Saved •••• |  |  |
| 358 | text | How to get this key ( |  |  |
| 388 | placeholder | Paste your key here… |  |  |
| 392 | screen-reader label | {slot.providerDisplay} API key |  |  |
| 399 | button | Saving… |  |  |
| 399 | button | Save key |  |  |
| 407 | button | Cancel |  |  |
| 421 | text | Remove this key? |  |  |
| 428 | button | Removing… |  |  |
| 428 | button | Yes, remove |  |  |
| 431 | button | Keep it |  |  |
| 441 | button | Replace |  |  |
| 449 | button | Remove |  |  |
| 468 | text | Your data |  |  |
| 471 | text | Everything in your account — CV, answers, applications, prep packs, interview transcripts — as one JSON file, or gone for good. What is stored and who processes it is in the | Everything in your account as one JSON file: CV, answers, applications, interview packs and interview transcripts. Or delete it all for good. What is stored and who processes it is in the | N16 SS |
| 472 | text | privacy notice |  |  |
| 472 | text | ; the |  |  |
| 473 | text | terms of use |  |  |
| 473 | text | say what you agree to. |  |  |
| 477 | button | Preparing… |  |  |
| 477 | button | Download everything (JSON) |  |  |
| 481 | button | Delete my account |  |  |
| 487 | screen-reader label | Delete account |  |  |
| 489 | text | This cannot be undone. |  |  |
| 489 | text | Your account, your CV, every application, every uploaded file, every prep pack and interview transcript are deleted immediately. Download your data first if you want to keep it. | Your account, your CV, every application, every uploaded file, every interview pack and interview transcript are deleted immediately. Download your data first if you want to keep it. | N16 |
| 492 | field label | Type |  |  |
| 492 | field label | to confirm |  |  |
| 508 | button | Deleting… |  |  |
| 508 | button | Delete my account permanently |  |  |
| 511 | button | Keep my account |  |  |

### components/FirstRunBanner.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 82 | text | Start here: upload your CV |  |  |
| 84 | text | Everything here is built from your master CV, and nothing goes in that it doesn't say. Add it once on Customise. | Jobhuntz builds everything from your main CV. It never adds anything your CV does not say. Add your CV once on My CV. | N1 N7 SS |
| 87 | button | Upload your CV |  |  |

### components/FirstRunGuide.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 57 | message | Couldn't save your answer. Check your connection and try again, or answer under Eligibility on Customise. | Couldn't save your answer. Check your connection and try again, or answer under Eligibility on My CV. | N7 |
| 66 | heading | Three steps to your first tailored CV |  |  |
| 72 | text | Upload your CV |  |  |
| 72 | text | (done) |  |  |
| 76 | text | Saved. Every tailored CV is built from it, and nothing goes in that it doesn't say. | Saved. We build every tailored CV from it. We never add anything it does not say. | SS |
| 77 | text | Your full CV, once: a PDF, a Word file or pasted text. Every tailored CV is built from it, and nothing goes in that it doesn't say. | Add your main CV once: a PDF, a Word file or pasted text. We build every tailored CV from it. We never add anything it does not say. | N1 SS |
| 81 | button | Upload your CV |  |  |
| 91 | text | Confirm your right to work and sponsorship | Answer one question about your right to work | PL |
| 91 | text | (done) |  |  |
| 95 | text | Answered: |  |  |
| 95 | text | . Change it under |  |  |
| 95 | text | Eligibility on Customise | Eligibility on My CV | N7 |
| 99 | text | Most UK application forms ask this, usually near the start. It is never worked out from your CV: choose the one that is true for you, or skip it and your form answers stay “Not answered” until you do. | Most UK application forms ask this near the start. We never guess it from your CV. Choose the answer that is true for you. If you skip it, your form answers say “Not answered” until you choose. | SS PL |
| 105 | screen-reader label | Your right to work in the UK |  |  |
| 116 | text | Saving… |  |  |
| 125 | button | Answer on Customise | Answer on My CV | N7 |
| 134 | text | Paste your first job |  |  |
| 136 | text | A job description or a link to the posting, on Tailor. A free check runs first and says how well you match before anything is spent. | Paste a job description, or a link to the job, on the Tailor page. A free check runs first. It tells you how well you match before you use a tailored CV. | N2 N3 SS |
| 142 | button | Paste your first job |  |  |
| 142 | button | Skip to your first job |  |  |

### components/MoveToClosedDialog.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 74 | heading | Move |  |  |
| 74 | heading | to Closed |  |  |
| 84 | text | Reason |  |  |
| 90 | text | Date |  |  |
| 94 | text | Lesson (optional) |  |  |
| 99 | button | Cancel |  |  |
| 100 | button | Moving… |  |  |
| 100 | button | Move to Closed |  |  |

### components/ui/AppHeader.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 30 | label | Actions | To do | N14 |
| 31 | message | What's next | Schedule | N14 |
| 32 | label | Tailor |  |  |
| 33 | label | Applications |  |  |
| 34 | label | Interview |  |  |
| 35 | label | Customise | My CV | N7 |
| 110 | message | Signing out… |  |  |
| 110 | message | Sign out |  |  |
| 134 | button | Close |  |  |
| 134 | button | Menu |  |  |
| 137 | screen-reader label | Main |  |  |
| 151 | text | Settings |  |  |
| 163 | screen-reader label | Account menu, signed in as {email} |  |  |
| 163 | screen-reader label | Account menu |  |  |
| 174 | text | Settings |  |  |

### lib/actionCentre.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 21 | message | Under 24 hours |  |  |
| 22 | message | Under 3 days |  |  |
| 23 | message | More than 3 days |  |  |
| 24 | message | No date yet |  |  |

### lib/applicationStage.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 19 | label | Take-home |  |  |
| 20 | label | Video |  |  |
| 21 | message | Work trial |  |  |
| 54 | message | To submit |  |  |
| 55 | label | Applied |  |  |
| 56 | label | Screening |  |  |
| 57 | label | Interview |  |  |
| 58 | label | Assessment |  |  |
| 59 | label | Offer |  |  |
| 60 | label | Won |  |  |
| 61 | label | Closed |  |  |
| 315 | message | {row.role} · Req {req} |  |  |
| 325 | message | {oldest.company_name} · {shortRole(oldest.role)}{req ? ` (${req})` : ""} |  |  |

### lib/closing.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 13 | message | Needs the user's confirmation: this row reached screening. |  |  |
| 19 | message | That can no longer be undone. |  |  |
| 81 | label | Screening |  |  |
| 81 | label | Assessment |  |  |
| 81 | label | Interview |  |  |
| 81 | label | Offer |  |  |
| 106 | message | Screening call |  |  |
| 114 | label | Rejected |  |  |
| 115 | label | Withdrawn |  |  |
| 116 | label | Ghosted | No reply | GH |
| 117 | message | Declined by me |  |  |
| 118 | message | Role closed |  |  |
| 121 | message | What stopped it? e.g. wanted 3+ yrs |  |  |
| 262 | label | Gmail |  |  |
| 270 | message | New activity from {company} — Reopen? |  |  |
| 271 | message | New activity from {company} — Move back to {STATUS_LABELS[p.status as Status]}? |  |  |
| 272 | message | (from {SOURCE_NAMES[p.source.toLowerCase()] ?? }) |  |  |
| 273 | message | {STATUS_LABELS[p.outcome]} on {shortDate(p.date)}{source}. |  |  |
| 309 | message | Remove {STATUS_LABELS[stage]}: picked by mistake |  |  |
| 315 | message | Removed '{stage}' on {day} — picked by mistake |  |  |
| 486 | message | Your CV reached screening {reached.length} {reached.length === 1 ? "time" : "times"} |  |  |
| 486 | message | Reached interview {reached.length} {reached.length === 1 ? "time" : "times"} |  |  |
| 487 | message | {lead} · {live} live · {closed} closed |  |  |
| 532 | label | Applied |  |  |
| 533 | message | Reached screening |  |  |
| 534 | message | Reached interview |  |  |
| 535 | label | Offer |  |  |
| 545 | message | Tailored here |  |  |
| 545 | message | Cold email |  |  |
| 545 | message | Added by hand |  |  |

### lib/contactCheck.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 27 | message | LinkedIn link |  |  |
| 28 | message | GitHub link |  |  |
| 83 | message | Your CV has no email address. Add it in Your details. |  |  |
| 96 | message | Your {FIELD_LABELS[field]} looks wrong: '{shown}'. Fix it in Your details. |  |  |
| 104 | message | {problems[0].message} ({more} more contact detail{more === 1 ? "" : "s"} to fix.) |  |  |

### lib/deadlines.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 78 | message | due in {Math.max(minutes, 1)}m |  |  |
| 78 | message | due in {Math.floor(minutes / 60)}h |  |  |
| 94 | message | Submit the {c} application |  |  |
| 95 | message | Reply to {c} |  |  |
| 96 | message | Complete the {c} assessment |  |  |
| 97 | message | Prepare for the {c} interview |  |  |
| 98 | message | Answer the {c} offer |  |  |
| 104 | message | Act on the {c} deadline |  |  |
| 107 | message | {base}, apply from {email} |  |  |
| 107 | message | {base}, invite went to {email} |  |  |
| 112 | message | The {row.company_name} deadline |  |  |
| 114 | message | {title}, invite went to {email} |  |  |
| 121 | message | Follow up with {row.company_name} ({STATUS_LABELS[status]}){email ? `, you applied from ${email}` : } |  |  |
| 121 | message | , you applied from {email} |  |  |

### lib/fallbackRoute.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 33 | message | Your OpenRouter key has used today's 50 free-model requests (a tailor is about 10). Add $10 of credit at openrouter.ai for 1,000 a day, or try again tomorrow. | Your API key has used today's 50 free requests at OpenRouter. One tailored CV needs about 10. Add $10 of credit at openrouter.ai for 1,000 a day, or try again tomorrow. | N4 N5 SS |
| 34 | message | Your OpenRouter key has hit its usage limit. Try again later. | Your API key has reached its limit. Try again later. | N4 ID |
| 42 | message | The shared Claude account is still out of credit (the top-up has to land on the API key this app uses, in the Anthropic Console, not a Claude.ai plan), so the run fell back to your OpenRouter key. | Our free AI service is not available, so Jobhuntz tried your own API key. | N4 PL |
| 43 | message | The shared Claude account is being rate-limited, so the run fell back to your OpenRouter key. | Our free AI service is busy, so Jobhuntz tried your own API key. | N4 PL |
| 48 | message | the shared Claude account is out of credit | our free AI service is not available right now | PL |
| 48 | message | the shared Claude account is being rate-limited | our free AI service is busy | PL |
| 49 | message | your OpenRouter key | your own API key | N4 |
| 49 | message | the deployment's OpenRouter key |  |  |
| 50 | message | This run used {on} because {why}. Nothing was charged to your free tailors. | This CV was written with {on} because {why}. It did not use one of your free tailored CVs. | N3 N5 |

### lib/firstRun.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 70 | message | Permanent right to work |  |  |
| 71 | message | Settled status, indefinite leave to remain or citizenship. No sponsorship, now or later. |  |  |
| 75 | message | Time-limited visa |  |  |
| 76 | message | A Student, Graduate or similar visa: no sponsorship to start, but needed later. | A Student, Graduate or similar visa. You can start without sponsorship (an employer supporting your visa), but you will need it later. | PL |
| 80 | message | I need sponsorship |  |  |
| 81 | message | You need an employer to sponsor a visa before you can start. |  |  |
| 86 | message | Not set |  |  |

### lib/gapCheck.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 168 | message | {t.slice(0, MAX_LINE_CHARS - 1).trimEnd()}… |  |  |
| 272 | message | and {terms.length - 5} more |  |  |
| 273 | message | The check for other wording didn't finish for {unchecked === 1 ? "one of them" : `${unc}, so your CV may show {unchecked === 1 ? "it" : "them"} under another name. |  |  |
| 273 | message | {unchecked} of them |  |  |
| 276 | message | {terms.length} core {terms.length === 1 ? "gap" : "gaps"}: {shown}{more}.{blocks ? " This role may not suit you." }{caveat} | {n} main requirement(s) not in your CV: {shown}{more}. This job may not suit you.{caveat} | PL N2 |
| 276 | message | This role may not suit you. | This job may not suit you. | N2 |

### lib/insights.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 53 | message | Junior / graduate |  |  |
| 53 | label | Mid-level |  |  |
| 53 | label | Senior |  |  |
| 189 | message | Under half of the role's terms |  |  |
| 190 | message | Half to three-quarters |  |  |
| 191 | message | Three-quarters or more |  |  |
| 194 | message | Under 50% of required skills |  |  |
| 195 | message | 50-79% of required skills |  |  |
| 196 | message | 80%+ of required skills |  |  |
| 198 | message | Read: apply | Advice: apply | PL |
| 198 | message | Read: long shot | Advice: low chance | PL ID |
| 198 | message | Read: likely auto-rejected | Advice: likely to be rejected automatically | PL |
| 239 | message | Tailored here |  |  |
| 239 | message | Cold email |  |  |
| 239 | message | Added by hand |  |  |
| 240 | message | Follow-up date set |  |  |
| 240 | message | No follow-up date |  |  |
| 241 | message | One-page CV |  |  |
| 241 | message | {row.pages}-page CV |  |  |

### lib/knockouts.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 132 | message | Not checked |  |  |
| 132 | message | No eligibility read was stored with this application. |  |  |
| 144 | label | Knockout |  |  |
| 144 | message | Knockout: {q} |  |  |
| 144 | message | Knockout: a condition the form screens on was failed. |  |  |
| 148 | message | Long shot | Low chance | ID |
| 148 | message | Long shot: {q} | Low chance: {q} | ID |
| 148 | message | Long shot: a condition was borderline. | Low chance: you only partly meet one condition. | ID PL |
| 150 | label | Clear |  |  |
| 150 | message | Clear — nothing failed; {unknown} condition{unknown === 1 ? "" : "s"} to check yourself. |  |  |
| 150 | message | Clear — no knockout condition failed. |  |  |
| 601 | message | (?:graduat(?:ed\|ing\|ion)\|graduates?s+(?:of\|from\|in\|between)\|classs+of)([^.;() d]{0,30}?)({GRAD_YEAR_LIST})(s*(?:onwards?\|ors+(?:later\|after\|earlier\|before)\|ands+(?:later\|after\|earlier\|before)\|+))? |  |  |
| 797 | message | Top Secret |  |  |
| 799 | message | a bachelor's degree |  |  |
| 799 | message | a master's degree |  |  |
| 855 | message | Sponsorship is offered for this role. |  |  |
| 856 | message | Set your right-to-work status in Customise to check this. | Set your right-to-work status on My CV to check this. | N7 |
| 859 | message | This role won't sponsor a visa and your profile says you need sponsorship. Applications failing this are usually rejected automatically, without the CV being read. |  |  |
| 860 | message | The posting asks about your right to work without saying whether it sponsors. | The job description asks about your right to work without saying whether it sponsors. | N2 |
| 860 | message | State plainly that you would need visa sponsorship and ask whether they can offer it. |  |  |
| 864 | message | (until {monthLabel(e.rightToWork.permissionEnds)}) |  |  |
| 866 | message | This asks for permanent right to work, settled status or citizenship; your permission is time-limited{ends}. Applications failing this are usually rejected automatically, without the CV being read. |  |  |
| 868 | message | This needs the right to work now and in the future, with no sponsorship; your permission is time-limited{ends}. Applications failing this are usually rejected automatically, without the CV being read. |  |  |
| 870 | message | You've listed right to work in {e.rightToWork.countries.join(", ")}; this role needs it in {val.country}. Check before applying. |  |  |
| 872 | message | You can start without sponsorship{ends}, but this employer says it won't sponsor and you will need it when your permission ends. |  |  |
| 872 | message | State plainly that you can start without sponsorship and the month from which you would need it. |  |  |
| 873 | message | You can work this role without sponsorship now{ends}; the form may ask when you would need it. |  |  |
| 875 | message | This asks for citizenship or settled status, not just the right to work; confirm yours qualifies. |  |  |
| 877 | message | You've listed right to work in {e.rightToWork.countries.join(", ")}; this role needs it in {val.country}. Check before applying. |  |  |
| 878 | message | You have the right to work this role asks for. |  |  |
| 883 | message | Set your clearance status in Customise to check this. | Set your clearance status on My CV to check this. | N7 |
| 884 | message | This asks for US {label} clearance; your profile records UK clearance only. Check it yourself. |  |  |
| 887 | message | You hold {label} clearance or higher. |  |  |
| 889 | message | Requires active {label} clearance and you don't hold it. Clearance takes months to obtain, and applications failing this are usually rejected automatically, without the CV being read. |  |  |
| 891 | message | You don't hold {label} yet, but the role only asks that you can obtain it. |  |  |
| 891 | message | Say you meet the residency requirement and are willing to undergo {label} vetting. |  |  |
| 892 | message | The role needs you to be eligible for {label} clearance and your profile says you aren't. |  |  |
| 893 | message | The role asks that you can obtain {label} clearance; say in Customise whether you're eligible. | The role asks that you can obtain {label} clearance; say on My CV whether you're eligible. | N7 |
| 897 | message | Add your years of experience in Customise to check this. | Add your years of experience on My CV to check this. | N7 |
| 900 | message | Asks for {need}+ years{subj}; you have {y}. |  |  |
| 903 | message | Asks for {need}+ years{subj}; you have {y}. Close enough to argue. |  |  |
| 903 | message | Lead with the depth of what you did in those {y} years rather than the count; don't round up. |  |  |
| 904 | message | Asks for {need}+ years{subj}; you have {y}. A years question on the form is answered with a number, and yours falls short. |  |  |
| 910 | message | Remote role. |  |  |
| 912 | message | Remote within {place}, where you're based. |  |  |
| 913 | message | Remote but restricted to {place}; add your base location in Customise to check. | Remote but restricted to {place}; add your base location on My CV to check. | N7 |
| 914 | message | Remote but restricted to {place}; your profile lists elsewhere. Check before applying. |  |  |
| 917 | message | Relocation required and you're open to it. |  |  |
| 918 | message | Relocation is required and you've said you won't relocate. |  |  |
| 918 | message | Only apply if you'd genuinely consider moving; say so plainly. |  |  |
| 919 | message | Relocation is required; say in Customise whether you'd relocate. | Relocation is required; say on My CV whether you'd relocate. | N7 |
| 922 | message | hybrid{val.daysInOffice ? ` (${val.daysInOffice} |  |  |
| 922 | message | ({val.daysInOffice} days in the office) |  |  |
| 924 | message | {cap(modeLabel)} in {place}; add your base location in Customise to check the commute. | {cap(modeLabel)} in {place}; add your base location on My CV to check the commute. | N7 |
| 928 | message | {cap(modeLabel)} in {base}, where you're based. |  |  |
| 929 | message | {cap(modeLabel)} in {place}; you're based in {loc.base.join(", ")}. |  |  |
| 929 | message | Say you're willing to relocate to {place}, and when. |  |  |
| 931 | message | On-site in {place}; you're based in {loc.base.join(", ")} and not relocating. |  |  |
| 932 | message | {cap(modeLabel)} in {place}; you're based in {loc.base.join(", ")} and not relocating. Office days are sometimes negotiable. |  |  |
| 932 | message | Ask how fixed the office days are before you commit. |  |  |
| 934 | message | {cap(modeLabel)} in {place}; say in Customise whether you'd relocate. | {cap(modeLabel)} in {place}; say on My CV whether you'd relocate. | N7 |
| 937 | message | {cap(modeLabel)} role and you're fine with that. |  |  |
| 938 | message | {cap(modeLabel)} role; you've said you'd rather not. |  |  |
| 938 | message | Decide whether you'd actually do the office days before applying. |  |  |
| 939 | message | {cap(modeLabel)} role; say in Customise whether that works for you. | {cap(modeLabel)} role; say on My CV whether that works for you. | N7 |
| 943 | message | Add your highest degree in Customise to check this. | Add your highest degree on My CV to check this. | N7 |
| 948 | message | Asks for {label} or equivalent experience; you don't hold the degree. |  |  |
| 948 | message | Point to the equivalent experience the posting allows, specifically. | Point to the equivalent experience the job description allows, specifically. | N2 |
| 949 | message | Requires {label}; your profile says you don't hold one. |  |  |
| 952 | message | Asks for a {val.classification}; add your degree classification in Customise. | Asks for a {val.classification}; add your degree classification on My CV. | N7 |
| 953 | message | Asks for a {val.classification}; your classification isn't on the UK scale, so check how they'd treat it. |  |  |
| 955 | message | Requires a {val.classification} and your profile records a {d.classification}. Degree class is a form question. |  |  |
| 957 | message | You hold {label}{val.classification ? ` at ${val.classifi}. |  |  |
| 957 | message | at {val.classification} or better |  |  |
| 961 | message | Add your graduation dates in Customise (Eligibility) to check this. | Add your graduation dates on My CV (Eligibility) to check this. | N7 |
| 969 | message | your last completed degree was {monthLabel(g.completed)} |  |  |
| 970 | message | your current degree completes {monthLabel(g.expected!)} |  |  |
| 970 | message | your degree completed {monthLabel(g.expected)} |  |  |
| 974 | message | State the date plainly: "I complete my degree in {monthLabel(g.expected!)}." |  |  |
| 981 | message | {val.years[0]}–{val.years[val.years.length - 1]} |  |  |
| 982 | message | {val.years.slice(0, -1).join(", ")} or {val.years[val.years.length - 1]} |  |  |
| 986 | message | Asks for {span} graduates; {facts}. |  |  |
| 987 | message | Asks for {span} graduates; {facts}. A graduation-year question on the form is answered with a year, and yours is outside it. |  |  |
| 990 | message | {val.withinMonths / 12} years |  |  |
| 990 | message | {val.withinMonths} months |  |  |
| 991 | message | Asks for graduation within the last {span}; {facts}. |  |  |
| 993 | message | Asks for graduation within the last {span}; {facts}. Many graduate programmes also take students finishing their degree, but not all, and the form will ask for your date. |  |  |
| 994 | message | Asks for graduation within the last {span}; {facts}. A graduation-date question on the form is answered with a date, and yours falls outside it. |  |  |
| 997 | message | Open to final-year students; {facts}. |  |  |
| 998 | message | Asks for a recent graduate; {facts}. |  |  |
| 999 | message | Asks for a recent graduate; {facts}. "Recent" isn't defined in the posting, so check what they mean before applying. | Asks for a recent graduate; {facts}. "Recent" isn't defined in the job description, so check what they mean before applying. | N2 |
| 1002 | message | Asks that you hold {val.name}; list your licences and certifications in Customise to check. | Asks that you hold {val.name}; list your licences and certifications on My CV to check. | N7 |
| 1008 | message | You hold {val.name}. |  |  |
| 1009 | message | Asks that you hold {val.name}, which isn't in your list. |  |  |
| 1009 | message | Confirm whether you actually hold {val.name}; if not, don't claim it. |  |  |
| 1012 | message | This is {TYPE_LABEL[val.type]} role. |  |  |
| 1013 | message | This is {TYPE_LABEL[val.type]} role, which you'd take. |  |  |
| 1014 | message | This is {TYPE_LABEL[val.type]} role{val.months ? ` (${val.months} months)` :}; your profile lists {e.employmentTypes.join(", ")}. |  |  |
| 1014 | message | ({val.months} months) |  |  |
| 1014 | message | Only apply if you'd genuinely accept these terms. |  |  |
| 1017 | message | Check this requirement yourself before applying. |  |  |
| 1035 | message | {hardOnes.length === 1 ? "One eligibility} you can't pass right now. Applications failing a gate are usually rejected automatically, without the CV being read. |  |  |
| 1035 | message | One eligibility gate |  |  |
| 1035 | message | {hardOnes.length} eligibility gates |  |  |
| 1040 | message | {soft} eligibility {soft === 1 ? "gate is" : "gates are"} arguable |  |  |
| 1042 | message | your CV shows {required.matched} of {required.total} required skills |  |  |
| 1044 | message | {top15.matched} of {top15.total} of the role's terms are in your CV |  |  |
| 1045 | message | . Worth applying if you can address that head-on. |  |  |
| 1049 | message | No gate you'd fail; {unknown} to check yourself below. |  |  |
| 1049 | message | No eligibility gate you'd fail, and your CV covers the role's requirements. |  |  |
| 1070 | message | Right to work |  |  |
| 1071 | message | Security clearance |  |  |
| 1072 | message | Years of experience |  |  |
| 1075 | message | Graduation date |  |  |
| 1076 | message | Licence / certification |  |  |
| 1077 | message | Contract type |  |  |
| 1087 | message | Not set |  |  |

### lib/limits.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 12 | message | That file is larger than 4MB. Upload a smaller file. |  |  |
| 51 | message | This looks like part of a posting (under 1,500 characters). Eligibility conditions usually sit at the bottom of the ad, and tailoring against a fragment gives a generic CV. Paste the whole posting before spending a tailor. | This looks like only part of a job description (under 1,500 characters). The requirements are usually at the bottom of the advert. Tailoring from part of one gives a general CV. Paste the whole job description before you use a tailored CV. | N2 N3 SS |
| 53 | message | Job description is too long (max ~15,000 characters). |  |  |
| 54 | message | CV is too long (max ~5 pages / 20,000 characters). |  |  |
| 55 | message | Project pool is too long (max ~15,000 characters). | Project list is too long (max ~15,000 characters). | N11 |

### lib/llmRouting.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 26 | message | Service temporarily unavailable. Please try again in a moment. |  |  |
| 45 | message | {minutes} minute{minutes === 1 ? "" : "s"} |  |  |
| 46 | message | {hours} hour{hours === 1 ? "" : "s"} |  |  |
| 47 | message | {hours} hour{hours === 1 ? "" : "s"} {minutes} minute{minutes === 1 ? "" : "s"} |  |  |
| 101 | message | OpenRouter is selected but no OpenRouter key is available |  |  |
| 137 | message | The OpenRouter key this interview started on is no longer available |  |  |
| 147 | message | OpenRouter is selected but no OpenRouter key is available |  |  |
| 208 | message | You've reached your daily tailoring limit ({DAILY_TAILOR_LIMIT} per 24 hours). Resets in {remaining}. | You have reached today's limit ({DAILY_TAILOR_LIMIT} tailored CVs in 24 hours). You can tailor again in {remaining}. | N3 PL |
| 220 | message | Your account isn't fully set up yet. Sign out and back in, and if this persists, contact support. |  |  |
| 278 | message | Couldn't check your saved API key just now. Please try again in a moment. |  |  |
| 291 | message | Your saved API key couldn't be read — it may need to be re-entered. Go to Settings and replace it. | We could not read your saved API key. Go to Settings and enter it again. | N4 |
| 307 | message | Your Gemini key can't complete a tailoring run — Gemini's free tier allows 5 requests per minute and one run makes 8. Add an OpenRouter key in Settings to continue. | Your Gemini key cannot tailor a CV. Gemini's free plan allows 5 requests a minute and one CV needs 8. Add an OpenRouter key in Settings to continue. | N5 |
| 318 | message | You've used all free tailors. Add your own API key in Settings to continue. | You have used your 3 free tailored CVs. Add your own API key in Settings to continue. | N3 N4 |

### lib/plan.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 14 | message | Screening call |  |  |
| 15 | label | Interview |  |  |
| 16 | label | Assessment |  |  |
| 17 | label | Take-home |  |  |
| 18 | label | Deadline |  |  |
| 19 | label | Follow-up |  |  |
| 20 | message | Offer deadline |  |  |
| 21 | label | Networking |  |  |
| 22 | message | Video interview |  |  |
| 23 | message | Work trial |  |  |
| 24 | message | Screening questions |  |  |
| 162 | message | ended {span(now - end)} ago: {e.application_id ? "set the outcome" : "} |  |  |
| 191 | label | Overdue |  |  |
| 192 | label | Today |  |  |
| 193 | label | Tomorrow |  |  |
| 194 | message | This week |  |  |
| 195 | message | Next week |  |  |
| 196 | label | Later |  |  |
| 234 | message | {a.date_applied ?? ""}T12:00:00Z |  |  |
| 288 | message | Needs booking |  |  |
| 483 | message | UK time |  |  |
| 486 | message | {day} at {clockTime(s.start, tz)} |  |  |
| 486 | message | {day} from {clockTime(s.start, tz)} to {clockTime(s.end, tz)} |  |  |
| 488 | message | Thank you for getting in touch. I'm available on {describe(slots[0])} ({zone}). Please let me know if that suits you. Kind regards, |  |  |
| 489 | message | - {describe(s)} |  |  |
| 490 | message | Thank you for getting in touch. I'm available at any of these times ({zone}): {lines} Please let me know which suits you best. Kind regards, |  |  |
| 495 | message | the {role} role |  |  |
| 496 | message | Thank you for letting me know about {what}{company ? ` at ${company}` : ""}. If you have a moment, I would welcome any brief feedback on my application, so I can improve for future roles. Kind regards, |  |  |
| 504 | label | Applied |  |  |
| 505 | label | Screening |  |  |
| 506 | label | Interview |  |  |
| 507 | label | Assessment |  |  |
| 508 | label | Offer |  |  |
| 509 | label | Won |  |  |
| 510 | label | Rejected |  |  |
| 511 | label | Ghosted | No reply | GH |
| 647 | message | {label} must be text. |  |  |
| 649 | message | {label} is too long (max {max} characters). |  |  |
| 662 | message | Pick a valid kind of event. |  |  |
| 667 | message | Give the event a title. |  |  |
| 668 | message | The title is too long (max {MAX_TITLE} characters). |  |  |
| 673 | message | Pick a valid event status. |  |  |
| 679 | message | Enter a valid date and time for {key.replace("_at", "").replace("_", " ")}. |  |  |
| 684 | message | Pick a valid time zone. |  |  |
| 687 | message | The stage |  |  |
| 687 | message | The link |  |  |
| 687 | message | The contact |  |  |
| 687 | message | The prep notes |  |  |
| 692 | message | Offer up to {MAX_SLOTS} slots. |  |  |
| 698 | message | Enter a valid date and time for each offered slot. |  |  |
| 705 | message | The end time is before the start. |  |  |
| 706 | message | Give the event a date and time, or mark it as still to book. |  |  |
| 713 | message | A window is free or busy. |  |  |
| 717 | message | Pick a date or a day of the week. |  |  |
| 719 | message | Enter a valid date. |  |  |
| 723 | message | Pick a valid day of the week. |  |  |
| 726 | message | Enter a start and end time. |  |  |
| 727 | message | The end time must be after the start. |  |  |
| 731 | message | Pick a valid time zone. |  |  |
| 735 | message | The label is too long (max 100 characters). |  |  |

### lib/referrals.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 20 | label | Offered |  |  |
| 21 | message | Details sent |  |  |
| 22 | label | Referred |  |  |
| 23 | label | Applied |  |  |
| 55 | message | Referral must be true or false. |  |  |
| 59 | message | Referrer name |  |  |
| 60 | message | Req ID |  |  |
| 64 | message | {label} must be text. |  |  |
| 66 | message | {label} is too long (max {max} characters). |  |  |
| 73 | message | Pick a valid referral status. |  |  |
| 118 | message | Send details to {who} |  |  |
| 118 | message | Send your details to the person referring you |  |  |
| 120 | message | Check {who} has submitted the referral |  |  |
| 120 | message | Check the referral has been submitted |  |  |
| 123 | message | Finish {row.company_name.trim() \|\| "the"} application |  |  |

### lib/routingText.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 17 | label | Claude |  |  |
| 17 | label | OpenRouter |  |  |
| 17 | label | Gemini |  |  |
| 27 | message | Your usage could not be read just now. |  |  |
| 28 | message | Tailoring runs on the free credits first, then on your OpenRouter key. | Jobhuntz uses your free tailored CVs first, then your own API key. | N3 N4 |
| 28 | message | Tailoring runs on the free credits first; an OpenRouter key keeps it running after them. | Jobhuntz uses your free tailored CVs first. After them you need your own API key. | N3 N4 |
| 37 | message | This account is unlimited: no daily cap and no credit count. {usage.dailyUsed} tailor{usage.dailyUsed === 1 ? "" : "s"} so far today. | This account is unlimited: no daily limit and no count of free tailored CVs. {usage.dailyUsed} tailored CV{s} so far today. | N3 N5 |
| 38 | message | The next run uses {label}{chosenProvider ? " (the provider picked }. | Your next tailored CV uses {label}{ (the provider picked on the Tailor page)}. | N5 |
| 38 | message | (the provider picked on the tailoring page) | (the provider picked on the Tailor page) | N5 |
| 44 | message | The daily cap is reached: {usage.dailyLimit} tailors a day, on every path — your own key included. | You have reached today's limit: {usage.dailyLimit} tailored CVs a day. The limit also applies on your own API key. | N3 N4 PL |
| 45 | message | The next run waits for the daily window to reset. | You can tailor again when the limit resets. | N5 PL |
| 51 | message | {dailyLeft} of {usage.dailyLimit} tailors left today; {claudeLeft} of {usage.claudeLimit} free Claude credit{usage.claudeLimit === 1 ? "" : "s"} left. | {dailyLeft} of {usage.dailyLimit} left today. {claudeLeft} of {usage.claudeLimit} free tailored CVs left in total. | N3 |
| 53 | message | The next run uses a free Claude credit. When those are used, your OpenRouter key takes over — the daily cap still applies. | Your next tailored CV is a free one. When the free ones are used, Jobhuntz uses your own API key. The daily limit still applies. | N3 N4 |
| 54 | message | The next run uses a free Claude credit. When those are used you will need an OpenRouter key; the daily cap applies either way. | Your next tailored CV is a free one. When the free ones are used, you will need your own API key. The daily limit applies in both cases. | N3 N4 |
| 60 | message | {dailyLeft} of {usage.dailyLimit} tailors left today; your free Claude credits are used. | {dailyLeft} of {usage.dailyLimit} left today. Your free tailored CVs are used. | N3 |
| 61 | message | The next run uses your OpenRouter key. Free models are slower and the run skips the polish retries; every honesty check still runs. | Your next tailored CV uses your own API key. Free models are slower, and some second attempts at wording are skipped. Every honesty check still runs. | N4 N5 PL |
| 66 | message | {dailyLeft} of {usage.dailyLimit} tailors left today, but your free Claude credits are used and there is no OpenRouter key. | {dailyLeft} of {usage.dailyLimit} left today, but your free tailored CVs are used and you have no API key. | N3 N4 |
| 67 | message | Add a free OpenRouter key below to keep tailoring. | Add your own API key below to keep tailoring. | N4 |

### lib/scoreChange.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 48 | message | Before tailoring: {c.before.matched}/{c.before.total} in your master CV. | Before tailoring: {c.before.matched}/{c.before.total} in your main CV. | N1 |
| 50 | message | Tailoring did not change which terms are matched. |  |  |
| 52 | message | Now matched: {list(c.gained)}. |  |  |
| 54 | message | No longer counted: {list(c.lost)} (in your master CV, but not in the tailored summary, skills, experience or projects, which are what this score reads). | No longer counted: {list(c.lost)} (in your main CV, but not in the tailored summary, skills, experience or projects, which are what this score reads). | N1 |

### lib/seniority.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 52 | message | junior / early-career |  |  |
| 75 | message | writing the RFCs / design docs |  |  |
| 186 | message | {shown} with {duty} duties |  |  |
| 221 | message | The posting doesn't say which level it is written for. | The job description does not say which level it is for. | N2 |
| 222 | message | This reads as {label}. | This looks like a {label} job. | PL |
| 224 | message | This reads as {label} — tailoring anyway will spend a credit. You look for junior and early-career roles only (Customise → Eligibility). | This looks like a {label} job. Tailoring anyway uses 1 tailored CV. You said you look for junior and early-career roles only (My CV → Eligibility). | N3 N7 PL |
| 228 | message | This reads as {label} (roles at this level usually expect {need}+ years) and your years of experience are not set in Customise → Eligibility, so it cannot be checked — set them. Tailoring anyway spends a credit. | This looks like a {label} job. Jobs at this level usually expect {need}+ years. Set your years of experience in My CV → Eligibility so we can check. Tailoring anyway uses 1 tailored CV. | N3 N7 SS |
| 230 | message | This reads as {label}; your {yearsExperience} years cover it. | This looks like a {label} job. Your {yearsExperience} years cover it. | PL |
| 234 | message | This reads as {label} — tailoring anyway will spend a credit. Roles at this level usually expect {need}+ years; you have {yearsExperience}. | This looks like a {label} job. Tailoring anyway uses 1 tailored CV. Jobs at this level usually expect {need}+ years; you have {yearsExperience}. | N3 PL |

### lib/tracker.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 22 | message | Ready to submit |  |  |
| 23 | label | Applied |  |  |
| 24 | label | Screening |  |  |
| 25 | label | Interview |  |  |
| 26 | label | Assessment |  |  |
| 27 | label | Offer |  |  |
| 28 | label | Won |  |  |
| 29 | label | Rejected |  |  |
| 30 | label | Withdrawn |  |  |
| 31 | label | Ghosted | No reply | GH |
| 50 | message | Ready to submit |  |  |
| 51 | label | Applied |  |  |
| 52 | label | Screening |  |  |
| 53 | label | Interview |  |  |
| 54 | label | Assessment |  |  |
| 55 | label | Offer |  |  |
| 56 | label | Accepted |  |  |
| 57 | label | Rejected |  |  |
| 58 | label | Withdrawn |  |  |
| 59 | label | Ghosted |  |  |
| 79 | message | Ready to submit |  |  |
| 80 | label | Applied |  |  |
| 81 | label | Screening |  |  |
| 82 | label | Interview |  |  |
| 83 | label | Offer |  |  |
| 84 | label | Rejected |  |  |
| 85 | label | Withdrawn |  |  |
| 193 | message | Follow-up {followup} cleared when marked {statusLabel(status)} on {today}. |  |  |
| 283 | message | Missing JD | Missing job description | N2 |
| 284 | message | Missing CV |  |  |
| 330 | message | The search-visibility score is weak: fewer than half of the role's terms are in this CV. | The search-visibility score is weak: fewer than half of the job's key words are in this CV. | PL |
| 331 | message | The eligibility read was "likely auto-rejected": the posting screens on a condition this profile does not meet. | The free check's advice was "likely to be rejected automatically": the job description screens on a condition you do not meet. | N8 N2 PL |
| 332 | message | The eligibility read was "long shot": one of the posting's conditions is a stretch for this profile. | The free check's advice was "low chance": you only partly meet one of the job's conditions. | N8 ID |
| 335 | message | on {d.date_applied} |  |  |
| 337 | message | You already have {d.company_name} — {d.role}{when}{status} in the tracker. | You already have {d.company_name}: {d.role}{when}{status} in Applications. | N6 SS |

### lib/triage/jdTriage.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 89 | label | Apply |  |  |
| 89 | label | Review |  |  |
| 89 | label | Skip |  |  |
| 91 | message | Years of experience |  |  |
| 92 | message | Security clearance |  |  |
| 93 | message | UK residence |  |  |
| 94 | message | Contract role |  |  |
| 95 | message | No sponsorship |  |  |
| 96 | message | Years of experience |  |  |
| 97 | message | Right to work for the duration |  |  |
| 98 | message | Right to work for the whole programme |  |  |
| 99 | message | Core language |  |  |
| 100 | message | Fixed-term contract |  |  |
| 101 | message | Right to work |  |  |
| 102 | message | Required language or framework |  |  |
| 103 | message | Desirable language or framework |  |  |
| 104 | message | Reapply wait |  |  |
| 105 | message | No new applications |  |  |
| 106 | message | Same role blocked |  |  |
| 107 | message | Applied for this role before |  |  |
| 215 | message | Fixed-term contract ({n} {n === 1 ? "month" : "months"}) |  |  |
| 215 | message | Fixed-term contract |  |  |
| 285 | message | React Native |  |  |
| 345 | message | desirable, not in your experience |  |  |
| 345 | message | one option, not in your experience |  |  |
| 346 | message | {t.name} ({note}) |  |  |
| 375 | message | {t.slice(0, max - 1).trimEnd()}… |  |  |
| 597 | message | The programme runs until {monthName(ends.month)}; your permission ends {monthName(permission)} |  |  |
| 645 | message | {TRIAGE_LABELS[t.verdict]}: {t.reasons.join("; ")} |  |  |

### lib/variants.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 55 | message | Only production-level skills can lead. Skipped: {dropped.map((d) => `${d.skill} (${word(d}. | Only production-level skills can be shown first. Skipped: {list}. | ID |
| 55 | message | {d.skill} ({word(d.reason)}) |  |  |
| 59 | label | Backend |  |  |
| 60 | label | Frontend |  |  |
| 61 | message | Full stack |  |  |
| 62 | message | AI engineering |  |  |
| 63 | message | Data engineering |  |  |
| 64 | message | ML engineering |  |  |
| 65 | message | DevOps / platform |  |  |
| 66 | label | Other |  |  |
| 119 | message | No positioning variants saved. | No headlines saved. | N10 |
| 120 | message | No variant applied (your choice for this run). | No headline used (your choice for this CV). | N10 N5 |
| 123 | message | {v.name} (your choice for this run). | {v.name} (your choice for this CV). | N5 |
| 127 | message | {byRole.name} - the posting reads as {ROLE_TYPE_LABEL[rt as RoleType] ?? rt}. | {byRole.name} - this looks like a {role type} job. | N2 PL |
| 129 | message | {variants[0].name} - your only variant, set for every role type. | {variants[0].name} - your only headline, set for every kind of job. | N10 |
| 132 | message | None of your variants is set for a {ROLE_TYPE_LABEL[rt as RoleType] ?? rt} role - tailoring uses your CV's own positioning. | None of your headlines is set for a {role type} job - tailoring uses your CV's own headline. | N10 |
| 132 | message | The posting's role type wasn't read - tailoring uses your CV's own positioning. | We could not tell what kind of job this is - tailoring uses your CV's own headline. | N10 N2 |
| 142 | message | - The summary's first line positions the candidate as: {variant.headline}. One positioning only - never a second role joined by a slash or a pipe. |  |  |
| 143 | message | - List these first, in this order, when the master CV genuinely shows them (skip any it does not): {variant.leadSkills.join(", ")}. |  |  |

### lib/visibilityVerdict.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 22 | message | Weak match. Do not send as-is. | Weak match. Do not send it yet. | ID |
| 23 | message | Borderline. Fix these before sending. |  |  |
| 24 | message | Ready to send. |  |  |
| 86 | message | Required skills: {required.matched}/{required.total} present. |  |  |
| 88 | message | Present: {coverage.matchedKeywords.join(", ") \|\| "} |  |  |
| 89 | message | Absent: {coverage.missedKeywords.join(", ") \|\| "(} |  |  |
| 91 | message | Required skills absent: {required.missedKeywords.join(", ")} |  |  |
| 122 | message | Weak fit. Company research scored {figure} (low match) against your CV; do not send as-is. | Weak fit. Company research scored {figure} (low match) against your CV. Do not send it yet. | ID |
| 123 | message | Company research: {figure}, low match. The search-term count above is not a fit score. |  |  |
| 129 | message | Borderline. The role's terms are covered, but company research scored {figure} (potential match). Fix the gaps before sending. |  |  |
| 130 | message | Company research: {figure}, potential match. |  |  |
| 136 | message | Company research: {figure}, {fit.tier === "high" ? "highly positive f}. |  |  |
| 172 | message | {kw} — not present in the tailored text |  |  |

### app/applications/[id]/interview/AvatarStage.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 66 | message | (max-width: 640px) |  |  |
| 109 | message | The 3D interviewer couldn't load. |  |  |
| 142 | text | Setting up the room{progress ? ` · ${progress}%` : "…"} |  |  |
| 142 | text | · {progress}% |  |  |
| 142 | text | The 3D interviewer couldn't load on this device — the interview works the same with captions. |  |  |
| 150 | text | {name}, {role}, your interviewer{speaking ? ", speaking" : ""}. |  |  |
| 150 | text | , speaking |  |  |

### app/applications/[id]/interview/FeedbackView.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 18 | message | {m} min {s % 60} s |  |  |
| 18 | message | {s} s |  |  |
| 27 | text | · your readout |  |  |
| 30 | text | of |  |  |
| 30 | text | checks met |  |  |
| 34 | text | Work on these first |  |  |
| 41 | text | Your answers were transcribed by your browser, so a mis-heard word isn't your mistake. Technical accuracy isn't judged here — only how you answered. |  |  |
| 42 | text | The AI review didn't come back this time, so these checks are the ones code can make on its own. |  |  |
| 48 | text | Question |  |  |
| 50 | text | What it was testing: |  |  |
| 52 | text | Your answer |  |  |
| 52 | text | · {formatSeconds(a.metrics.seconds)} |  |  |
| 52 | text | words |  |  |
| 61 | text | — “ |  |  |
| 61 | text | ” |  |  |
| 68 | text | You said |  |  |
| 68 | text | — your CV doesn't show |  |  |
| 68 | text | that figure |  |  |
| 68 | text | those figures |  |  |
| 68 | text | . An interviewer may ask where it comes from. |  |  |
| 74 | text | filler words ( |  |  |
| 74 | text | ). A short pause sounds more confident. |  |  |
| 80 | text | You said “we” |  |  |
| 80 | text | times and “I” |  |  |
| 80 | text | . Say what you did yourself. |  |  |
| 85 | text | Try this instead: |  |  |
| 89 | text | Not from your CV: rephrase before you say this |  |  |
| 92 | text | “ |  |  |
| 92 | text | ” |  |  |
| 98 | text | From your CV: |  |  |
| 104 | button | Try another round |  |  |
| 105 | button | Back to applications |  |  |

### app/applications/[id]/interview/InterviewRoom.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 78 | message | The microphone is blocked, so you can type your answers. To speak instead, allow the microphone for this site in the browser's address bar and reload. |  |  |
| 80 | message | Speech recognition lost its connection. Keep talking, or press T to type. |  |  |
| 153 | message | {interview.persona.firstName} needs a moment — carrying on in {wait} seconds. |  |  |
| 159 | message | This interview moved on in another tab. Reload the page to continue there. |  |  |
| 161 | message | The interviewer didn't respond. |  |  |
| 166 | message | The interviewer's reply was simplified this time (the AI didn't answer), so the interview moved to the next question. |  |  |
| 173 | message | The interviewer took too long to reply. Send your answer again. |  |  |
| 173 | message | Something went wrong. |  |  |
| 191 | message | Take your time — answer when you're ready. |  |  |
| 225 | message | Couldn't build your feedback. |  |  |
| 229 | message | Couldn't build your feedback. |  |  |
| 304 | message | {interview.persona.firstName} is speaking |  |  |
| 305 | message | Your turn — type your answer |  |  |
| 305 | message | Your turn — listening |  |  |
| 306 | message | {interview.persona.firstName} is thinking… |  |  |
| 307 | label | Paused |  |  |
| 308 | message | Writing your feedback… |  |  |
| 309 | label | Finished |  |  |
| 310 | message | Something went wrong |  |  |
| 316 | screen-reader label | Mock interview |  |  |
| 321 | text | Question {progress.asked} of {progress.total} |  |  |
| 321 | text | Closing questions |  |  |
| 332 | text | You |  |  |
| 334 | screen-reader label | Sending your answer when this fills |  |  |
| 339 | text | Start speaking when you're ready. When you pause, your answer is sent after a short countdown. |  |  |
| 345 | field label | Your answer |  |  |
| 355 | placeholder | Type your answer as you would say it. Ctrl+Enter to send. |  |  |
| 366 | button | I've finished my answer |  |  |
| 370 | button | Skip to my answer |  |  |
| 373 | button | Repeat the question |  |  |
| 376 | button | Resume |  |  |
| 376 | button | Pause |  |  |
| 379 | button | Type instead |  |  |
| 382 | button | End interview |  |  |
| 387 | screen-reader label | End the interview? |  |  |
| 388 | text | Leave before answering anything? Your credit has been used. | Leave before answering anything? This interview has already counted as 1 tailored CV. | N3 |
| 388 | text | End now and get feedback on the answers you've given? |  |  |
| 389 | button | Leave |  |  |
| 389 | button | End and get feedback |  |  |
| 390 | button | Keep going |  |  |
| 394 | text | Keys: Enter or Space finish your answer · Esc skip or end · R repeat · P pause |  |  |
| 394 | text | · T type |  |  |
| 397 | text | Transcript so far |  |  |
| 401 | text | You |  |  |

### app/applications/[id]/interview/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 7 | message | Mock interview |  |  |

### app/applications/[id]/interview/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 29 | message | Your session has expired — sign in again to continue. |  |  |
| 108 | message | Couldn't load this application. |  |  |
| 117 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 163 | message | The natural voice couldn't load. |  |  |
| 206 | message | Hi, I'm {persona.firstName}. I'll be interviewing you today. |  |  |
| 225 | message | Couldn't start the interview. |  |  |
| 234 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 251 | message | That interview has no feedback yet. |  |  |
| 281 | message | Save your master CV first. | Save your main CV first. | N1 |
| 281 | message | The interviewer's questions are built from it. |  |  |
| 281 | message | Go to Customise → | Go to My CV → | N7 |
| 282 | message | Add the job description first. |  |  |
| 282 | message | The interview is built from it. Paste it into this application in the tracker, then come back. | The interview is built from it. Paste it into this application in Applications, then come back. | N6 |
| 282 | message | Open the tracker → | Open your applications list → | N6 |
| 283 | message | Mock interviews aren't switched on yet. |  |  |
| 284 | message | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| 284 | message | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| 284 | message | Add your key in Settings → | Add my API key → | N4 BT |
| 285 | message | Your Gemini key can't run mock interviews. | Your Gemini key cannot run a mock interview. | PL |
| 285 | message | Once your free Claude credits are used, interviews run on an OpenRouter key. Add one in Settings to continue. | After your free tailored CVs are used, a mock interview needs an OpenRouter key. Add one in Settings to continue. | N3 |
| 285 | message | Add an OpenRouter key → |  |  |
| 286 | message | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| 286 | message | Your saved key can no longer be read. Please go to Settings and replace it. |  |  |
| 286 | message | Go to Settings → |  |  |
| 287 | message | Your key's daily limit is reached. | Your API key has reached today's limit. | N4 |
| 287 | message | Its free quota resets daily — come back tomorrow to continue. |  |  |
| 293 | message | The natural voice is too slow on this device ({kokoro.factor.toFixed(1)}× real time), so {persona.firstName} will use your browser's British voice. |  |  |
| 294 | message | The natural voice couldn't load ({kokoro.reason}), so {persona.firstName} will use your browser's British voice. |  |  |
| 300 | title | Mock interview |  |  |
| 301 | page tagline | {row.role} at {row.company_name} — a UK interview, out loud, built from this job and your CV. |  |  |
| 301 | page tagline | A UK interview, out loud, built from the job and your CV. |  |  |
| 304 | text | ← Back to applications |  |  |
| 305 | text | Prep pack | Interview pack | N16 |
| 308 | label | Loading the interview room |  |  |
| 312 | button | Sign in |  |  |
| 317 | title | This application doesn't exist |  |  |
| 317 | button | Back to applications |  |  |
| 317 | text | It may have been deleted, or the link is wrong. |  |  |
| 323 | title | Add the job description first |  |  |
| 323 | button | Open the tracker | Open your applications list | N6 |
| 324 | text | The interviewer's questions come from the job description. Paste it into this application in the tracker, then come back. | The interviewer's questions come from the job description. Paste it into this application in Applications, then come back. | N6 |
| 381 | text | Loading the 3D interviewer{avatar.pct ? ` · ${avatar.pct}%` : "…"} — choose the round and voice meanwhile; nothing waits for it. |  |  |
| 381 | text | · {avatar.pct}% |  |  |
| 383 | text | {persona.name} is ready. |  |  |
| 384 | text | The 3D interviewer couldn't load on this device — the interview runs the same with the voice and captions. |  |  |
| 387 | text | Choose the round |  |  |
| 396 | text | min · |  |  |
| 396 | text | questions |  |  |
| 398 | text | With |  |  |
| 407 | text | Voice and microphone |  |  |
| 409 | text | 's voice |  |  |
| 410 | screen-reader label | Interviewer voice |  |  |
| 411 | field label | Your browser's British voice (instant) |  |  |
| 412 | field label | Natural British voice |  |  |
| 412 | field label | (needs WebGPU — not on this browser) |  |  |
| 413 | field label | Captions only |  |  |
| 418 | text | Downloading the voice once (about 160–330 MB, then cached) · |  |  |
| 422 | text | Downloads about 160–330 MB once, then it's cached. A quick speed test decides whether this device can keep up. |  |  |
| 423 | text | Until it is loaded, {persona.firstName} uses your browser's British voice — you can start now. |  |  |
| 425 | button | Load the natural voice |  |  |
| 430 | text | Loaded · |  |  |
| 430 | text | × real time on this device. |  |  |
| 433 | button | Hear |  |  |
| 438 | text | Your answers |  |  |
| 439 | screen-reader label | How you answer |  |  |
| 440 | field label | Speak |  |  |
| 440 | field label | (this browser can't transcribe speech — use Chrome or Edge) |  |  |
| 441 | field label | Type |  |  |
| 445 | button | Say something… |  |  |
| 445 | button | Test your microphone |  |  |
| 449 | text | Heard you. |  |  |
| 449 | text | Very quiet — check your microphone. |  |  |
| 450 | text | The microphone is blocked. Allow it in the address bar, or type your answers. |  |  |
| 452 | field label | Send after a pause of |  |  |
| 454 | choice | 2 seconds |  |  |
| 455 | choice | 3 seconds |  |  |
| 456 | choice | 5 seconds |  |  |
| 463 | text | Chrome and Edge send your voice to Google or Microsoft to turn it into text; Jobhuntz never receives or stores audio, only the text. Typing sends nothing extra. |  |  |
| 464 | text | Your typed answers are saved with this interview so you can review them. |  |  |
| 472 | text | with |  |  |
| 472 | text | · about |  |  |
| 472 | text | minutes. Interviews stay private to you and are deleted with the application. |  |  |
| 476 | button | Preparing your interviewer… |  |  |
| 476 | button | Start interview · uses 1 credit | Start interview · counts as 1 tailored CV | N3 |
| 478 | text | left today |  |  |
| 480 | text | You've used today's credits. Add your own key in Settings to keep going. | You have reached today's limit of 3. You can start an interview tomorrow. | N3 PL |
| 485 | text | Your interviews for this job |  |  |
| 490 | text | Not finished |  |  |
| 491 | button | View feedback |  |  |

### app/applications/[id]/prep/PracticeMode.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 64 | message | Answer shown. |  |  |
| 71 | message | Rated {RATING_LABEL[value]}. |  |  |
| 140 | screen-reader label | Practice mode |  |  |
| 143 | text | {deck.length} / {deck.length} |  |  |
| 143 | text | {index + 1} / {deck.length} |  |  |
| 151 | screen-reader label | Practice progress |  |  |
| 161 | tooltip / title | Rate a question Shaky first |  |  |
| 163 | button | Review shaky only |  |  |
| 163 | button | · {shakyCount} |  |  |
| 166 | button | Exit |  |  |
| 181 | button | Show answer |  |  |
| 182 | text | Think it through out loud first. |  |  |
| 188 | text | Why they ask |  |  |
| 192 | screen-reader label | How did that go? |  |  |
| 193 | text | How did that go? |  |  |
| 195 | button | Shaky |  |  |
| 198 | button | OK |  |  |
| 201 | button | Nailed it |  |  |
| 208 | button | ← Previous |  |  |
| 211 | button | Finish → |  |  |
| 211 | button | Next → |  |  |
| 215 | text | Space |  |  |
| 215 | text | reveal · |  |  |
| 215 | text | rate · |  |  |
| 216 | text | move · |  |  |
| 216 | text | Esc |  |  |
| 216 | text | exit |  |  |
| 221 | text | Nothing to review. |  |  |
| 221 | text | Deck complete. |  |  |
| 224 | text | Nailed it |  |  |
| 225 | text | OK |  |  |
| 226 | text | Shaky |  |  |
| 227 | text | Unrated |  |  |
| 231 | button | Restart |  |  |
| 234 | button | Review shaky · |  |  |
| 238 | button | Exit practice |  |  |

### app/applications/[id]/prep/PrepPackView.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 16 | message | Not from your CV: rephrase before you say this |  |  |
| 30 | text | : “{f.sentence.length > 60 ? `${f.sentence.s}” |  |  |
| 30 | text | {f.sentence.slice(0, 59)}… |  |  |
| 42 | button | Rewriting from your CV… |  |  |
| 42 | button | Use only CV facts |  |  |
| 48 | label | Behavioural |  |  |
| 49 | label | Technical |  |  |
| 50 | message | Role & motivation |  |  |
| 51 | label | Company |  |  |
| 52 | message | Honest gap |  |  |
| 57 | label | Shaky |  |  |
| 57 | message | Nailed it |  |  |
| 69 | text | Situation |  |  |
| 70 | text | Task |  |  |
| 71 | text | Action |  |  |
| 72 | text | Result |  |  |
| 104 | text | From your CV |  |  |
| 108 | text | ✓ Traced to your CV |  |  |
| 108 | text | Couldn't trace — check before using |  |  |
| 117 | text | Check these figures against your CV before you say them: |  |  |
| 135 | text | Why they ask |  |  |
| 164 | message | Couldn't copy — select the text and copy it manually. |  |  |
| 170 | message | the CV you sent |  |  |
| 179 | heading | Your angle |  |  |
| 203 | text | Honest gaps — say these plainly, never dress them up |  |  |
| 218 | heading | Likely questions |  |  |
| 221 | screen-reader label | Filter questions by category |  |  |
| 228 | button | All · |  |  |
| 252 | heading | Questions to ask them |  |  |
| 263 | heading | 30-second opener |  |  |
| 270 | button | Copied ✓ |  |  |
| 270 | button | Copy opener |  |  |
| 280 | text | Built from |  |  |
| 282 | text | {pack.check.sentences} sentence{pack.check.sentences === 1 ? "" : "s"} checked against your master CV — {pack.check.flagged} marked as not from it{pack.check.removed > 0 ? `, ${pack.check}. | {n} sentence(s) checked against your main CV. {flagged} marked as not from it{, removed …}. | N1 SS |
| 283 | text | , {pack.check.removed} company claim{pack.check.removed === 1 ? "" : "s"} removed because the job description and your research don't state {pack.check.removed === 1 ? "it" : "them"} |  |  |
| 285 | text | Generated before sentence checks existed — regenerate to check it against your CV. |  |  |

### app/applications/[id]/prep/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 7 | message | Interview prep |  |  |

### app/applications/[id]/prep/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 26 | message | Your session has expired — sign in again to see your prep pack. | Your session has expired. Sign in again to see your interview pack. | N16 SS |
| 39 | message | Reading the job description and your CV |  |  |
| 40 | message | Matching their stack to your real experience |  |  |
| 41 | message | Writing STAR answers from what you actually did |  |  |
| 42 | message | Tracing every claim back to your CV |  |  |
| 89 | message | Couldn't load this application. |  |  |
| 100 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 152 | message | Couldn't build your prep pack. Try again. | Couldn't build your interview pack. Try again. | N16 |
| 157 | message | The prep pack came back in an unexpected shape. Try again. | The interview pack came back in an unexpected shape. Try again. | N16 |
| 164 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 187 | message | Couldn't rewrite that. Try again. |  |  |
| 189 | message | The prep pack came back in an unexpected shape. Try again. | The interview pack came back in an unexpected shape. Try again. | N16 |
| 193 | message | {n(data.rewritten)} sentence{n(data.rewritten) === 1 ? "" : "s"} rewritten from your CV, {n(data.removed)} removed{data.model?.error ? " — the model gave n}{data.saved === false ? " (not saved: rel}. |  |  |
| 194 | message | — the model gave no usable answer, so nothing was rewritten |  |  |
| 195 | message | (not saved: reload and it will be gone) |  |  |
| 198 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 216 | message | Couldn't build the PDF. Try again. |  |  |
| 221 | message | Couldn't reach the server. Try again. |  |  |
| 237 | text | Save your master CV first. | Save your main CV first. | N1 |
| 238 | text | Every answer in the pack is built from it — there is nothing to build from yet. |  |  |
| 239 | button | Go to Customise → | Go to My CV → | N7 |
| 245 | text | Add the job description first. |  |  |
| 246 | text | The prep pack is built from it. Paste it into this application in the tracker, then come back. | The interview pack is built from it. Paste it into this application on Applications, then come back. | N16 N6 |
| 247 | button | Open the tracker → | Open your applications list → | N6 |
| 253 | text | Your 3 free tailors are used up. | You have used your 3 free tailored CVs. | N3 |
| 254 | text | Add your own key to keep going — it takes 2 minutes and the tool stays free. | Add your own API key to continue. It is free and takes about 2 minutes. | N4 ID |
| 255 | button | Add your key in Settings → | Add my API key → | N4 BT |
| 261 | text | Your Gemini key can't run interview prep. | Your Gemini key cannot make an interview pack. | N16 |
| 262 | text | Once your free Claude credits are used, prep runs on an OpenRouter key. Add one in Settings to continue. | After your free tailored CVs are used, an interview pack needs an OpenRouter key. Add one in Settings to continue. | N3 |
| 263 | button | Add an OpenRouter key → |  |  |
| 269 | text | Your API key needs to be re-entered. | Please enter your API key again. | N4 |
| 270 | text | Your saved key can no longer be read. Please go to Settings and replace it. |  |  |
| 271 | button | Go to Settings → |  |  |
| 277 | text | Your key's daily limit is reached. | Your API key has reached today's limit. | N4 |
| 278 | text | Its free quota resets daily — come back tomorrow to continue. |  |  |
| 294 | text | Usually 1–2 minutes — it writes and checks every answer · |  |  |
| 294 | text | s |  |  |
| 302 | title | Interview prep |  |  |
| 305 | page tagline | {row.role} at {row.company_name} — answers from your real CV, checked sentence by sentence. |  |  |
| 306 | page tagline | Answers from your real CV, checked sentence by sentence. |  |  |
| 310 | text | ← Back to applications |  |  |
| 315 | label | Loading your prep pack | Loading your interview pack | N16 |
| 323 | button | Sign in |  |  |
| 330 | title | This application doesn't exist |  |  |
| 330 | button | Back to applications |  |  |
| 331 | text | It may have been deleted, or the link is wrong. |  |  |
| 344 | title | Add the job description first |  |  |
| 344 | button | Open the tracker | Open your applications list | N6 |
| 345 | text | The prep pack is built from the job description. Paste it into this application's JD cell in the tracker, then come back here. | The interview pack is built from the job description. Add the job description to this application on Applications, then come back here. | N16 N6 |
| 352 | text | What you'll get |  |  |
| 354 | text | 8–10 likely questions for this exact role: behavioral, technical, motivation, company — and the honest gaps they'll probe. |  |  |
| 355 | text | A STAR answer for each, built from your master CV and checked sentence by sentence: the CV lines it came from with a ✓ when they trace verbatim, and a mark on any sentence the check couldn't trace, with one click to rewrite it from CV facts alone. | A STAR answer for each, built from your main CV and checked sentence by sentence: the CV lines it came from with a ✓ when they trace verbatim, and a mark on any sentence the check couldn't trace, with one click to rewrite it from CV facts alone. | N1 |
| 356 | text | Questions worth asking them, and a 30-second opener. |  |  |
| 357 | text | Practice mode: one question at a time, reveal the answer, rate yourself, review the shaky ones. |  |  |
| 363 | button | Generate prep pack | Make my interview pack | N16 BT |
| 368 | text | Uses 1 tailor credit · saved to this application, so opening it again is free. | Counts as 1 tailored CV · saved with this application, so opening it again is free. | N3 |
| 369 | text | {remaining} of {usage.dailyLimit} tailors left today. | {remaining} of {usage.dailyLimit} tailored CVs left today. | N5 |
| 373 | text | You've used today's | You have reached today's limit of | N3 PL |
| 373 | text | tailors — come back tomorrow, or add your own key in Settings. | . You can make an interview pack tomorrow. | N3 N16 SS |
| 385 | text | Generated |  |  |
| 390 | text | Regenerating uses 1 credit and resets your ratings. | Making it again counts as 1 tailored CV and resets your ratings. | N3 PL |
| 392 | button | Confirm |  |  |
| 395 | button | Cancel |  |  |
| 400 | button | Regenerate… |  |  |
| 404 | button | Preparing… |  |  |
| 404 | button | Download PDF |  |  |
| 408 | button | Practice |  |  |
| 412 | text | Mock interview |  |  |

### app/error.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 25 | text | Something went wrong |  |  |
| 26 | heading | This page hit an error |  |  |
| 28 | text | Your saved CV and applications are safe — this only affects what's on screen. Try again, or head back to the app. |  |  |
| 32 | button | Try again |  |  |
| 33 | button | Back to app |  |  |

### app/interviews/layout.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 6 | label | Interviews |  |  |

### app/interviews/page.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 21 | message | Every mock interview and every prep pack, across all your applications. | Every mock interview and every interview pack, across all your applications. | N16 |
| 56 | message | Your session has expired — sign in again to see your interviews. |  |  |
| 59 | message | Could not load your interviews. |  |  |
| 69 | message | Couldn't reach the server. Check your connection and try again. |  |  |
| 83 | title | Interviews |  |  |
| 88 | text | Mock interviews |  |  |
| 90 | label | Loading your interviews |  |  |
| 92 | title | No mock interviews yet |  |  |
| 92 | button | Open the tracker | Open your applications list | N6 |
| 93 | text | Each tracker row has an Interview button: pick the UK round, and an interviewer built from that job and your CV asks the questions out loud. One tailor credit each. | Each application has an Interview button. Pick the UK round, and an interviewer built from that job and your CV asks the questions out loud. Each interview counts as 1 tailored CV. | N3 SS |
| 104 | text | {app.company_name} — {app.role} |  |  |
| 104 | text | Application deleted |  |  |
| 109 | text | Not finished |  |  |
| 109 | text | No feedback |  |  |
| 112 | text | Open |  |  |
| 122 | text | Prep packs | Interview packs | N16 |
| 124 | label | Loading your prep packs | Loading your interview packs | N16 |
| 126 | title | No prep packs yet | No interview packs yet | N16 |
| 126 | button | Open the tracker | Open your applications list | N6 |
| 127 | text | Each tracker row has a Prep button: the likely questions for that job with answers built only from your CV, each line traced back to it. | Each application has a Prep button: the likely questions for that job with answers built only from your CV, each line traced back to it. | N6 |
| 135 | text | · built |  |  |
| 138 | text | Open |  |  |

### app/not-found.tsx

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 10 | heading | That page doesn't exist |  |  |
| 12 | text | The link may be old or mistyped. Everything you need is one click away. |  |  |
| 15 | button | Open the app |  |  |
| 16 | button | Home |  |  |

### lib/answerBank.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 47 | message | Do you require visa sponsorship? (Yes / No) |  |  |
| 48 | message | Do you have the right to work in the UK? (Yes / No) |  |  |
| 49 | message | Visa / sponsorship details (free text) |  |  |
| 50 | message | When can you start? |  |  |
| 51 | message | Can you work full time? (Yes / No) |  |  |
| 63 | message | from {from} |  |  |
| 66 | message | I am available {when}{hours}. |  |  |
| 74 | message | No sponsorship required. |  |  |
| 74 | message | I will require visa sponsorship. |  |  |
| 125 | message | Will you now or in the future require sponsorship? |  |  |
| 126 | message | Will you now or in the future require sponsorship for employment visa status? |  |  |
| 127 | message | Do you require visa sponsorship? |  |  |
| 128 | message | Do you require sponsorship to work in the UK? |  |  |
| 129 | message | Will you require visa sponsorship to work in the UK? |  |  |
| 130 | message | Would you need sponsorship to take up this role? |  |  |
| 131 | message | Do you require a Certificate of Sponsorship? |  |  |
| 132 | message | Do you need a work permit to work in the UK? |  |  |
| 133 | message | Do you require a visa to work in the UK? |  |  |
| 135 | message | Do you have the right to work in the UK? |  |  |
| 136 | message | Do you have the legal right to work in the United Kingdom? |  |  |
| 137 | message | Are you legally authorised to work in the UK? |  |  |
| 138 | message | Are you eligible to work in the UK? |  |  |
| 139 | message | Are you legally entitled to work in the UK? |  |  |
| 140 | message | Are you eligible to work in the country where this role is based? |  |  |
| 142 | message | Please provide details of your visa status |  |  |
| 143 | message | Please describe your visa and sponsorship requirements |  |  |
| 144 | message | What is your current immigration status? |  |  |
| 145 | message | What is your right to work status? |  |  |
| 146 | message | What type of visa do you hold? |  |  |
| 147 | message | When can you start? |  |  |
| 148 | message | When are you available to start? |  |  |
| 149 | message | What is your notice period? |  |  |
| 150 | message | What is your earliest start date? |  |  |
| 151 | message | Are you able to work full time? |  |  |
| 152 | message | Can you work full time? |  |  |
| 153 | message | Are you available to work full time? |  |  |
| 228 | message | This question asks about the future, and your permission to work is time-limited{ends ? ` (until ${ends})` : ""}. Check this answer is right for you before you send it. |  |  |
| 228 | message | (until {ends}) |  |  |
| 232 | message | A consent or declaration question: answer it yourself. We never fill these in. |  |  |
| 233 | message | A criminal-record question: answer it yourself. We never fill these in. |  |  |

### lib/companyRules.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 32 | message | Wait before reapplying |  |  |
| 33 | message | No new applications until |  |  |
| 34 | message | Not the same role again |  |  |
| 122 | message | {m < 9 ? y : y + 1}-09-01 |  |  |
| 137 | message | (?:(?![,;:]\|(?:and\|but\|however\|while\|whereas\|although))[^.!? ]) |  |  |
| 188 | message | {cut.slice(0, Math.max(cut.lastIndexOf(" }… |  |  |
| 208 | message | {Number(date.slice(0, 4)) + 1}-01-01 |  |  |
| 271 | message | , from "{clipWords(s, REASON_SOURCE_CHARS)}" |  |  |
| 285 | message | Wait {rule.value} days before reapplying (no application date on record yet) |  |  |
| 286 | message | Reapply after {dayMonthYear(until)} ({rule.value} days) |  |  |
| 288 | message | No new applications until {dayMonthYear(rule.value)} |  |  |
| 289 | message | Not the same role again: {rule.value} |  |  |
| 315 | message | A rule you saved for {r.company_name}. |  |  |
| 318 | message | reapply wait of {r.value} days, no application date on record{fromSource(r.source_text)} |  |  |
| 319 | message | reapply after {dayMonthYear(until)}{fromSource(r.source_text)} |  |  |
| 321 | message | no reapply until {dayMonthYear(r.value)}{fromSource(r.source_text)} |  |  |
| 323 | message | same role blocked ({r.value}){fromSource(r.source_text)} |  |  |
| 325 | message | same-role block on {r.value}; check this is a different role{fromSource(r.source_text)} |  |  |
| 336 | message | reapply after {dayMonthYear(until)} (you applied {dayMonthYear(last)}){fromSource(d.source_text)} |  |  |
| 346 | message | on {dayMonthYear(before.date_applied)} |  |  |
| 347 | message | rejected for this role{when} |  |  |
| 347 | message | already applied for this role{when} ({STATUS_LABELS[status]}) |  |  |
| 348 | message | Your tracker: {String(before.company_name)}, {String(before.role ?? "")}{when}, {STATUS_LABELS[status]}. | your applications list: {String(before.company_name)}, {String(before.role ?? "")}{when}, {STATUS_LABELS[status]}. | N6 |
| 386 | message | Name the company. |  |  |
| 387 | message | The company name is too long (max {MAX_NAME_CHARS} characters). |  |  |
| 389 | message | Pick a kind of rule. |  |  |
| 394 | message | Enter the wait as a number of days (1 to {MAX_RULE_DAYS}). |  |  |
| 397 | message | Enter the date as YYYY-MM-DD. |  |  |
| 401 | message | Name the role. |  |  |
| 402 | message | The role is too long (max {MAX_NAME_CHARS} characters). |  |  |
| 407 | message | Only a wait counts from a date. |  |  |
| 408 | message | Enter the start date as YYYY-MM-DD. |  |  |
| 412 | message | Keep what they said under {MAX_SOURCE_CHARS} characters. |  |  |

### lib/factGuard.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 36 | message | OpenAI API |  |  |
| 40 | message | Google Cloud |  |  |
| 43 | message | Claude Code |  |  |
| 75 | message | {d} → {own} |  |  |
| 83 | message | OpenAI API |  |  |
| 144 | message | GitHub Actions |  |  |
| 172 | message | Cloud & DevOps |  |  |
| 455 | message | Removed, as your master CV describes the role differently: | Removed, as your main CV describes the role differently: | N1 |
| 456 | message | Kept as written; check these against your master CV (Customize → Claims registry → "Wording your CV must never say" keeps a phrase out for good): | Kept as written. Check these against your main CV. (My CV → Skill levels → "Wording your CV must never say" keeps a phrase out for good.) | N1 N7 N9 SS |
| 457 | message | Summary lines copied from the job ad, check they are true: | Summary lines copied from the job description. Check they are true: | N2 SS |
| 458 | message | Removed tools not in your master CV: | Removed tools not in your main CV: | N1 |
| 459 | message | Degree name corrected to your master CV: | Degree name corrected to your main CV: | N1 |

### lib/projectPool.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 65 | message | card-{out.length + 1} |  |  |
| 92 | message | That is {cards.length} projects, and the pool holds {MAX_POOL_CARDS}. Remove {cards.length - MAX_POOL_CARDS} to save. | That is {cards.length} projects, and the project list holds {MAX_POOL_CARDS}. Remove {cards.length - MAX_POOL_CARDS} to save. | N11 |
| 94 | message | A project |  |  |
| 95 | message | A project name is over {MAX_NAME} characters. Shorten it to save. |  |  |
| 96 | message | {name}: a date is over {MAX_DATE} characters. Shorten it to save. |  |  |
| 97 | message | {name}: "What you did" is {card.body.trim().length.toLocaleString("} characters, over the {MAX_BODY.toLocaleString("en-GB")} limit. Shorten it to save. |  |  |
| 98 | message | {name}: the label is over {MAX_LABEL} characters. Shorten it to save. |  |  |
| 99 | message | {name}: that is {card.tech.length} tech items, over the {MAX_TECH_ITEMS} limit. Remove some to save. |  |  |
| 101 | message | {name}: "{long.trim().slice(0, 40)}…" is too long for a tech item. Shorten it or move it to "What you did". |  |  |
| 145 | message | {start} – {end} |  |  |
| 152 | message | {card.name} ({label}) |  |  |
| 162 | message | Tech: {card.tech.join(", ")} |  |  |
| 231 | message | You pinned {pinned} but {settings.count === "auto" ? "Auto chose"} {count}. |  |  |
| 231 | message | Auto chose |  |  |
| 256 | message | Auto ({count}) |  |  |
| 256 | message | Newest first |  |  |
| 256 | message | Most relevant |  |  |
| 379 | message | {chosen} projects don't fit on 1 page; showing {showing}. Switch to 2 pages or pick {showing}. |  |  |
| 384 | message | Your {pinned} pinned projects don't fit on 1 page. Switch to 2 pages or unpin one. |  |  |

### lib/quality.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 287 | message | {kept.replace(/[.!?]$/, "")}. |  |  |
| 313 | message | ends with a clause narrating its relevance to the employer — state what was built, how, and the result, then stop |  |  |
| 314 | message | filler: {h.word} (twice in one bullet) |  |  |
| 314 | message | filler: {h.word} |  |  |
| 315 | message | placeholder "{p}" — never template text; state the result without a figure when the master CV gives none |  |  |
| 317 | message | runs to {bulletLines(bullet)} printed lines — at most {MAX_BULLET_LINES}; cut words, never facts |  |  |
| 319 | message | repeats a word ({rep}) — say it once |  |  |
| 324 | message | {n} words — at most {style.maxWords} in this style; {generated ? "cut words, never facts" : "} |  |  |
| 324 | message | cut words, never facts |  |  |
| 326 | message | "{w}" is banned in this style — the plain equivalent the rules allow, or another bullet |  |  |
| 345 | message | opens with "{f.bullet.trim().split(/\s+/)[0]}", already the opening verb of {style.verbCap} bullets — at most {style.verbCap} in this style; open on a different verb or pick another bullet |  |  |

### lib/suggestionCheck.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 144 | message | (?:into\|under\|to\|in)s+(?:yours+\|thes+)?(?:[w&.'’-]+s+){0,3}?{e.replace(/[.*+?^${}()\|[\]\\]/g, "\\$&")} |  |  |
| 259 | message | {term}: your CV may show the work as “{shown}”. If it is the same work, name it in your master CV in your own words; the suggested line goes further than that. | {term}: your CV may show the work as “{shown}”. If it is the same work, name it in your main CV in your own words; the suggested line goes further than that. | N1 |
| 261 | message | {term}: your master CV doesn't show this. Add it only with real work you can point to. | {term}: your main CV doesn't show this. Add it only with real work you can point to. | N1 |
| 263 | message | A suggestion moved project work into a paid role, so it isn't listed. Your master CV shows that work in a project. | A suggestion moved project work into a paid role, so it isn't listed. Your main CV shows that work in a project. | N1 |
| 264 | message | A suggestion went beyond what your master CV shows, so it isn't listed. Add only what you can point to. | A suggestion went beyond what your main CV shows, so it isn't listed. Add only what you can point to. | N1 |

### lib/postingAge.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 67 | message | Applied within 3 days of posting | Applied within 3 days of the job being posted | N2 |
| 68 | message | Applied 4–14 days after posting | Applied 4–14 days after the job was posted | N2 |
| 69 | message | Applied 15+ days after posting | Applied 15+ days after the job was posted | N2 |

### lib/retiredClaims.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 50 | message | {r.phrase} => {r.replacement} |  |  |
| 61 | message | {phrase} => {replacement} |  |  |
| 262 | message | This still says {list}, which your list on Customise rules out. Edit it in the preview, then download. | This still says {list}, which your list on My CV rules out. Edit it in the preview, then download. | N7 |

### lib/importJob/fetchJob.ts

| Line | Where | Current text | Proposed text | Reason |
|---|---|---|---|---|
| 33 | message | Paste a job link first. |  |  |
| 34 | message | That link is too long to be a job posting. | That link is too long to be a job link. | N2 |
| 37 | message | That isn't a link we can read yet. We read job links from {SUPPORTED_SOURCES_TEXT}. |  |  |
| 45 | message | We couldn't reach {label} just now, or that link leads off {label}. Paste the posting's own link instead. | We couldn't reach {label} just now, or that link leads off {label}. Paste the job's own link instead. | N2 |
| 46 | message | {label} has no posting at that link. It may have closed. | {label} has no job at that link. It may have closed. | N2 |
| 49 | message | We found that link on {label} but couldn't tell which company it belongs to. |  |  |
| 55 | message | We couldn't reach {label} just now. Try again in a minute. | We couldn't reach {label} just now, or that link leads off {label}. Paste the job's own link instead. | N2 |
| 56 | message | {label} has no posting at that link. It may have closed. | {label} has no job at that link. It may have closed. | N2 |
| 59 | message | LinkedIn wouldn't show us that posting just now. | LinkedIn wouldn't show us that job just now. | N2 |
| 59 | message | {label} answered with an error (HTTP {page.status}). |  |  |
| 62 | message | We found that link on {label} but couldn't read a job description from it. |  |  |

