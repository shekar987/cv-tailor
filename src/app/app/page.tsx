"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { getMasterCV, getProfile, importFromLocalStorageIfNeeded, type Profile } from "@/lib/cvStore";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import CvPreview, { type CvPreviewHandle } from "../CvPreview";
import CoverLetterPreview from "../CoverLetterPreview";
import type { AtsMatchResult } from "@/lib/atsMatch";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import { salaryFromJd, buildAppliedNotes, localIsoDate, addDays } from "@/lib/applicationSnapshot";
import { MAX_JD_CHARS, JD_TOO_LONG, MAX_NOTES_CHARS } from "@/lib/limits";
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
  };
  atsScore?: {
    keyword_coverage?: string;
    required_skill_coverage?: string;
    overall_assessment?: string;
    hits?: string[];
    misses?: string[];
    recommendations?: string[];
  };
};

type AppliedState = "idle" | "saving" | "saved" | "already" | "error";

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
  // Seconds since the full pipeline started — honest feedback during the wait.
  const [elapsed, setElapsed] = useState(0);
  // Reaches into CvPreview for the EDITED document when saving to the tracker.
  const previewRef = useRef<CvPreviewHandle>(null);

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
    saveWorkspace(userId, { jobDescription, result, ranProvider, tailorSessionId, resultJd, research, researchUrl: companyUrl || null });
  }, [workspaceReady, userId, jobDescription, result, ranProvider, tailorSessionId, resultJd, research, companyUrl]);

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
    setGateAnalysis(null);
    setGateError("");
    const el = document.getElementById("jd");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Research-powered extras: one model call each, built from the research +
  // master CV. "cold_email" additionally requires the owner account.
  async function handleExtra(kind: "pitch" | "talking_points" | "cold_email") {
    if (extrasLoading) return;
    const setError = kind === "cold_email" ? setColdEmailError : setExtrasError;
    setError("");
    setExtrasLoading(kind);
    try {
      const res = await fetch("/api/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          cvText: masterCvText,
          companyResearch: research?.profile,
          analysis: result?.analysis,
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
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, cvText: masterCvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error || "Couldn't check keyword match. You can still tailor without it.");
      } else {
        setGateAnalysis(data.result ?? null);
        setPreCheck(data.atsPreCheck ?? null);
      }
    } catch {
      setGateError("Couldn't reach the server for the keyword check. You can still tailor without it.");
    } finally {
      setGateLoading(false);
    }
  }

  // Step 2: the full 8-step pipeline. If gateAnalysis is set (the user came
  // through the pre-check), it's sent along so /api/tailor skips re-running
  // Step 1 — otherwise the server runs Step 1 fresh, exactly as before this
  // feature existed.
  // Core pipeline call, shared by both flows: "jd" tailors what's in the
  // job-description box (gate analysis reused, stale-JD banner armed);
  // "outreach" tailors an internal research brief (no gate, no banner — the
  // JD box is a separate concern by design).
  async function executeTailor(jdText: string, source: "jd" | "outreach") {
    if (loading) return;
    if (jdText.length > MAX_JD_CHARS) {
      setError(JD_TOO_LONG);
      setErrorType(null);
      return;
    }
    setError("");
    setErrorType(null);
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
          // Only meaningful for unlimited accounts; the server ignores it otherwise
          ...(isUnlimited ? { provider } : {}),
          // The gate's analysis belongs to the JD-box text only.
          ...(source === "jd" && gateAnalysis ? { analysis: gateAnalysis } : {}),
          // Real scraped research (Stage 3): the tailor route injects it into
          // the cover-letter context instead of synthesizing research from the
          // JD alone. Only sent when it was run for this company.
          ...(research?.profile ? { companyResearch: research.profile } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        setErrorType(data.errorType || null);
        return;
      }
      // A fresh id per completed run: re-tailoring the same job is a new
      // session, and legitimately gets its own tracker row. Computed before
      // any state changes so a missing crypto API (non-secure origin) can't
      // throw after the result has already rendered.
      const sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setResult(data);
      setRanProvider(typeof data.provider === "string" ? data.provider : null);
      setTailorSessionId(sessionId);
      // Outreach results aren't "for" the JD box, so the stale-JD banner
      // stays quiet (it only arms when resultJd is a string).
      setResultJd(source === "jd" ? jdText : null);
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
      }
    } catch {
      setError("Couldn't reach the server. Check it's running and try again.");
      setErrorType(null);
    } finally {
      setLoading(false);
      // Success or limit error, the counters may have moved — refresh the chip.
      getUsage().then(setUsage);
    }
  }

  function runFullTailor() {
    return executeTailor(jobDescription, "jd");
  }

  // Cold-outreach tailoring: research → CV + cover letter, no JD involved.
  function runColdOutreachTailor() {
    const brief = buildOutreachBrief();
    if (!brief) {
      setResearchError("This research came back without company details — use \"research again\" first.");
      return;
    }
    return executeTailor(brief, "outreach");
  }
  // Snapshot the finished run into the application tracker. Reads only what
  // the run already produced — the pipeline itself is untouched. The server
  // owns the duplicate rule (one row per session id) and reports a repeat
  // click back as alreadySaved, without touching the existing row.
  async function handleApplied() {
    if (!result) return;
    // Workspaces saved before session ids existed restore without one; mint
    // it now so the save effect persists it and a second click still dedupes.
    const sid = tailorSessionId ?? crypto.randomUUID();
    if (sid !== tailorSessionId) setTailorSessionId(sid);
    const analysis = result.analysis;
    const today = new Date();

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
          cv_reference: buildFileBaseName(profile, analysis, "CV"),
          tailor_session_id: sid,
          status: "Applied",
          source: "tailored",
          // The JD's literal figure with its unit ("£480 per day"),
          // "Voluntary (unpaid)", or an explicit "Not Specified".
          salary: salaryFromJd(jobDescription),
          date_applied: localIsoDate(today),
          followup_date: localIsoDate(addDays(today, 7)),
          // Generated talking points ride along into the tracker row for
          // interview prep. The API rejects (not truncates) over-long notes,
          // so the combined text is sliced to the cap client-side.
          notes: [buildAppliedNotes(result.atsScore), talkingPoints && `— Interview talking points —\n${talkingPoints}`]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, MAX_NOTES_CHARS),
          job_description: jobDescription.slice(0, 15_000),
          // The CV as generated, with the profile and section order it was
          // rendered with, so the tracker shows this exact document later.
          tailored_cv: {
            summary: edited?.summary || result.summary || "",
            skills: edited?.skills || result.skills || "",
            experience: editedExperience || result.experience || "",
            projects: edited?.projects ?? result.projects ?? {},
            profile: edited?.profile
              ? { ...edited.profile, projects: edited.projectsMeta }
              : profile,
            sectionOrder: edited ? edited.sectionOrder : sectionOrder,
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
    } catch {
      setAppliedState("error");
      setAppliedError("Couldn't reach the server. Try again.");
    }
  }

  // Stable reference so React.memo on CvPreview can skip re-renders when only the JD
  // textarea or other unrelated state changes. Only rebuilds when result changes.
  const cvData = useMemo(() => ({
    summary: result?.summary,
    skills: result?.skills,
    experience: result?.experience,
    projects: result?.projects as any,
  }), [result]);

  // Step 1's read of the JD, surfaced on the gate card so a mis-pasted JD is
  // caught before the full run is spent on the wrong job.
  const gateInfo = useMemo(() => {
    const a = gateAnalysis as { role_title?: unknown; company_name?: unknown } | null;
    const role = realValue(typeof a?.role_title === "string" ? a.role_title : "");
    const company = realValue(typeof a?.company_name === "string" ? a.company_name : "");
    return role || company ? { role, company } : null;
  }, [gateAnalysis]);

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
    if (!result.atsScore?.keyword_coverage) issues.push("ATS scoring didn't complete.");
    return issues;
  }, [result]);

  // First name only, for a personal greeting on the results — falls back to
  // nothing (not a placeholder) if no profile name is set yet.
  const firstName = (profile?.name || "").trim().split(/\s+/)[0] || "";

  return (
    <main className="page">
      <div className="container">
        <AppHeader
          title="Tailor your CV"
          tagline="Honest, ATS-ready tailoring. Every claim traces back to your real CV — nothing invented."
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
                        {loading ? "Tailoring…" : "Tailor CV + cover letter for this company"}
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
                            {result?.analysis ? "References the tailored role." : "No role selected — it pitches speculatively."}
                          </span>
                          {coldEmailError && (
                            <StatusText as="span" role="alert">{coldEmailError}</StatusText>
                          )}
                        </div>
                        {coldEmail && (
                          <div className="extraBlock">
                            <div className="gateLabel">Ready to send — attach your downloaded CV</div>
                            <p className="extraText">{coldEmail}</p>
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
                <div className="gateLabel">Rough keyword match, before tailoring</div>
                <Badge variant="value" tone={preCheck.matched >= 10 ? "success" : "neutral"}>
                  {preCheck.matched}/{preCheck.total}
                </Badge>
                <p className="gateNote">
                  {preCheck.matched >= 10
                    ? "Good overlap with this role's top keywords, from your CV as it stands today."
                    : "Below the usual 10-keyword mark for your CV as-is — tailoring can still genuinely help by surfacing real adjacent skills, though a gap this size may be honest too."}
                  {" "}This checks literal keyword presence in your raw CV; the tailored version gets scored separately afterward, and the two numbers can differ.
                </p>
                <div className="gateActions">
                  <Button onClick={runFullTailor} disabled={loading}>
                    {loading ? "Tailoring…" : "Continue to full tailoring →"}
                  </Button>
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
                <li>Researching the company</li>
                <li>Tailoring summary, skills, experience, projects</li>
                <li>Writing your cover letter</li>
                <li>Scoring against ATS keywords</li>
              </ul>
              <p className="loadingMeta">{elapsed}s — a full run usually takes 20–40 seconds.</p>
            </div>
          </section>
        )}

        {!cvLoading && result && (
          <section className="results">
            {resultInfo && (
              <div className="resultsContext">
                <span>
                  Tailored for <strong>{resultInfo.role || "this role"}</strong>
                  {resultInfo.company && <> at <strong>{resultInfo.company}</strong></>}
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
            {resultJd !== null && jobDescription.trim() !== resultJd.trim() && (
              <div className="limitNotice" role="status">
                These results were tailored for your previous job description — the text above has
                changed since. Run another tailor to refresh them.
              </div>
            )}
            {partialIssues.length > 0 && (
              <div className="limitNotice" role="status">
                {partialIssues.join(" ")} Re-running the same job description retries those steps
                (it counts as a new run).
              </div>
            )}
            {result.atsScore?.keyword_coverage && (
              <div className="scoreCard">
                <div className="scoreLabel">
                  {firstName ? `Hey ${firstName}, here's your ATS keyword match` : "Your ATS keyword match"}
                </div>
                <div className="scoreValue">{result.atsScore.keyword_coverage}</div>
                {result.atsScore.required_skill_coverage && (
                  <div className="scoreSub">
                    Required skills covered: {result.atsScore.required_skill_coverage}
                  </div>
                )}
                {result.atsScore.overall_assessment && (
                  <p className="scoreNote">{result.atsScore.overall_assessment}</p>
                )}

                {Array.isArray((result.atsScore as any).hits) && (result.atsScore as any).hits.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel hits">Matched ({(result.atsScore as any).hits.length})</div>
                    <ul className="atsList">
                      {(result.atsScore as any).hits.map((h: string, i: number) => (
                        <li key={i}><Badge variant="dot" tone="hit">✓</Badge>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray((result.atsScore as any).misses) && (result.atsScore as any).misses.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel misses">Missing ({(result.atsScore as any).misses.length})</div>
                    <ul className="atsList">
                      {(result.atsScore as any).misses.map((m: string, i: number) => (
                        <li key={i}><Badge variant="dot" tone="miss">✕</Badge>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray((result.atsScore as any).recommendations) && (result.atsScore as any).recommendations.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">Recommendations</div>
                    <ul className="atsList">
                      {(result.atsScore as any).recommendations.map((r: string, i: number) => (
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
                disabled={appliedState === "saving" || appliedState === "saved" || appliedState === "already"}
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
            </div>
            {appliedNotice && (
              <div className="limitNotice" role="status">{appliedNotice}</div>
            )}

            <CvPreview
              ref={previewRef}
              data={cvData}
              profile={profile}
              sectionOrder={sectionOrder}
              fileBaseName={buildFileBaseName(profile, result.analysis, "CV")}
            />
{result.coverLetter && (
              <>
                <h2 className="clHeading">Cover Letter</h2>
                <CoverLetterPreview
                  coverLetter={result.coverLetter}
                  fileBaseName={buildFileBaseName(profile, result.analysis, "CoverLetter")}
                />
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
