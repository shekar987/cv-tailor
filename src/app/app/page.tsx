"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getMasterCV, getProfile, importFromLocalStorageIfNeeded, type Profile } from "@/lib/cvStore";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import CvPreview from "../CvPreview";
import CoverLetterPreview from "../CoverLetterPreview";
import type { AtsMatchResult } from "@/lib/atsMatch";
import { loadWorkspace, saveWorkspace, clearWorkspace } from "@/lib/workspace";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Textarea from "@/components/ui/Textarea";
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
  atsScore?: {
    keyword_coverage?: string;
    required_skill_coverage?: string;
    overall_assessment?: string;
    hits?: string[];
    misses?: string[];
    recommendations?: string[];
  };
};

export default function Home() {
  const router = useRouter();
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<string | null>(null); // "user_limit" | "provider_limit" | null
  const [userEmail, setUserEmail] = useState<string | null>(null);

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

  // Identity for the persisted workspace, and a flag so we never write back
  // before the restore has run (which would blank out saved work on mount).
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  // On load: fetch CV + profile from Supabase.
  // If the DB has nothing but localStorage does, import it once then clear localStorage.
  useEffect(() => {
    async function loadCv() {
      // Get user email from local session (no network call)
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      setUserEmail(session?.user?.email ?? null);

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

      // Section order for rendering. Non-blocking and fail-soft: any problem
      // leaves it null, which renders the default order.
      fetch("/api/section-order")
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
      setCvLoading(false);
    }
    loadCv();
  }, []);

  // Persist the JD and the tailored result whenever either changes. Guarded on
  // workspaceReady so the initial empty state never overwrites saved work.
  useEffect(() => {
    if (!workspaceReady || !userId) return;
    saveWorkspace(userId, { jobDescription, result, ranProvider });
  }, [workspaceReady, userId, jobDescription, result, ranProvider]);

  async function handleSignOut() {
    // Don't leave a tailored CV in this browser's storage after sign-out.
    if (userId) clearWorkspace(userId);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'local' });
    router.refresh();
    router.push('/auth/login');
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
  async function runFullTailor() {
    setError("");
    setErrorType(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription,
          cvText: masterCvText,
          projectNames: (profile?.projects || []).map((p) => p.name),
          // Only meaningful for unlimited accounts; the server ignores it otherwise
          ...(isUnlimited ? { provider } : {}),
          ...(gateAnalysis ? { analysis: gateAnalysis } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        setErrorType(data.errorType || null);
      } else {
        setResult(data);
        setRanProvider(typeof data.provider === "string" ? data.provider : null);
      }
    } catch {
      setError("Couldn't reach the server. Check it's running and try again.");
      setErrorType(null);
    } finally {
      setLoading(false);
      // The gate applied to this specific run; clear it so a re-tailor of the
      // same JD starts a fresh pre-check rather than silently reusing a stale one.
      setPreCheck(null);
      setGateAnalysis(null);
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

  // First name only, for a personal greeting on the results — falls back to
  // nothing (not a placeholder) if no profile name is set yet.
  const firstName = (profile?.name || "").trim().split(/\s+/)[0] || "";

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div className="appBar">
            <div className="wordmark">
              CV<span className="dot">.</span>Tailor
            </div>
            {userEmail && (
              <div className="appBarActions">
                <span className="appBarEmail" title={userEmail}>{userEmail}</span>
                <Link href="/customize" className="customizeLink">Customize</Link>
                <Link href="/settings" className="customizeLink">Settings</Link>
                <button type="button" onClick={handleSignOut} className="customizeLink">
                  Sign out
                </button>
              </div>
            )}
          </div>
          <p className="tagline">
            Honest, ATS-ready tailoring. Every claim traces back to your real CV — nothing invented.
          </p>
        </header>

        {/* Master CV status — uploading/editing/replacing it lives on /customize now */}
        {cvLoading ? (
          <Card>
            <p className="cvHelp">Loading your CV…</p>
          </Card>
        ) : !masterCvText ? (
          <Card>
            <FormField
              label="Master CV"
              help="Add your CV once in Customize, and it's reused for every job you tailor for here."
            >
              <Button href="/customize">Add your CV in Customize →</Button>
            </FormField>
          </Card>
        ) : null}

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
            </FormField>
            {/* Step 1: cheap pre-check (JD analysis only) — shown until a gate
                result exists. Provider choice doesn't apply here: the gate
                always runs on Claude, same as profile extraction. */}
            {!preCheck && (
              <div className="actions">
                <Button onClick={handlePreCheck} disabled={gateLoading || loading}>
                  {gateLoading ? "Checking keyword match…" : "Tailor my CV"}
                </Button>
                {error && !hasOwnNotice(errorType) && (
                  <StatusText as="span">{error}</StatusText>
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
                  <StatusText style={{ marginTop: 'var(--space-3)' }}>{error}</StatusText>
                )}
              </Card>
            )}

            {/* ── Saved key unreadable — re-entry needed (e.g. after KEY_ENCRYPTION_SECRET rotation) ── */}
            {errorType === "key_decrypt_failed" && (
              <div className="limitNotice">
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
              <div className="limitNotice">
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
              <div className="limitNotice">
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
              <div className="limitNotice">
                <div className="limitNotice__title">Today's tailoring limit is reached.</div>
                <div className="limitNotice__body">
                  Your key's free quota resets daily — come back tomorrow to continue.
                </div>
                <div className="limitNotice__body">
                  A subscription plan with higher limits is on the way.
                </div>
              </div>
            )}

            {/* ── Other limit states (daily cap, provider quota) ── */}
            {error && (errorType === "user_limit" || errorType === "provider_limit" || errorType === "claude_limit_reached") && (
              <div className="limitNotice">{error}</div>
            )}
          </Card>
        )}

        {loading && (
          <section className="loading">
            <div className="pulse" />
            <ul>
              <li>Analysing the job description</li>
              <li>Researching the company</li>
              <li>Tailoring summary, skills, experience, projects</li>
              <li>Writing your cover letter</li>
              <li>Scoring against ATS keywords</li>
            </ul>
          </section>
        )}

        {result && (
          <section className="results">
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
          
            
            <CvPreview
              data={cvData}
              profile={profile}
              sectionOrder={sectionOrder}
              fileBaseName={(() => {
                const first = (profile?.name || "User").trim().split(/\s+/).slice(0, 2).join("_");
                const cn = ((result as any).analysis?.company_name || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                const rt = ((result as any).analysis?.role_title || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                return [first, cn, rt, "CV"].filter(Boolean).join("_");
              })()}
            />
{result.coverLetter && (
              <>
                <h2 className="clHeading">Cover Letter</h2>
                <CoverLetterPreview
                  coverLetter={result.coverLetter}
                  fileBaseName={(() => {
                    const first = (profile?.name || "User").trim().split(/\s+/).slice(0, 2).join("_");
                    const cn = ((result as any).analysis?.company_name || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                    const rt = ((result as any).analysis?.role_title || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                    return [first, cn, rt, "CoverLetter"].filter(Boolean).join("_");
                  })()}
                />
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
