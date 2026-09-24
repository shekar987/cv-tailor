"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { getMasterCV, getProfile, getUserSettings, importFromLocalStorageIfNeeded, saveClaims, type Profile } from "@/lib/cvStore";
import {
  jdQuality,
  summarizeGates,
  CATEGORY_LABEL,
  type Eligibility,
  type GateVerdict,
  type GateRead,
  type GatesSummary,
} from "@/lib/knockouts";
import { normalizeProfile } from "@/lib/profile";
import { companyNamesMatch } from "@/lib/companyMatch";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import CvPreview, { type CvPreviewHandle } from "../CvPreview";
import CoverLetterPreview, { type CoverLetterPreviewHandle } from "../CoverLetterPreview";
import { tailoredSectionsText, type AtsMatchResult } from "@/lib/atsMatch";
import { normalizeClaims, checkClaims, seedClaimsFromCv, SKILL_RULE_TEXT, type ClaimsRegistry, type ClaimCheck, type ClaimWhere } from "@/lib/claims";
import { qualityReport, onePageExpected, type QualityReport } from "@/lib/quality";
import { normalizeVariants, pickVariant, leadSkillsNotice, type VariantsConfig, type LeadSkillDrop } from "@/lib/variants";
import { normalizePreferences, profileForDocument, rightToWorkForForms, DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import type { SeniorityFit } from "@/lib/seniority";
import { isGraduateScheme, graduateSectionOrder } from "@/lib/graduateMode";
import type { BulletChanges, RoleChanges } from "@/lib/bulletIds";
import { fallbackNotice } from "@/lib/fallbackRoute";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import { salaryFromJd, buildAppliedNotes, localIsoDate, addDays } from "@/lib/applicationSnapshot";
import { bandFor, parseCoverage, combineWithFit, type VisibilityBand, type CombinedVerdict } from "@/lib/visibilityVerdict";
import { MAX_JD_CHARS, JD_TOO_LONG, MAX_NOTES_CHARS, JD_PARTIAL_NOTICE } from "@/lib/limits";
import { getUsage, type Usage } from "@/lib/usage";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Textarea from "@/components/ui/Textarea";
import Input from "@/components/ui/Input";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";
import Badge from "@/components/ui/Badge";

// Server strings for the unlimited-account provider override (tailor route Path A)
type TailorProvider = "anthropic" | "gemini" | "openrouter";
const PROVIDER_LABELS: Record<TailorProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

// errorTypes that render their own dedicated notice block below the JD card.
// The plain inline error is suppressed for these so the message isn't shown
// twice. Kept as ONE list because it was previously duplicated across two
// conditions, which meant adding an errorType silently double-rendered it.
const ERROR_TYPES_WITH_OWN_NOTICE = new Set([
  "user_limit",
  "provider_limit",
  "claude_limit_reached",
  "needs_keys",
  "needs_openrouter_key",
  "user_key_limit",
  "key_decrypt_failed",
  "provider_credit",
]);

function hasOwnNotice(errorType: string | null): boolean {
  return errorType !== null && ERROR_TYPES_WITH_OWN_NOTICE.has(errorType);
}

type Result = {
  provider?: string; // echoed back for unlimited accounts only
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: any;
  coverLetter?: string;
  // Step 1's JD analysis, echoed back by /api/tailor. Only the fields the
  // client reads are typed here.
  analysis?: {
    company_name?: string;
    role_title?: string;
    // The role's terms; the Applied snapshot is scored against them server-side.
    top_15_ats_keywords?: string[];
    required_skills?: string[];
  };
  // lib/visibilityVerdict's VisibilityScore: every figure and the verdict are
  // computed server-side from the keyword match; only the annotations and the
  // edits (`recommendations`) are the model's.
  atsScore?: {
    band?: VisibilityBand;
    verdict?: string;
    keyword_coverage?: string;
    required_skill_coverage?: string;
    required_misses?: string[];
    hits?: string[];
    misses?: string[];
    recommendations?: string[];
  };
  // Pool mode (Advanced customization): the 2 projects the pipeline selected
  // from the user's project pool. Present only when a pool was sent; the
  // display profile derives its projects from this instead of the master CV's.
  selectedProjects?: { name?: string; date?: string; tech?: string; bullets?: string[] }[];
  // Attached client-side on a JD run: the eligibility-gate read the pre-check
  // gave this job, kept with the result (and its workspace copy) so the
  // Applied row can store it after the gate state is cleared.
  gatesSummary?: GatesSummary;
  // The server's deterministic claim check of this exact output (lib/claims).
  claimCheck?: ClaimCheck;
  // Attached client-side: the positioning variant this run was made with.
  variantName?: string;
  variantReason?: string;
  // What the server's hard formatting rules dropped from this run
  // (lib/formatRules): tools cut from the Technical Tools line, sentences
  // cut from the summary. Null entries mean the rule had nothing to do.
  formatFixes?: {
    tools?: { kept: string[]; dropped: string[] } | null;
    summary?: { sentences: number; kept: number } | null;
  };
  // Visa / sponsorship sentences the server removed from the CV text and the
  // letter because Right to Work is off the document (lib/rightToWorkText).
  rtwStripped?: { cv: string[]; letter: string[] };
  // The header line under the name for this run (lib/headline); replaces the
  // extracted tagline in the display profile when present.
  headline?: string;
  // "Changes vs master CV" (lib/bulletIds): the finished bullets against the
  // master's own — kept, edited (which words), reverted, dropped, new.
  bulletChanges?: { protocol: boolean; experience: BulletChanges | null; projects: RoleChanges[] };
  // The variant's lead skills the run could not use (lib/variants): only
  // production-level registry skills lead.
  variantLeadSkills?: { kept: string[]; dropped: LeadSkillDrop[] } | null;
  // The run was retried on an OpenRouter key because the shared Claude
  // account could not serve it (lib/fallbackRoute).
  fallback?: { from: string; to: "openrouter"; source: "own_key" | "env_key"; reason: "provider_credit" | "provider_limit" } | null;
  // One-page fit for a candidate with under three years (lib/onePage): what
  // was left out for length, and whether the result now fits one page.
  onePage?: {
    fits: boolean;
    pagesBefore: number;
    pagesAfter: number;
    leftOut: { summary: string[]; tools: string[]; experience: { role: string; bullet: string }[]; projects: { project: string; bullet: string }[] };
  } | null;
};

const WHERE_LABEL: Record<ClaimWhere, string> = { cv: "CV", coverLetter: "cover letter", email: "email", extra: "text" };

// The employer name Step 1 read off the JD, for the relevance bolt-on check.
function companyOf(analysis: unknown): string | undefined {
  const a = analysis as { company_name?: unknown } | null | undefined;
  return typeof a?.company_name === "string" ? a.company_name : undefined;
}
function roleTitleOf(analysis: unknown): string | undefined {
  const a = analysis as { role_title?: unknown } | null | undefined;
  return typeof a?.role_title === "string" ? a.role_title : undefined;
}

// What /api/analyze returns beside the keyword pre-check.
type GateExtras = {
  required: AtsMatchResult | null;
  knockouts: { profileSet: boolean; verdicts: GateVerdict[]; read: { read: GateRead; reason: string } } | null;
  duplicateOf: { id: string; company_name: string; role: string; date_applied: string }[] | null;
  // Tracker rows at the same company (by normalized name), newest first —
  // a recruiter sees every application to their company in one screen.
  sameCompany: { company: string; count: number; last: { role: string; date_applied: string; status: string } } | null;
  // Which level the posting is written for, against the user's years
  // (lib/seniority). fits === false is a blocking warning: the continue
  // button demotes to "Tailor anyway" exactly as a skip read does.
  seniority: SeniorityFit | null;
  // The pre-check ran on the user's own OpenRouter key (shared account out of credit).
  fallback: { source: "own_key" | "env_key"; reason: "provider_credit" | "provider_limit" } | null;
};

const READ_LABEL: Record<GateRead, string> = {
  apply: "Apply",
  long_shot: "Long shot",
  skip: "Likely auto-rejected",
};
const VERDICT_RANK: Record<GateVerdict["verdict"], number> = { hard: 0, soft: 1, pass: 2, unknown: 3 };

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// "cleared": the run was saved to the tracker and the workspace emptied for
// the next posting (undo keeps the last run for the session).
type AppliedState = "idle" | "saving" | "saved" | "already" | "error" | "cleared";

// ── Stage 3: company research (the /api/research payload, typed loosely — the
// server owns the shape; the UI renders what's present and skips what isn't).
type ResearchProfile = {
  company_name?: string;
  what_they_build?: string;
  target_audience?: string;
  ai_footprint?: string;
  pain_points?: string[];
  engineering_stack?: string[];
  tone_words?: string[];
};
type ResearchFit = {
  total?: number;
  tier?: "low" | "medium" | "high";
  components?: Record<string, { score?: number; evidence?: string }>;
  matched_stack?: string[];
  missing_stack?: string[];
  honest_gaps?: string;
  headline?: string;
};
type ResearchOpening = { title?: string; location?: string; url?: string; description?: string };
type ResearchData = {
  profile?: ResearchProfile;
  websiteStack?: string[];
  stackKeywords?: { keyword: string; count: number }[];
  openings?: ResearchOpening[];
  jobBoard?: { provider?: string; count?: number } | null;
  fitScore?: ResearchFit | null;
  researchedAt?: string;
  cached?: boolean;
  // The domain the research was run for (absent on envelopes saved before it
  // was returned). Shown beside the company name so the user can see exactly
  // which company a run is bound to.
  domain?: string;
};

const FIT_TIER_META = {
  low: { emoji: "⚠️", label: "Low match" },
  medium: { emoji: "⚡", label: "Potential match" },
  high: { emoji: "🔥", label: "Highly positive fit" },
} as const;

const FIT_COMPONENT_META: { key: string; label: string; weight: number }[] = [
  { key: "hard_skills", label: "Hard skills", weight: 40 },
  { key: "domain", label: "Domain experience", weight: 30 },
  { key: "scale", label: "Complexity & scale", weight: 20 },
  { key: "product", label: "Product empathy", weight: 10 },
];

// Step 1 sometimes answers a missing company or role with a placeholder
// phrase ("Not specified", "Unknown", "N/A") instead of an empty string.
// Treat those as absent everywhere — a filename, the gate card, or a tracker
// row must never carry "Not_specified" as if it were a company.
const PLACEHOLDER_RE = /^(not\s+(specified|mentioned|provided|stated|available|found|given|applicable)|unspecified|unknown( company| role)?|n\/?a|none|-+)$/i;
function realValue(text: string | undefined): string {
  const t = (text || "").trim();
  return PLACEHOLDER_RE.test(t) ? "" : t;
}

// Download filename, e.g. Jane_Doe_Acme_Backend_Engineer_CV. Also stored as
// the tracker row's cv_reference, so the two always name the same document.
// CvPreview is memoised on this string — keep it deterministic. Missing
// pieces are simply left out (filter(Boolean) below).
function buildFileBaseName(profile: Profile | null, analysis: Result["analysis"], suffix: string): string {
  const first = (profile?.name || "User").trim().split(/\s+/).slice(0, 2).join("_");
  const cn = realValue(analysis?.company_name).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const rt = realValue(analysis?.role_title).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return [first, cn, rt, suffix].filter(Boolean).join("_");
}

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<string | null>(null); // "user_limit" | "provider_limit" | null

  // Master CV — read-only here. Uploading/editing/replacing it lives on
  // /customize; this page only needs to know whether one exists.
  const [masterCvText, setMasterCvText] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cvLoading, setCvLoading] = useState(true);  // true while initial DB fetch is in-flight
  // Advanced customization (saved on /customize): the user's full project
  // pool. Non-empty = every tailor run sends it, and the pipeline selects the
  // 2 most relevant pool projects instead of tailoring the master CV's own.
  const [projectsPool, setProjectsPool] = useState("");

  // Provider selector — owner accounts only (profiles.is_unlimited).
  // Fails closed: unless the flag reads back true, normal users see nothing.
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [provider, setProvider] = useState<TailorProvider>("anthropic");
  const [ranProvider, setRanProvider] = useState<string | null>(null);

  // Pre-tailoring ATS gate: a free-ish preview (Step 1 only, ~1/9th the cost of
  // a full tailor) run before the paid 8-step pipeline. `gateAnalysis` is the
  // JD analysis it produced — held so that if the user proceeds, /api/tailor
  // reuses it instead of paying for Step 1 a second time. Both are cleared
  // whenever the JD or CV changes, since a stale analysis would be reused
  // against a different job/CV than it was computed for.
  // The user's saved CV section order. Left as null until loaded (and on any
  // failure), which resolveSectionOrder treats as "use the default order".
  const [sectionOrder, setSectionOrder] = useState<unknown>(null);

  const [preCheck, setPreCheck] = useState<AtsMatchResult | null>(null);
  const [gateAnalysis, setGateAnalysis] = useState<unknown>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState("");
  // The rest of the pre-check: required-skill coverage, eligibility-gate
  // verdicts + the one-line read, and tracker rows with this exact JD.
  // Cleared with preCheck — it belongs to the same JD.
  const [gateExtras, setGateExtras] = useState<GateExtras | null>(null);
  // The user's eligibility answers (Customize), sent with the pre-check so
  // the server can compare each gate. null = never set up.
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  // The claims registry (Customize), sent with every tailor/extras call and
  // used for the live re-check of the edited preview. null = none yet.
  const [claims, setClaims] = useState<ClaimsRegistry | null>(null);
  // The claim check of the preview AS EDITED, after a re-check; null means
  // "use the server's check of the original output".
  const [liveCheck, setLiveCheck] = useState<ClaimCheck | null>(null);
  const [coldEmailCheck, setColdEmailCheck] = useState<ClaimCheck | null>(null);
  // Quality read of the preview AS EDITED (page estimate, duplicates, weak
  // bullets, filler); null = read the original result.
  const [liveQuality, setLiveQuality] = useState<QualityReport | null>(null);
  // Positioning variants (Customize) and the user's override for this run
  // (null = pick by the posting's role type; "none" = apply none).
  const [variants, setVariants] = useState<VariantsConfig | null>(null);
  // Document preferences (lib/preferences): Right to Work off the CV unless switched on.
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [variantOverride, setVariantOverride] = useState<string | null>(null);

  // Stage 3 — company research + Fit Score. Self-contained error state: the
  // server's limit messages are shown verbatim inside the research card, so
  // this never crosses wires with the tailor pipeline's notice blocks.
  const [companyUrl, setCompanyUrl] = useState("");
  const [research, setResearch] = useState<ResearchData | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [showAllOpenings, setShowAllOpenings] = useState(false);

  // High-fit (80+) extras — pitch script + interview talking points. Session
  // state only: cheap to regenerate, and each is one burst-limited call.
  const [pitchScript, setPitchScript] = useState("");
  const [talkingPoints, setTalkingPoints] = useState("");
  const [extrasLoading, setExtrasLoading] = useState<"" | "pitch" | "talking_points" | "cold_email">("");
  const [extrasError, setExtrasError] = useState("");

  // Cold outreach email — owner-only (the server gates on is_unlimited too).
  // Its own error slot: the high-fit extras card isn't always mounted.
  const [coldEmail, setColdEmail] = useState("");
  const [coldEmailError, setColdEmailError] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);
  // Optional personalisation, only ever included when the user typed it —
  // the prompt is forbidden from inventing a connection to the recipient.
  const [recipientName, setRecipientName] = useState("");
  const [personalNote, setPersonalNote] = useState("");

  // Identity for the persisted workspace, and a flag so we never write back
  // before the restore has run (which would blank out saved work on mount).
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  // Identity of the current tailoring run — minted when a run completes and
  // persisted with the workspace. The tracker keys "Applied" saves on it, so
  // clicking twice (even across a reload) can't create two rows.
  const [tailorSessionId, setTailorSessionId] = useState<string | null>(null);
  const [appliedState, setAppliedState] = useState<AppliedState>("idle");
  const [appliedError, setAppliedError] = useState("");
  // Saved, but the API had something to tell us (e.g. no CV snapshot column yet).
  const [appliedNotice, setAppliedNotice] = useState("");

  // Free-tier position for the usage chip. Null (load failed, signed out,
  // column blocked) hides the chip — quota display must never break the page.
  const [usage, setUsage] = useState<Usage | null>(null);
  // The JD the current result was generated from, so editing the textarea can
  // flag the results below as stale. Null for results saved before this field.
  const [resultJd, setResultJd] = useState<string | null>(null);
  // Graduate-scheme layout (lib/graduateMode) applies per run; this holds the
  // run the user switched back to their standard order.
  const [standardOrderFor, setStandardOrderFor] = useState<string | null>(null);
  // A graduate / placement / early-careers posting is screened on the degree
  // first: Education moves under the summary for this run (lib/graduateMode),
  // unless the user's own order already has it there or they switched this
  // run back. The preview and the Applied snapshot read runSectionOrder.
  // Declared here, above the handlers that close over it: the React Compiler
  // will not memoise around a const declared after the function using it.
  const graduateRun = !!result && isGraduateScheme(roleTitleOf(result.analysis), resultJd ?? jobDescription);
  const graduateLayout = graduateRun && standardOrderFor !== (tailorSessionId ?? "run") ? graduateSectionOrder(sectionOrder) : null;
  const runSectionOrder: unknown = graduateLayout?.changed ? graduateLayout.order : sectionOrder;
  // Which flow produced the result. Only "jd" runs arm the stale-JD banner;
  // an outreach run is tailored from a research brief, not the JD box.
  const [resultSource, setResultSource] = useState<"jd" | "outreach" | null>(null);
  // The JD box no longer holds the text this result was tailored from: the
  // downloads and Applied are held shut until the user restores that text or
  // clears the result — a CV must never go out under a different posting.
  const staleRun = !!result && resultJd !== null && resultSource !== "outreach" && jobDescription.trim() !== resultJd.trim();
  // The company whose research the in-flight run is using (null when none is
  // applied), for the progress list — the binding is visible during the run.
  const [runResearchCompany, setRunResearchCompany] = useState<string | null>(null);
  // Seconds since the full pipeline started — honest feedback during the wait.
  const [elapsed, setElapsed] = useState(0);
  // Reaches into CvPreview for the EDITED document when saving to the tracker.
  const previewRef = useRef<CvPreviewHandle>(null);
  const coverRef = useRef<CoverLetterPreviewHandle>(null);
  // The run cleared after Applied, kept for one undo in this session.
  const undoRef = useRef<{ result: Result; resultJd: string | null; resultSource: "jd" | "outreach" | null; tailorSessionId: string | null; jobDescription: string } | null>(null);

  // On load: fetch CV + profile from Supabase.
  // If the DB has nothing but localStorage does, import it once then clear localStorage.
  useEffect(() => {
    async function loadCv() {
      // Local session read (no network call) — only the user id is needed here;
      // the header shows the email itself.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      // Restore the pasted JD and tailored result from the last visit, so a
      // refresh — or following a link out of the CV preview — doesn't discard
      // work. Keyed by user id: a different account on this browser must not
      // inherit the previous person's CV.
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const saved = loadWorkspace(uid);
        if (saved) {
          if (saved.jobDescription) setJobDescription(saved.jobDescription);
          if (saved.result) setResult(saved.result as Result);
          if (saved.ranProvider) setRanProvider(saved.ranProvider);
          if (saved.tailorSessionId) setTailorSessionId(saved.tailorSessionId);
          if (typeof saved.resultJd === "string") setResultJd(saved.resultJd);
          if (saved.resultSource === "jd" || saved.resultSource === "outreach") setResultSource(saved.resultSource);
          if (saved.research && typeof saved.research === "object") setResearch(saved.research as ResearchData);
          if (saved.researchUrl) setCompanyUrl(saved.researchUrl);
        }
      }
      // Only now may the save effect run — writing before this point would
      // persist the empty initial state over whatever was stored.
      setWorkspaceReady(true);

      // Gate the provider selector: RLS scopes this SELECT to the user's own
      // profiles row. On any error, warn (for diagnosis) and keep the selector hidden.
      supabase
        .from("profiles")
        .select("is_unlimited")
        .maybeSingle()
        .then(({ data: profRow, error: profErr }) => {
          if (profErr) {
            console.warn("Provider selector: couldn't read profiles.is_unlimited —", profErr.message);
          } else if (profRow?.is_unlimited === true) {
            setIsUnlimited(true);
          }
        });

      // The usage chip. Fire-and-forget: null just hides it.
      getUsage().then(setUsage);

      // Section order for rendering, resolved BEFORE the results are allowed
      // to render: a restored CV must not paint in the default order and then
      // re-lay out. Fail-soft: any problem leaves it null (the default order).
      const orderLoaded = fetch("/api/section-order")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data?.order) setSectionOrder(data.order); })
        .catch(() => { /* default order */ });

      let stored = await getMasterCV();

      if (!stored) {
        // First login, or user hasn't saved a CV yet.
        // Check localStorage for a one-time migration of any pre-auth CV.
        const imported = await importFromLocalStorageIfNeeded();
        if (imported) {
          stored = imported;
          // Profile was also imported inside importFromLocalStorageIfNeeded.
        }
      }

      if (stored) {
        setMasterCvText(stored.text);
        setProjectsPool(stored.projectsPool ?? "");
        const settings = await getUserSettings();
        setEligibility(settings.eligibility);
        // An empty registry is never the resting state: seed it from the
        // CV's own skills section, with levels read from where the CV shows
        // each skill used, and keep it (best effort).
        let registry = normalizeClaims(settings.claims);
        if ((!registry || registry.skills.length === 0) && stored.text.trim()) {
          const seeded = seedClaimsFromCv(stored.text);
          if (seeded.skills.length > 0) {
            registry = seeded;
            void saveClaims(seeded);
          }
        }
        setClaims(registry);
        setVariants(normalizeVariants(settings.variants));
        setPreferences(normalizePreferences(settings.preferences));
        const p = await getProfile();
        setProfile(p);
      }
      await orderLoaded;
      // Only now may a restored result render — with the real profile and
      // order, not a "YOUR NAME" placeholder that re-flows a moment later.
      setCvLoading(false);
    }
    loadCv();
  }, []);

  // Persist the JD and the tailored result whenever either changes. Guarded on
  // workspaceReady so the initial empty state never overwrites saved work.
  useEffect(() => {
    if (!workspaceReady || !userId) return;
    saveWorkspace(userId, { jobDescription, result, ranProvider, tailorSessionId, resultJd, resultSource, research, researchUrl: companyUrl || null });
  }, [workspaceReady, userId, jobDescription, result, ranProvider, tailorSessionId, resultJd, resultSource, research, companyUrl]);

  // Tick once a second while the pipeline runs; resets to 0 on each new run.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // Stage 3: research the pasted company URL. Costs one tailor credit (the
  // server refunds it if the model calls fail; a cache hit within 7 days is
  // free); all the web fetching happens before the credit is touched, so an
  // unreachable site costs nothing.
  async function handleResearch(force = false) {
    if (researchLoading || loading) return;
    if (!masterCvText.trim()) {
      setResearchError("Add your master CV in Customize first — the Fit Score compares the company against it.");
      return;
    }
    const url = companyUrl.trim();
    if (!url) {
      setResearchError("Paste the company's website URL first.");
      return;
    }
    setResearchError("");
    setResearchLoading(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          cvText: masterCvText,
          ...(isUnlimited ? { provider } : {}),
          ...(force ? { force: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResearchError(data.error || "Research failed. Try again.");
        return;
      }
      setResearch(data as ResearchData);
      setShowAllOpenings(false);
    } catch {
      setResearchError("Couldn't reach the server. Try again.");
    } finally {
      setResearchLoading(false);
      // A credit may have been spent (or refunded) — refresh the chip.
      getUsage().then(setUsage);
    }
  }

  async function copyColdEmail() {
    try {
      await navigator.clipboard.writeText(coldEmail);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      setColdEmailError("Couldn't copy — select the text and copy it manually.");
    }
  }

  // Cold outreach is a SEPARATE flow from the JD box: the research becomes an
  // internal target brief the pipeline tailors against — the job-description
  // textarea is never touched, and no keyword gate runs (there's no JD to
  // match against). Null when the research came back without company facts.
  function buildOutreachBrief(): string | null {
    const p = research?.profile;
    if (!p || (!p.company_name && !p.what_they_build)) return null;
    const stack =
      research?.stackKeywords?.length
        ? research.stackKeywords.map((k) => k.keyword).join(", ")
        : (p.engineering_stack || []).join(", ");
    const lines = [
      `Speculative application to ${p.company_name || "this company"} — no posted job. Target built from real research:`,
      "",
      p.what_they_build ? `What they build: ${p.what_they_build}` : "",
      p.target_audience ? `Audience: ${p.target_audience}` : "",
      stack ? `Engineering stack (from their live job ads): ${stack}` : "",
      p.pain_points?.length ? `Engineering problems they're visibly working on: ${p.pain_points.join("; ")}` : "",
      p.ai_footprint ? `AI footprint: ${p.ai_footprint}` : "",
      "",
      "Role target: software engineering roles matching the stack above.",
    ].filter((l) => l !== "");
    return lines.join("\n");
  }

  // A researched opening becomes the JD with one click — the aggregator made
  // useful. Same invalidation as typing in the JD box: the gate's analysis
  // belonged to the previous text.
  function applyOpening(o: ResearchOpening) {
    const jd = [o.title, o.location].filter(Boolean).join("\n") + (o.description ? `\n\n${o.description}` : "");
    setJobDescription(jd.trim());
    setPreCheck(null);
    setGateExtras(null);
    setGateAnalysis(null);
    setGateError("");
    const el = document.getElementById("jd");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Research-powered extras: one model call each, built from the research +
  // master CV. "cold_email" additionally requires the owner account.
  // `analysisOverride` exists for the auto-email fired right after a company
  // tailor: the `result` state in this closure is still the PREVIOUS run's at
  // that moment, so the fresh analysis must be passed explicitly.
  async function handleExtra(
    kind: "pitch" | "talking_points" | "cold_email",
    analysisOverride?: Result["analysis"]
  ) {
    if (extrasLoading) return;
    const setError = kind === "cold_email" ? setColdEmailError : setExtrasError;
    setError("");
    setExtrasLoading(kind);
    // The tailored role only rides along when it is at the researched
    // company; otherwise the extra pitches speculatively rather than
    // stitching company A's research to company B's role.
    const analysis = analysisOverride ?? result?.analysis;
    const boundAnalysis =
      analysis && companyNamesMatch(realValue(analysis.company_name), research?.profile?.company_name) ? analysis : undefined;
    try {
      const res = await fetch("/api/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          cvText: masterCvText,
          companyResearch: research?.profile,
          analysis: boundAnalysis,
          ...(claims ? { claims } : {}),
          ...(kind === "cold_email" && recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
          ...(kind === "cold_email" && personalNote.trim() ? { personalNote: personalNote.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't generate that just now. Try again.");
        return;
      }
      if (kind === "pitch") setPitchScript(data.text || "");
      else if (kind === "talking_points") setTalkingPoints(data.text || "");
      else {
        setColdEmail(data.text || "");
        setColdEmailCheck(data.claimCheck ?? null);
        setEmailCopied(false);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setExtrasLoading("");
    }
  }

  // Step 1 of the click-through: run ONLY the JD analyzer + a local keyword
  // check against the raw CV, so the user sees a rough fit estimate before the
  // paid 8-step pipeline runs. Never blocks on a low score — just informs.
  async function handlePreCheck() {
    if (!masterCvText.trim()) {
      setError("Add your master CV in Customize first.");
      setErrorType(null);
      return;
    }
    if (!jobDescription.trim()) {
      setError("Paste a job description to get started.");
      setErrorType(null);
      return;
    }
    if (jobDescription.length > MAX_JD_CHARS) {
      setError(JD_TOO_LONG);
      setErrorType(null);
      return;
    }
    setError("");
    setErrorType(null);
    setGateError("");
    setGateLoading(true);
    try {
      // The tracker list is free and already ordered newest first; fetched
      // alongside the analysis so the same-company notice costs no extra wait.
      const rowsPromise: Promise<Record<string, unknown>[]> = fetch("/api/applications")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (Array.isArray(j?.applications) ? (j.applications as Record<string, unknown>[]) : []))
        .catch(() => []);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, cvText: masterCvText, ...(eligibility ? { eligibility } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        // An exhausted shared account fails the pre-check too, and "you can
        // still tailor without it" would be a lie — the tailor would fail the
        // same way. Raise the dedicated notice instead.
        if (data.errorType === "provider_credit") {
          setErrorType("provider_credit");
          setError(data.error);
        } else {
          setGateError(data.error || "Couldn't check keyword match. You can still tailor without it.");
        }
      } else {
        const company = realValue(typeof data.result?.company_name === "string" ? data.result.company_name : "");
        const rows = company ? await rowsPromise : [];
        const same = rows.filter((r) => typeof r.company_name === "string" && companyNamesMatch(company, r.company_name));
        setGateAnalysis(data.result ?? null);
        setPreCheck(data.atsPreCheck ?? null);
        setGateExtras({
          required: data.requiredPreCheck ?? null,
          knockouts: data.knockouts ?? null,
          fallback: data.fallback ?? null,
          duplicateOf: Array.isArray(data.duplicateOf) && data.duplicateOf.length > 0 ? data.duplicateOf : null,
          sameCompany: same.length
            ? {
                company,
                count: same.length,
                last: { role: String(same[0].role ?? ""), date_applied: String(same[0].date_applied ?? ""), status: String(same[0].status ?? "") },
              }
            : null,
          seniority: data.seniority && typeof data.seniority === "object" && typeof data.seniority.reason === "string" ? (data.seniority as SeniorityFit) : null,
        });
      }
    } catch {
      setGateError("Couldn't reach the server for the keyword check. You can still tailor without it.");
    } finally {
      setGateLoading(false);
    }
  }

  // Step 1's read of the JD, surfaced on the gate card so a mis-pasted JD is
  // caught before the full run is spent on the wrong job. Declared ahead of
  // executeTailor, which reads it: a hoisted function referencing a memo
  // declared below it stops the React Compiler preserving the memo.
  const gateInfo = useMemo(() => {
    const a = gateAnalysis as { role_title?: unknown; company_name?: unknown } | null;
    const role = realValue(typeof a?.role_title === "string" ? a.role_title : "");
    const company = realValue(typeof a?.company_name === "string" ? a.company_name : "");
    return role || company ? { role, company } : null;
  }, [gateAnalysis]);

  // The eligibility read and its verdicts, hard fails first, "check these
  // yourself" last. Declared above executeTailor for the same reason.
  const gateRead: GateRead = gateExtras?.knockouts?.read.read ?? "apply";
  // The seniority read blocks like a skip read: the posting is written for a
  // level the user's years don't cover, so tailoring is a credit spent on a
  // long shot at best.
  const seniorityBlocks = gateExtras?.seniority?.fits === false;
  const gateVerdicts = useMemo(
    () => [...(gateExtras?.knockouts?.verdicts ?? [])].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]),
    [gateExtras]
  );
  // Partial-posting warning: computed locally, so it shows on the skip card
  // too (the pre-check may have failed before it could say anything).
  const jdInfo = jdQuality(jobDescription);

  // The claim check in force: the live re-check of the edited preview when
  // there is one, else the server's check of the original output. Blocking
  // holds Download and Applied shut until an edit passes a re-check.
  const activeCheck: ClaimCheck | null = liveCheck ?? result?.claimCheck ?? null;
  const claimIssues = activeCheck ? activeCheck.skillViolations.length + activeCheck.numberViolations.length : 0;
  const blocked = !!activeCheck?.blocking;
  // The first thing holding the download shut, as the sentence and the rule
  // it breaks — shown beside the Download button, not only in the notice.
  const downloadReason: string | undefined = (() => {
    if (!blocked || !activeCheck) return undefined;
    const s = activeCheck.skillViolations[0];
    if (s) return `${s.skill}: ${s.claim || `appears in the ${WHERE_LABEL[s.where]}`} — ${SKILL_RULE_TEXT[s.rule]}.`;
    const n = activeCheck.numberViolations.find((x) => x.kind === "absent");
    if (n) return `${n.figure} isn't on your master CV: "${n.sentence.length > 100 ? `${n.sentence.slice(0, 99)}…` : n.sentence}".`;
    return undefined;
  })();

  // The positioning variant for this run: the override, else the one whose
  // role types include the posting's role_type. Declared above executeTailor
  // for the same reason as gateInfo.
  const variantPick = pickVariant(variants, (gateAnalysis as { role_type?: unknown } | null)?.role_type, variantOverride);

  // Whether the saved research applies to the job in the JD box, for the
  // gate card and the outreach hint. "unknown" = the gate couldn't read a
  // company off the JD (agency postings often hide it) — no research is
  // applied then, deliberately.
  const researchBinding = useMemo(() => {
    const company = research?.profile?.company_name?.trim() || "";
    if (!company) return null;
    if (!gateInfo?.company) return { company, jobCompany: "", status: "unknown" as const };
    return {
      company,
      jobCompany: gateInfo.company,
      status: companyNamesMatch(gateInfo.company, company) ? ("match" as const) : ("mismatch" as const),
    };
  }, [research, gateInfo]);

  // Step 2: the full 8-step pipeline. If gateAnalysis is set (the user came
  // through the pre-check), it's sent along so /api/tailor skips re-running
  // Step 1 — otherwise the server runs Step 1 fresh, exactly as before this
  // feature existed.
  // Core pipeline call, shared by both flows: "jd" tailors what's in the
  // job-description box (gate analysis reused, stale-JD banner armed);
  // "outreach" tailors an internal research brief (no gate, no banner — the
  // JD box is a separate concern by design).
  // Returns the fresh result on success and null on every failure path, so a
  // caller that chains work (the outreach auto cold-email) can act on the new
  // run without reading this closure's stale `result` state.
  async function executeTailor(jdText: string, source: "jd" | "outreach"): Promise<Result | null> {
    if (loading) return null;
    if (jdText.length > MAX_JD_CHARS) {
      setError(JD_TOO_LONG);
      setErrorType(null);
      return null;
    }
    setError("");
    setErrorType(null);
    // Research is bound to a company. An outreach run IS that company's
    // brief, so it always applies; a JD run applies it only when the gate
    // read the same company off the JD. Otherwise company A's research would
    // shape company B's cover letter — the mislabelled-output bug.
    const researchToSend =
      source === "outreach"
        ? research?.profile ?? null
        : gateInfo?.company && companyNamesMatch(gateInfo.company, research?.profile?.company_name)
          ? research?.profile ?? null
          : null;
    setRunResearchCompany(researchToSend?.company_name || null);
    setLoading(true);
    // The previous result stays on screen (and in the persisted workspace)
    // until a new one actually arrives — a failed run must not destroy the
    // last good CV.
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: jdText,
          cvText: masterCvText,
          projectNames: (profile?.projects || []).map((p) => p.name),
          // Advanced customization: when a pool is saved, the pipeline selects
          // the 2 most relevant pool projects instead of the names above.
          ...(projectsPool ? { projectsPool } : {}),
          // Only meaningful for unlimited accounts; the server ignores it otherwise
          ...(isUnlimited ? { provider } : {}),
          // The gate's analysis belongs to the JD-box text only.
          ...(source === "jd" && gateAnalysis ? { analysis: gateAnalysis } : {}),
          // Real scraped research (Stage 3): the tailor route injects it into
          // the cover-letter context instead of synthesizing research from the
          // JD alone. Only sent when it is bound to this company (above).
          ...(researchToSend ? { companyResearch: researchToSend } : {}),
          // The claims registry: what each skill may be called, and the
          // basis for the server's claim check of the output.
          ...(claims ? { claims } : {}),
          // The positioning variant for this run (headline + lead skills).
          ...(variantPick.variant ? { variant: variantPick.variant } : {}),
          // Document switches: Right to Work off the CV (default) also keeps
          // visa / sponsorship sentences out of the generated text.
          preferences,
          // The eligibility answers (years → one-page target) and the document
          // profile (education, certifications… for the server's page estimate).
          ...(eligibility ? { eligibility } : {}),
          ...(profile ? { profile: profileForDocument(profile, preferences) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        setErrorType(data.errorType || null);
        return null;
      }
      // A fresh id per completed run: re-tailoring the same job is a new
      // session, and legitimately gets its own tracker row. Computed before
      // any state changes so a missing crypto API (non-secure origin) can't
      // throw after the result has already rendered.
      const sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // A JD run keeps the pre-check's eligibility read with its result, so
      // the Applied row can record it after the gate state is cleared below.
      const gatesSummary =
        source === "jd" && gateExtras?.knockouts
          ? summarizeGates(gateExtras.knockouts.verdicts, gateExtras.knockouts.read.read)
          : undefined;
      const fresh: Result = {
        ...(data as Result),
        ...(gatesSummary ? { gatesSummary } : {}),
        ...(variantPick.variant ? { variantName: variantPick.variant.name, variantReason: variantPick.reason } : {}),
      };
      setResult(fresh);
      setLiveCheck(null);
      setLiveQuality(null);
      setRanProvider(typeof data.provider === "string" ? data.provider : null);
      setTailorSessionId(sessionId);
      // The text this run was tailored from — the JD box for a JD run, the
      // research brief for outreach. The tracker saves it as the row's job
      // description, so an outreach row never inherits whatever happens to be
      // in the JD box. The stale banner keys on resultSource, not on this.
      setResultJd(jdText);
      setResultSource(source);
      setAppliedState("idle");
      setAppliedError("");
      setAppliedNotice("");
      // The gate applied to this specific run; clear it so a re-tailor of the
      // same JD starts a fresh pre-check rather than silently reusing a stale
      // one. Only on success: a failed run keeps the paid-for analysis for the
      // retry instead of charging for it again.
      if (source === "jd") {
        setPreCheck(null);
        setGateAnalysis(null);
        setGateExtras(null);
      }
      return fresh;
    } catch {
      setError("Couldn't reach the server. Check it's running and try again.");
      setErrorType(null);
      return null;
    } finally {
      setLoading(false);
      setRunResearchCompany(null);
      // Success or limit error, the counters may have moved — refresh the chip.
      getUsage().then(setUsage);
    }
  }

  function runFullTailor() {
    return executeTailor(jobDescription, "jd");
  }

  // Cold-outreach tailoring: research → CV + cover letter, no JD involved.
  // For the owner account, a successful run also auto-drafts the UKJI cold
  // email (one extras call — a different burst bucket from "tailor", so the
  // pair can't rate-limit each other). The email is strictly best-effort:
  // handleExtra catches every failure into coldEmailError, so a failed email
  // can never damage the tailored result that just rendered.
  async function runColdOutreachTailor() {
    const brief = buildOutreachBrief();
    if (!brief) {
      setResearchError("This research came back without company details — use \"research again\" first.");
      return;
    }
    const fresh = await executeTailor(brief, "outreach");
    if (fresh && isUnlimited) await handleExtra("cold_email", fresh.analysis);
  }
  // Snapshot the finished run into the application tracker. Reads only what
  // the run already produced — the pipeline itself is untouched. The server
  // owns the duplicate rule (one row per session id) and reports a repeat
  // click back as alreadySaved, without touching the existing row.
  // Re-run the claim check on the preview AS EDITED — the same function the
  // server ran, on the same text assembly, against the same sources. Called
  // from the "Re-check now" button and when focus leaves either preview
  // (deferred a tick: collectPayload blurs the active element, and running it
  // inside the focusout itself would fight the focus change).
  function recheckClaims() {
    if (!result) return;
    const payload = previewRef.current?.collectPayload();
    const letter = coverRef.current?.collectText();
    const cvText = payload
      ? tailoredSectionsText({ summary: payload.summary, skills: payload.skills, experience: payload.experience, projects: payload.projects })
      : tailoredSectionsText({ summary: result.summary, skills: result.skills, experience: result.experience, projects: result.projects });
    setLiveCheck(
      checkClaims(
        [
          { where: "cv", text: cvText, experience: payload ? payload.experience : result.experience, skills: payload ? payload.skills : result.skills },
          // The letter may quote the posting's facts about the company.
          { where: "coverLetter", text: letter ?? result.coverLetter ?? "", extraSources: [resultJd ?? jobDescription] },
        ],
        claims,
        [masterCvText, projectsPool]
      )
    );
    if (payload) {
      setLiveQuality(
        qualityReport(
          { summary: payload.summary, skills: payload.skills, experience: payload.experience, projects: payload.projects },
          payload.profile ? { ...payload.profile, projects: payload.projectsMeta } : null,
          letter ?? result.coverLetter ?? "",
          companyOf(result.analysis),
          payload.targetPages
        )
      );
    }
  }

  // Paint the flagged figures and skills onto the editable previews with the
  // CSS Custom Highlight API: nothing is injected into the contentEditable
  // DOM the downloads read from. Browsers without it just get the list.
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const registry = (CSS as unknown as { highlights: { set(n: string, h: unknown): void; delete(n: string): void } }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!HighlightCtor) return;
    // The ::highlight() rule lives here, not in globals.css: Turbopack's CSS
    // parser rejects the pseudo-element, and only browsers with the API
    // ever reach this line.
    if (!document.getElementById("claimHighlightStyle")) {
      const style = document.createElement("style");
      style.id = "claimHighlightStyle";
      style.textContent = "::highlight(claimViolation){background-color:var(--danger-dim);color:var(--danger);text-decoration:underline wavy;}";
      document.head.appendChild(style);
    }
    const needles = [
      ...(activeCheck?.numberViolations.map((n) => n.figure) ?? []),
      ...(activeCheck?.skillViolations.map((s) => s.skill) ?? []),
    ]
      .map((s) => s.toLowerCase().trim())
      .filter((s) => s.length >= 2);
    if (needles.length === 0) {
      registry.delete("claimViolation");
      return;
    }
    const roots = [previewRef.current?.getRoot(), coverRef.current?.getRoot()].filter((r): r is HTMLDivElement => !!r);
    const ranges: Range[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || "").toLowerCase();
        for (const needle of needles) {
          let at = text.indexOf(needle);
          while (at >= 0) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            ranges.push(range);
            at = text.indexOf(needle, at + needle.length);
          }
        }
      }
    }
    registry.set("claimViolation", new HighlightCtor(...ranges));
    return () => registry.delete("claimViolation");
  }, [activeCheck, result]);

  async function handleApplied() {
    if (blocked) return;
    if (!result) return;
    // Workspaces saved before session ids existed restore without one; mint
    // it now so the save effect persists it and a second click still dedupes.
    const sid = tailorSessionId ?? crypto.randomUUID();
    if (sid !== tailorSessionId) setTailorSessionId(sid);
    const analysis = result.analysis;
    const today = new Date();
    // What the run was actually tailored from (the research brief for an
    // outreach run), not whatever is sitting in the JD box right now.
    const jdForRow = resultJd ?? jobDescription;

    // Snapshot the document AS EDITED in the preview — the tracker should hold
    // the CV that was actually sent, not the raw pipeline output. The @@JOB@@
    // wire markers go back to plain "Role | Company | Date" lines, the format
    // every renderer of this snapshot expects.
    const edited = previewRef.current?.collectPayload() ?? null;
    const editedExperience = edited
      ? edited.experience
          .split("\n")
          .map((line) => {
            const m = /^@@JOB@@(.*)@@(.*)$/.exec(line);
            return m ? [m[1].trim(), m[2].trim()].filter(Boolean).join(" | ") : line;
          })
          .join("\n")
      : null;

    setAppliedState("saving");
    setAppliedError("");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: realValue(analysis?.company_name) || "Unknown company",
          role: realValue(analysis?.role_title) || "Unknown role",
          cv_reference: buildFileBaseName(displayProfile, analysis, "CV"),
          tailor_session_id: sid,
          status: "Applied",
          source: "tailored",
          // The JD's literal figure with its unit ("£480 per day"),
          // "Voluntary (unpaid)", or an explicit "Not Specified".
          salary: salaryFromJd(jdForRow),
          date_applied: localIsoDate(today),
          followup_date: localIsoDate(addDays(today, 7)),
          // Generated talking points ride along into the tracker row for
          // interview prep. The API rejects (not truncates) over-long notes,
          // so the combined text is sliced to the cap client-side.
          notes: [buildAppliedNotes(result.atsScore), talkingPoints && `— Interview talking points —\n${talkingPoints}`]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, MAX_NOTES_CHARS),
          job_description: jdForRow.slice(0, 15_000),
          // The CV as generated, with the profile and section order it was
          // rendered with, so the tracker shows this exact document later.
          tailored_cv: {
            summary: edited?.summary || result.summary || "",
            skills: edited?.skills || result.skills || "",
            experience: editedExperience || result.experience || "",
            projects: edited?.projects ?? result.projects ?? {},
            profile: edited?.profile
              ? { ...edited.profile, projects: edited.projectsMeta }
              // Preview not mounted: fall back to the profile the document
              // rendered with — in pool mode that carries the selected
              // projects, not the master CV's, and Right to Work only when
              // the switch is on.
              : displayProfile,
            sectionOrder: edited ? edited.sectionOrder : runSectionOrder,
            // The letter as it stands in the preview — edits included, date
            // line first — so the tracker holds it as sent. And the role's
            // terms: the server scores this exact snapshot against them, so
            // the stored figures are re-derivable from the stored document.
            coverLetter: coverRef.current?.collectText() ?? result.coverLetter ?? "",
            ats: {
              keywords: analysis?.top_15_ats_keywords ?? [],
              required: analysis?.required_skills ?? [],
            },
            // The eligibility read this run was made under, for the
            // tracker's "what's working" view.
            ...(result.gatesSummary ? { gates: result.gatesSummary } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAppliedState("error");
        setAppliedError(data.error || "Couldn't save to the tracker. Try again.");
        return;
      }
      setAppliedState(data.alreadySaved ? "already" : "saved");
      // Saved, but without the CV snapshot (database migration pending).
      setAppliedNotice(typeof data.warning === "string" ? data.warning : "");
      // Saved: the tracker holds the CV, the letter and the posting, so the
      // workspace clears for the next one (undo brings it back this session).
      if (!data.alreadySaved && result) {
        undoRef.current = { result, resultJd, resultSource, tailorSessionId, jobDescription };
        const warning = typeof data.warning === "string" ? data.warning : "";
        clearRun();
        setJobDescription("");
        setAppliedNotice(warning);
        setAppliedState("cleared");
      }
    } catch {
      setAppliedState("error");
      setAppliedError("Couldn't reach the server. Try again.");
    }
  }

  // Empty the workspace: result, its JD, session, gate and quality state.
  function clearRun() {
    setResult(null);
    setResultJd(null);
    setResultSource(null);
    setTailorSessionId(null);
    setLiveQuality(null);
    setAppliedError("");
    setAppliedNotice("");
    setPreCheck(null);
    setGateAnalysis(null);
    setGateExtras(null);
  }
  function clearResult() {
    clearRun();
    setAppliedState("idle");
  }
  function undoClear() {
    const u = undoRef.current;
    if (!u) return;
    undoRef.current = null;
    setResult(u.result);
    setResultJd(u.resultJd);
    setResultSource(u.resultSource);
    setTailorSessionId(u.tailorSessionId);
    setJobDescription(u.jobDescription);
    setAppliedState("already");
  }

  // Stable reference so React.memo on CvPreview can skip re-renders when only the JD
  // textarea or other unrelated state changes. Only rebuilds when result changes.
  const cvData = useMemo(() => ({
    summary: result?.summary,
    skills: result?.skills,
    experience: result?.experience,
    projects: result?.projects as any,
  }), [result]);

  // Pool mode: the profile the document renders with. When the run selected
  // projects from the user's pool, those replace the master-CV projects —
  // CvPreview, both downloads (via collectPayload's projectsMeta) and the
  // Applied snapshot all read from this one derivation. MUST stay a useMemo
  // keyed on [profile, result]: CvPreview is React.memo-wrapped precisely so
  // parent re-renders (e.g. typing in the JD box) don't reset contentEditable
  // edits, and a fresh object per render would defeat that.
  const displayProfile = useMemo<Profile | null>(() => {
    const sel = Array.isArray(result?.selectedProjects)
      ? result.selectedProjects.filter(
          (s) => s && typeof s.name === "string" && s.name.trim() && Array.isArray(s.bullets) && s.bullets.length > 0
        )
      : [];
    // Right to Work is dropped here unless the Customize switch is on
    // (lib/preferences), so preview, downloads (via the preview's DOM read),
    // the page estimate and the Applied snapshot all see one document.
    // The run's header line (lib/headline) stands in for the extracted tagline.
    const headline = typeof result?.headline === "string" && result.headline.trim() ? result.headline.trim() : "";
    const withHeadline = <T extends Profile | null>(p: T): T => (p && headline ? { ...p, tagline: headline } : p);
    if (sel.length === 0) return withHeadline(profileForDocument(profile, preferences));
    // A pool can exist without an extracted profile; render the selection on
    // an empty-but-well-formed base rather than dropping it.
    const base = withHeadline(profileForDocument(profile ?? normalizeProfile({}), preferences));
    return {
      ...base,
      projects: sel.map((s) => ({
        // "Name | Date" is the stored project-name format splitTrailingDate
        // re-splits on render (date right-aligned, same as master projects).
        name: s.date?.trim() ? `${s.name!.trim()} | ${s.date.trim()}` : s.name!.trim(),
        tech: s.tech?.trim() || "",
        links: [],
        originalBullets: [],
      })),
    };
  }, [profile, result, preferences]);

  // The CV's Right to Work wording for the copy block beside the downloads —
  // read from the stored profile, so it is offered even when off the document.
  const rtwForForms = useMemo(() => rightToWorkForForms(profile), [profile]);

  // Deterministic quality read (lib/quality) of what is on screen: the page
  // estimate the download layout implies, content repeated across sections,
  // bullets with no evidence, filler words. Never blocks; it says what to fix.
  // 1 for under three years (the user's own eligibility answer), else 2 —
  // the page target the estimate, the preview and the downloads all use.
  const onePageTarget: 1 | 2 = onePageExpected(eligibility?.yearsExperience) ? 1 : 2;
  const quality: QualityReport | null = useMemo(() => {
    if (liveQuality) return liveQuality;
    if (!result) return null;
    return qualityReport(
      { summary: result.summary, skills: result.skills, experience: result.experience, projects: result.projects },
      displayProfile,
      result.coverLetter,
      companyOf(result.analysis),
      onePageTarget
    );
  }, [liveQuality, result, displayProfile, onePageTarget]);
  // Under three years of experience (the user's own eligibility answer —
  // never inferred) a recruiter expects one page. Two readings: the content
  // genuinely cannot fit one page at the tightest spacing, or it could but
  // the download's layout stretches a short CV towards two.
  const overOnePage = !!quality && onePageExpected(eligibility?.yearsExperience) && quality.pages.pages > 1;
  const qualityIssues = quality
    ? (quality.pages.overBudget ? 1 : 0) +
      (overOnePage && !quality.pages.overBudget ? 1 : 0) +
      quality.duplicates.length +
      (quality.weakBullets.length > 0 ? 1 : 0) +
      (quality.inflation.length > 0 ? 1 : 0) +
      (quality.boltOns.length > 0 ? 1 : 0)
    : 0;

  // Focus leaving a preview re-reads both notices when either has something
  // to say. Declared after the memos it reads (React Compiler rule).
  function onPreviewBlur() {
    if (!result || (claimIssues === 0 && qualityIssues === 0)) return;
    setTimeout(recheckClaims, 0);
  }

  // Same placeholder-scrubbed view of the finished run's analysis, for the
  // results context row.
  const resultInfo = useMemo(() => {
    const role = realValue(result?.analysis?.role_title);
    const company = realValue(result?.analysis?.company_name);
    return role || company ? { role, company } : null;
  }, [result]);

  // Steps that quietly failed this run — named honestly instead of rendering
  // as blank sections the user might not notice until after they've applied.
  const partialIssues = useMemo(() => {
    if (!result) return [];
    const empty: string[] = [];
    if (!result.summary?.trim()) empty.push("summary");
    if (!result.skills?.trim()) empty.push("skills");
    if (!result.experience?.trim()) empty.push("experience");
    if (!result.coverLetter?.trim()) empty.push("cover letter");
    const issues: string[] = [];
    if (empty.length > 0) {
      issues.push(`The ${empty.join(", ")} ${empty.length > 1 ? "sections" : "section"} came back empty this run.`);
    }
    if (!result.atsScore?.keyword_coverage) issues.push("Search-visibility scoring didn't complete.");
    // The server includes selectedProjects (possibly empty) whenever a pool
    // was sent — an empty array means the selection step failed and the
    // master-CV projects rendered instead.
    if (Array.isArray(result.selectedProjects) && result.selectedProjects.length === 0) {
      issues.push("Project selection from your pool didn't complete this run — showing your master CV's projects instead.");
    }
    return issues;
  }, [result]);

  // First name only, for a personal greeting on the results — falls back to
  // nothing (not a placeholder) if no profile name is set yet.
  const firstName = (profile?.name || "").trim().split(/\s+/)[0] || "";

  // The search-visibility band, re-derived from the same "X/N" the score card
  // shows, so the verdict line and the edits heading can never disagree with
  // the number — including for a result saved before the server sent a band.
  const visibilityBand: VisibilityBand | undefined = (() => {
    if (!result?.atsScore) return undefined;
    const cov = parseCoverage(result.atsScore.keyword_coverage);
    return cov ? bandFor(cov.matched, cov.total) : result.atsScore.band;
  })();
  // One verdict on one screen: when the research panel scored this same
  // company, its Fit Score is authoritative and can only lower the band
  // (lib/visibilityVerdict combineWithFit). The line names the research figure.
  const verdict: CombinedVerdict | undefined = (() => {
    if (!visibilityBand) return undefined;
    const fit = research?.fitScore;
    const total = typeof fit?.total === "number" ? fit.total : null;
    const sameCompany =
      total !== null && !!result?.analysis && companyNamesMatch(realValue(result.analysis.company_name), research?.profile?.company_name);
    return combineWithFit(visibilityBand, sameCompany && total !== null ? { total, tier: fit?.tier ?? "low" } : null);
  })();

  return (
    <main className="page">
      <div className="container">
        <AppHeader
          title="Tailor your CV"
          tagline="Honest tailoring. Every claim traces back to your real CV — nothing invented."
        />

        {/* Master CV status — uploading/editing/replacing it lives on /customize now */}
        {cvLoading ? (
          <Card>
            <div className="label">Master CV</div>
            <Skeleton lines={2} label="Loading your CV" />
          </Card>
        ) : !masterCvText ? (
          <Card>
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                  <path d="M9 13h6M9 17h6" />
                </svg>
              }
              title="Start with your master CV"
              actions={<Button href="/customize">Add your CV in Customize →</Button>}
            >
              Add it once and it&apos;s reused for every job you tailor for here. Paste it or upload a PDF or Word file.
            </EmptyState>
          </Card>
        ) : null}

        {/* Stage 3 — company research + Fit Score (optional, before the JD) */}
        {masterCvText && (
          <Card>
            <FormField
              label="Company research (optional)"
              htmlFor="companyUrl"
              help="Paste the company's website and we'll read their site and live job ads, then score how well your real CV fits before you spend a tailor. Uses one tailor credit — repeat lookups of the same company are free for 7 days."
            >
              <div className="researchRow">
                <Input
                  id="companyUrl"
                  value={companyUrl}
                  onChange={(e) => setCompanyUrl(e.target.value)}
                  placeholder="e.g. deliveroo.co.uk"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button variant="secondary" onClick={() => handleResearch()} disabled={researchLoading || loading}>
                  {researchLoading ? "Researching…" : "Research company"}
                </Button>
              </div>
            </FormField>
            {researchError && (
              <StatusText style={{ marginTop: "var(--space-3)" }} role="alert">{researchError}</StatusText>
            )}

            {research && !researchLoading && (
              <Card variant="dashed">
                <div className="researchHead">
                  <div>
                    <div className="gateLabel">Company profile</div>
                    <div className="researchName">{research.profile?.company_name || companyUrl}</div>
                    {research.domain && <div className="fitEvidence">{research.domain}</div>}
                  </div>
                  <button type="button" className="inlineLink researchRefresh" onClick={() => handleResearch(true)}>
                    {research.cached ? "Saved result — research again" : "Research again"}
                  </button>
                </div>
                {research.profile?.what_they_build && (
                  <p className="gateNote">
                    {research.profile.what_they_build}
                    {research.profile.target_audience && <> Audience: {research.profile.target_audience}.</>}
                    {research.profile.ai_footprint && <> {research.profile.ai_footprint}</>}
                  </p>
                )}

                {research.fitScore && typeof research.fitScore.total === "number" && (
                  <div className="fitBlock">
                    <div className="fitHeader">
                      <span className={`fitTierBadge ${research.fitScore.tier ?? "low"}`}>
                        {FIT_TIER_META[research.fitScore.tier ?? "low"].emoji}{" "}
                        {FIT_TIER_META[research.fitScore.tier ?? "low"].label}
                      </span>
                      <span className="fitTotal">
                        {research.fitScore.total}
                        <span className="fitOutOf">/100</span>
                      </span>
                    </div>
                    {research.fitScore.headline && <p className="gateNote">{research.fitScore.headline}</p>}
                    <div className="fitBars">
                      {FIT_COMPONENT_META.map(({ key, label, weight }) => {
                        const c = research.fitScore?.components?.[key];
                        if (!c || typeof c.score !== "number") return null;
                        return (
                          <div className="fitBar" key={key}>
                            <div className="fitBarTop">
                              <span>{label} · weighs {weight}%</span>
                              <span>{c.score}</span>
                            </div>
                            <div className="fitBarTrack" role="img" aria-label={`${label}: ${c.score} out of 100`}>
                              <div className="fitBarFill" style={{ width: `${c.score}%` }} />
                            </div>
                            {c.evidence && <p className="fitEvidence">{c.evidence}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {research.fitScore.honest_gaps && (
                      <p className="fitGaps">
                        <strong>Honest gaps:</strong> {research.fitScore.honest_gaps}
                      </p>
                    )}
                  </div>
                )}

                {Array.isArray(research.stackKeywords) && research.stackKeywords.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">
                      Engineering stack — from {research.jobBoard?.count ?? research.openings?.length ?? 0} live job ads
                    </div>
                    <div className="stackChips">
                      {research.stackKeywords.map((k) => {
                        const matched = research.fitScore?.matched_stack?.some(
                          (m) => m.toLowerCase() === k.keyword.toLowerCase()
                        );
                        return (
                          <span key={k.keyword} className={"stackChip" + (matched ? " matched" : "")}>
                            {matched ? "✓ " : ""}{k.keyword}
                          </span>
                        );
                      })}
                    </div>
                    <p className="fitEvidence">✓ = already evidenced in your master CV.</p>
                  </div>
                )}

                {Array.isArray(research.websiteStack) && research.websiteStack.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">Their website runs on</div>
                    <div className="stackChips">
                      {research.websiteStack.map((s) => (
                        <span key={s} className="stackChip muted">{s}</span>
                      ))}
                    </div>
                    <p className="fitEvidence">
                      Website tech ≠ engineering stack — the job ads above are the real hiring signal.
                    </p>
                  </div>
                )}

                {Array.isArray(research.openings) && research.openings.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">
                      Open roles ({research.openings.length})
                      {research.jobBoard?.provider && <> — via {research.jobBoard.provider}</>}
                    </div>
                    <ul className="openingsList">
                      {(showAllOpenings ? research.openings : research.openings.slice(0, 6)).map((o, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="openingBtn"
                            onClick={() => applyOpening(o)}
                            disabled={loading}
                            title="Use this job ad as the job description below"
                          >
                            <span className="openingTitle">{o.title}</span>
                            {o.location && <span className="openingLoc">{o.location}</span>}
                            <span className="openingUse">Use as JD ↓</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {research.openings.length > 6 && (
                      <button
                        type="button"
                        className="inlineLink"
                        onClick={() => setShowAllOpenings((v) => !v)}
                      >
                        {showAllOpenings ? "Show fewer" : `Show all ${research.openings.length} roles`}
                      </button>
                    )}
                  </div>
                )}

                {/* Cold outreach — a SEPARATE flow from the JD box: tailor
                    CV + cover letter straight from the research (no posted
                    job, no keyword gate), then draft the email to send with
                    the CV attached (email is owner-only; server enforces). */}
                {research.profile && (research.profile.company_name || research.profile.what_they_build) ? (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">Cold outreach — no job posting needed</div>
                    <p className="gateNote" style={{ marginBottom: "var(--space-3)" }}>
                      Tailors your CV and cover letter to {research.profile.company_name || "this company"}&apos;s
                      real stack from the research — completely separate from the job-description box below.
                    </p>
                    <div className="gateActions">
                      <Button variant="secondary" onClick={runColdOutreachTailor} disabled={loading || researchLoading}>
                        {loading
                          ? "Tailoring…"
                          : isUnlimited
                            ? "Tailor CV + cover letter + cold email"
                            : "Tailor CV + cover letter for this company"}
                      </Button>
                    </div>

                    {isUnlimited && (
                      <>
                        <div className="outreachInputs">
                          <Input
                            value={recipientName}
                            onChange={(e) => setRecipientName(e.target.value)}
                            placeholder="Recipient's name (optional)"
                            maxLength={80}
                            autoComplete="off"
                          />
                          <Input
                            value={personalNote}
                            onChange={(e) => setPersonalNote(e.target.value)}
                            placeholder="One TRUE line about how you know them (optional)"
                            maxLength={300}
                            autoComplete="off"
                          />
                        </div>
                        <p className="fitEvidence">
                          Left empty, the email skips the personal line — it never invents a connection.
                        </p>
                        <div className="gateActions" style={{ marginTop: "var(--space-3)" }}>
                          <Button
                            variant="secondary"
                            onClick={() => handleExtra("cold_email")}
                            disabled={extrasLoading !== ""}
                          >
                            {extrasLoading === "cold_email" ? "Writing…" : coldEmail ? "Rewrite cold email" : "Cold email draft"}
                          </Button>
                          <span className="fitEvidence">
                            {!result?.analysis
                              ? "No role selected — it pitches speculatively."
                              : companyNamesMatch(realValue(result.analysis.company_name), research.profile?.company_name)
                                ? "References the tailored role."
                                : "The tailored role is for a different company — it pitches speculatively."}
                          </span>
                          {coldEmailError && (
                            <StatusText as="span" role="alert">{coldEmailError}</StatusText>
                          )}
                        </div>
                        {coldEmail && (
                          <div className="extraBlock">
                            <div className="gateLabel">Ready to send — attach your downloaded CV</div>
                            <p className="extraText">{coldEmail}</p>
                            {coldEmailCheck && coldEmailCheck.skillViolations.length + coldEmailCheck.numberViolations.length > 0 && (
                              <p className="fitEvidence" role="status" data-email-claim-check>
                                Claims check:{" "}
                                {[
                                  ...coldEmailCheck.skillViolations.map((s) => `${s.skill} is marked learning`),
                                  ...coldEmailCheck.numberViolations.map((n) =>
                                    n.kind === "absent" ? `${n.figure} isn't on your CV` : `${n.figure} is used in a different context`
                                  ),
                                ].join("; ")}
                                . Rewrite the email or edit before sending.
                              </p>
                            )}
                            <button type="button" className="inlineLink" onClick={copyColdEmail}>
                              {emailCopied ? "Copied ✓" : "Copy email"}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="atsGroup">
                    <p className="gateNote" style={{ marginBottom: 0 }}>
                      This research came back without company details, so tailoring and outreach are
                      unavailable for it — use &quot;research again&quot; above to refresh.
                    </p>
                  </div>
                )}
              </Card>
            )}
          </Card>
        )}

        {/* JD card — only show once a master CV exists */}
        {masterCvText && (
          <Card>
            {appliedState === "cleared" && !result && (
              <div className="limitNotice" role="status" data-applied-cleared style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
                <div className="limitNotice__title">Saved to your tracker</div>
                <div className="limitNotice__body">
                  The CV, the cover letter and the posting are on the tracker, so the workspace is clear for the next one.
                  {appliedNotice ? ` ${appliedNotice}` : ""}
                </div>
                <div className="limitNotice__cta" style={{ gap: "var(--space-2)" }}>
                  <Button type="button" variant="secondary" onClick={undoClear}>
                    Bring the last result back
                  </Button>
                  <Link href="/applications" className="customizeLink">View tracker →</Link>
                </div>
              </div>
            )}
            <FormField label="Job description" htmlFor="jd">
              <Textarea
                id="jd"
                value={jobDescription}
                onChange={(e) => {
                  setJobDescription(e.target.value);
                  // The gate's analysis was computed for the PREVIOUS JD text —
                  // reusing it against an edited JD would show a stale keyword
                  // match and let /api/tailor skip Step 1 for the wrong job.
                  if (preCheck || gateAnalysis) {
                    setPreCheck(null);
                    setGateAnalysis(null);
                    setGateExtras(null);
                    setGateError("");
                  }
                }}
                placeholder="Paste the job description for the role you're applying to…"
                rows={8}
              />
              <p className={"charCount" + (jobDescription.length > MAX_JD_CHARS ? " over" : "")} aria-live="polite">
                {jobDescription.length.toLocaleString()} / {MAX_JD_CHARS.toLocaleString()}
              </p>
            </FormField>
            {usage && !usage.unlimited && (
              <p className="usageRow">
                <span>
                  Free tailors today:{" "}
                  <strong>{Math.max(usage.dailyLimit - usage.dailyUsed, 0)} of {usage.dailyLimit}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Claude credits:{" "}
                  <strong>{Math.max(usage.claudeLimit - usage.claudeUsed, 0)} of {usage.claudeLimit}</strong>
                </span>
              </p>
            )}
            {/* Step 1: cheap pre-check (JD analysis only) — shown until a gate
                result exists. Provider choice doesn't apply here: the gate
                always runs on Claude, same as profile extraction. */}
            {!preCheck && (
              <div className="actions">
                <Button onClick={handlePreCheck} disabled={gateLoading || loading}>
                  {gateLoading ? "Checking keyword match…" : "Tailor my CV"}
                </Button>
                {error && !hasOwnNotice(errorType) && (
                  <StatusText as="span" role="alert">{error}</StatusText>
                )}
              </div>
            )}

            {/* The pre-check call itself failed — don't block on it, just let
                them proceed straight to the full run (which re-runs Step 1 fresh). */}
            {gateError && !preCheck && (
              <Card variant="dashed">
                <p className="gateNote" style={{ marginBottom: 'var(--space-3)' }}>{gateError}</p>
                {jdInfo.partial && (
                  <p className="gateNote" style={{ marginBottom: 'var(--space-3)' }}>{JD_PARTIAL_NOTICE}</p>
                )}
                {research?.profile?.company_name && (
                  <p className="gateNote" style={{ marginBottom: 'var(--space-3)' }}>
                    Without the check we can&apos;t confirm this job is at{" "}
                    <strong>{research.profile.company_name}</strong>, so your research won&apos;t be applied to this run.
                  </p>
                )}
                <div className="gateActions">
                  <Button variant="secondary" onClick={runFullTailor} disabled={loading}>
                    {loading ? "Tailoring…" : "Tailor without the check →"}
                  </Button>
                </div>
              </Card>
            )}

            {/* Step 2: the gate result. Never blocks below 10/15 — just informs. */}
            {preCheck && (
              <Card variant="dashed">
                {gateInfo && (
                  <p className="gateRole">
                    Looks like: <strong>{gateInfo.role || "this role"}</strong>
                    {gateInfo.company && <> at <strong>{gateInfo.company}</strong></>}
                    {" "}— if that&apos;s not the job you meant, fix the JD above before continuing.
                  </p>
                )}
                {researchBinding && (
                  <p className="gateNote" data-research-binding={researchBinding.status}>
                    {researchBinding.status === "match" && (
                      <>Company research for <strong>{researchBinding.company}</strong> will be used in this run.</>
                    )}
                    {researchBinding.status === "mismatch" && (
                      <>
                        Your research is for <strong>{researchBinding.company}</strong>; this job looks like{" "}
                        <strong>{researchBinding.jobCompany}</strong> — the research won&apos;t be applied to this run.
                      </>
                    )}
                    {researchBinding.status === "unknown" && (
                      <>
                        Couldn&apos;t tell which company this job is at, so your research for{" "}
                        <strong>{researchBinding.company}</strong> won&apos;t be applied to this run.
                      </>
                    )}
                  </p>
                )}
                {gateExtras?.duplicateOf && (
                  <div className="limitNotice" role="status" style={{ marginBottom: 'var(--space-4)' }} data-gate-duplicate>
                    You already saved this exact job description:{" "}
                    {gateExtras.duplicateOf.map((d, i) => (
                      <span key={d.id}>
                        {i > 0 ? "; " : ""}
                        <strong>{d.company_name} — {d.role}</strong>, applied {formatDay(d.date_applied)}
                      </span>
                    ))}
                    . Continue only if this is a genuinely new application.
                  </div>
                )}
                {gateExtras?.sameCompany && (
                  <div className="limitNotice" role="status" style={{ marginBottom: 'var(--space-4)' }} data-gate-same-company>
                    You have already applied to <strong>{gateExtras.sameCompany.company}</strong>{" "}
                    {gateExtras.sameCompany.count === 1 ? "once" : `${gateExtras.sameCompany.count} times`}
                    {" "}(last: {gateExtras.sameCompany.last.role}, {formatDay(gateExtras.sameCompany.last.date_applied)}
                    {gateExtras.sameCompany.last.status ? `, ${gateExtras.sameCompany.last.status}` : ""}). Recruiters see every application to
                    their company in one screen; apply again only for a genuinely different role.
                  </div>
                )}
                {jdInfo.partial && (
                  <div className="limitNotice" role="status" style={{ marginBottom: 'var(--space-4)' }} data-gate-partial>
                    {JD_PARTIAL_NOTICE}
                  </div>
                )}
                {gateExtras?.fallback && (
                  <p className="gateNote" data-fallback-notice>
                    {fallbackNotice(gateExtras.fallback)}
                  </p>
                )}
                {gateExtras?.seniority && gateExtras.seniority.level !== "unknown" && (
                  <div
                    className={gateExtras.seniority.fits === false ? "limitNotice" : "gateNote"}
                    role="status"
                    style={{ marginBottom: 'var(--space-4)' }}
                    data-gate-seniority={gateExtras.seniority.level}
                    data-gate-seniority-fits={String(gateExtras.seniority.fits)}
                  >
                    {gateExtras.seniority.reason}
                    {gateExtras.seniority.signals.length > 0 && (
                      <>
                        {" "}Read from: {gateExtras.seniority.signals.map((s) => `${s.kind === "title" ? "title" : s.kind === "years" ? "years" : s.kind === "salary" ? "salary" : "ownership"} (${s.text})`).join(", ")}.
                      </>
                    )}
                  </div>
                )}
                {gateExtras?.knockouts && (
                  <>
                    <div className="gateLabel">Read on this application</div>
                    <Badge variant="value" tone={gateRead === "apply" ? "success" : "neutral"} data-gate-read={gateRead}>
                      {READ_LABEL[gateRead]}
                    </Badge>
                    <p className="gateNote">
                      {gateExtras.knockouts.read.reason}
                      {!gateExtras.knockouts.profileSet && (
                        <>
                          {" "}Set up your eligibility answers in{" "}
                          <Link href="/customize" className="customizeLink">Customize</Link> (about 2 minutes) and this
                          check turns each job&apos;s eligibility conditions into pass or fail before you spend a tailor.
                        </>
                      )}
                    </p>
                    {gateVerdicts.length > 0 && (
                      <div className="atsGroup">
                        <div className={"atsGroupLabel " + (gateExtras.knockouts.verdicts.some((x) => x.verdict === "hard") ? "misses" : "recs")}>
                          Eligibility gates ({gateVerdicts.length})
                        </div>
                        <ul className="atsList" data-gate-list>
                          {gateVerdicts.map((x, i) => (
                            <li key={i} data-gate-verdict={x.verdict}>
                              <Badge variant="dot" tone={x.verdict === "hard" ? "miss" : x.verdict === "pass" ? "hit" : "rec"}>
                                {x.verdict === "hard" ? "✕" : x.verdict === "pass" ? "✓" : x.verdict === "soft" ? "→" : "?"}
                              </Badge>
                              <span>
                                <strong>{CATEGORY_LABEL[x.gate.category]}:</strong> &ldquo;{x.gate.requirement}&rdquo; — {x.reason}
                                {x.wording && <span className="fitEvidence" style={{ display: "block" }}>Say: {x.wording}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                <div className="gateLabel" style={gateExtras?.knockouts ? { marginTop: 'var(--space-5)' } : undefined}>
                  Rough keyword match, before tailoring
                </div>
                <Badge variant="value" tone={preCheck.matched >= 10 ? "success" : "neutral"}>
                  {preCheck.matched}/{preCheck.total}
                </Badge>
                <p className="gateNote">
                  {preCheck.matched >= 10
                    ? "Good overlap with this role's top keywords, from your CV as it stands today."
                    : "Below the usual 10-keyword mark for your CV as-is — tailoring can still genuinely help by surfacing real adjacent skills, though a gap this size may be honest too."}
                  {" "}This checks literal keyword presence in your raw CV; the tailored version gets scored separately afterward, and the two numbers can differ.
                </p>
                {gateExtras?.required && gateExtras.required.total > 0 && (
                  <>
                    <div className="gateLabel">Required skills in your CV</div>
                    <Badge variant="value" tone={gateExtras.required.matched / gateExtras.required.total >= 0.5 ? "success" : "neutral"}>
                      {gateExtras.required.matched}/{gateExtras.required.total}
                    </Badge>
                    <p className="gateNote">
                      {gateExtras.required.missedKeywords.length > 0
                        ? `Not in your CV as it stands: ${gateExtras.required.missedKeywords.join(", ")}.`
                        : "Every required skill the posting names is in your CV."}
                    </p>
                  </>
                )}
                <div className="gateActions">
                  <Button variant={gateRead === "skip" || seniorityBlocks ? "secondary" : "primary"} onClick={runFullTailor} disabled={loading}>
                    {loading ? "Tailoring…" : gateRead === "skip" || seniorityBlocks ? "Tailor anyway (uses a credit) →" : "Continue to full tailoring →"}
                  </Button>
                  {variants && variants.variants.length > 0 && (
                    <span className="providerPick" data-variant-pick={variantPick.variant?.id ?? "none"}>
                      <label htmlFor="variantSelect">Positioning</label>
                      <select
                        id="variantSelect"
                        value={variantOverride ?? "auto"}
                        onChange={(e) => setVariantOverride(e.target.value === "auto" ? null : e.target.value)}
                        disabled={loading}
                        title={variantPick.reason}
                      >
                        <option value="auto">Auto{variantOverride ? "" : variantPick.variant ? ` — ${variantPick.variant.name}` : " — none"}</option>
                        {variants.variants.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                        <option value="none">None</option>
                      </select>
                    </span>
                  )}
                  {isUnlimited && (
                    <span className="providerPick">
                      <label htmlFor="providerSelect">Provider</label>
                      <select
                        id="providerSelect"
                        value={provider}
                        onChange={(e) => setProvider(e.target.value as TailorProvider)}
                        disabled={loading}
                      >
                        <option value="anthropic">Claude</option>
                        <option value="gemini">Gemini</option>
                        <option value="openrouter">OpenRouter</option>
                      </select>
                      {ranProvider && ranProvider in PROVIDER_LABELS && (
                        <span className="providerRan">ran on {PROVIDER_LABELS[ranProvider as TailorProvider]}</span>
                      )}
                    </span>
                  )}
                </div>
                {error && !hasOwnNotice(errorType) && (
                  <StatusText style={{ marginTop: 'var(--space-3)' }} role="alert">{error}</StatusText>
                )}
              </Card>
            )}

            {/* ── Saved key unreadable — re-entry needed (e.g. after KEY_ENCRYPTION_SECRET rotation) ── */}
            {/* ── The SHARED account has run out of credit ──
                Not the user's fault and not fixable by retrying, but the app
                has an answer: their own free OpenRouter key runs tailoring
                instead. Found by the first real paid run on 2026-09-24, when
                every tailor returned a bare "Tailoring failed". */}
            {errorType === "provider_credit" && (
              <div className="limitNotice" role="alert" data-provider-credit>
                <div className="limitNotice__title">Tailoring is temporarily unavailable.</div>
                <div className="limitNotice__body">
                  The shared Claude account has run out of credit — this isn&apos;t your account, and you
                  haven&apos;t been charged a tailor. Add your own free OpenRouter key and tailoring runs on
                  it instead, starting immediately.
                </div>
                <Button href="/settings" className="limitNotice__cta">
                  Add your key in Settings →
                </Button>
              </div>
            )}

            {errorType === "key_decrypt_failed" && (
              <div className="limitNotice" role="alert">
                <div className="limitNotice__title">Your API key needs to be re-entered.</div>
                <div className="limitNotice__body">
                  Your saved key can no longer be read. Please go to Settings and replace it.
                </div>
                <Button href="/settings" className="limitNotice__cta">
                  Go to Settings →
                </Button>
              </div>
            )}

            {/* ── Free tailors used up — no keys saved yet ── */}
            {errorType === "needs_keys" && (
              <div className="limitNotice" role="alert">
                <div className="limitNotice__title">Your 3 free tailors are used up.</div>
                <div className="limitNotice__body">
                  Add your own key to keep going — it takes 2 minutes and the tool stays free.
                </div>
                <Button href="/settings" className="limitNotice__cta">
                  Add your key in Settings →
                </Button>
              </div>
            )}

            {/* ── Has a Gemini key, but Gemini can't complete a run ── */}
            {errorType === "needs_openrouter_key" && (
              <div className="limitNotice" role="alert">
                <div className="limitNotice__title">Your Gemini key can&apos;t run a tailor.</div>
                <div className="limitNotice__body">
                  Gemini&apos;s free tier allows 5 requests per minute, and one tailoring run makes 8 —
                  so it can&apos;t finish even once. Add an OpenRouter key instead; its free tier handles
                  a full run.
                </div>
                <Button href="/settings" className="limitNotice__cta">
                  Add an OpenRouter key →
                </Button>
              </div>
            )}

            {/* ── User's own key quota exhausted ── */}
            {errorType === "user_key_limit" && (
              <div className="limitNotice" role="alert">
                <div className="limitNotice__title">Today&apos;s tailoring limit is reached.</div>
                <div className="limitNotice__body">
                  Your key&apos;s free quota resets daily — come back tomorrow to continue.
                </div>
                <div className="limitNotice__body">
                  A subscription plan with higher limits is on the way.
                </div>
              </div>
            )}

            {/* ── Other limit states (daily cap, provider quota) ── */}
            {error && (errorType === "user_limit" || errorType === "provider_limit" || errorType === "claude_limit_reached") && (
              <div className="limitNotice" role="alert">{error}</div>
            )}
          </Card>
        )}

        {loading && (
          <section className="loading">
            <div className="pulse" />
            <div className="loadingBody">
              <ul>
                <li>Analysing the job description</li>
                <li>{runResearchCompany ? `Using your research for ${runResearchCompany}` : "Researching the company"}</li>
                <li>Tailoring summary, skills, experience, projects</li>
                <li>Writing your cover letter</li>
                <li>Scoring recruiter search visibility</li>
              </ul>
              <p className="loadingMeta">{elapsed}s — a full run usually takes 20–40 seconds.</p>
            </div>
          </section>
        )}

        {!cvLoading && result && (
          <section className="results riseIn">
            {resultInfo && (
              <div className="resultsContext">
                <span>
                  Tailored for <strong>{resultInfo.role || "this role"}</strong>
                  {resultInfo.company && <> at <strong>{resultInfo.company}</strong></>}
                  {result.variantName && (
                    <span data-variant-used={result.variantName}>
                      {" "}· positioned as <strong>{result.variantName}</strong>
                      {result.variantReason && <span className="fitEvidence" style={{ display: "block" }}>{result.variantReason}</span>}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="inlineLink"
                  onClick={() => {
                    const jd = document.getElementById("jd");
                    jd?.scrollIntoView({ behavior: "smooth", block: "center" });
                    (jd as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
                  }}
                >
                  Start a new tailoring ↑
                </button>
              </div>
            )}
            {staleRun && (
              <div className="limitNotice" role="alert" data-stale-jd>
                <div className="limitNotice__title">The job description changed since this CV was tailored</div>
                <div className="limitNotice__body">
                  Downloads are held until the text above matches the posting this was tailored for (Applied still
                  saves the run with the posting it was tailored from). Restore that text, or clear this result and
                  tailor the new posting.
                </div>
                <div className="limitNotice__cta" style={{ gap: "var(--space-2)" }}>
                  <Button type="button" variant="secondary" onClick={() => setJobDescription(resultJd ?? "")}>
                    Restore that job description
                  </Button>
                  <Button type="button" variant="ghost" onClick={clearResult}>
                    Clear this result
                  </Button>
                </div>
              </div>
            )}
            {partialIssues.length > 0 && (
              <div className="limitNotice" role="status">
                {partialIssues.join(" ")} Re-running the same job description retries those steps
                (it counts as a new run).
              </div>
            )}
            {activeCheck && claimIssues > 0 && (
              <div className="limitNotice" role={blocked ? "alert" : "status"} data-claim-check={blocked ? "blocking" : "warn"}>
                <div className="limitNotice__title">
                  {blocked
                    ? `Claims check: ${claimIssues === 1 ? "1 thing" : `${claimIssues} things`} to fix before you can download`
                    : `Claims check: ${claimIssues === 1 ? "1 thing" : `${claimIssues} things`} to look at`}
                </div>
                <div className="limitNotice__body">
                  <ul className="atsList">
                    {activeCheck.skillViolations.map((s, i) => (
                      <li key={`s${i}`}>
                        <Badge variant="dot" tone={activeCheck.mode === "enforce" ? "miss" : "rec"}>
                          {activeCheck.mode === "enforce" ? "✕" : "?"}
                        </Badge>
                        <span>
                          {s.level === "learning" ? (
                            <>
                              <strong>{s.skill}</strong> is marked <em>learning</em> in your registry, and it appears in the {WHERE_LABEL[s.where]}
                              {s.claim ? <>: &ldquo;{s.claim}&rdquo;</> : null}.
                            </>
                          ) : (
                            <>
                              <strong>{s.skill}</strong> is registered as <em>project-only</em>, but the {WHERE_LABEL[s.where]} claims more — {s.claim}.
                              Rule: {SKILL_RULE_TEXT[s.rule]}. Raise its level in Customize only if you have used it at work.
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                    {activeCheck.numberViolations.map((n, i) => (
                      <li key={`n${i}`}>
                        <Badge variant="dot" tone={activeCheck.mode === "enforce" && n.kind === "absent" ? "miss" : "rec"}>
                          {n.kind === "absent" ? "✕" : "?"}
                        </Badge>
                        <span>
                          <strong>{n.figure}</strong>{" "}
                          {n.kind === "absent" ? "isn't on your master CV" : "is on your CV in a different context"} — in the{" "}
                          {WHERE_LABEL[n.where]}: &ldquo;{n.sentence.length > 140 ? `${n.sentence.slice(0, 139)}…` : n.sentence}&rdquo;
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="fitEvidence">
                    {blocked
                      ? "Edit the preview below, then re-check. Download and Applied unlock when it passes."
                      : activeCheck.mode === "enforce"
                        ? "Warnings don't block downloads; a figure missing from your CV or a skill claimed above its level would."
                        : "Save a master CV in Customize and its skills become blocking checks."}
                  </p>
                </div>
                <div className="limitNotice__cta">
                  <Button variant="secondary" onClick={recheckClaims}>Re-check now</Button>
                </div>
              </div>
            )}
            {(result.formatFixes?.tools || result.formatFixes?.summary) && (
              <div className="limitNotice" role="status" data-format-fixes>
                <div className="limitNotice__title">Formatting rules applied</div>
                <div className="limitNotice__body">
                  <ul className="atsList">
                    {result.formatFixes.tools && (
                      <li data-format-fix="tools">
                        <Badge variant="dot" tone="rec">→</Badge>
                        <span>
                          Technical Tools ran to {result.formatFixes.tools.kept.length + result.formatFixes.tools.dropped.length}; kept the{" "}
                          {result.formatFixes.tools.kept.length} most relevant to this role and dropped:{" "}
                          {result.formatFixes.tools.dropped.join(", ")}. Add one back in the preview if it matters more than a term shown.
                        </span>
                      </li>
                    )}
                    {result.formatFixes.summary && (
                      <li data-format-fix="summary">
                        <Badge variant="dot" tone="rec">→</Badge>
                        <span>
                          The summary came back as {result.formatFixes.summary.sentences} sentences; kept the first{" "}
                          {result.formatFixes.summary.kept}, one per line. Check they still carry the role title and your strongest figure.
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
            {result.variantLeadSkills && result.variantLeadSkills.dropped.length > 0 && (
              <div className="limitNotice" role="status" data-lead-skills-skipped>
                <div className="limitNotice__title">Lead skills skipped</div>
                <div className="limitNotice__body">
                  {leadSkillsNotice(result.variantLeadSkills.dropped)} Change the level on Customize if it is production work, or take it out of the variant.
                </div>
              </div>
            )}
            {result.fallback && (
              <div className="limitNotice" role="status" data-fallback-notice>
                <div className="limitNotice__title">Ran on OpenRouter</div>
                <div className="limitNotice__body">{fallbackNotice(result.fallback)}</div>
              </div>
            )}
            {graduateLayout?.changed && (
              <div className="limitNotice" role="status" data-graduate-layout>
                <div className="limitNotice__title">Graduate-scheme layout</div>
                <div className="limitNotice__body">
                  This posting is screened on the degree first, so Education sits under the summary for this run.
                  Your saved section order is unchanged.
                </div>
                <div className="limitNotice__cta">
                  <Button type="button" variant="secondary" onClick={() => setStandardOrderFor(tailorSessionId ?? "run")}>
                    Use my standard order for this run
                  </Button>
                </div>
              </div>
            )}
            {result.onePage && (
              <div className="limitNotice" role="status" data-one-page={result.onePage.fits ? "fits" : "over"}>
                <div className="limitNotice__title">
                  {result.onePage.fits ? "Fitted to one page" : "Could not fit one page"}
                </div>
                <div className="limitNotice__body">
                  Under three years of experience calls for one page, so the download is laid out to one.
                  {result.onePage.leftOut.experience.length + result.onePage.leftOut.projects.length + result.onePage.leftOut.summary.length + result.onePage.leftOut.tools.length > 0
                    ? " Left out for length — paste one back into the preview if it matters more than what stayed:"
                    : " Nothing had to be left out."}
                  {!result.onePage.fits && " Even at the tightest spacing it still runs over: shorten the remaining bullets in the preview."}
                  <ul className="atsList">
                    {result.onePage.leftOut.summary.map((s, i) => (
                      <li key={`s${i}`}>Summary: {s}</li>
                    ))}
                    {result.onePage.leftOut.tools.length > 0 && <li>Technical Tools: {result.onePage.leftOut.tools.join(", ")}</li>}
                    {result.onePage.leftOut.experience.map((e, i) => (
                      <li key={`e${i}`}>{e.role ? `${e.role}: ` : ""}{e.bullet}</li>
                    ))}
                    {result.onePage.leftOut.projects.map((p, i) => (
                      <li key={`p${i}`}>{p.project}: {p.bullet}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {result.rtwStripped && (result.rtwStripped.cv.length > 0 || result.rtwStripped.letter.length > 0) && (
              <div className="limitNotice" role="status" data-rtw-stripped>
                <div className="limitNotice__title">Right to Work kept off the document</div>
                <div className="limitNotice__body">
                  Your setting keeps immigration status off the CV, so these sentences were removed
                  {result.rtwStripped.cv.length > 0 && result.rtwStripped.letter.length > 0
                    ? " from the CV and the cover letter"
                    : result.rtwStripped.cv.length > 0
                      ? " from the CV"
                      : " from the cover letter"}
                  . The wording is still in the copy block below for application forms.
                  <ul className="atsList">
                    {[...result.rtwStripped.cv, ...result.rtwStripped.letter].map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {quality && qualityIssues > 0 && (
              <div className="limitNotice" role="status" data-quality-check>
                <div className="limitNotice__title">Before you send</div>
                <div className="limitNotice__body">
                  <ul className="atsList">
                    {quality.pages.overBudget && (
                      <li>
                        <Badge variant="dot" tone="miss">✕</Badge>
                        <span>
                          About <strong>{quality.pages.pages} pages</strong> — over the two-page limit even at the tightest
                          spacing. Cut the least relevant bullets in the preview below.
                        </span>
                      </li>
                    )}
                    {overOnePage && !quality.pages.overBudget && (
                      <li data-quality-one-page={quality.pages.fitsOnePage ? "stretched" : "over"}>
                        <Badge variant="dot" tone="miss">✕</Badge>
                        <span>
                          About <strong>{quality.pages.pages} pages</strong> for under three years of experience — recruiters expect one.{" "}
                          {quality.pages.fitsOnePage
                            ? // Deliberately NOT "cut until it fits one page": the document is laid
                              // out over two pages by design, so trimming content only buys roomier
                              // spacing, never a one-page file. Say what the length actually is.
                              "The content itself would fit one page — the length here is spacing, not substance. Worth asking whether every bullet earns its place."
                            : "Even the tightest spacing can't hold this on one page: cut the least relevant bullets and projects in the preview below."}
                        </span>
                      </li>
                    )}
                    {quality.duplicates.map((d, i) => (
                      <li key={`d${i}`}>
                        <Badge variant="dot" tone="rec">?</Badge>
                        <span>
                          <strong>{d.text}</strong>{" "}
                          {d.kind === "project_in_experience"
                            ? "is a project and also appears under Experience — keep it in one place."
                            : d.kind === "project_in_education"
                              ? "is a project and also appears under Education — keep it in one place."
                              : "appears twice."}
                        </span>
                      </li>
                    ))}
                    {quality.weakBullets.length > 0 && (
                      <li>
                        <Badge variant="dot" tone="rec">?</Badge>
                        <span>
                          {quality.weakBullets.length === 1 ? "One bullet carries" : `${quality.weakBullets.length} bullets carry`} no number,
                          scale or named system: &ldquo;{quality.weakBullets[0].slice(0, 90)}
                          {quality.weakBullets[0].length > 90 ? "…" : ""}&rdquo;
                          {quality.weakBullets.length > 1 ? " and more" : ""}. Add the evidence from your CV, or cut it.
                        </span>
                      </li>
                    )}
                    {quality.inflation.length > 0 && (
                      <li>
                        <Badge variant="dot" tone="rec">?</Badge>
                        <span>
                          Filler a recruiter reads straight past:{" "}
                          {quality.inflation.map((h) => `${h.word}${h.count > 1 ? ` ×${h.count}` : ""}`).join(", ")}. Cut or replace with what you did.
                        </span>
                      </li>
                    )}
                    {quality.boltOns.length > 0 && (
                      <li data-quality-boltons={quality.boltOns.length}>
                        <Badge variant="dot" tone="rec">?</Badge>
                        <span>
                          {quality.boltOns.length === 1 ? "One bullet ends" : `${quality.boltOns.length} bullets end`} by explaining why it matters to
                          the employer: &ldquo;…{quality.boltOns[0].slice(-80)}&rdquo;
                          {quality.boltOns.length > 1 ? " and more" : ""}. That clause is the clearest sign of a tool at work; cut it and let the bullet
                          stop on the result.
                        </span>
                      </li>
                    )}
                  </ul>
                  <p className="fitEvidence">Edit the preview below; this read updates when you click away or re-check.</p>
                </div>
                <div className="limitNotice__cta">
                  <Button variant="secondary" onClick={recheckClaims} data-quality-recheck>Re-check now</Button>
                </div>
              </div>
            )}
            {result.atsScore?.keyword_coverage && (
              <div className="scoreCard">
                <div className="scoreLabel">
                  {firstName ? `Hey ${firstName}, here's your recruiter search visibility` : "Your recruiter search visibility"}
                </div>
                <div className="scoreValue">{result.atsScore.keyword_coverage}</div>
                {verdict && (
                  <div className="scoreVerdict" data-band={verdict.band} data-visibility-verdict>
                    {verdict.label}
                  </div>
                )}
                {verdict?.fitNote && (
                  <div className="scoreSub" data-fit-reference>
                    {verdict.fitNote}
                  </div>
                )}
                {result.atsScore.required_skill_coverage && (
                  <div className="scoreSub">
                    Required skills in the tailored CV: {result.atsScore.required_skill_coverage}
                    {(result.atsScore.required_misses?.length ?? 0) > 0
                      ? ` — not present: ${result.atsScore.required_misses!.join(", ")}`
                      : ""}
                  </div>
                )}
                <p className="scoreNote">
                  How likely a recruiter searching their pipeline for this role&apos;s terms is to surface your CV — the count is how many of those terms the tailored text carries.
                </p>

                {Array.isArray(result.atsScore.hits) && result.atsScore.hits.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel hits">Matched ({result.atsScore.hits.length})</div>
                    <ul className="atsList">
                      {result.atsScore.hits.map((h, i) => (
                        <li key={i}><Badge variant="dot" tone="hit">✓</Badge>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(result.atsScore.misses) && result.atsScore.misses.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel misses">Missing ({result.atsScore.misses.length})</div>
                    <ul className="atsList">
                      {result.atsScore.misses.map((m, i) => (
                        <li key={i}><Badge variant="dot" tone="miss">✕</Badge>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(result.atsScore.recommendations) && result.atsScore.recommendations.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">
                      {verdict?.band === "weak" ? "Fix first" : verdict?.band === "borderline" ? "Fix before sending" : "Optional edits"}
                    </div>
                    <ul className="atsList">
                      {result.atsScore.recommendations.map((r, i) => (
                        <li key={i}><Badge variant="dot" tone="rec">→</Badge>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          
            
            {/* High-fit extras — only when the research scored this company
                80+ AND a tailored result exists. Secondary buttons: amber on
                this view still belongs to Download. */}
            {research?.fitScore?.tier === "high" && research?.profile && (
              <Card>
                <div className="label">
                  🔥 High-fit extras for {research.profile.company_name || "this company"}
                </div>
                <p className="cvHelp">
                  This company scored {research.fitScore.total}/100 against your real CV — worth going
                  beyond the CV. Both are built only from your master CV and the research; nothing invented.
                </p>
                <div className="actions" style={{ marginTop: 0 }}>
                  <Button
                    variant="secondary"
                    onClick={() => handleExtra("pitch")}
                    disabled={extrasLoading !== ""}
                  >
                    {extrasLoading === "pitch" ? "Writing…" : pitchScript ? "Rewrite pitch script" : "60-second pitch script"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleExtra("talking_points")}
                    disabled={extrasLoading !== ""}
                  >
                    {extrasLoading === "talking_points" ? "Preparing…" : talkingPoints ? "Redo talking points" : "Interview talking points"}
                  </Button>
                  {extrasError && <StatusText as="span" role="alert">{extrasError}</StatusText>}
                </div>
                {pitchScript && (
                  <div className="extraBlock">
                    <div className="gateLabel">Pitch script — 60-90 seconds, spoken</div>
                    <p className="extraText">{pitchScript}</p>
                  </div>
                )}
                {talkingPoints && (
                  <div className="extraBlock">
                    <div className="gateLabel">Interview talking points</div>
                    <p className="extraText">{talkingPoints}</p>
                    <p className="fitEvidence">Saved into the tracker row&apos;s notes when you click Applied below.</p>
                  </div>
                )}
              </Card>
            )}

            {/* Applied → snapshot this run into the tracker. Secondary on
                purpose: amber on this view belongs to Download. */}
            <div className="actions appliedRow">
              <Button
                variant="secondary"
                onClick={handleApplied}
                disabled={blocked || appliedState === "saving" || appliedState === "saved" || appliedState === "already"}
                title={blocked ? "Fix the flagged claims first" : undefined}
              >
                {appliedState === "saving"
                  ? "Saving…"
                  : appliedState === "saved"
                    ? "Saved to tracker ✓"
                    : appliedState === "already"
                      ? "Already in tracker"
                      : "Applied — save to tracker"}
              </Button>
              {(appliedState === "saved" || appliedState === "already") && (
                <Link href="/applications" className="customizeLink">View tracker →</Link>
              )}
              {appliedError && (
                <StatusText as="span" role="alert">{appliedError}</StatusText>
              )}
              {blocked && appliedState === "idle" && (
                <StatusText as="span" role="status">Fix the flagged claims above first.</StatusText>
              )}
            </div>
            {appliedNotice && (
              <div className="limitNotice" role="status">{appliedNotice}</div>
            )}

            {/* Focus leaving either editable preview re-runs the claim check
                on the edited text (focusout bubbles; the previews stay memo'd
                and untouched). */}
            {quality && (
              <p className="fitEvidence" data-page-estimate={quality.pages.pages} data-warn={overOnePage || quality.pages.overBudget ? "" : undefined}>
                About {quality.pages.pages} {quality.pages.pages === 1 ? "page" : "pages"} at the spacing the download uses
                {quality.pages.overBudget
                  ? " — over the two-page limit."
                  : overOnePage
                    ? " — over one page, which is what under three years of experience calls for. See Before you send above."
                    : "."}
              </p>
            )}
            <div onBlur={onPreviewBlur}>
              <CvPreview
                ref={previewRef}
                data={cvData}
                profile={displayProfile}
                rightToWorkForForms={rtwForForms}
                targetPages={onePageTarget}
                downloadsDisabledReason={downloadReason ?? (staleRun ? "The job description changed since this CV was tailored — restore it or clear the result." : undefined)}
                sectionOrder={runSectionOrder}
                fileBaseName={buildFileBaseName(displayProfile, result.analysis, "CV")}
                downloadsDisabled={blocked || staleRun}
              />
              {result.bulletChanges && (result.bulletChanges.experience || result.bulletChanges.projects.length > 0) && (
                <details className="changesView" data-bullet-changes>
                  <summary>
                    Changes vs master CV
                    {result.bulletChanges.experience && (
                      <span className="changesView__counts">
                        {" "}— {result.bulletChanges.experience.kept} kept, {result.bulletChanges.experience.edited} edited,{" "}
                        {result.bulletChanges.experience.dropped} left out
                        {result.bulletChanges.experience.added > 0 ? `, ${result.bulletChanges.experience.added} not in the master CV` : ""}
                      </span>
                    )}
                  </summary>
                  <p className="fitEvidence">
                    Every experience bullet is one of the master CV&apos;s, chosen and reordered for this posting, with at most two words
                    changed. {result.bulletChanges.protocol ? "Ids were checked on this run." : "This run came back without bullet ids, so the comparison below is by closest match."}
                  </p>
                  {[...(result.bulletChanges.experience?.roles ?? []), ...result.bulletChanges.projects].map((r, ri) => (
                    <div key={ri} className="changesView__role">
                      <div className="changesView__title">
                        {r.role}
                        {r.reordered && <span className="changesView__tag">reordered</span>}
                      </div>
                      <ul className="atsList">
                        {r.bullets.map((b, bi) => (
                          <li key={bi} data-status={b.status}>
                            <span className="changesView__status">{b.status === "kept" ? "kept" : b.status === "edited" ? "edited" : b.status === "reverted" ? "reverted to master" : "not in master"}</span>
                            <span>
                              {b.output}
                              {b.status === "edited" && (b.from.length > 0 || b.to.length > 0) && (
                                <span className="changesView__diff">
                                  {" "}({b.from.length > 0 ? b.from.join(" ") : "—"} → {b.to.length > 0 ? b.to.join(" ") : "—"})
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                        {r.dropped.map((d, di) => (
                          <li key={`d${di}`} data-status="dropped">
                            <span className="changesView__status">left out</span>
                            <span>{d.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              )}
              {result.coverLetter && (
                <>
                  <h2 className="clHeading">Cover Letter</h2>
                  <CoverLetterPreview
                    ref={coverRef}
                    coverLetter={result.coverLetter}
                    fileBaseName={buildFileBaseName(displayProfile, result.analysis, "CoverLetter")}
                    downloadsDisabled={blocked || staleRun}
                  />
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
