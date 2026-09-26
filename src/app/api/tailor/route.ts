import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, Provider, ProviderRateLimitError, ProviderCreditError, MODELS } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { resolveLlmRoute, formatDuration, loadOwnOpenRouterKey } from "@/lib/llmRouting";
import { chooseFallback, openRouterLimitMessage, fallbackExhaustedMessage, type FallbackReason } from "@/lib/fallbackRoute";
import { MAX_CV_CHARS, MAX_JD_CHARS, MAX_POOL_CHARS, MAX_CLAIMS_JSON, MAX_ELIGIBILITY_JSON, CV_TOO_LONG, JD_TOO_LONG, POOL_TOO_LONG } from "@/lib/limits";
import { normalizeClaims, renderClaimsBlock, checkClaims, looksLikeRefusal, demoteProjectTools, type ClaimsRegistry } from "@/lib/claims";
import { normalizeVariants, renderVariantBlock, productionLeadSkills, type Variant } from "@/lib/variants";
import { normalizePreferences } from "@/lib/preferences";
import { stripRightToWorkSentences, stripRightToWorkLines, stripRightToWorkBullets, mentionsRightToWork } from "@/lib/rightToWorkText";
import {
  summaryPrompt,
  skillsPrompt,
  experiencePrompt,
  projectsPrompt,
  poolProjectsPrompt,
  COMPANY_RESEARCH_PROMPT,
  coverLetterPrompt,
  coverLetterFixPrompt,
  claimsRepairPrompt,
  supportCheckPrompt,
  atsScoringPrompt,
  JD_ANALYZER_PROMPT,
  rejectedBulletsBlock,
} from "@/prompts/steps";
import { lintBullets, countFlags, trimBoltOn } from "@/lib/quality";
import { fitOnePage, fitTwoPages, experienceRefillCandidates, projectRefillCandidates, type PageFitReport, type RefillCandidate } from "@/lib/onePage";
import { buildHeadline, degreesInProgress } from "@/lib/headline";
import { normalizeEligibility } from "@/lib/knockouts";
import { normalizeProfile } from "@/lib/profile";
import { coreTitle, titleInText, titleAsIdentity } from "@/lib/roleTitle";
import { unsupportedProperNouns, sentencesNaming, dropSentences } from "@/lib/properNouns";
import { experienceBudget, onePageExperienceBudget, projectsBudget, normalizeExperienceOutput } from "@/lib/contentBudget";
import { parseMasterExperience, renderIdBlock, reconcileExperience, diffAgainstMaster, diffProjects } from "@/lib/bulletIds";
import { normalizeSelectedProjects, projectsFromSelected } from "@/lib/poolProjects";
import { sanitizeCompanyResearch } from "@/lib/companyResearch";
import { matchAtsKeywords, tailoredSectionsText } from "@/lib/atsMatch";
import {
  surgicalUntilStable,
  listRepairs,
  checkSections,
  normalizeRepairEdits,
  applyModelEdits,
  replacementPasses,
  applyToSection,
  type RepairSections,
} from "@/lib/claimRepair";
import { buildEvidenceMap, renderEvidenceBlock, graftRules, poolCoverageBlock, projectFacts } from "@/lib/evidenceMap";
import {
  supportSentences,
  normalizeSupportVerdicts,
  decideSupport,
  trimNarration,
  fixHeldDegrees,
  statesDegreeAsHeld,
  dropRepeatedSentences,
  mergedProjects,
  isMergeProblem,
  type SupportReport,
} from "@/lib/supportCheck";
import { normalizeLetter, capEmDashes } from "@/lib/letterFormat";
import { reconcileAtsScore, renderBandBlock } from "@/lib/visibilityVerdict";
import { applyFormatRules } from "@/lib/formatRules";

// Minimal shape check for a client-supplied analysis object (from the
// pre-tailoring ATS gate — see runPipeline's precomputedAnalysis param). Not a
// security boundary: the JD itself is already fully user-controlled input, so
// a hand-crafted analysis grants nothing an attacker couldn't already get by
// writing an unusual job description. This only guards against wasting the
// user's own quota on a silently broken run (e.g. a stale/malformed payload).
function looksLikeJdAnalysis(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).top_15_ats_keywords)
  );
}

// Re-throws ProviderRateLimitError so the route can answer with a specific
// 429; swallows everything else and returns the given empty value. This keeps
// the "one bad step doesn't kill the whole response" behaviour while letting a
// provider quota error surface as itself rather than as a blank section.
function swallowStep<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof ProviderRateLimitError) throw err;
    // An exhausted account is not a flaky step: swallowing it would hand the
    // user a CV with a silently blank section instead of an explanation.
    if (err instanceof ProviderCreditError) throw err;
    return fallback;
  };
}

// Runs the complete tailoring pipeline — JD analysis, then wave 1 (five calls
// in parallel), then wave 2 (two calls) — for one provider + optional key
// override. Eight model calls, or seven when the pre-check gate's analysis is
// reused. Throws ProviderRateLimitError if any step hits the provider's quota.
async function runPipeline(opts: {
  provider: Provider;
  apiKeyOverride: string | undefined;
  jd: string;
  cv: string;
  projectNames: string[];
  // The user's document switch (lib/preferences): Right to Work off the CV
  // (the default) also means no visa / sponsorship sentence in the summary,
  // the bullets or the letter — the models write from the master CV text,
  // which states it, so the finished text is filtered deterministically.
  omitRightToWork: boolean;
  // The user's one-page choice (Preferences.onePageCv): the prompts get a
  // one-page budget and lib/onePage trims the finished text to one page.
  // Otherwise (the default) the text is fitted to two pages. Both measure
  // with the document profile below.
  onePage: boolean;
  profile: unknown;
  // The user's stated years (eligibility), for the header line — never inferred.
  yearsExperience: number | null;
  // Result of the pre-tailoring ATS gate's Step 1 call (/api/analyze with
  // cvText). When present and well-formed, Step 0 below is SKIPPED — this is
  // the whole point of the gate: the user already paid for this exact call
  // when they saw the "X/15 keywords" preview, so it must not run twice.
  precomputedAnalysis?: unknown;
  // Sanitized Stage 3 research. When present, the wave-1 synthetic
  // company-research call is SKIPPED (real scraped facts beat a model's
  // guesses, and the research run already paid for itself by saving this
  // call) and the profile rides along in every step's context. ABSOLUTE_RULES
  // still bound what the steps may do with the vocabulary (rule 6).
  companyResearch?: Record<string, unknown> | null;
  // Advanced customization: the user's full project pool (free text). When
  // present, the projects step SELECTS the 2 most relevant pool projects and
  // writes their bullets — replacing the master-CV projects for this run —
  // and the response additionally carries `selectedProjects` metadata.
  projectsPool?: string;
  // The user's claims registry (lib/claims). Rendered into every writing
  // prompt as what each skill may be called; the finished text is checked
  // against it deterministically at the end. Absent = the generic rule.
  claims?: ClaimsRegistry | null;
  // The positioning variant the client picked for this run (lib/variants):
  // headline + lead skills for the summary and skills steps. Null = the
  // CV's own positioning.
  variant?: Variant | null;
}) {
  const { provider, apiKeyOverride, jd, cv, projectNames, precomputedAnalysis, companyResearch, projectsPool, claims, variant, omitRightToWork, onePage, profile, yearsExperience } = opts;
  // Fast mode on OpenRouter: free models take 30–50 s per call, so the four
  // optional polish retries (title, bullet lint, claims rewrite, letter
  // proper-noun rewrite) are skipped — the run stays inside the platform's
  // time limit. Every deterministic guard still runs: format rules, id
  // reconciliation, claims check (a violation blocks the download instead of
  // being rewritten), proper-noun sentences are dropped instead of rewritten,
  // one-page trim, right-to-work strip.
  const fast = provider === "openrouter";
  const claimsBlock = renderClaimsBlock(claims);
  // Only production-level registry skills may lead (lib/variants); the
  // skipped ones are reported so the user can fix the variant or the level.
  const leadSkills = variant ? productionLeadSkills(variant.leadSkills, claims) : { kept: [] as string[], dropped: [] };
  const variantBlock = renderVariantBlock(variant ? { ...variant, leadSkills: leadSkills.kept } : null);

  // Step 0 — JD analysis. Reused from the pre-tailoring gate when available and
  // well-formed; otherwise run fresh (this is also the fallback for a caller
  // that never ran the gate, or a JD edited after the gate ran).
  const reusedAnalysis = looksLikeJdAnalysis(precomputedAnalysis);
  if (process.env.NODE_ENV !== "production") {
    // Decision only, never content — confirms locally whether the gate's
    // Step 1 call is actually being reused, not re-paid-for.
    console.log(reusedAnalysis ? "[tailor] Step 0: reused analysis from pre-check gate" : "[tailor] Step 0: ran JD analyzer fresh");
  }
  const analysis = reusedAnalysis
    ? precomputedAnalysis
    : await callLLM({
        provider,
        apiKeyOverride,
        system: JD_ANALYZER_PROMPT,
        userInput: jd,
        expectJson: true,
      });
  // The tailoring steps read the analysis JSON; when real research exists it
  // rides along inside it, grounding emphasis choices in the company's actual
  // stack and product rather than JD inference alone.
  const analysisStr = JSON.stringify(
    companyResearch && analysis && typeof analysis === "object"
      ? { ...(analysis as Record<string, unknown>), company_research: companyResearch }
      : analysis
  );

  // The posting's title, as the summary must state it (lib/roleTitle).
  const roleTitle = coreTitle(analysis && typeof analysis === "object" ? (analysis as Record<string, unknown>).role_title : "");

  // Requirement → evidence (lib/evidenceMap): for every requirement the
  // posting names, where the master CV shows it — paid work, a personal
  // project only, a list only, or nowhere. Every writing prompt receives it;
  // the claims check holds the CV to it (a technology the master CV never
  // shows is an invention wherever it appears).
  const evidence = buildEvidenceMap(analysis, cv, projectsPool, claims);
  const evidenceBlock = renderEvidenceBlock(evidence);
  const grafts = graftRules(evidence);
  const coverageBlock = projectsPool ? poolCoverageBlock(projectsPool, evidence) : "";

  // Adaptive content budget: only ask the model to trim what two pages truly
  // can't hold (lib/contentBudget.ts). When the CV can't be parsed, the
  // prompts fall back to their fixed defaults — behaviour as before.
  const expBudget = onePage ? onePageExperienceBudget(cv) : experienceBudget(cv) ?? undefined;
  const projBudget = projectsBudget(projectNames.length, onePage);
  // Bullets by id (lib/bulletIds): the experience step selects and reorders
  // the master CV's numbered bullets; the output is reconciled against them.
  const masterRoles = parseMasterExperience(cv);
  const idBlock = renderIdBlock(masterRoles);
  // "Software Developer with two years' production experience…" when the
  // title plainly describes the candidate's paid work; otherwise the title
  // is named as the job applied for (lib/roleTitle).
  const asIdentity = titleAsIdentity(roleTitle, masterRoles.map((r) => r.header.split(/\s[—–|]\s/)[0]));

  // Wave 1 — parallel; individual step failures produce empty values,
  // but ProviderRateLimitError propagates.
  const [research, summaryRaw, skillsRaw, experienceRaw, projects] = await Promise.all([
    companyResearch
      ? Promise.resolve<unknown>(companyResearch) // real scraped research — skip the synthetic call
      : callLLM({ provider, apiKeyOverride, system: COMPANY_RESEARCH_PROMPT, userInput: analysisStr, expectJson: true })
          .catch(swallowStep({})),
    callLLM({ provider, apiKeyOverride, system: summaryPrompt(cv, claimsBlock, variantBlock, roleTitle, "", evidenceBlock, asIdentity), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: skillsPrompt(cv, claimsBlock, variantBlock, evidenceBlock), userInput: analysisStr })
      .catch(swallowStep("")),
    callLLM({ provider, apiKeyOverride, system: experiencePrompt(cv, expBudget, claimsBlock, "", idBlock, evidenceBlock), userInput: analysisStr })
      .catch(swallowStep("")),
    projectsPool
      // Pool mode: select + tailor from the pasted pool. Runs even when the
      // extracted profile has no projects (projectNames empty) — the pool is
      // the source, not the profile.
      ? callLLM({ provider, apiKeyOverride, system: poolProjectsPrompt(cv, projectsPool, claimsBlock, "", evidenceBlock, coverageBlock), userInput: analysisStr, expectJson: true })
          .catch(swallowStep({}))
      : projectNames.length > 0
        ? callLLM({ provider, apiKeyOverride, system: projectsPrompt(cv, projectNames, projBudget, claimsBlock, "", evidenceBlock), userInput: analysisStr, expectJson: true })
            .catch(swallowStep({}))
        : Promise.resolve({}),
  ]);

  // A step that refused ("I cannot produce a tailored CV for this role")
  // instead of writing the section is a failed step: empty, so the client's
  // partial-failure notice names it rather than rendering the refusal.
  const dropRefusal = (v: unknown) => (looksLikeRefusal(v) ? "" : v);
  // The exact role title must be in the summary (lib/roleTitle). One retry
  // with the rejection spelled out; the draft is kept if the retry fails too.
  const summaryDraft = dropRefusal(summaryRaw);
  const titleCheck = { title: roleTitle, present: !roleTitle || titleInText(summaryDraft, roleTitle), retried: false };
  let summary: unknown = summaryDraft;
  if (!fast && roleTitle && typeof summaryDraft === "string" && summaryDraft.trim() && !titleCheck.present) {
    const retryBlock = `\nREJECTED IN YOUR PREVIOUS DRAFT: the summary did not contain the exact role title "${roleTitle}". Rewrite it so that title appears verbatim once, ${asIdentity ? "opening the summary as the candidate's professional identity" : "as the job being applied for"}. Keep every fact and figure as it was.\n`;
    const retry = dropRefusal(
      await callLLM({ provider, apiKeyOverride, system: summaryPrompt(cv, claimsBlock, variantBlock, roleTitle, retryBlock, evidenceBlock, asIdentity), userInput: analysisStr }).catch(swallowStep(""))
    );
    if (typeof retry === "string" && retry.trim() && titleInText(retry, roleTitle)) {
      summary = retry;
      titleCheck.present = true;
      titleCheck.retried = true;
    }
  }
  // Hard formatting rules (lib/formatRules): the Technical Tools line is cut
  // to the 15 most JD-relevant terms and the summary to three sentences.
  // Applied BEFORE the score and the claim check, so both read exactly the
  // text the user gets; the response says what was dropped.
  const formatted = applyFormatRules({ summary, skills: dropRefusal(skillsRaw) }, analysis, [cv, projectsPool], roleTitle, claims ?? null);
  summary = formatted.summary;
  const skills = formatted.skills;
  const formatFixes = formatted.fixes;
  const experience = dropRefusal(experienceRaw);

  // Pool mode: coerce the selection JSON at the boundary and re-key bullets by
  // index so every downstream consumer (ATS scoring, renderers, downloads) sees
  // the exact same shape as the normal path. A failed/empty selection degrades
  // to {} — the client then falls back to the master-CV projects.
  const selectedProjects = projectsPool ? normalizeSelectedProjects(projects) : [];
  const projectsOut = projectsPool ? projectsFromSelected(selectedProjects) : projects;

  // The model mirrors a bullet-less master CV with plain achievement lines —
  // repair the markers deterministically so every renderer draws real
  // bullets. Done BEFORE ATS scoring, so the score sees exactly the text the
  // user gets.
  // Id protocol first: every bullet must resolve to a master bullet, with at
  // most MAX_SUBSTITUTIONS changed words, or it is reverted / dropped.
  const reconciled = typeof experience === "string" ? reconcileExperience(experience, masterRoles) : { experience, changes: null };
  const idProtocol = reconciled.changes !== null;
  const experienceOut = typeof reconciled.experience === "string" ? normalizeExperienceOutput(reconciled.experience) : reconciled.experience;

  // Bullet lint, then ONE retry per flagged section. The same deterministic
  // checks the UI shows (lib/quality: relevance bolt-ons, filler) run on the
  // draft; a flagged section is regenerated once with its rejected bullets
  // passed back as constraints, and the retry is kept only when it is
  // non-empty and carries fewer flags than the draft. Capped at one retry.
  const company =
    analysis && typeof analysis === "object" && typeof (analysis as Record<string, unknown>).company_name === "string"
      ? ((analysis as Record<string, unknown>).company_name as string)
      : "";
  let experienceFinal = experienceOut;
  let projectsFinal: unknown = projectsOut;
  let selectedFinal = selectedProjects;
  const draftLint = lintBullets({ experience: experienceOut, projects: projectsOut }, company);
  const retried = { experience: false, projects: false };
  if (!fast && countFlags(draftLint) > 0) {
    const [experienceRetry, projectsRetry] = await Promise.all([
      draftLint.experience.length > 0
        ? callLLM({ provider, apiKeyOverride, system: experiencePrompt(cv, expBudget, claimsBlock, rejectedBulletsBlock(draftLint.experience), idBlock, evidenceBlock), userInput: analysisStr })
            .catch(swallowStep(""))
        : Promise.resolve<unknown>(""),
      draftLint.projects.length > 0
        ? projectsPool
          ? callLLM({ provider, apiKeyOverride, system: poolProjectsPrompt(cv, projectsPool, claimsBlock, rejectedBulletsBlock(draftLint.projects), evidenceBlock, coverageBlock), userInput: analysisStr, expectJson: true })
              .catch(swallowStep({}))
          : callLLM({ provider, apiKeyOverride, system: projectsPrompt(cv, projectNames, projBudget, claimsBlock, rejectedBulletsBlock(draftLint.projects), evidenceBlock), userInput: analysisStr, expectJson: true })
              .catch(swallowStep({}))
        : Promise.resolve<unknown>({}),
    ]);
    if (draftLint.experience.length > 0) {
      const candidate = dropRefusal(experienceRetry);
      const candidateOut = typeof candidate === "string" && candidate.trim() ? normalizeExperienceOutput(reconcileExperience(candidate, masterRoles).experience) : "";
      if (candidateOut && lintBullets({ experience: candidateOut }, company).experience.length < draftLint.experience.length) {
        experienceFinal = candidateOut;
        retried.experience = true;
      }
    }
    if (draftLint.projects.length > 0) {
      const candidateSelected = projectsPool ? normalizeSelectedProjects(projectsRetry) : [];
      const candidateProjects: unknown = projectsPool ? projectsFromSelected(candidateSelected) : projectsRetry;
      const nonEmpty = !!candidateProjects && typeof candidateProjects === "object" && Object.keys(candidateProjects as object).length > 0;
      if (nonEmpty && lintBullets({ projects: candidateProjects }, company).projects.length < draftLint.projects.length) {
        projectsFinal = candidateProjects;
        selectedFinal = candidateSelected;
        retried.projects = true;
      }
    }
  }
  // A generated project bullet that still ends in a bolt-on loses the
  // trailing clause (the master-selected experience bullets are left as the
  // candidate wrote them).
  if (projectsFinal && typeof projectsFinal === "object") {
    const trimmedProjects: Record<string, string[]> = {};
    for (const [k, list] of Object.entries(projectsFinal as Record<string, unknown>)) {
      trimmedProjects[k] = Array.isArray(list) ? list.map((b) => (typeof b === "string" ? trimBoltOn(b, company) ?? b : b)).filter((b): b is string => typeof b === "string") : [];
    }
    projectsFinal = trimmedProjects;
    if (projectsPool) selectedFinal = selectedFinal.map((p, i) => ({ ...p, bullets: trimmedProjects[String(i)] ?? p.bullets }));
  }
  const bulletLint = { retried, remaining: lintBullets({ experience: experienceFinal, projects: projectsFinal }, company) };

  // Search-visibility score — deterministic, BEFORE wave 2: the band is
  // arithmetic on lib/atsMatch over the same text assembly the tracker scores
  // on Applied, and the scoring call below receives it as settled. The model
  // annotates the lists and proposes edits inside the band; it never picks
  // the verdict (lib/visibilityVerdict).
  // Claims levels enforced on the generated text per section (lib/claims),
  // BEFORE the score so it reads the final text. The registry is the
  // candidate's statement; a master-CV bullet that carries a project-level
  // skill under a paid role is the overclaim it corrects. The evidence map
  // adds the posting's own terms: a technology the master CV never shows is
  // an invention anywhere in the CV. Lead Technical Tools are demoted, exact
  // trims come next, then ONE model call rewrites the sentences a trim cannot
  // fix (each rewrite checked on its own); anything that survives blocks the
  // download with the sentence and the rule named, and "Fix it" can finish it.
  let skillsFinal: unknown = skills;
  const claimFix = { toolsDemoted: [] as string[], trimmed: [] as string[], rewritten: [] as string[], remaining: 0 };
  {
    const registry = claims ?? null;
    const sources = [cv, projectsPool];
    const projectSkillNames = (claims?.skills ?? []).filter((s) => s.level === "project").map((s) => s.name);
    if (projectSkillNames.length > 0) {
      const demoted = demoteProjectTools(skillsFinal, projectSkillNames);
      skillsFinal = demoted.skills;
      claimFix.toolsDemoted = demoted.demoted;
    }
    const asSections = (): RepairSections => ({
      summary: typeof summary === "string" ? summary : "",
      skills: typeof skillsFinal === "string" ? skillsFinal : "",
      experience: typeof experienceFinal === "string" ? experienceFinal : "",
      projects: projectsFinal && typeof projectsFinal === "object" ? (projectsFinal as Record<string, string[]>) : {},
      coverLetter: "",
    });
    const write = (s: RepairSections) => {
      if (typeof summary === "string") summary = s.summary;
      if (typeof skillsFinal === "string") skillsFinal = s.skills;
      if (typeof experienceFinal === "string") experienceFinal = s.experience;
      if (projectsFinal && typeof projectsFinal === "object") {
        projectsFinal = s.projects;
        // Pool mode keeps each selected project's bullets beside its name.
        if (projectsPool) selectedFinal = selectedFinal.map((p, i) => ({ ...p, bullets: s.projects[String(i)] ?? p.bullets }));
      }
    };
    // Best effort: the final check below still runs and reports whatever is
    // left, so a bug here can never fail a paid run.
    try {
      // Exact trims (lib/claimRepair): only the flagged words go — "LLM/RAG"
      // → "LLM", a list item — so every other word, figure and outcome
      // stays. A fast (OpenRouter) run gets these too.
      const t = surgicalUntilStable(asSections(), registry, sources, jd, grafts);
      if (t.changes.length > 0) {
        write(t.sections);
        claimFix.trimmed = t.changes.map((c) => c.after);
      }
      // One rewrite call for what a trim cannot fix, each sentence accepted
      // only when it passes the check on its own and keeps the role title.
      const items = listRepairs(asSections(), checkSections(asSections(), registry, sources, jd, grafts), registry);
      if (!fast && items.length > 0) {
        const a = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 30) : []);
        const raw = await callLLM({
          provider,
          apiKeyOverride,
          system: claimsRepairPrompt(cv, claimsBlock, { title: roleTitle, keywords: list(a.top_15_ats_keywords), required: list(a.required_skills) }),
          userInput: JSON.stringify({ items: items.slice(0, 20).map(({ id, section, sentence, problems }) => ({ id, section, sentence, problems })) }),
          expectJson: true,
          maxTokens: 3000,
        }).catch(swallowStep(null));
        const applied = applyModelEdits(asSections(), items, normalizeRepairEdits(raw, items), (it, rep) =>
          replacementPasses(rep, it.section, registry, sources, jd, grafts) &&
          (it.section !== "summary" || !roleTitle || !titleInText(it.sentence, roleTitle) || titleInText(rep, roleTitle))
        );
        if (applied.changes.length > 0) {
          write(applied.sections);
          claimFix.rewritten = applied.changes.map((c) => c.section);
        }
      }
      claimFix.remaining = listRepairs(asSections(), checkSections(asSections(), registry, sources, jd, grafts), registry).length;
    } catch (e) {
      console.error("Claims repair pass failed:", e instanceof Error ? e.message : String(e));
    }
  }

  // Right to Work off the document (lib/rightToWorkText): any sentence or
  // bullet that states the visa / sponsorship position is removed from the
  // finished CV text before it is scored, and reported as rtwStripped.
  const rtwStripped = { cv: [] as string[], letter: [] as string[] };
  if (omitRightToWork) {
    if (typeof summary === "string") {
      const r = stripRightToWorkSentences(summary);
      summary = r.text;
      rtwStripped.cv.push(...r.removed);
    }
    if (typeof skillsFinal === "string") {
      const r = stripRightToWorkLines(skillsFinal);
      skillsFinal = r.text;
      rtwStripped.cv.push(...r.removed);
    }
    if (typeof experienceFinal === "string") {
      const r = stripRightToWorkLines(experienceFinal);
      experienceFinal = r.text;
      rtwStripped.cv.push(...r.removed);
    }
    const p = stripRightToWorkBullets(projectsFinal);
    projectsFinal = p.projects;
    rtwStripped.cv.push(...p.removed);
  }

  // Page fit (lib/onePage), before the score so the score reads the text the
  // user will send. Two pages (the default): trimmed by relevance if it runs
  // past two; otherwise the master CV's own left-out bullets are restored,
  // most relevant first, while it still fits — each one cleared by the
  // claims registry in its section and by the Right-to-Work switch, so a
  // restored bullet can never bring back what the passes above removed.
  // One page (the user's opt-in): trimmed by relevance to one page.
  let pageFitReport: PageFitReport | null = null;
  {
    const t = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
    const fitTerms = { keywords: t.top_15_ats_keywords, required: t.required_skills };
    const fitProfile = (profile ?? null) as Parameters<typeof fitOnePage>[1];
    const current = { summary, skills: skillsFinal, experience: experienceFinal, projects: projectsFinal };
    let fitted: ReturnType<typeof fitOnePage>;
    if (onePage) {
      fitted = fitOnePage(current, fitProfile, fitTerms);
    } else {
      const allowed = (c: RefillCandidate) => {
        if (omitRightToWork && mentionsRightToWork(c.text)) return false;
        const check = checkClaims(
          [{ where: "cv", text: c.text, ...(c.where === "experience" ? { experience: c.text } : {}) }],
          claims,
          [cv, projectsPool]
        );
        return check.skillViolations.length === 0 && !check.numberViolations.some((n) => n.kind === "absent");
      };
      const metas = (profile as { projects?: { name?: string; originalBullets?: string[] }[] } | null)?.projects;
      const candidates = [
        ...experienceRefillCandidates(experienceFinal, masterRoles),
        // Pool mode renders the selected pool projects, not the profile's.
        ...(projectsPool ? [] : projectRefillCandidates(projectsFinal, metas)),
      ].filter(allowed);
      fitted = fitTwoPages(current, fitProfile, fitTerms, candidates);
    }
    summary = fitted.sections.summary;
    skillsFinal = fitted.sections.skills;
    experienceFinal = fitted.sections.experience as typeof experienceFinal;
    projectsFinal = fitted.sections.projects;
    pageFitReport = fitted.report;
  }

  const sections = { summary, skills: skillsFinal, experience: experienceFinal, projects: projectsFinal };
  const tailoredText = tailoredSectionsText(sections);
  const terms = (analysis && typeof analysis === "object" ? analysis : {}) as Record<string, unknown>;
  const coverage = matchAtsKeywords(tailoredText, terms.top_15_ats_keywords);
  const requiredRaw = matchAtsKeywords(tailoredText, terms.required_skills);
  const required = requiredRaw.total > 0 ? requiredRaw : null;

  // Wave 2 — cover letter + score annotation
  const coverLetterInput = JSON.stringify({ analysis, research });
  const atsInput = JSON.stringify({
    score: {
      keyword_coverage: `${coverage.matched}/${coverage.total}`,
      present: coverage.matchedKeywords,
      absent: coverage.missedKeywords,
      ...(required ? { required_skill_coverage: `${required.matched}/${required.total}`, required_absent: required.missedKeywords } : {}),
    },
    summary,
    skills: skillsFinal,
    experience: experienceFinal,
    projects: projectsFinal,
  });

  const [coverLetterRaw, atsAnnotation] = await Promise.all([
    callLLM({ provider, apiKeyOverride, system: coverLetterPrompt(cv, claimsBlock, omitRightToWork, evidenceBlock), userInput: coverLetterInput, maxTokens: 1200 })
      .catch(swallowStep("")),
    coverage.total > 0
      ? callLLM({ provider, apiKeyOverride, system: atsScoringPrompt(renderBandBlock(coverage, required)), userInput: atsInput, expectJson: true })
          .catch(swallowStep(null))
      : Promise.resolve(null),
  ]);

  // Every proper noun in the letter must come from the JD, the research or
  // the CV (lib/properNouns). Offending sentences are rewritten once by the
  // model; if a name is still unsupported, those sentences are dropped.
  // The letter's furniture (lib/letterFormat): a company addressed as a
  // person, a missing sign-off, a date line the model wrote.
  const letterNormalized = normalizeLetter(dropRefusal(coverLetterRaw), {
    company: company || null,
    name: (profile as { name?: string } | null)?.name ?? null,
  });
  const letterDraft = letterNormalized.letter;
  const letterSources = [jd, cv, projectsPool, JSON.stringify(research ?? {}), JSON.stringify(analysis ?? {})];
  const letterCheck = { unsupported: [] as string[], rewritten: false, dropped: 0 };
  let coverLetter: unknown = letterDraft;
  if (typeof letterDraft === "string" && letterDraft.trim()) {
    const unsupported = unsupportedProperNouns(letterDraft, letterSources);
    if (unsupported.length > 0) {
      letterCheck.unsupported = unsupported;
      const offending = sentencesNaming(letterDraft, unsupported);
      const retry = fast
        ? ""
        : dropRefusal(
            await callLLM({ provider, apiKeyOverride, system: coverLetterFixPrompt(unsupported, offending), userInput: letterDraft, maxTokens: 1200 }).catch(swallowStep(""))
          );
      if (typeof retry === "string" && retry.trim() && unsupportedProperNouns(retry, letterSources).length === 0) {
        coverLetter = retry;
        letterCheck.rewritten = true;
      } else {
        coverLetter = dropSentences(letterDraft, offending);
        letterCheck.dropped = offending.length;
      }
    }
  }
  if (omitRightToWork && typeof coverLetter === "string") {
    const r = stripRightToWorkSentences(coverLetter);
    coverLetter = r.text;
    rtwStripped.letter = r.removed;
  }
  // The summary and the letter, sentence by sentence against the master CV
  // (lib/supportCheck): one call names the master-CV lines behind every
  // claim about the candidate's past, or a corrected sentence. Quotes are
  // verified here; an unsupported sentence is replaced by its fix when the
  // fix passes the claims check and the proper-noun check (and keeps the
  // role title), and removed otherwise. Skipped in fast mode.
  let supportReport: SupportReport | null = null;
  // A degree the profile dates to the future is never stated as held ("I
  // hold an MSc …, graduating January 2027" reached both outputs measured on
  // 26 Sep): deterministic, before the fact check and whatever the provider.
  const inProgress = degreesInProgress((profile as { education?: { degree?: string; dates?: string; note?: string }[] } | null)?.education);
  const preChanged: SupportReport["changed"] = [];
  for (const section of ["summary", "coverLetter"] as const) {
    const text = section === "summary" ? summary : coverLetter;
    if (typeof text !== "string") continue;
    const r = fixHeldDegrees(text, inProgress);
    if (r.changed.length === 0) continue;
    if (section === "summary") summary = r.text;
    else coverLetter = r.text;
    for (const m of r.changed) preChanged.push({ section, sentence: m, action: "rewritten", replacement: fixHeldDegrees(m, inProgress).text });
  }
  // The letter's opening names the role; if it has to go, a plain true
  // opening takes its place so the letter never loses the job it is for.
  const letterOpening = typeof coverLetter === "string" ? supportSentences("", coverLetter).find((x) => x.section === "coverLetter")?.sentence ?? "" : "";
  const safeOpening = roleTitle ? `I am applying for the ${roleTitle} role${company ? ` at ${company}` : ""}.` : "";
  // Each project's own facts: one project's work told as another's is a
  // problem the fact check must fix, and no rewrite may do it (rule 7).
  const facts = projectFacts(cv, projectsPool);
  if (fast) {
    // No model call: the narrating clause is cut where that is clean, and a
    // sentence that merges two projects' facts goes.
    const changed: SupportReport["changed"] = [];
    let cur: RepairSections = { summary: typeof summary === "string" ? summary : "", skills: "", experience: "", projects: {}, coverLetter: typeof coverLetter === "string" ? coverLetter : "" };
    for (const s of supportSentences(cur.summary, cur.coverLetter, facts)) {
      if (s.problems.length === 0) continue;
      const merged = isMergeProblem(s);
      const t = merged ? (s.section === "coverLetter" && s.sentence === letterOpening && safeOpening ? safeOpening : "") : trimNarration(s.sentence);
      const next = t !== null ? applyToSection(cur, s.section, s.sentence, t) : null;
      if (!next) continue;
      cur = next;
      changed.push(t ? { section: s.section, sentence: s.sentence, action: "rewritten", replacement: t } : { section: s.section, sentence: s.sentence, action: "removed" });
    }
    if (typeof summary === "string") summary = cur.summary;
    if (typeof coverLetter === "string") coverLetter = cur.coverLetter;
    supportReport = { checked: 0, changed, unverified: [], skipped: "fast" };
  } else {
    const sentences = supportSentences(typeof summary === "string" ? summary : "", typeof coverLetter === "string" ? coverLetter : "", facts);
    if (sentences.length > 0) {
      const raw = await callLLM({
        provider,
        apiKeyOverride,
        system: supportCheckPrompt(cv, projectsPool ?? ""),
        userInput: JSON.stringify({ sentences: sentences.map(({ id, section, sentence, problems }) => ({ id, section, sentence, ...(problems.length ? { problems } : {}) })) }),
        expectJson: true,
        maxTokens: 4000,
        // The honesty gate reads subtle misattribution better on the larger
        // model; only on Claude (callLLM forwards a model name to the others).
        ...(provider === "anthropic" ? { model: MODELS.quality } : {}),
      }).catch(swallowStep(null));
      if (raw && typeof raw === "object") {
        const verdicts = normalizeSupportVerdicts(raw, sentences);
        const nameSources = (section: string) => (section === "coverLetter" ? letterSources : [cv, projectsPool, jd, JSON.stringify(analysis ?? {})]);
        const decisions = decideSupport(sentences, verdicts, [cv, projectsPool], (s, fix) => {
          if (statesDegreeAsHeld(fix, inProgress)) return false;
          if (mergedProjects(fix, facts.projects, facts.paidWork).length > 0) return false;
          if (!replacementPasses(fix, s.section, claims ?? null, [cv, projectsPool], jd, grafts)) return false;
          const had = unsupportedProperNouns(s.sentence, nameSources(s.section));
          if (unsupportedProperNouns(fix, nameSources(s.section)).some((n) => !had.includes(n))) return false;
          return s.section !== "summary" || !roleTitle || !titleInText(s.sentence, roleTitle) || titleInText(fix, roleTitle);
        });
        let cur: RepairSections = {
          summary: typeof summary === "string" ? summary : "",
          skills: "",
          experience: "",
          projects: {},
          coverLetter: typeof coverLetter === "string" ? coverLetter : "",
        };
        const changed: SupportReport["changed"] = [];
        for (const d of decisions) {
          if (d.action !== "rewrite" && d.action !== "remove") continue;
          // The summary's role-title sentence is never removed: it is a hard
          // requirement, and a rejected fix leaves it for the claims check.
          if (d.action === "remove" && d.section === "summary" && roleTitle && titleInText(d.sentence, roleTitle)) continue;
          // Nor is the letter's opening: a plain true opening replaces it.
          if (d.action === "remove" && d.section === "coverLetter" && d.sentence === letterOpening && safeOpening) {
            d.action = "rewrite";
            d.replacement = safeOpening;
          }
          const next = applyToSection(cur, d.section, d.sentence, d.action === "rewrite" && d.replacement ? d.replacement : "");
          if (!next) continue;
          cur = next;
          changed.push(
            d.action === "rewrite" && d.replacement
              ? { section: d.section, sentence: d.sentence, action: "rewritten", replacement: d.replacement }
              : { section: d.section, sentence: d.sentence, action: "removed" }
          );
        }
        if (typeof summary === "string") summary = cur.summary;
        if (typeof coverLetter === "string") coverLetter = cur.coverLetter;
        supportReport = { checked: verdicts.size, changed, unverified: decisions.filter((d) => d.action === "unverified").map((d) => d.sentence) };
      } else {
        supportReport = { checked: 0, changed: [], unverified: [], skipped: "failed" };
      }
    }
  }
  // The same fact twice reads as generated: the later telling goes (the
  // summary never loses its role-title sentence this way).
  const postChanged: SupportReport["changed"] = [];
  for (const section of ["summary", "coverLetter"] as const) {
    const text = section === "summary" ? summary : coverLetter;
    if (typeof text !== "string") continue;
    const r = dropRepeatedSentences(text);
    if (r.dropped.length === 0) continue;
    if (section === "summary" && roleTitle && titleInText(text, roleTitle) && !titleInText(r.text, roleTitle)) continue;
    if (section === "summary") summary = r.text;
    else coverLetter = r.text;
    for (const sentence of r.dropped) postChanged.push({ section, sentence, action: "removed" });
  }
  // The fact check's fixes may bring dashes back: the letter's one-dash rule
  // holds on the finished text.
  if (typeof coverLetter === "string") coverLetter = capEmDashes(coverLetter).text;
  if (preChanged.length || postChanged.length) {
    supportReport = supportReport
      ? { ...supportReport, changed: [...preChanged, ...supportReport.changed, ...postChanged] }
      : { checked: 0, changed: [...preChanged, ...postChanged], unverified: [] };
  }

  // The score and the claims check read the FINISHED text: the fact check
  // may have changed the summary. No terms to score against (analysis
  // failed) → no score; otherwise the deterministic score stands even when
  // the annotation call failed.
  const finalSections = { summary, skills: skillsFinal, experience: experienceFinal, projects: projectsFinal };
  const finalText = tailoredSectionsText(finalSections);
  const finalCoverage = matchAtsKeywords(finalText, terms.top_15_ats_keywords);
  const finalRequiredRaw = matchAtsKeywords(finalText, terms.required_skills);
  const atsScore = finalCoverage.total > 0 ? reconcileAtsScore(atsAnnotation, finalCoverage, finalRequiredRaw.total > 0 ? finalRequiredRaw : null) : null;
  // Deterministic claim check on the same finished text — no model call,
  // computed from exactly what the user sees. The client re-runs the same
  // function on the edited preview. The letter may quote the posting's own
  // facts about the company; the CV may not, so only the letter gets the JD
  // as a source.
  const claimCheck = checkClaims(
    [
      { where: "cv", text: finalText, experience: finalSections.experience, skills: finalSections.skills },
      { where: "coverLetter", text: typeof coverLetter === "string" ? coverLetter : "", extraSources: [jd] },
    ],
    claims,
    [cv, projectsPool],
    grafts
  );

  return {
    analysis,
    research,
    summary,
    skills: skillsFinal,
    experience: experienceFinal,
    projects: projectsFinal,
    coverLetter,
    atsScore,
    claimCheck,
    claimFix,
    // Requirement → evidence for this posting (lib/evidenceMap), and what the
    // sentence-by-sentence fact check changed (lib/supportCheck).
    evidence,
    supportCheck: supportReport,
    letterFixes: letterNormalized.fixes,
    bulletLint,
    titleCheck,
    formatFixes,
    letterCheck,
    rtwStripped,
    pageFit: pageFitReport,
    // True when the polish retries were skipped to fit the time limit (OpenRouter).
    fastMode: fast,
    variantLeadSkills: variant ? leadSkills : null,
    // "Changes vs master CV": the finished text against the master's own
    // bullets (lib/bulletIds) — kept, edited (which words), dropped, new.
    bulletChanges: {
      protocol: idProtocol,
      experience: typeof sections.experience === "string" ? diffAgainstMaster(sections.experience, masterRoles) : null,
      projects: projectsPool ? [] : diffProjects(sections.projects, (profile as { projects?: { name?: string; originalBullets?: string[] }[] } | null)?.projects),
    },
    // The header line under the name (lib/headline): qualification with its
    // stated status · the top production-level skill this posting asks for ·
    // the stated years · the posting's title. Replaces the extracted tagline
    // for this run; the preview, both downloads and the Applied snapshot all
    // read it through the display profile.
    headline: buildHeadline({
      education: (profile as { education?: { degree?: string; dates?: string; note?: string }[] } | null)?.education,
      claims,
      requiredSkills: terms.required_skills,
      keywords: terms.top_15_ats_keywords,
      yearsExperience,
      roleTitle: terms.role_title,
    }).headline,
    ...(projectsPool ? { selectedProjects: selectedFinal } : {}),
  };
}

// A run on OpenRouter's free models takes ~30 s per call across two waves and
// the retries; the platform default would cut it off. Vercel caps this at the
// plan's maximum.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = claimsData.claims.sub as string;

    // ── Burst rate limit (cheap first gate, before DB + LLM work) ──────────────
    const burst = await checkBurstLimit(userId, "tailor");
    if (!burst.ok) {
      return NextResponse.json(
        {
          error: `Too many requests. Please wait ${burst.retryAfterSeconds}s and try again.`,
          errorType: "provider_limit",
          retryAfter: burst.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    // ── Input validation ──────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const jd = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    const cv = typeof body.cvText === "string" ? body.cvText.trim() : "";
    if (!jd) {
      return NextResponse.json({ error: "No job description provided" }, { status: 400 });
    }
    if (!cv) {
      return NextResponse.json({ error: "No CV text provided" }, { status: 400 });
    }
    if (cv.length > MAX_CV_CHARS) {
      return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
    }
    if (jd.length > MAX_JD_CHARS) {
      return NextResponse.json({ error: JD_TOO_LONG }, { status: 400 });
    }
    const safeProjectNames = Array.isArray(body.projectNames)
      ? body.projectNames.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, 50)
      : [];
    const projectsPool = typeof body.projectsPool === "string" ? body.projectsPool.trim() : "";
    if (projectsPool.length > MAX_POOL_CHARS) {
      return NextResponse.json({ error: POOL_TOO_LONG }, { status: 400 });
    }
    const bodyProvider = body.provider;
    const bodyAnalysis = body.analysis;
    const bodyResearch = sanitizeCompanyResearch(body.companyResearch);
    if (body.claims !== undefined && JSON.stringify(body.claims).length > MAX_CLAIMS_JSON) {
      return NextResponse.json({ error: "Claims registry is too large." }, { status: 400 });
    }
    const bodyClaims = normalizeClaims(body.claims);
    // Document switches (lib/preferences), sent along by the client like the
    // registry — the server reads no per-user table here. Absent = defaults.
    const preferences = normalizePreferences(body.preferences);
    // Eligibility answers (years → the header line) and the document profile
    // (for the page fit), both sent by the client like the registry.
    if (body.eligibility !== undefined && JSON.stringify(body.eligibility).length > MAX_ELIGIBILITY_JSON) {
      return NextResponse.json({ error: "Eligibility profile is too large." }, { status: 400 });
    }
    const eligibility = normalizeEligibility(body.eligibility);
    // The CV's length: two pages unless the user chose one (Customize).
    const onePage = preferences.onePageCv;
    if (body.profile !== undefined && JSON.stringify(body.profile).length > MAX_CV_CHARS) {
      return NextResponse.json({ error: "Profile is too large." }, { status: 400 });
    }
    const bodyProfile = body.profile && typeof body.profile === "object" ? normalizeProfile(body.profile) : null;
    // One variant, bounded like a stored one; anything malformed = none.
    const bodyVariant = body.variant ? (normalizeVariants({ variants: [body.variant] })?.variants[0] ?? null) : null;

    // ── Quota + provider routing (shared brain — lib/llmRouting.ts) ───────────
    const route = await resolveLlmRoute(supabase, userId, { bodyProvider });
    if (!route.ok) {
      return NextResponse.json(route.body, { status: route.status });
    }
    // The unlimited path honours the dropdown with the deployment's env key;
    // when OpenRouter is chosen and no OPENROUTER_API_KEY is deployed, the
    // user's own saved key runs it (the adapter would otherwise throw
    // "OPENROUTER_API_KEY is not set" and the run would 500).
    let routeKey = route.apiKeyOverride;
    if (route.provider === "openrouter" && !routeKey && !process.env.OPENROUTER_API_KEY) {
      const own = await loadOwnOpenRouterKey(supabase, userId);
      if (!own.key) {
        await route.refund();
        return NextResponse.json({ needsKeys: true, error: "OpenRouter is selected but no OpenRouter key is available — add one in Settings.", errorType: "needs_openrouter_key" }, { status: 402 });
      }
      routeKey = own.key;
    }

    async function runOrRefund(opts: Parameters<typeof runPipeline>[0]) {
      if (!route.ok) throw new Error("unreachable");
      try {
        return await runPipeline(opts);
      } catch (err) {
        await route.refund();
        throw err;
      }
    }

    const pipelineOpts = {
        provider: route.provider,
        apiKeyOverride: routeKey,
        jd,
        cv,
        projectNames: safeProjectNames,
        precomputedAnalysis: bodyAnalysis,
        companyResearch: bodyResearch,
        ...(projectsPool ? { projectsPool } : {}),
        claims: bodyClaims,
        variant: bodyVariant,
        omitRightToWork: !preferences.includeRightToWorkOnCv,
        onePage,
        profile: bodyProfile,
        yearsExperience: eligibility.yearsExperience,
    };
    try {
      const result = await runOrRefund(pipelineOpts);
      // The unlimited (owner) path reports which provider ran, for the dropdown.
      return NextResponse.json(route.reason === "unlimited" ? { provider: route.provider, ...result } : result);
    } catch (err) {
      // The shared account cannot serve the run (balance at zero, or Anthropic
      // rate-limiting it): retry ONCE on the user's own OpenRouter key — or the
      // deployment's, for the unlimited path — instead of a 503 that tells
      // them to add a key they may already have (lib/fallbackRoute). The
      // counters were refunded by runOrRefund, so the fallback run is not
      // charged to their free tailors.
      const sharedFailure =
        err instanceof ProviderCreditError || (err instanceof ProviderRateLimitError && route.provider === "anthropic");
      if (sharedFailure && route.reason !== "own_key") {
        const own = await loadOwnOpenRouterKey(supabase, userId);
        const fb = chooseFallback({
          failedProvider: route.provider,
          routeReason: route.reason,
          ownKey: own.key,
          envOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
        });
        if (fb) {
          const reason: FallbackReason = err instanceof ProviderCreditError ? "provider_credit" : "provider_limit";
          console.warn(`Tailor fallback: ${route.provider} → openrouter (${fb.source}) after ${reason}`);
          let result: Awaited<ReturnType<typeof runPipeline>>;
          try {
            result = await runPipeline({ ...pipelineOpts, provider: fb.provider, apiKeyOverride: fb.apiKeyOverride });
          } catch (fbErr) {
            if (fbErr instanceof ProviderRateLimitError) {
              return NextResponse.json({ limitReached: true, error: fallbackExhaustedMessage(reason, fbErr), errorType: "user_key_limit" }, { status: 429 });
            }
            throw fbErr;
          }
          return NextResponse.json({
            ...(route.reason === "unlimited" ? { provider: "openrouter" } : {}),
            ...result,
            fallback: { from: route.provider, to: "openrouter", source: fb.source, reason },
          });
        }
      }
      if (route.reason === "own_key" && err instanceof ProviderRateLimitError) {
        // OpenRouter's own limit — the app imposes no cap of its own here.
        return NextResponse.json(
          {
            limitReached: true,
            error: openRouterLimitMessage(err),
            errorType: "user_key_limit",
          },
          { status: 429 }
        );
      }
      throw err;
    }

  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      const retryMsg = error.retryAfterSeconds
        ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.`
        : "Try again shortly.";
      const message = `The service is busy right now. ${retryMsg}`;
      console.error("Provider rate limit:", error.provider, error.message);
      return NextResponse.json(
        {
          error: message,
          errorType: "provider_limit",
          retryAfter: error.retryAfterSeconds ?? null,
        },
        { status: 429 }
      );
    }
    if (error instanceof ProviderCreditError) {
      console.error("Provider credit exhausted:", error.provider);
      return NextResponse.json(
        {
          error:
            "Tailoring is temporarily unavailable — the shared Claude account has run out of credit. " +
            "This isn't your account: add your own free OpenRouter key in Settings and tailoring runs on it instead.",
          errorType: "provider_credit",
        },
        { status: 503 }
      );
    }
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Tailor API error:", msg);
    return NextResponse.json({ error: "Tailoring failed" }, { status: 500 });
  }
}
