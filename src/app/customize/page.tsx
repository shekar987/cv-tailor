"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getMasterCV,
  saveMasterCV,
  clearMasterCV,
  saveProjectsPool,
  getProfile,
  saveProfile,
  clearProfile,
  importFromLocalStorageIfNeeded,
  type Profile,
} from "@/lib/cvStore";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import { MAX_CV_CHARS, MAX_POOL_CHARS } from "@/lib/limits";
import { splitTrailingDate } from "@/lib/projectDate";
import { stripMarkdown } from "@/lib/markdownText";
import CvUpload from "../CvUpload";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
  resolveSectionOrder,
  isDefaultOrder,
  type SectionId,
} from "@/lib/sectionOrder";

// Reorder the CV's standard sections. Section ORDER only — bullet counts and
// content are untouched and still come from the tailoring run.
//
// No drag-and-drop library: this is a five-item single-column list, and the
// project's guidance is not to add dependencies for small problems. Native
// HTML5 drag handles the mouse; the ↑/↓ buttons cover keyboard, screen readers
// and touch, which drag alone would not.
export default function CustomizePage() {
  const router = useRouter();
  const [order, setOrder] = useState<SectionId[]>(DEFAULT_SECTION_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Identity for the /app workspace — used to drop a stale tailored result
  // when the master CV changes here (project bullets are index-keyed against
  // the profile's project list, so a result built from the old CV could
  // otherwise render bullets under the wrong project on /app).
  const [userId, setUserId] = useState<string | null>(null);

  // Master CV
  const [masterCvText, setMasterCvText] = useState("");
  const [cvDraft, setCvDraft] = useState("");
  const [editingCv, setEditingCv] = useState(false);
  const [cvSavedAt, setCvSavedAt] = useState<number | null>(null);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState("");
  // Set when a CV is populated from an uploaded file, so the user is told to
  // check the extraction before saving. Cleared once they edit or save.
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Inline two-step confirms (no blocking window.confirm): replacing the CV is
  // destructive, and re-running extraction spends an AI call.
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmReextract, setConfirmReextract] = useState(false);
  const [reextracting, setReextracting] = useState(false);

  // Profile details — extracted from the master CV, edited here.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  // Extraction can fail while the CV itself saved fine; the user needs to
  // know, because a missing profile means a CV headed "YOUR NAME".
  const [profileError, setProfileError] = useState("");

  // Advanced customization — the full project pool (master_cvs.projects_pool).
  // When saved, every tailor run selects the 2 most relevant pool projects
  // instead of tailoring the master CV's own projects.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [poolDraft, setPoolDraft] = useState("");
  const [poolSaved, setPoolSaved] = useState(false);
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolMsg, setPoolMsg] = useState("");
  const [poolError, setPoolError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      // The page is auth-gated by proxy.ts, but bounce defensively if the
      // session vanished between navigation and mount.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login?next=/customize");
        return;
      }
      setUserId(session.user.id);

      try {
        const res = await fetch("/api/section-order");
        const data = await res.json();
        if (!active) return;
        if (res.ok) setOrder(resolveSectionOrder(data.order));
      } catch {
        // Fall back to the default order — the page still works, and saving
        // will surface any real problem.
      } finally {
        if (active) setLoading(false);
      }

      let stored = await getMasterCV();
      if (!stored) {
        // First login, or user hasn't saved a CV yet — check localStorage for
        // a one-time migration of any pre-auth CV.
        const imported = await importFromLocalStorageIfNeeded();
        if (imported) stored = imported;
      }
      if (!active) return;
      if (stored) {
        setMasterCvText(stored.text);
        setCvSavedAt(stored.updatedAt);
        if (stored.projectsPool) {
          setPoolDraft(stored.projectsPool);
          setPoolSaved(true);
        }
      } else {
        setEditingCv(true); // no CV yet — open the editor so they set one
      }
      setCvLoading(false);

      const p = await getProfile();
      if (active) {
        setProfile(p);
        setProfileLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  // One upsert per pause in typing, not per keystroke — the previous version
  // sent the whole profile on every character, and out-of-order responses
  // could persist a stale value.
  const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current); }, []);

  function updateProfileField(field: keyof Profile, value: string) {
    if (!profile) return;
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = setTimeout(() => {
      saveProfile(updated).then((ok) => {
        setProfileError(ok ? "" : "Couldn't save that change. Check your connection and try again.");
      });
    }, 500);
  }

  // Drops any tailored result sitting in the /app workspace without touching
  // the pasted job description — the JD is independent of the CV, but a
  // tailored result is not.
  function invalidateWorkspaceResult() {
    if (!userId) return;
    const existing = loadWorkspace(userId);
    saveWorkspace(userId, { jobDescription: existing?.jobDescription ?? "", result: null, ranProvider: null });
  }

  // Save (or clear, with empty text) the project pool. A result tailored
  // against the old pool is stale for the same reason a CV edit makes one
  // stale, so both paths invalidate the workspace result.
  async function handleSavePool(clear: boolean) {
    const pool = clear ? "" : poolDraft.trim();
    setPoolMsg("");
    setPoolError("");
    if (!clear && !pool) {
      setPoolError("Paste your projects first, or use Remove pool to switch this off.");
      return;
    }
    if (pool.length > MAX_POOL_CHARS) {
      setPoolError(`Project pool is too long (${pool.length.toLocaleString()} / ${MAX_POOL_CHARS.toLocaleString()} characters).`);
      return;
    }
    setPoolSaving(true);
    const res = await saveProjectsPool(pool);
    setPoolSaving(false);
    if (res.ok) {
      setPoolDraft(pool);
      setPoolSaved(!clear);
      invalidateWorkspaceResult();
      setPoolMsg(clear
        ? "Pool removed. Tailoring uses the projects from your master CV again."
        : "Saved. Every tailor run now picks the 2 most relevant projects from this pool.");
    } else if (res.missingColumn) {
      setPoolError("Your database doesn't have this feature's column yet — run supabase/migrations/20260911120000_master_cvs_projects_pool.sql in the Supabase SQL editor, then save again.");
    } else {
      setPoolError("Couldn't save the pool. Check your connection and try again.");
    }
  }

  async function handleSaveCv() {
    if (extracting) return; // a second click mid-save would spend a second extraction call
    // A CV pasted from a markdown file carries **bold** and [label](url)
    // syntax that would otherwise leak literally into every output — the CV
    // text is quoted verbatim by the prompts and captured verbatim by
    // extraction. Clean it here and reflect the cleaned text in the box, so
    // what's stored is exactly what the user sees.
    const draft = stripMarkdown(cvDraft).trim();
    if (draft !== cvDraft) setCvDraft(draft);
    if (!draft) {
      setCvError("Paste your CV before saving.");
      return;
    }
    if (draft.length > MAX_CV_CHARS) {
      setCvError(
        `Your CV is ${draft.length.toLocaleString()} characters — the limit is ${MAX_CV_CHARS.toLocaleString()}. Trim it, or keep just the sections that matter.`
      );
      return;
    }
    setCvError("");
    setExtracting(true);
    try {
      const rec = await saveMasterCV(draft);
      if (!rec) {
        setCvError("Couldn't save your CV. Check your connection and try again.");
        return;
      }
      setMasterCvText(rec.text);
      setCvSavedAt(rec.updatedAt);
      setUploadNotice(null);
      invalidateWorkspaceResult();

      // Extract the profile (name/contact/education) from the new CV. The CV
      // is already saved at this point; a failure here is reported, not hidden.
      let extractError = "";
      try {
        const res = await fetch("/api/extract-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cvText: rec.text }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.profile) {
          setProfile(data.profile);
          const persisted = await saveProfile(data.profile);
          if (!persisted) {
            extractError = "Your CV is saved, but your details couldn't be stored. Reload and try Edit → Save again.";
          }
        } else {
          extractError = data.error
            ? `Your CV is saved, but reading your details out of it failed: ${data.error}`
            : "Your CV is saved, but your details couldn't be read out of it. Try Edit → Save again.";
        }
      } catch {
        extractError = "Your CV is saved, but the server couldn't be reached to read your details. Try Edit → Save again.";
      }
      setProfileError(extractError);
      setEditingCv(false);
    } finally {
      setExtracting(false);
    }
  }

  function handleEditCv() {
    setCvDraft(masterCvText);
    setEditingCv(true);
  }

  async function handleClearCv() {
    // Destructive and irreversible — reached only through the inline two-step
    // confirm below, so no blocking window.confirm here.
    setConfirmReplace(false);
    // Reset UI immediately so the user doesn't wait for the DB delete
    setProfile(null);
    setMasterCvText("");
    setCvSavedAt(null);
    setCvDraft("");
    setEditingCv(true);
    setUploadNotice(null);
    // The row delete below takes projects_pool with it — mirror that in the UI.
    setPoolDraft("");
    setPoolSaved(false);
    setShowAdvanced(false);
    setPoolMsg("");
    setPoolError("");
    invalidateWorkspaceResult();
    // Delete from DB in the background
    await clearMasterCV();
    await clearProfile();
  }

  // Re-runs profile extraction against the SAVED master CV — the recovery path
  // when extraction failed on save, or when the extracted details look wrong.
  // Spends one AI call, hence the two-step confirm in the UI.
  async function handleReextract() {
    if (!masterCvText || reextracting || extracting) return;
    setConfirmReextract(false);
    setReextracting(true);
    setProfileError("");
    try {
      const res = await fetch("/api/extract-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvText: masterCvText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.profile) {
        setProfile(data.profile);
        const persisted = await saveProfile(data.profile);
        if (persisted) {
          // The project list may have changed shape — a tailored result keyed
          // by the old project indexes must not survive it.
          invalidateWorkspaceResult();
        } else {
          setProfileError("Extraction worked, but the result couldn't be stored. Try again.");
        }
      } else {
        setProfileError(
          data.error
            ? `Re-running extraction failed: ${data.error}`
            : "Re-running extraction failed. Try again."
        );
      }
    } catch {
      setProfileError("Couldn't reach the server to re-run extraction. Try again.");
    } finally {
      setReextracting(false);
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSavedMsg("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch("/api/section-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save. Please try again.");
      } else {
        setSavedMsg(
          isDefaultOrder(order)
            ? "Saved — you're back on the standard order."
            : "Saved. Every CV you tailor from now on uses this order."
        );
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <div className="container">
        <AppHeader
          title="Customize"
          tagline="Manage your master CV, your details, and how your tailored CV is laid out."
        />

        <Card>
          {cvLoading ? (
            <>
              <div className="label">Master CV</div>
              <Skeleton lines={3} label="Loading your CV" />
            </>
          ) : editingCv ? (
            <FormField
              label="Master CV"
              htmlFor="cv"
              help="Add your full CV once. It's saved to your account and reused for every job — you'll only need to paste the job description on the main page each time."
            >
              <CvUpload
                disabled={extracting}
                onExtracted={(text, meta) => {
                  // Populate the SAME textarea the paste flow uses. Nothing is
                  // saved yet — the user reviews and edits, then hits Save.
                  // Markdown cleanup applies to uploads too (.md files arrive
                  // through the plain-text path).
                  setCvDraft(stripMarkdown(text));
                  setCvError("");
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

              <Textarea
                id="cv"
                value={cvDraft}
                onChange={(e) => {
                  setCvDraft(e.target.value);
                  if (uploadNotice) setUploadNotice(null);
                }}
                placeholder="Paste your full CV here…"
                rows={10}
                disabled={extracting}
              />
              <p className={"charCount" + (cvDraft.length > MAX_CV_CHARS ? " over" : "")} aria-live="polite">
                {cvDraft.length.toLocaleString()} / {MAX_CV_CHARS.toLocaleString()}
              </p>
              <div className="actions">
                <Button onClick={handleSaveCv} disabled={extracting}>
                  {extracting ? "Saving…" : "Save master CV"}
                </Button>
                {masterCvText && (
                  <Button variant="secondary" onClick={() => setEditingCv(false)} disabled={extracting}>Cancel</Button>
                )}
                {cvError && <StatusText as="span" role="alert">{cvError}</StatusText>}
              </div>
            </FormField>
          ) : (
            <div className="cvSavedRow">
              <div>
                <div className="cvSavedLabel">✓ Master CV saved</div>
                {cvSavedAt && (
                  <div className="cvSavedMeta">Last updated {new Date(cvSavedAt).toLocaleDateString()}</div>
                )}
              </div>
              <div className="cvSavedActions">
                {confirmReplace ? (
                  <>
                    <StatusText as="span">Delete your saved CV and extracted details?</StatusText>
                    <Button variant="ghost" className="keyRemove" onClick={handleClearCv}>
                      Yes, replace
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmReplace(false)}>Keep it</Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={handleEditCv}>Edit</Button>
                    <Button variant="ghost" onClick={() => setConfirmReplace(true)}>Replace</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="label">
            Your details {extracting && <span className="cvSavedMeta">— extracting…</span>}
          </div>
          {profileError && <p role="alert" className="keyError">{profileError}</p>}
          {profileLoading ? (
            <Skeleton lines={2} label="Loading your details" />
          ) : profile ? (
            <>
              <p className="cvHelp">Pulled from your CV. Check these are right — they appear in your tailored CV&apos;s header and sections.</p>
              <div className="profileGrid">
                <label>Name<Input value={profile.name} onChange={(e) => updateProfileField("name", e.target.value)} /></label>
                <label>Tagline<Input value={profile.tagline} onChange={(e) => updateProfileField("tagline", e.target.value)} /></label>
                <label>Location<Input value={profile.location} onChange={(e) => updateProfileField("location", e.target.value)} /></label>
                <label>Phone<Input value={profile.phone} onChange={(e) => updateProfileField("phone", e.target.value)} /></label>
                <label>Email<Input value={profile.email} onChange={(e) => updateProfileField("email", e.target.value)} /></label>
                <label>LinkedIn<Input value={profile.linkedin} onChange={(e) => updateProfileField("linkedin", e.target.value)} /></label>
                <label>GitHub<Input value={profile.github} onChange={(e) => updateProfileField("github", e.target.value)} /></label>
                <label>Website<Input value={profile.website} onChange={(e) => updateProfileField("website", e.target.value)} /></label>
              </div>

              {(profile.projects.length > 0 ||
                profile.education.length > 0 ||
                profile.certifications.length > 0 ||
                (profile.extraSections?.length ?? 0) > 0) && (
                <div className="extractSummary">
                  <div className="extractLabel">Also extracted from your CV</div>
                  <dl className="extractGrid">
                    {profile.projects.length > 0 && (
                      <div className="extractRow">
                        <dt>Projects ({profile.projects.length})</dt>
                        <dd>
                          {profile.projects
                            .map((pr) => splitTrailingDate(pr.name || "").title || pr.name)
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    {profile.education.length > 0 && (
                      <div className="extractRow">
                        <dt>Education ({profile.education.length})</dt>
                        <dd>
                          {profile.education
                            .map((e) => [e.degree, e.institution].filter(Boolean).join(" — "))
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    {profile.certifications.length > 0 && (
                      <div className="extractRow">
                        <dt>Certifications ({profile.certifications.length})</dt>
                        <dd>{profile.certifications.join(" · ")}</dd>
                      </div>
                    )}
                    {(profile.extraSections?.length ?? 0) > 0 && (
                      <div className="extractRow">
                        <dt>Extra sections</dt>
                        <dd>{(profile.extraSections ?? []).map((s) => s.title).join(" · ")}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="cvHelp cvHelpTight">
                    This just shows what was read out of your CV — the wording itself is edited
                    inline on the tailored CV preview.
                  </p>
                </div>
              )}
            </>
          ) : masterCvText ? (
            <p className="cvHelp">
              Your CV is saved, but no details have been extracted from it yet — run the
              extraction below.
            </p>
          ) : (
            <p className="cvHelp">
              No details yet — add your master CV above and these will be extracted automatically.
            </p>
          )}
          {!profileLoading && masterCvText && (
            <div className="actions">
              {confirmReextract ? (
                <>
                  <StatusText as="span">Re-running uses one AI call — continue?</StatusText>
                  <Button variant="secondary" onClick={handleReextract} disabled={reextracting}>
                    Yes, re-run
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmReextract(false)} disabled={reextracting}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmReextract(true)}
                  disabled={reextracting || extracting || editingCv}
                >
                  {reextracting ? "Re-running extraction…" : "Re-run extraction"}
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card>
          <FormField
            label="Section order"
            help="Drag a section, or use the arrows. This changes the order only — how many bullets each section gets is still decided by the tailoring for each specific job."
          >
          {loading ? (
            <Skeleton lines={5} label="Loading your layout" />
          ) : (
            <>
              <ul className="orderList">
                {order.map((id, index) => (
                  <li
                    key={id}
                    className={
                      "orderItem" +
                      (dragIndex === index ? " dragging" : "") +
                      (overIndex === index && dragIndex !== index ? " dropTarget" : "")
                    }
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      e.preventDefault(); // required for onDrop to fire
                      setOverIndex(index);
                    }}
                    onDragLeave={() => setOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) move(dragIndex, index);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  >
                    <span className="orderGrip" aria-hidden="true">⋮⋮</span>
                    <span className="orderNum">{index + 1}</span>
                    {/* The real CV heading style, so what's being reordered is
                        recognisably the same thing that appears on the CV. */}
                    <span className="cvHead orderHead">{SECTION_LABELS[id]}</span>
                    <span className="orderBtns">
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${SECTION_LABELS[id]} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index + 1)}
                        disabled={index === order.length - 1}
                        aria-label={`Move ${SECTION_LABELS[id]} down`}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save order"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setOrder([...DEFAULT_SECTION_ORDER]); setSavedMsg(""); }}
                  disabled={saving || isDefaultOrder(order)}
                >
                  Reset to standard
                </Button>
              </div>

              {error && <StatusText className="msgBelow" role="alert">{error}</StatusText>}
              {savedMsg && <StatusText tone="success" className="msgBelow" role="status">{savedMsg}</StatusText>}
            </>
          )}
          </FormField>
        </Card>

        <Card>
          <div className="label">Not affected by this</div>
          <p className="cvHelp cvHelpTight">
            Your name and contact details stay at the top. Certifications, Right to Work and any
            extra sections from your CV stay after the sections above, in that order.
          </p>
        </Card>

        {/* Advanced customization — the full project pool. Only meaningful
            once a master CV exists (the pool augments it, and the DB write is
            an update against that row). */}
        {masterCvText && (
          <Card>
            <div className="label">Advanced customization</div>
            {!showAdvanced ? (
              <>
                <p className="cvHelp cvHelpTight">
                  {poolSaved
                    ? "A project pool is saved — every tailor run picks the 2 most relevant projects from it."
                    : "Paste ALL your projects once; each tailor run then picks the 2 most relevant for that job."}
                </p>
                <div className="actions">
                  <Button variant="secondary" onClick={() => { setShowAdvanced(true); setPoolMsg(""); setPoolError(""); }}>
                    Advanced customization
                  </Button>
                </div>
              </>
            ) : (
              <FormField
                label="Project pool"
                help="Paste ALL your projects here, in your own words — names, dates, tech, and what you did. On every tailor run the 2 most relevant to that job (1 if you only add one) are selected and get tailored bullets, replacing the projects from your master CV for that run. Remove the pool to switch back. Replacing your master CV also deletes the pool."
              >
                <Textarea
                  rows={12}
                  value={poolDraft}
                  onChange={(e) => { setPoolDraft(e.target.value); setPoolMsg(""); setPoolError(""); }}
                  placeholder={"Project name | Jan 2025\nTech: React, Node.js, PostgreSQL\n- What you built and the outcome\n\nNext project…"}
                  disabled={poolSaving}
                />
                <p className="charCount">
                  {poolDraft.length.toLocaleString()} / {MAX_POOL_CHARS.toLocaleString()}
                </p>
                <div className="actions">
                  <Button onClick={() => handleSavePool(false)} disabled={poolSaving}>
                    {poolSaving ? "Saving…" : "Save project pool"}
                  </Button>
                  {poolSaved && (
                    <Button variant="ghost" className="keyRemove" onClick={() => handleSavePool(true)} disabled={poolSaving}>
                      Remove pool
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setShowAdvanced(false)} disabled={poolSaving}>
                    Close
                  </Button>
                </div>
                {poolError && <StatusText className="msgBelow" role="alert">{poolError}</StatusText>}
                {poolMsg && <StatusText tone="success" className="msgBelow" role="status">{poolMsg}</StatusText>}
              </FormField>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
