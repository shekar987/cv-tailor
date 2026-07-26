"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getMasterCV, saveMasterCV, clearMasterCV, getProfile, saveProfile, clearProfile, importFromLocalStorageIfNeeded, type Profile } from "@/lib/cvStore";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import CvPreview from "../CvPreview";
import CoverLetterPreview from "../CoverLetterPreview";
import CvUpload from "../CvUpload";
import type { AtsMatchResult } from "@/lib/atsMatch";

// Server strings for the unlimited-account provider override (tailor route Path A)
type TailorProvider = "anthropic" | "gemini" | "openrouter";
const PROVIDER_LABELS: Record<TailorProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

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

  // Master CV state
  const [masterCvText, setMasterCvText] = useState("");      // the stored CV text
  const [cvDraft, setCvDraft] = useState("");                // editing buffer
  const [editingCv, setEditingCv] = useState(false);         // is the CV editor open?
  const [cvSavedAt, setCvSavedAt] = useState<number | null>(null);

  // Set when a CV is populated from an uploaded file, so the user is told to
  // check the extraction before saving. Cleared once they edit or save.
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [extracting, setExtracting] = useState(false);
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
  const [preCheck, setPreCheck] = useState<AtsMatchResult | null>(null);
  const [gateAnalysis, setGateAnalysis] = useState<unknown>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState("");

  // On load: fetch CV + profile from Supabase.
  // If the DB has nothing but localStorage does, import it once then clear localStorage.
  useEffect(() => {
    async function loadCv() {
      // Get user email from local session (no network call)
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      setUserEmail(session?.user?.email ?? null);

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
        setCvSavedAt(stored.updatedAt);
        const p = await getProfile();
        setProfile(p);
      } else {
        setEditingCv(true); // no CV yet — open the editor so they set one
      }
      setCvLoading(false);
    }
    loadCv();
  }, []);

  async function handleSaveCv() {
    if (!cvDraft.trim()) {
      setError("Paste your CV before saving.");
      return;
    }
    const rec = await saveMasterCV(cvDraft);
    setMasterCvText(rec.text);
    setCvSavedAt(rec.updatedAt);
    setError("");
    setUploadNotice(null);
    // A new CV invalidates any gate result computed against the old one.
    setPreCheck(null);
    setGateAnalysis(null);
    setGateError("");

    // Extract the profile (name/contact/education) from the new CV
    setExtracting(true);
    try {
      const res = await fetch("/api/extract-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvText: rec.text }),
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        setProfile(data.profile);
        await saveProfile(data.profile);
      }
    } catch {
      // extraction failed — user can still proceed; we'll fall back
    } finally {
      setExtracting(false);
      setEditingCv(false);
    }
  }

  function handleEditCv() {
    setCvDraft(masterCvText);
    setEditingCv(true);
  }

  async function handleClearCv() {
    // Reset UI immediately so the user doesn't wait for the DB delete
    setProfile(null);
    setMasterCvText("");
    setCvSavedAt(null);
    setCvDraft("");
    setEditingCv(true);
    setUploadNotice(null);
    setPreCheck(null);
    setGateAnalysis(null);
    setGateError("");
    // Delete from DB in the background
    await clearMasterCV();
    await clearProfile();
  }

  function updateProfileField(field: keyof Profile, value: any) {
    if (!profile) return;
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    saveProfile(updated); // fire-and-forget: UI state is already correct, DB catches up
  }

  async function handleSignOut() {
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
      setError("Set your master CV first (the box above).");
      setErrorType(null);
      setEditingCv(true);
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

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="wordmark">
              CV<span className="dot">.</span>Tailor
            </div>
            {userEmail && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{userEmail}</span>
                <Link
                  href="/settings"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--muted)',
                    fontSize: 13,
                    padding: '5px 12px',
                    textDecoration: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  Settings
                </Link>
                <button
                  onClick={handleSignOut}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: 13,
                    padding: '5px 12px',
                    fontFamily: 'inherit',
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          <p className="tagline">
            Honest, ATS-ready tailoring. Every claim traces back to your real CV — nothing invented.
          </p>
        </header>

        {/* Master CV card */}
        <section className="inputCard">
          {cvLoading ? (
            <p className="cvHelp" style={{ color: 'var(--muted)' }}>Loading your CV…</p>
          ) : editingCv ? (
            <>
              <label className="label" htmlFor="cv">Your master CV</label>
              <p className="cvHelp">Add your full CV once. It's saved to your account and reused for every job — you'll only need to paste the job description each time.</p>

              <CvUpload
                disabled={extracting}
                onExtracted={(text, meta) => {
                  // Populate the SAME textarea the paste flow uses. Nothing is
                  // saved yet — the user reviews and edits, then hits Save.
                  setCvDraft(text);
                  setError("");
                  setUploadNotice(
                    `Text extracted from ${meta.filename} (${meta.characters.toLocaleString()} characters). ` +
                    `Check it below before saving — PDFs and Word files can lose formatting, so fix any run-together ` +
                    `lines or missing headings now.`
                  );
                }}
              />

              <div className="orDivider"><span>or paste it below</span></div>

              {uploadNotice && (
                <p className="uploadNotice" role="status">{uploadNotice}</p>
              )}

              <textarea
                id="cv"
                value={cvDraft}
                onChange={(e) => {
                  setCvDraft(e.target.value);
                  if (uploadNotice) setUploadNotice(null);
                }}
                placeholder="Paste your full CV here…"
                rows={10}
              />
              <div className="actions">
                <button onClick={handleSaveCv} className="cta">Save master CV</button>
                {masterCvText && (
                  <button onClick={() => setEditingCv(false)} className="cta secondary">Cancel</button>
                )}
              </div>
            </>
          ) : (
            <div className="cvSavedRow">
              <div>
                <div className="cvSavedLabel">✓ Master CV saved</div>
                {cvSavedAt && (
                  <div className="cvSavedMeta">Last updated {new Date(cvSavedAt).toLocaleDateString()}</div>
                )}
              </div>
              <div className="cvSavedActions">
                <button onClick={handleEditCv} className="cta secondary">Edit</button>
                <button onClick={handleClearCv} className="cta ghost">Replace</button>
              </div>
            </div>
          )}
        </section>
        {/* Profile confirm card — shows extracted details for the user to verify */}
        {masterCvText && !editingCv && (
          <section className="inputCard">
            <div className="label">Your details {extracting && <span className="cvSavedMeta">— extracting…</span>}</div>
            <p className="cvHelp">Pulled from your CV. Check these are right — they appear in your tailored CV's header and sections.</p>
            {profile && (
              <div className="profileGrid">
                <label>Name<input value={profile.name} onChange={(e) => updateProfileField("name", e.target.value)} /></label>
                <label>Tagline<input value={profile.tagline} onChange={(e) => updateProfileField("tagline", e.target.value)} /></label>
                <label>Location<input value={profile.location} onChange={(e) => updateProfileField("location", e.target.value)} /></label>
                <label>Phone<input value={profile.phone} onChange={(e) => updateProfileField("phone", e.target.value)} /></label>
                <label>Email<input value={profile.email} onChange={(e) => updateProfileField("email", e.target.value)} /></label>
                <label>LinkedIn<input value={profile.linkedin} onChange={(e) => updateProfileField("linkedin", e.target.value)} /></label>
                <label>GitHub<input value={profile.github} onChange={(e) => updateProfileField("github", e.target.value)} /></label>
              </div>
            )}
          </section>
        )}

        {/* JD card — only show once a master CV exists */}
        {masterCvText && (
          <section className="inputCard">
            <label className="label" htmlFor="jd">Job description</label>
            <textarea
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
            {/* Step 1: cheap pre-check (JD analysis only) — shown until a gate
                result exists. Provider choice doesn't apply here: the gate
                always runs on Claude, same as profile extraction. */}
            {!preCheck && (
              <div className="actions">
                <button onClick={handlePreCheck} disabled={gateLoading || loading} className="cta">
                  {gateLoading ? "Checking keyword match…" : "Tailor my CV"}
                </button>
                {error && errorType !== "user_limit" && errorType !== "provider_limit" && errorType !== "claude_limit_reached" && errorType !== "needs_keys" && errorType !== "user_key_limit" && errorType !== "key_decrypt_failed" && (
                  <span className="error">{error}</span>
                )}
              </div>
            )}

            {/* The pre-check call itself failed — don't block on it, just let
                them proceed straight to the full run (which re-runs Step 1 fresh). */}
            {gateError && !preCheck && (
              <div className="gateCard">
                <p className="gateNote" style={{ marginBottom: 12 }}>{gateError}</p>
                <div className="gateActions">
                  <button onClick={runFullTailor} disabled={loading} className="cta secondary">
                    {loading ? "Tailoring…" : "Tailor without the check →"}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: the gate result. Never blocks below 10/15 — just informs. */}
            {preCheck && (
              <div className="gateCard">
                <div className="gateLabel">Rough keyword match, before tailoring</div>
                <div className={`gateValue ${preCheck.matched >= 10 ? "good" : "low"}`}>
                  {preCheck.matched}/{preCheck.total}
                </div>
                <p className="gateNote">
                  {preCheck.matched >= 10
                    ? "Good overlap with this role's top keywords, from your CV as it stands today."
                    : "Below the usual 10-keyword mark for your CV as-is — tailoring can still genuinely help by surfacing real adjacent skills, though a gap this size may be honest too."}
                  {" "}This checks literal keyword presence in your raw CV; the tailored version gets scored separately afterward, and the two numbers can differ.
                </p>
                <div className="gateActions">
                  <button onClick={runFullTailor} disabled={loading} className="cta">
                    {loading ? "Tailoring…" : "Continue to full tailoring →"}
                  </button>
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
                {error && errorType !== "user_limit" && errorType !== "provider_limit" && errorType !== "claude_limit_reached" && errorType !== "needs_keys" && errorType !== "user_key_limit" && errorType !== "key_decrypt_failed" && (
                  <p className="error" style={{ marginTop: 10 }}>{error}</p>
                )}
              </div>
            )}

            {/* ── Saved key unreadable — re-entry needed (e.g. after KEY_ENCRYPTION_SECRET rotation) ── */}
            {errorType === "key_decrypt_failed" && (
              <div className="limitNotice">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Your API key needs to be re-entered.</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
                  Your saved key can no longer be read. Please go to Settings and replace it.
                </div>
                <Link
                  href="/settings"
                  className="cta"
                  style={{ display: 'inline-block', padding: '8px 18px', fontSize: 14, borderRadius: 9, textDecoration: 'none' }}
                >
                  Go to Settings →
                </Link>
              </div>
            )}

            {/* ── Free tailors used up — no keys saved yet ── */}
            {errorType === "needs_keys" && (
              <div className="limitNotice">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Your 3 free tailors are used up.</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
                  Add your own key to keep going — it takes 2 minutes and the tool stays free.
                </div>
                <Link
                  href="/settings"
                  className="cta"
                  style={{ display: 'inline-block', padding: '8px 18px', fontSize: 14, borderRadius: 9, textDecoration: 'none' }}
                >
                  Add your key in Settings →
                </Link>
              </div>
            )}

            {/* ── User's own key quota exhausted ── */}
            {errorType === "user_key_limit" && (
              <div className="limitNotice">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Today's tailoring limit is reached.</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 4 }}>
                  Your key's free quota resets daily — come back tomorrow to continue.
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
                  A subscription plan with higher limits is on the way.
                </div>
              </div>
            )}

            {/* ── Other limit states (daily cap, provider quota) ── */}
            {error && (errorType === "user_limit" || errorType === "provider_limit" || errorType === "claude_limit_reached") && (
              <div className="limitNotice">{error}</div>
            )}
          </section>
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
                <div className="scoreLabel">ATS keyword match</div>
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
                        <li key={i}><span className="dot hit">✓</span>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray((result.atsScore as any).misses) && (result.atsScore as any).misses.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel misses">Missing ({(result.atsScore as any).misses.length})</div>
                    <ul className="atsList">
                      {(result.atsScore as any).misses.map((m: string, i: number) => (
                        <li key={i}><span className="dot miss">✕</span>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray((result.atsScore as any).recommendations) && (result.atsScore as any).recommendations.length > 0 && (
                  <div className="atsGroup">
                    <div className="atsGroupLabel recs">Recommendations</div>
                    <ul className="atsList">
                      {(result.atsScore as any).recommendations.map((r: string, i: number) => (
                        <li key={i}><span className="dot rec">→</span>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          
            
            <CvPreview
              data={cvData}
              profile={profile}
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
