"use client";
import { useState, useEffect } from "react";
import { getMasterCV, saveMasterCV, clearMasterCV } from "@/lib/cvStore";
import CvPreview from "../CvPreview";
import CoverLetterPreview from "../CoverLetterPreview";

type Result = {
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
 const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  // Master CV state
  const [masterCvText, setMasterCvText] = useState("");      // the stored CV text
  const [cvDraft, setCvDraft] = useState("");                // editing buffer
  const [editingCv, setEditingCv] = useState(false);         // is the CV editor open?
  const [cvSavedAt, setCvSavedAt] = useState<number | null>(null);

  // On load, read any stored master CV
  useEffect(() => {
    const stored = getMasterCV();
    if (stored) {
      setMasterCvText(stored.text);
      setCvSavedAt(stored.updatedAt);
    } else {
      setEditingCv(true); // no CV yet — open the editor so they set one
    }
  }, []);

  function handleSaveCv() {
    if (!cvDraft.trim()) {
      setError("Paste your CV before saving.");
      return;
    }
    const rec = saveMasterCV(cvDraft);
    setMasterCvText(rec.text);
    setCvSavedAt(rec.updatedAt);
    setEditingCv(false);
    setError("");
  }

  function handleEditCv() {
    setCvDraft(masterCvText);
    setEditingCv(true);
  }

  function handleClearCv() {
    clearMasterCV();
    setMasterCvText("");
    setCvSavedAt(null);
    setCvDraft("");
    setEditingCv(true);
  }

  async function handleTailor() {

    if (!masterCvText.trim()) {
      setError("Set your master CV first (the box above).");
      setEditingCv(true);
      return;
    }
    if (!jobDescription.trim()) {
      setError("Paste a job description to get started.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, cvText: masterCvText }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Something went wrong. Try again.");
      else setResult(data);
    } catch {
      setError("Couldn't reach the server. Check it's running and try again.");
    } finally {
      setLoading(false);
    }
  }
async function handleDownload() {
    if (!result) return;
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: result.summary,
          skills: result.skills,
          experience: result.experience,
          projects: result.projects,
          companyName: (result as any).analysis?.company_name || "",
          roleTitle: (result as any).analysis?.role_title || "",
        }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
     const cn = ((result as any).analysis?.company_name || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      const rt = ((result as any).analysis?.role_title || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      a.download = ["Soma_Shekar", cn, rt, "CV"].filter(Boolean).join("_") + ".docx";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't generate the document. Try again.");
    }
  }
  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div className="wordmark">
            CV<span className="dot">.</span>Tailor
          </div>
          <p className="tagline">
            Honest, ATS-ready tailoring. Every claim traces back to your real CV — nothing invented.
          </p>
        </header>

        {/* Master CV card */}
        <section className="inputCard">
          {editingCv ? (
            <>
              <label className="label" htmlFor="cv">Your master CV</label>
              <p className="cvHelp">Paste your full CV once. It's saved in your browser and reused for every job — you'll only need to paste the job description each time.</p>
              <textarea
                id="cv"
                value={cvDraft}
                onChange={(e) => setCvDraft(e.target.value)}
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

        {/* JD card — only show once a master CV exists */}
        {masterCvText && (
          <section className="inputCard">
            <label className="label" htmlFor="jd">Job description</label>
            <textarea
              id="jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description for the role you're applying to…"
              rows={8}
            />
            <div className="actions">
              <button onClick={handleTailor} disabled={loading} className="cta">
                {loading ? "Tailoring…" : "Tailor my CV"}
              </button>
              {error && <span className="error">{error}</span>}
            </div>
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
         data={{ summary: result.summary, skills: result.skills, experience: result.experience, projects: result.projects as any }}
         fileBaseName={(() => {
          const cn = ((result as any).analysis?.company_name || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
          const rt = ((result as any).analysis?.role_title || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
          return ["Soma_Shekar", cn, rt, "CV"].filter(Boolean).join("_");
              })()}
/>
{result.coverLetter && (
              <>
                <h2 className="clHeading">Cover Letter</h2>
                <CoverLetterPreview
                  coverLetter={result.coverLetter}
                  fileBaseName={(() => {
                    const cn = ((result as any).analysis?.company_name || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                    const rt = ((result as any).analysis?.role_title || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
                    return ["Soma_Shekar", cn, rt, "CoverLetter"].filter(Boolean).join("_");
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

function Block({ title, content }: { title: string; content?: string }) {
  if (!content) return null;
  return (
    <article className="block">
      <h2>{title}</h2>
      <div className="blockBody">{content}</div>
    </article>
  );
}