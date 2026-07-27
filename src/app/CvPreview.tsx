"use client";

import React, { useRef, useState } from "react";
// projects now arrives keyed by index: { "0": [...bullets], "1": [...bullets] }
type ProjectsData = Record<string, string[]>;

type CvData = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: ProjectsData;
};


import type { Profile } from "@/lib/cvStore";
import DownloadButton from "./DownloadButton";
import { filterExtraSections, isReservedSectionTitle } from "@/lib/sections";
import { saveBlob } from "@/lib/saveBlob";
import { resolveSectionOrder, type SectionId } from "@/lib/sectionOrder";

function CvPreview({
  data,
  profile,
  fileBaseName = "CV",
  sectionOrder,
}: {
  data: CvData;
  profile?: Profile | null;
  fileBaseName?: string;
  // The user's saved order from profiles.section_order. Undefined/null/malformed
  // all resolve to the default order, so an untouched account renders exactly
  // as it did before this feature existed.
  sectionOrder?: unknown;
}) {
  const order = resolveSectionOrder(sectionOrder);
  // Fallbacks keep it working if profile is missing
  const p = profile || null;
  const name = p?.name || "YOUR NAME";
  // Mirror the download route's tagline cleanup so the on-screen preview matches
  // the PDF/Word: a headline never carries contact/social URLs (would duplicate
  // the GitHub/LinkedIn shown below). Bare words like "GitHub Actions" are kept.
  const tagline = (p?.tagline || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?(?:linkedin|github)\.com\/?\S*/gi, " ")
    .replace(/\b(?:LinkedIn|GitHub)\s*:/gi, " ")
    .replace(/^\s*[|•·,\-–—]+\s*|\s*[|•·,\-–—]+\s*$/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const contactLine = [p?.location, p?.phone, p?.email].filter(Boolean).join(" | ");
  const linkedin = p?.linkedin || "";
  const github = p?.github || "";
  const ref = useRef<HTMLDivElement>(null);
  // Download UX state — surfaces failures instead of a silent dead button
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);

  const lines = (text?: string) =>
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !/^(SKILLS|PROJECTS|PROFESSIONAL SUMMARY|EXPERIENCE|WORK EXPERIENCE|EDUCATION|CERTIFICATIONS)\s*:?\s*$/i.test(l));
  // Renders mixed subheads and bullet groups, grouping consecutive bullets into <ul>
  // Detects job-header lines (role | company) followed by a date line, and renders
  // them on one bold line (role left, date right). Groups bullets into <ul>.
  const isDateLine = (s: string) =>
    /\b(19|20)\d{2}\b/.test(s) && (s.includes("–") || s.includes("-") || /present/i.test(s)) && s.length < 40;

  // Detects "Role | Company | June 2024 – Present" style headers — date is inline, not on the next line.
  // Works whether or not the line has a leading bullet marker.
  const isInlineJobHeader = (s: string) => {
    const clean = s.replace(/^[•\-]\s*/, "");
    return clean.includes("|") && /\b(19|20)\d{2}\b/.test(clean) && (clean.includes("–") || /\bPresent\b/i.test(clean));
  };

  // Splits "Role | Company | June 2024 – Present" → { role: "Role | Company", date: "June 2024 – Present" }
  const splitInlineJobHeader = (s: string): { role: string; date: string } => {
    const clean = s.replace(/^[•\-]\s*/, "");
    const parts = clean.split("|").map((p) => p.trim());
    for (let j = parts.length - 1; j >= 0; j--) {
      if (/\b(19|20)\d{2}\b/.test(parts[j])) {
        return { role: parts.slice(0, j).join(" | "), date: parts[j] };
      }
    }
    return { role: clean, date: "" };
  };

  const renderMixed = (text: string | undefined, prefix: string): React.ReactNode[] => {
    const ls = lines(text);
    const nodes: React.ReactNode[] = [];

    // Find the first job header so we can skip any orphaned lines before it.
    // When there are no headers at all, firstHeaderIdx = ls.length and nothing is skipped.
    let firstHeaderIdx = ls.length;
    for (let j = 0; j < ls.length; j++) {
      if (isInlineJobHeader(ls[j])) { firstHeaderIdx = j; break; }
      if (!ls[j].startsWith("•") && !ls[j].startsWith("-") && j + 1 < ls.length && isDateLine(ls[j + 1])) {
        firstHeaderIdx = j; break;
      }
    }

    let i = 0;
    let nodeKey = 0; // always-incrementing; prevents key collisions between ul/p nodes
    while (i < ls.length) {
      const l = ls[i];
      const isBullet = l.startsWith("•") || l.startsWith("-");

      if (isBullet) {
        const bullets: React.ReactNode[] = [];
        while (i < ls.length && (ls[i].startsWith("•") || ls[i].startsWith("-"))) {
          const line = ls[i];
          if (isInlineJobHeader(line)) {
            // Flush any pending bullets before rendering the job header
            if (bullets.length > 0) {
              nodes.push(<ul key={`${prefix}-${nodeKey++}`} style={{ fontWeight: 400 }}>{bullets.splice(0)}</ul>);
            }
            const { role, date } = splitInlineJobHeader(line);
            nodes.push(
              <p className="cvJobHeader" key={`${prefix}-${nodeKey++}`}>
                <span className="cvJobRole">{role}</span>
                <span className="cvJobDate">{date}</span>
              </p>
            );
          } else if (i >= firstHeaderIdx) {
            const clean = line.replace(/^[•\-]\s*/, "").replace(/\*\*/g, "");
            bullets.push(
              <li className="cvBullet" key={`${prefix}-${i}`} style={{ fontWeight: 400 }}>
                {clean}
              </li>
            );
          }
          // else: i < firstHeaderIdx → orphaned bullet before first header; skip
          i++;
        }
        if (bullets.length > 0) {
          nodes.push(<ul key={`${prefix}-${nodeKey++}`} style={{ fontWeight: 400 }}>{bullets}</ul>);
        }
      } else {
        const next = ls[i + 1];
        if (isInlineJobHeader(l)) {
          // Inline job header without bullet prefix
          const { role, date } = splitInlineJobHeader(l);
          nodes.push(
            <p className="cvJobHeader" key={`${prefix}-${nodeKey++}`}>
              <span className="cvJobRole">{role}</span>
              <span className="cvJobDate">{date}</span>
            </p>
          );
          i++;
        } else if (next && isDateLine(next)) {
          // Two-line format: role on this line, date on next (e.g. Soma's CV format)
          nodes.push(
            <p className="cvJobHeader" key={`${prefix}-${nodeKey++}`}>
              <span className="cvJobRole">{l}</span>
              <span className="cvJobDate">{next}</span>
            </p>
          );
          i += 2;
        } else if (isDateLine(l)) {
          // Stray date line — skip
          i++;
        } else if (i < firstHeaderIdx) {
          // Orphaned non-bullet line before first header — skip
          i++;
        } else {
          // Plain body line without bullet prefix
          nodes.push(
            <ul key={`${prefix}-${nodeKey++}`} style={{ fontWeight: 400 }}>
              <li className="cvBullet" style={{ fontWeight: 400 }}>{l.replace(/\*\*/g, "")}</li>
            </ul>
          );
          i++;
        }
      }
    }
    return nodes;
  };


  async function downloadPdf() {
    if (pdfBusy) return;
    setDocErr(null);
    setPdfBusy(true);
    try {
      // PDF renders from the SAME server-built .docx as the Word download, so
      // the two match by construction. Entirely in-browser — nothing leaves the page.
      const blob = await fetchDocx();
      if (!blob) throw new Error("Could not build the document");
      const { docxBlobToPdf } = await import("@/lib/docxToPdf");
      await docxBlobToPdf(blob, fileBaseName);
    } catch (e) {
      console.error("PDF generation failed:", e);
      setDocErr("PDF generation failed. Try the Word download, or retry.");
    } finally {
      setPdfBusy(false);
    }
  }

  // Walk the live preview DOM into the /api/download payload (captures inline
  // edits). Shared by both downloads. Returns null if the preview isn't mounted.
  function collectPayload() {
    if (!ref.current) return null;
    (document.activeElement as HTMLElement)?.blur();

    const div = ref.current;
    // Walk direct children only — same depth-first approach the cover letter uses,
    // adapted for a structured document with h2 section headings.
    const kids = Array.from(div.children) as HTMLElement[];

    // Index of the h2 whose textContent matches the given section name (case-insensitive).
    // textContent is NOT affected by CSS text-transform, so "Professional Summary" matches.
    function headingIdx(name: string): number {
      return kids.findIndex(
        el => el.tagName === "H2" && (el.textContent || "").trim().toLowerCase() === name
      );
    }

    // All direct children between this section's h2 and the next h2.
    function sectionKids(name: string): HTMLElement[] {
      const si = headingIdx(name);
      if (si === -1) return [];
      let ei = kids.length;
      for (let i = si + 1; i < kids.length; i++) {
        if (kids[i].tagName === "H2") { ei = i; break; }
      }
      return kids.slice(si + 1, ei);
    }

    // For flat text sections (summary, skills): join textContent of each child.
    function readText(name: string): string {
      return sectionKids(name)
        .map(el => (el.textContent || "").trim())
        .filter(Boolean)
        .join("\n");
    }

    // Experience: p.cvJobHeader elements give role+date; ul children give bullets.
    function readExperience(): string {
      const parts: string[] = [];
      for (const el of sectionKids("experience")) {
        if (el.classList.contains("cvJobHeader")) {
          const role = (el.querySelector(".cvJobRole")?.textContent || "").trim();
          const date = (el.querySelector(".cvJobDate")?.textContent || "").trim();
          parts.push(`@@JOB@@${role}@@${date}`);
        } else if (el.tagName === "UL") {
          Array.from(el.querySelectorAll("li")).forEach(li => {
            const txt = (li.textContent || "").trim();
            if (txt) parts.push(`- ${txt}`);
          });
        } else {
          const txt = (el.textContent || "").trim();
          if (txt) parts.push(txt);
        }
      }
      return parts.join("\n");
    }

    // Projects: div children of the projects section → each div holds one project's bullets.
    const domProjects: Record<string, string[]> = {};
    sectionKids("projects")
      .filter(el => el.tagName === "DIV")
      .forEach((projDiv, idx) => {
        const bullets = Array.from(projDiv.querySelectorAll("li"))
          .map(li => (li.textContent || "").trim())
          .filter(Boolean);
        if (bullets.length > 0) domProjects[String(idx)] = bullets;
      });

    // Education: each div child has a cvSubhead (degree+dates) and optionally cvText + cvBullet.
    const domEducation = sectionKids("education")
      .filter(el => el.tagName === "DIV")
      .map(eduDiv => {
        const subhead = (eduDiv.querySelector(".cvSubhead")?.textContent || "").trim();
        const institution = (eduDiv.querySelector(".cvText")?.textContent || "").trim();
        const note = (eduDiv.querySelector(".cvBullet")?.textContent || "").trim();
        return { degree: subhead, institution: institution || undefined, note: note || undefined };
      })
      .filter(e => e.degree);

    // Certifications and Right to Work: flat bullet lists.
    const domCerts = sectionKids("certifications")
      .flatMap(el => Array.from(el.querySelectorAll("li")).map(li => (li.textContent || "").trim()))
      .filter(Boolean);
    const domRtw = sectionKids("right to work")
      .flatMap(el => Array.from(el.querySelectorAll("li")).map(li => (li.textContent || "").trim()))
      .filter(Boolean);

    // Pass-through sections: any h2 that isn't one of the known/reserved headings.
    // Captured from the DOM so inline edits (including edited titles) are kept.
    const domExtras: { title: string; bullets: string[] }[] = [];
    kids.forEach((el, i) => {
      if (el.tagName !== "H2") return;
      const title = (el.textContent || "").trim();
      if (!title || isReservedSectionTitle(title)) return;
      const bullets: string[] = [];
      for (let j = i + 1; j < kids.length && kids[j].tagName !== "H2"; j++) {
        const k = kids[j];
        if (k.tagName === "UL") {
          Array.from(k.querySelectorAll("li")).forEach(li => {
            const txt = (li.textContent || "").trim();
            if (txt) bullets.push(txt);
          });
        } else {
          const txt = (k.textContent || "").trim();
          if (txt) bullets.push(txt);
        }
      }
      if (bullets.length > 0) domExtras.push({ title, bullets });
    });

    const domName = (div.querySelector("h1.cvName")?.textContent || "").trim();
    const domTagline = (div.querySelector("p.cvTagline")?.textContent || "").trim();

    const summary = readText("professional summary") || data.summary || "";
    const skills = readText("skills") || data.skills || "";
    const experience = readExperience() || data.experience || "";

    const profileForDownload = p
      ? {
          ...p,
          name: domName || p.name,
          tagline: domTagline || p.tagline,
          education: domEducation.length > 0 ? domEducation : p.education,
          certifications: domCerts.length > 0 ? domCerts : p.certifications,
          rightToWork: domRtw.length > 0 ? domRtw : p.rightToWork,
          extraSections: domExtras.length > 0 ? domExtras : p.extraSections,
        }
      : p;

    return {
      summary,
      skills,
      experience,
      projects: Object.keys(domProjects).length > 0 ? domProjects : (data.projects || {}),
      projectsMeta: p?.projects || [],
      profile: profileForDownload,
      fileBaseName,
      // Send the ALREADY-RESOLVED order rather than the raw stored value, so the
      // .docx (and therefore the PDF, which renders that .docx) is laid out in
      // exactly the sequence the user is looking at on screen.
      sectionOrder: order,
    };
  }

  // Single source of truth for both downloads: the server-built .docx for the
  // current preview state. PDF is a client-side render of this same file.
  async function fetchDocx(): Promise<Blob | null> {
    const payload = collectPayload();
    if (!payload) return null;
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return res.blob();
  }

  async function downloadWord() {
    setDocErr(null);
    try {
      const blob = await fetchDocx();
      if (!blob) { setDocErr("Word download failed. Please retry."); return; }
      saveBlob(blob, `${fileBaseName}.docx`);
    } catch (e) {
      console.error("Word generation failed:", e);
      setDocErr("Word download failed. Check your connection and retry.");
    }
  }

  // The five reorderable sections. Each renders exactly the markup it did
  // before this feature — they are only pulled out into a map so the render
  // sequence can follow the user's saved order. Anything NOT in here (contact
  // header, certifications, right to work, pass-through extras) keeps its
  // fixed position.
  const SECTIONS: Record<SectionId, () => React.ReactNode> = {
    summary: () =>
      data.summary ? (
        <>
          <h2 className="cvHead">Professional Summary</h2>
          {lines(data.summary).map((l, i) => (<p className="cvText" key={`sum-${i}`}>{l}</p>))}
        </>
      ) : null,

    skills: () =>
      data.skills ? (
        <>
          <h2 className="cvHead">Skills</h2>
          {lines(data.skills).map((l, i) => {
            // Bold the label before the first colon ("Functional Competencies:",
            // "Technical Tools:") — mirrors textToParagraphs skills mode in /api/download
            const ci = l.indexOf(":");
            return ci > 0 ? (
              <p className="cvText" key={`sk-${i}`}>
                <strong>{l.slice(0, ci + 1)}</strong>
                {l.slice(ci + 1)}
              </p>
            ) : (
              <p className="cvText" key={`sk-${i}`}>{l}</p>
            );
          })}
        </>
      ) : null,

    experience: () =>
      data.experience ? (
        <>
          <h2 className="cvHead">Experience</h2>
          {renderMixed(data.experience, "exp")}
        </>
      ) : null,

    projects: () =>
      p?.projects && p.projects.length > 0 ? (
        <>
          <h2 className="cvHead">Projects</h2>
          {p.projects.map((proj, idx) => {
            // tailored bullets for this project come keyed by index; fall back to original bullets
            const tailored = data.projects?.[String(idx)];
            const bullets = (Array.isArray(tailored) && tailored.length > 0)
              ? tailored
              : (proj.originalBullets || []);
            if (bullets.length === 0 && !proj.name) return null;
            return (
              <div key={`proj-${idx}`}>
                <p className="cvProjTitle">{proj.name}</p>
                {proj.tech && <p className="cvText">{proj.tech}</p>}
                {proj.links && proj.links.length > 0 && (
                  <p className="cvText">
                    {proj.links.map((l, li) => {
                      // Match the download route: show the label only when it
                      // isn't a duplicate of the link text (avoids "GitHubGitHub"),
                      // separate with ": ", and strip the protocol for display.
                      const label = (l.label || "").trim().replace(/:\s*$/, "");
                      const rawText = (l.text || l.url || "").trim();
                      const display = rawText.replace(/^https?:\/\//i, "");
                      const href = l.url?.startsWith("http") ? l.url : "https://" + (l.url || rawText);
                      const showLabel = !!label && label.toLowerCase() !== display.toLowerCase() && label.toLowerCase() !== rawText.toLowerCase();
                      return (
                        <span key={li}>
                          {li > 0 ? "  |  " : ""}
                          {showLabel ? `${label}: ` : ""}
                          <a href={href} className="cvLink" target="_blank" rel="noopener noreferrer">{display}</a>
                        </span>
                      );
                    })}
                  </p>
                )}
                <ul>
                  {bullets.map((b, i) => (<li className="cvBullet" key={`${idx}-${i}`}>{b.replace(/^[-•]\s*/, "")}</li>))}
                </ul>
              </div>
            );
          })}
        </>
      ) : null,

    education: () =>
      p?.education && p.education.length > 0 ? (
        <>
          <h2 className="cvHead">Education</h2>
          {p.education.map((e, i) => (
            <div key={`edu-${i}`}>
              <p className="cvSubhead">{e.degree}{e.dates ? ` — ${e.dates}` : ""}</p>
              {e.institution && <p className="cvText">{e.institution}</p>}
              {e.note?.trim() && (
                <ul>
                  <li className="cvBullet">{e.note}</li>
                </ul>
              )}
            </div>
          ))}
        </>
      ) : null,
  };

  return (
    <div className="cvDocWrap">
      <div className="cvActions">
        <DownloadButton onPdf={downloadPdf} onWord={downloadWord} busy={pdfBusy} />
      </div>
      {docErr && <p className="error" role="alert">{docErr}</p>}
      <p className="editHint">Click any text to edit it. Your changes are included when you download.</p>
      <div className="cvDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}>
        <h1 className="cvName">{name}</h1>
        {tagline && <p className="cvTagline">{tagline}</p>}
        {contactLine && <p className="cvContact">{contactLine}</p>}
        {(linkedin || github) && (
          <p className="cvContact" contentEditable={false}>
            {/* Open in a new tab: following a link in this tab would unload the
                page and throw away the tailored result the user is looking at. */}
            {linkedin && <a href={linkedin.startsWith("http") ? linkedin : "https://" + linkedin} className="cvLink" target="_blank" rel="noopener noreferrer">LinkedIn</a>}
            {linkedin && github && " | "}
            {github && <a href={github.startsWith("http") ? github : "https://" + github} className="cvLink" target="_blank" rel="noopener noreferrer">GitHub</a>}
          </p>
        )}

        {/* The five reorderable sections, emitted in the user's saved order.
            Each entry renders the SAME markup it always did — only the sequence
            varies. React.Fragment adds no DOM, so the default order produces
            output identical to before this feature. */}
        {order.map((sectionId) => (
          <React.Fragment key={`section-${sectionId}`}>{SECTIONS[sectionId]()}</React.Fragment>
        ))}

        {p?.certifications && p.certifications.length > 0 && (
          <>
            <h2 className="cvHead">Certifications</h2>
            <ul>
              {p.certifications.map((c, i) => (
                <li className="cvBullet" key={`cert-${i}`}>{c}</li>
              ))}
            </ul>
          </>
        )}

        {p?.rightToWork && p.rightToWork.length > 0 && (
          <>
            <h2 className="cvHead">Right to Work</h2>
            <ul>
              {p.rightToWork.map((r, i) => (
                <li className="cvBullet" key={`rtw-${i}`}>{r}</li>
              ))}
            </ul>
          </>
        )}

        {filterExtraSections(p?.extraSections).map((sec, si) => (
          <React.Fragment key={`extra-${si}`}>
            <h2 className="cvHead">{sec.title}</h2>
            <ul>
              {sec.bullets.map((b, i) => (
                <li className="cvBullet" key={`extra-${si}-${i}`}>{b.replace(/^[-•]\s*/, "")}</li>
              ))}
            </ul>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Wrap in memo so parent re-renders (e.g. user typing in the JD box) don't reconcile
// the contentEditable and silently reset user edits. Re-renders only when props change.
export default React.memo(CvPreview);
