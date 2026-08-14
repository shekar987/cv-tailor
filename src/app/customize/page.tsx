"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getMasterCV,
  saveMasterCV,
  clearMasterCV,
  getProfile,
  saveProfile,
  clearProfile,
  importFromLocalStorageIfNeeded,
  type Profile,
} from "@/lib/cvStore";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import CvUpload from "../CvUpload";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
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

  // Profile details — extracted from the master CV, edited here.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      // The page is auth-gated by proxy.ts, but bounce defensively if the
      // session vanished between navigation and mount.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login");
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

  function updateProfileField(field: keyof Profile, value: string) {
    if (!profile) return;
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    saveProfile(updated); // fire-and-forget: UI state is already correct, DB catches up
  }

  // Drops any tailored result sitting in the /app workspace without touching
  // the pasted job description — the JD is independent of the CV, but a
  // tailored result is not.
  function invalidateWorkspaceResult() {
    if (!userId) return;
    const existing = loadWorkspace(userId);
    saveWorkspace(userId, { jobDescription: existing?.jobDescription ?? "", result: null, ranProvider: null });
  }

  async function handleSaveCv() {
    if (!cvDraft.trim()) {
      setCvError("Paste your CV before saving.");
      return;
    }
    const rec = await saveMasterCV(cvDraft);
    setMasterCvText(rec.text);
    setCvSavedAt(rec.updatedAt);
    setCvError("");
    setUploadNotice(null);
    invalidateWorkspaceResult();

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
    // Destructive and irreversible — the button sits right next to "Edit",
    // so a confirmation guards against a misclick wiping the master CV.
    if (!window.confirm("Replace your master CV? This deletes your saved CV and extracted details — this can't be undone.")) {
      return;
    }
    // Reset UI immediately so the user doesn't wait for the DB delete
    setProfile(null);
    setMasterCvText("");
    setCvSavedAt(null);
    setCvDraft("");
    setEditingCv(true);
    setUploadNotice(null);
    invalidateWorkspaceResult();
    // Delete from DB in the background
    await clearMasterCV();
    await clearProfile();
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
        <header className="header">
          <div className="appBar" style={{ marginBottom: 8 }}>
            <div className="wordmark">Jobhuntz</div>
            <Link href="/app" className="customizeLink">← Back to app</Link>
          </div>
          <p className="tagline">
            Manage your master CV, your details, and how your tailored CV is laid out.
          </p>
        </header>

        <Card>
          {cvLoading ? (
            <p className="cvHelp">Loading your CV…</p>
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
                  setCvDraft(text);
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
              />
              <div className="actions">
                <Button onClick={handleSaveCv}>Save master CV</Button>
                {masterCvText && (
                  <Button variant="secondary" onClick={() => setEditingCv(false)}>Cancel</Button>
                )}
                {cvError && <StatusText as="span">{cvError}</StatusText>}
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
                <Button variant="secondary" onClick={handleEditCv}>Edit</Button>
                <Button variant="ghost" onClick={handleClearCv}>Replace</Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="label">
            Your details {extracting && <span className="cvSavedMeta">— extracting…</span>}
          </div>
          {profileLoading ? (
            <p className="cvHelp" style={{ color: "var(--muted)" }}>Loading your details…</p>
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
              </div>
            </>
          ) : (
            <p className="cvHelp">
              No details yet — add your master CV above and these will be extracted automatically.
            </p>
          )}
        </Card>

        <Card>
          <FormField
            label="Section order"
            help="Drag a section, or use the arrows. This changes the order only — how many bullets each section gets is still decided by the tailoring for each specific job."
          >
          {loading ? (
            <p className="cvHelp" style={{ color: "var(--muted)" }}>Loading your layout…</p>
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

              {error && <StatusText style={{ marginTop: 12 }} role="alert">{error}</StatusText>}
              {savedMsg && <StatusText tone="success" style={{ marginTop: 12 }} role="status">{savedMsg}</StatusText>}
            </>
          )}
          </FormField>
        </Card>

        <Card>
          <div className="label">Not affected by this</div>
          <p className="cvHelp" style={{ marginBottom: 0 }}>
            Your name and contact details stay at the top. Certifications, Right to Work and any
            extra sections from your CV stay after the sections above, in that order.
          </p>
        </Card>
      </div>
    </main>
  );
}
