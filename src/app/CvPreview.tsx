"use client";

import React, { useRef } from "react";
// projects now arrives keyed by index: { "0": [...bullets], "1": [...bullets] }
type ProjectsData = Record<string, string[]>;

type CvData = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: ProjectsData;
};


import type { Profile } from "@/lib/cvStore";

function CvPreview({
  data,
  profile,
  fileBaseName = "CV",
}: {
  data: CvData;
  profile?: Profile | null;
  fileBaseName?: string;
}) {
  // Fallbacks keep it working if profile is missing
  const p = profile || null;
  const name = p?.name || "YOUR NAME";
  const tagline = p?.tagline || "";
  const contactLine = [p?.location, p?.phone, p?.email].filter(Boolean).join(" | ");
  const linkedin = p?.linkedin || "";
  const github = p?.github || "";
  const ref = useRef<HTMLDivElement>(null);

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
              nodes.push(<ul key={`${prefix}-ul-flush-${i}`} style={{ fontWeight: 400 }}>{bullets.splice(0)}</ul>);
            }
            const { role, date } = splitInlineJobHeader(line);
            nodes.push(
              <p className="cvJobHeader" key={`${prefix}-jh-${i}`}>
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
          nodes.push(<ul key={`${prefix}-ul-${i}`} style={{ fontWeight: 400 }}>{bullets}</ul>);
        }
      } else {
        const next = ls[i + 1];
        if (isInlineJobHeader(l)) {
          // Inline job header without bullet prefix
          const { role, date } = splitInlineJobHeader(l);
          nodes.push(
            <p className="cvJobHeader" key={`${prefix}-jh-${i}`}>
              <span className="cvJobRole">{role}</span>
              <span className="cvJobDate">{date}</span>
            </p>
          );
          i++;
        } else if (next && isDateLine(next)) {
          // Two-line format: role on this line, date on next (e.g. Soma's CV format)
          nodes.push(
            <p className="cvJobHeader" key={`${prefix}-jh-${i}`}>
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
            <ul key={`${prefix}-ul-${i}`} style={{ fontWeight: 400 }}>
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
    if (!ref.current) return;
    (document.activeElement as HTMLElement)?.blur();
    const html2pdf = (await import("html2pdf.js")).default;
     const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number],
      filename: `${fileBaseName}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    html2pdf().set(opt).from(ref.current).save();
  }

  async function downloadWord() {
    if (!ref.current) return;
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

    const domName = (div.querySelector("h1.cvName")?.textContent || "").trim();
    const domTagline = (div.querySelector("p.cvTagline")?.textContent || "").trim();

    const summary = readText("professional summary") || data.summary || "";
    const skills = readText("skills") || data.skills || "";
    const experience = readExperience() || data.experience || "";

    console.log("[CVWord] headings found:", kids.filter(k => k.tagName === "H2").map(k => k.textContent?.trim()));
    console.log("[CVWord] summary (first 100):", summary.slice(0, 100));
    console.log("[CVWord] skills (first 100):", skills.slice(0, 100));
    console.log("[CVWord] experience (first 150):", experience.slice(0, 150));

    const profileForDownload = p
      ? {
          ...p,
          name: domName || p.name,
          tagline: domTagline || p.tagline,
          education: domEducation.length > 0 ? domEducation : p.education,
          certifications: domCerts.length > 0 ? domCerts : p.certifications,
          rightToWork: domRtw.length > 0 ? domRtw : p.rightToWork,
        }
      : p;

    const payload = {
      summary,
      skills,
      experience,
      projects: Object.keys(domProjects).length > 0 ? domProjects : (data.projects || {}),
      projectsMeta: p?.projects || [],
      profile: profileForDownload,
      fileBaseName,
    };

    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.docx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="cvDocWrap">
      <div className="cvActions">
        <button className="cta" onClick={downloadPdf}>Download PDF</button>
        <button className="cta secondary" onClick={downloadWord}>Download Word</button>
      </div>
      <p className="editHint">Click any text to edit it. Your changes are included when you download.</p>
      <div className="cvDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}>
        <h1 className="cvName">{name}</h1>
        {tagline && <p className="cvTagline">{tagline}</p>}
        {contactLine && <p className="cvContact">{contactLine}</p>}
        {(linkedin || github) && (
          <p className="cvContact" contentEditable={false}>
            {linkedin && <a href={linkedin.startsWith("http") ? linkedin : "https://" + linkedin} className="cvLink">{linkedin.replace(/^https?:\/\//, "")}</a>}
            {linkedin && github && " | "}
            {github && <a href={github.startsWith("http") ? github : "https://" + github} className="cvLink">{github.replace(/^https?:\/\//, "")}</a>}
          </p>
        )}

        {data.summary && (
          <>
            <h2 className="cvHead">Professional Summary</h2>
            {lines(data.summary).map((l, i) => (<p className="cvText" key={`sum-${i}`}>{l}</p>))}
          </>
        )}

        {data.skills && (
          <>
            <h2 className="cvHead">Skills</h2>
            {lines(data.skills).map((l, i) => (<p className="cvText" key={`sk-${i}`}>{l}</p>))}
          </>
        )}

        {data.experience && (
          <>
            <h2 className="cvHead">Experience</h2>
            {renderMixed(data.experience, "exp")}
          </>
        )}

        {p?.projects && p.projects.length > 0 && (
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
                      {proj.links.map((l, li) => (
                        <span key={li}>
                          {li > 0 ? "  |  " : ""}
                          {l.label}
                          <a href={l.url} className="cvLink">{l.text}</a>
                        </span>
                      ))}
                    </p>
                  )}
                  <ul>
                    {bullets.map((b, i) => (<li className="cvBullet" key={`${idx}-${i}`}>{b.replace(/^[-•]\s*/, "")}</li>))}
                  </ul>
                </div>
              );
            })}
          </>
        )}

        {p?.education && p.education.length > 0 && (
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
        )}

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
      </div>
    </div>
  );
}

// Wrap in memo so parent re-renders (e.g. user typing in the JD box) don't reconcile
// the contentEditable and silently reset user edits. Re-renders only when props change.
export default React.memo(CvPreview);
