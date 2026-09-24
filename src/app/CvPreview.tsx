"use client";

import React, { useImperativeHandle, useRef, useState } from "react";
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
import Button from "@/components/ui/Button";
import StatusText from "@/components/ui/StatusText";
import { filterExtraSections, isReservedSectionTitle, SECTION_HEADING_LINE_RE } from "@/lib/sections";
import { saveBlob } from "@/lib/saveBlob";
import { resolveSectionOrder, type SectionId } from "@/lib/sectionOrder";
import { splitTrailingDate } from "@/lib/projectDate";
import { pastePlainText } from "@/lib/pastePlainText";
import { parseBoldSegments, stripBoldMarkers } from "@/lib/markdownText";

// **span** → <strong> — the render half of the bold contract (see
// lib/markdownText). readInline() below is its exact inverse, used by
// collectPayload(), so an edited document round-trips bold instead of
// silently flattening it the way textContent did.
function renderInline(text: string): React.ReactNode {
  const segments = parseBoldSegments(text);
  if (!segments.some((s) => s.bold)) return text;
  return segments.map((s, i) =>
    s.bold ? <strong key={i}>{s.text}</strong> : <React.Fragment key={i}>{s.text}</React.Fragment>
  );
}

// DOM → text with <strong>/<b> serialized back to **…**. Everything else
// (spans, stray divs from contentEditable) contributes its text only.
function readInline(node: Node | null): string {
  if (!node) return "";
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      const inner = readInline(el);
      if (el.tagName === "STRONG" || el.tagName === "B") out += inner.trim() ? `**${inner}**` : inner;
      else out += inner;
    }
  });
  return out;
}

type CvPreviewProps = {
  data: CvData;
  profile?: Profile | null;
  fileBaseName?: string;
  // The user's saved order from profiles.section_order. Undefined/null/malformed
  // all resolve to the default order, so an untouched account renders exactly
  // as it did before this feature existed.
  sectionOrder?: unknown;
  // Downloads held shut by the page while the claims check is blocking, with
  // the first flagged sentence and the rule it breaks as the reason.
  downloadsDisabled?: boolean;
  downloadsDisabledReason?: string;
  // The CV's Right to Work wording, offered beside the downloads as a
  // copy-to-clipboard block for application forms. The document itself
  // carries the section only when the Customize switch is on (the page
  // passes a profile without it otherwise). Empty = no block.
  rightToWorkForForms?: string;
};

// What collectPayload() hands back: the document as currently on screen,
// inline edits included. Consumed by both downloads and, via the ref, by the
// /app page's Applied snapshot.
export type CvPreviewHandle = {
  collectPayload: () => {
    summary: string;
    skills: string;
    experience: string;
    projects: ProjectsData;
    projectsMeta: NonNullable<Profile["projects"]>;
    profile: Profile | null;
    fileBaseName: string;
    sectionOrder: SectionId[];
  } | null;
  // The editable root, for the page's claim-check highlights.
  getRoot: () => HTMLDivElement | null;
};

const CvPreview = React.forwardRef<CvPreviewHandle, CvPreviewProps>(function CvPreview(
  { data, profile, fileBaseName = "CV", sectionOrder, downloadsDisabled = false, downloadsDisabledReason, rightToWorkForForms = "" },
  fwdRef
) {
  const order = resolveSectionOrder(sectionOrder);
  const [rtwCopied, setRtwCopied] = useState(false);
  async function copyRightToWork() {
    try {
      await navigator.clipboard.writeText(rightToWorkForForms);
      setRtwCopied(true);
      window.setTimeout(() => setRtwCopied(false), 2000);
    } catch {
      setRtwCopied(false);
    }
  }
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
  const location = p?.location || "";
  const phone = p?.phone || "";
  const email = p?.email || "";
  const linkedin = p?.linkedin || "";
  const github = p?.github || "";
  const website = p?.website || "";
  const hasContactRow = !!(location || phone || email || linkedin || github || website);
  const ref = useRef<HTMLDivElement>(null);
  // Download UX state — one flag for both formats, so the button reads
  // "Generating…" for a Word build as well as a PDF one.
  const [busy, setBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);

  // The /app page snapshots the EDITED document for the tracker through this
  // handle — the same DOM walk both downloads use, so nothing can drift.
  useImperativeHandle(fwdRef, () => ({ collectPayload, getRoot: () => ref.current }));

  const lines = (text?: string) =>
    (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !SECTION_HEADING_LINE_RE.test(l));
  // Renders mixed subheads and bullet groups, grouping consecutive bullets into <ul>
  // Detects job-header lines (role | company) followed by a date line, and renders
  // them on one bold line (role left, date right). Groups bullets into <ul>.
  const isDateLine = (s: string) =>
    /\b(19|20)\d{2}\b/.test(s) &&
    (s.includes("–") || s.includes("-") || /\bto\b/i.test(s) || /present/i.test(s)) &&
    s.length < 40;

  // Detects "Role | Company | June 2024 – Present" style headers — date is inline, not on the next line.
  // Works whether or not the line has a leading bullet marker.
  const isInlineJobHeader = (s: string) => {
    const clean = s.replace(/^[•\-]\s*/, "");
    return (
      clean.includes("|") &&
      /\b(19|20)\d{2}\b/.test(clean) &&
      // "Jun 2024 – Present", "07/2022 to 09/2024" — CVs write ranges with an
      // en-dash, a bare "to", or an open "Present".
      (clean.includes("–") || /\bto\b/i.test(clean) || /\bPresent\b/i.test(clean))
    );
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
    // No header recognised at all (an unfamiliar date format used to blank
    // the ENTIRE section this way): render every line rather than skipping —
    // the orphan-skip below only makes sense when a header actually exists.
    if (firstHeaderIdx === ls.length) firstHeaderIdx = 0;

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
            const clean = line.replace(/^[•\-]\s*/, "");
            bullets.push(
              <li className="cvBullet" key={`${prefix}-${i}`} style={{ fontWeight: 400 }}>
                {renderInline(clean)}
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
          // Plain body line without bullet prefix (e.g. a role's "Highlight:"
          // line) — a plain justified paragraph, matching how both document
          // builders render non-bullet lines (they don't add a bullet glyph).
          // Reads back through readExperience()'s else-branch as a plain
          // line, so it round-trips unchanged.
          nodes.push(
            <p className="cvText" key={`${prefix}-${nodeKey++}`} style={{ fontWeight: 400 }}>{renderInline(l)}</p>
          );
          i++;
        }
      }
    }
    return nodes;
  };


  async function downloadPdf() {
    if (busy) return;
    setDocErr(null);
    setBusy(true);
    try {
      // Built server-side from the same payload as the Word download, with a
      // real text layer (not a rasterized image) so it's ATS-parseable.
      const payload = collectPayload();
      if (!payload) throw new Error("Could not build the document");
      const res = await fetch("/api/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Could not build the document");
      const blob = await res.blob();
      saveBlob(blob, `${fileBaseName}.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e instanceof Error ? e.message : String(e));
      setDocErr("PDF generation failed. Try the Word download, or retry.");
    } finally {
      setBusy(false);
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

    // For flat text sections (summary, skills): join each child's inline
    // reading (bold preserved as **…**), not its flattened textContent.
    function readText(name: string): string {
      return sectionKids(name)
        .map(el => readInline(el).trim())
        .filter(Boolean)
        .join("\n");
    }

    // Experience: p.cvJobHeader elements give role+date; ul children give bullets.
    function readExperience(): string {
      const parts: string[] = [];
      for (const el of sectionKids("experience")) {
        if (el.classList.contains("cvJobHeader")) {
          // "@@" is the marker's own delimiter; a role typed as "SRE @@ Acme"
          // would otherwise split into the date column on the way out.
          const role = (el.querySelector(".cvJobRole")?.textContent || "").replace(/@@/g, "").trim();
          const date = (el.querySelector(".cvJobDate")?.textContent || "").replace(/@@/g, "").trim();
          parts.push(`@@JOB@@${role}@@${date}`);
        } else if (el.tagName === "UL") {
          Array.from(el.querySelectorAll("li")).forEach(li => {
            const txt = readInline(li).trim();
            if (txt) parts.push(`- ${txt}`);
          });
        } else {
          const txt = readInline(el).trim();
          if (txt) parts.push(txt);
        }
      }
      return parts.join("\n");
    }

    // Projects: div children of the projects section → each holds one
    // project's title (read back so inline title edits persist instead of
    // silently reverting, the same bug class as the education-note fix) and
    // bullets. Tech/links are deliberately NOT read back — see
    // contentEditable={false} on those below.
    const domProjects: Record<string, string[]> = {};
    const domProjectNames: Record<string, string> = {};
    // Matched by the data-proj-index each project wrapper is rendered with,
    // not by position: pressing Enter inside a contentEditable can insert a
    // stray top-level <div>, which by position would shift every following
    // project's bullets under the wrong title in the download.
    sectionKids("projects")
      .filter(el => el.hasAttribute("data-proj-index"))
      .forEach((projDiv) => {
        const idx = projDiv.getAttribute("data-proj-index") || "";
        const bullets = Array.from(projDiv.querySelectorAll("li"))
          .map(li => readInline(li).trim())
          .filter(Boolean);
        if (bullets.length > 0) domProjects[idx] = bullets;

        const jobHeader = projDiv.querySelector(".cvJobHeader");
        const title = ((jobHeader
          ? jobHeader.querySelector(".cvProjTitle")?.textContent
          : projDiv.querySelector(".cvProjTitle")?.textContent) || "").trim();
        // Reconstruct the stored "title | date" format splitTrailingDate()
        // expects — always with " | ", regardless of what separator the
        // original name used, since that's re-parsed on every render anyway.
        const date = (jobHeader?.querySelector(".cvJobDate")?.textContent || "").trim();
        if (title) domProjectNames[idx] = date ? `${title} | ${date}` : title;
      });

    // Education: each div child has either a cvJobHeader (degree + right-aligned
    // dates, when dates exist) or a plain cvSubhead (degree only), plus
    // optionally cvText + cvBullet.
    const domEducation = sectionKids("education")
      .filter(el => el.tagName === "DIV")
      .map(eduDiv => {
        const jobHeader = eduDiv.querySelector(".cvJobHeader");
        const degree = jobHeader
          ? (jobHeader.querySelector(".cvJobRole")?.textContent || "").trim()
          : (eduDiv.querySelector(".cvSubhead")?.textContent || "").trim();
        const dates = jobHeader
          ? (jobHeader.querySelector(".cvJobDate")?.textContent || "").trim()
          : "";
        const institution = (eduDiv.querySelector(".cvText")?.textContent || "").trim();
        // An entry can have multiple note bullets (one <li class="cvBullet">
        // each) — read all of them back, not just the first, or editing/
        // downloading would silently drop the 2nd and 3rd.
        const note = Array.from(eduDiv.querySelectorAll(".cvBullet"))
          .map(li => readInline(li).trim())
          .filter(Boolean)
          .join("\n");
        // Plain strings ("" when absent) to match Education — every consumer
        // gates on truthiness, so "" and undefined behave alike.
        return { degree, dates, institution, note };
      })
      .filter(e => e.degree);

    // Certifications and Right to Work: flat bullet lists.
    const domCerts = sectionKids("certifications")
      .flatMap(el => Array.from(el.querySelectorAll("li")).map(li => readInline(li).trim()))
      .filter(Boolean);
    const domRtw = sectionKids("right to work")
      .flatMap(el => Array.from(el.querySelectorAll("li")).map(li => readInline(li).trim()))
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
            const txt = readInline(li).trim();
            if (txt) bullets.push(txt);
          });
        } else {
          const txt = readInline(k).trim();
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

    // Apply any DOM-read title edit on top of the saved project metadata —
    // tech/links stay whatever was saved, since those two are read-only in
    // the DOM (see contentEditable={false} on those below).
    const projectsMeta = (p?.projects || []).map((proj, idx) => {
      const domName = domProjectNames[String(idx)];
      return domName ? { ...proj, name: domName } : proj;
    });

    return {
      summary,
      skills,
      experience,
      projects: Object.keys(domProjects).length > 0 ? domProjects : (data.projects || {}),
      projectsMeta,
      profile: profileForDownload,
      fileBaseName,
      // Send the ALREADY-RESOLVED order rather than the raw stored value, so the
      // .docx (and therefore the PDF, which renders that .docx) is laid out in
      // exactly the sequence the user is looking at on screen.
      sectionOrder: order,
    };
  }

  // The server-built .docx for the current preview state. The PDF route takes
  // the same collectPayload() output and draws it with jsPDF.
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
    if (busy) return;
    setDocErr(null);
    setBusy(true);
    try {
      const blob = await fetchDocx();
      if (!blob) { setDocErr("Word download failed. Please retry."); return; }
      saveBlob(blob, `${fileBaseName}.docx`);
    } catch (e) {
      console.error("Word generation failed:", e instanceof Error ? e.message : String(e));
      setDocErr("Word download failed. Check your connection and retry.");
    } finally {
      setBusy(false);
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
          {lines(data.summary).map((l, i) => (<p className="cvText" key={`sum-${i}`}>{renderInline(l)}</p>))}
        </>
      ) : null,

    skills: () =>
      data.skills ? (
        <>
          <h2 className="cvHead">Skills</h2>
          {lines(data.skills).map((l, i) => {
            // Bold the label before the first colon ("Functional Competencies:",
            // "Technical Tools:") — mirrors textToParagraphs skills mode in
            // /api/download. Markers are flattened FIRST: the label gets its
            // own bold styling, so "**Functional Competencies:**" from the
            // model must not leak literal asterisks around it.
            const flat = stripBoldMarkers(l);
            const ci = flat.indexOf(":");
            return ci > 0 ? (
              <p className="cvText" key={`sk-${i}`}>
                <strong>{flat.slice(0, ci + 1)}</strong>
                {flat.slice(ci + 1)}
              </p>
            ) : (
              <p className="cvText" key={`sk-${i}`}>{renderInline(l)}</p>
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
            const { title: projTitle, date: projDate } = splitTrailingDate(proj.name || "");
            return (
              <div key={`proj-${idx}`} data-proj-index={idx}>
                {projDate ? (
                  <p className="cvJobHeader">
                    <span className="cvJobRole cvProjTitle">{projTitle}</span>
                    <span className="cvJobDate">{projDate}</span>
                  </p>
                ) : (
                  <p className="cvProjTitle">{projTitle}</p>
                )}
                {/* contentEditable={false}: like the contact row, these two
                    are never read back out of the DOM by collectPayload()
                    (a rendered link <a> can't be unambiguously reconstructed
                    into its original {label, text, url}) — editable-looking
                    but silently reverting on download is worse than
                    read-only. The title above IS read back, so it stays
                    editable. */}
                {proj.tech && <p className="cvText" contentEditable={false}>{renderInline(proj.tech)}</p>}
                {proj.links && proj.links.length > 0 && (
                  <p className="cvText" contentEditable={false}>
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
                          {li > 0 ? " | " : ""}
                          {showLabel ? `${label}: ` : ""}
                          <a href={href} className="cvLink" target="_blank" rel="noopener noreferrer">{display}</a>
                        </span>
                      );
                    })}
                  </p>
                )}
                <ul>
                  {bullets.map((b, i) => (<li className="cvBullet" key={`${idx}-${i}`}>{renderInline(b.replace(/^[-•]\s*/, ""))}</li>))}
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
              {e.dates ? (
                <p className="cvJobHeader">
                  <span className="cvJobRole">{e.degree}</span>
                  {/* cvDateMeta: grey, non-bold, smaller — matching how both
                      document builders style education dates. */}
                  <span className="cvJobDate cvDateMeta">{e.dates}</span>
                </p>
              ) : (
                <p className="cvSubhead">{e.degree}</p>
              )}
              {e.institution && <p className="cvText">{e.institution}</p>}
              {e.note?.trim() && (
                <ul>
                  {e.note.split("\n").map((n, ni) => n.trim() && (
                    <li className="cvBullet" key={`edu-${i}-note-${ni}`}>{renderInline(n.trim())}</li>
                  ))}
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
        <DownloadButton onPdf={downloadPdf} onWord={downloadWord} busy={busy} disabled={downloadsDisabled} disabledReason={downloadsDisabledReason || "Fix the flagged claims first"} />
        {downloadsDisabled && downloadsDisabledReason && (
          <StatusText as="span" role="alert" data-download-blocked-reason>
            {downloadsDisabledReason}
          </StatusText>
        )}
      </div>
      {rightToWorkForForms && (
        <div className="rtwForms" data-rtw-forms>
          <div className="rtwFormsBody">
            <span className="rtwFormsLabel">Right to work — for application forms (not on the CV)</span>
            <pre className="rtwFormsText">{rightToWorkForForms}</pre>
          </div>
          <Button type="button" variant="secondary" onClick={copyRightToWork} data-rtw-copy>
            {rtwCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      {docErr && <StatusText role="alert">{docErr}</StatusText>}
      <p className="editHint">Click any text to edit it. Your changes are included when you download.</p>
      <div className="cvDoc" ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} onPaste={pastePlainText}>
        <h1 className="cvName">{name}</h1>
        {tagline && <p className="cvTagline">{tagline}</p>}
        {hasContactRow && (
          // contentEditable={false}: contact fields are never read back out of
          // this DOM (collectPayload() always sources them from `profile`), so
          // inline edits here would silently vanish — a single non-editable
          // line, matching how the download routes render this row, avoids
          // that trap. Open links in a new tab: following one in this tab
          // would unload the page and throw away the tailored result.
          <p className="cvContact" contentEditable={false}>
            {[
              location,
              phone,
              email ? (
                <a key="email" href={`mailto:${email}`} className="cvLink">{email}</a>
              ) : null,
              linkedin ? (
                <a key="li" href={linkedin.startsWith("http") ? linkedin : "https://" + linkedin} className="cvLink" target="_blank" rel="noopener noreferrer">LinkedIn</a>
              ) : null,
              github ? (
                <a key="gh" href={github.startsWith("http") ? github : "https://" + github} className="cvLink" target="_blank" rel="noopener noreferrer">GitHub</a>
              ) : null,
              website ? (
                <a key="web" href={website.startsWith("http") ? website : "https://" + website} className="cvLink" target="_blank" rel="noopener noreferrer">Portfolio</a>
              ) : null,
            ]
              .filter((piece) => piece !== null && piece !== "")
              .map((piece, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " · "}
                  {piece}
                </React.Fragment>
              ))}
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
                <li className="cvBullet" key={`cert-${i}`}>{renderInline(c)}</li>
              ))}
            </ul>
          </>
        )}

        {p?.rightToWork && p.rightToWork.length > 0 && (
          <>
            <h2 className="cvHead">Right to Work</h2>
            <ul>
              {p.rightToWork.map((r, i) => (
                <li className="cvBullet" key={`rtw-${i}`}>{renderInline(r)}</li>
              ))}
            </ul>
          </>
        )}

        {filterExtraSections(p?.extraSections).map((sec, si) => (
          <React.Fragment key={`extra-${si}`}>
            <h2 className="cvHead">{sec.title}</h2>
            <ul>
              {sec.bullets.map((b, i) => (
                <li className="cvBullet" key={`extra-${si}-${i}`}>{renderInline(b.replace(/^[-•]\s*/, ""))}</li>
              ))}
            </ul>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});

// Wrap in memo so parent re-renders (e.g. user typing in the JD box) don't reconcile
// the contentEditable and silently reset user edits. Re-renders only when props change.
export default React.memo(CvPreview);
