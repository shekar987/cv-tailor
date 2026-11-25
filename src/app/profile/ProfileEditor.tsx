"use client";

// The editable cards of "Your profile facts" (/profile, TL-2). Presentational:
// it holds no state and does no I/O — the page owns the profile and the save.
// Split out so the screen can be rendered with fixture data in isolation.

import {
  type StructuredProfile,
  type SkillEvidence,
  type SkillTier,
  type Direction,
} from "@/lib/profile/schema";
import { metricValueInSource } from "@/lib/profile/validate";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeading from "@/components/ui/SectionHeading";
import StatusText from "@/components/ui/StatusText";

export type SaveState = "idle" | "saving" | "saved";

const EVIDENCE_OPTIONS: SkillEvidence[] = ["production", "project", "coursework", "learning"];
const TIER_OPTIONS: SkillTier[] = ["technical", "functional"];
const DIRECTION_OPTIONS: Direction[] = ["down", "up", "none"];
const DIRECTION_LABEL: Record<Direction, string> = { down: "↓ reduced", up: "↑ increased", none: "— count" };

export default function ProfileEditor({
  profile,
  masterCv,
  showSources,
  onToggleSources,
  onChange,
  onRebuild,
  building,
  liveProblems,
  problems,
  saveState,
  onSave,
}: {
  profile: StructuredProfile;
  masterCv: string;
  showSources: boolean;
  onToggleSources: () => void;
  onChange: (p: StructuredProfile) => void;
  onRebuild?: () => void;
  building: boolean;
  liveProblems: string[];
  problems: string[];
  saveState: SaveState;
  onSave: () => void;
}) {
  // ── Immutable updaters ──────────────────────────────────────────────────────
  function setExperience(ei: number, patch: Partial<StructuredProfile["experience"][number]>) {
    const experience = profile.experience.map((e, i) => (i === ei ? { ...e, ...patch } : e));
    onChange({ ...profile, experience });
  }
  function setBulletText(ei: number, bi: number, text: string) {
    const experience = profile.experience.map((e, i) =>
      i === ei ? { ...e, bullets: e.bullets.map((b, j) => (j === bi ? { ...b, text } : b)) } : e
    );
    onChange({ ...profile, experience });
  }
  function setMetric(ei: number, bi: number, mi: number, patch: Partial<StructuredProfile["experience"][number]["bullets"][number]["metrics"][number]>) {
    const experience = profile.experience.map((e, i) =>
      i === ei
        ? {
            ...e,
            bullets: e.bullets.map((b, j) =>
              j === bi ? { ...b, metrics: b.metrics.map((m, k) => (k === mi ? { ...m, ...patch } : m)) } : b
            ),
          }
        : e
    );
    onChange({ ...profile, experience });
  }
  function setSkill(si: number, patch: Partial<StructuredProfile["skills"][number]>) {
    onChange({ ...profile, skills: profile.skills.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  }
  function setProject(pi: number, patch: Partial<StructuredProfile["projects"][number]>) {
    onChange({ ...profile, projects: profile.projects.map((p, i) => (i === pi ? { ...p, ...patch } : p)) });
  }
  function setEducation(edi: number, patch: Partial<StructuredProfile["education"][number]>) {
    onChange({ ...profile, education: profile.education.map((e, i) => (i === edi ? { ...e, ...patch } : e)) });
  }

  const blocked = liveProblems.length > 0;

  return (
    <>
      <div className="profileToolbar" data-sources-state={showSources ? "shown" : "hidden"}>
        <button type="button" className="linkBtn" onClick={onToggleSources} aria-pressed={showSources}>
          {showSources ? "Hide sources" : "Show sources"}
        </button>
        {onRebuild && (
          <button type="button" className="linkBtn" onClick={onRebuild} disabled={building}>
            {building ? "Reading your CV…" : "Rebuild from my main CV"}
          </button>
        )}
        <span className="profileToolbarSpacer" />
        {saveState === "saved" && <StatusText as="span" tone="success" role="status">✓ Saved</StatusText>}
        <Button onClick={onSave} disabled={saveState === "saving" || blocked} data-save-profile>
          {saveState === "saving" ? "Saving…" : "Save profile facts"}
        </Button>
      </div>

      {(blocked || problems.length > 0) && (
        <div className="limitNotice" role="alert" data-profile-problems>
          <strong>{blocked ? "Fix these before you can save:" : "Couldn't save:"}</strong>
          <ul className="profileProblemList">
            {(blocked ? liveProblems : problems).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Experience */}
      <Card>
        <SectionHeading folio="01">Experience</SectionHeading>
        {profile.experience.map((role, ei) => (
          <div className="profileRole" key={role.id}>
            <div className="profileRoleHead">
              <input className="textInput" value={role.title} aria-label="Job title"
                onChange={(e) => setExperience(ei, { title: e.target.value })} />
              <input className="textInput" value={role.employer} aria-label="Employer"
                onChange={(e) => setExperience(ei, { employer: e.target.value })} />
              <input className="textInput" value={role.dates} aria-label="Dates"
                onChange={(e) => setExperience(ei, { dates: e.target.value })} />
              <input className="textInput" value={role.location} aria-label="Location"
                onChange={(e) => setExperience(ei, { location: e.target.value })} />
            </div>
            {role.bullets.map((b, bi) => (
              <div className="profileBullet" key={b.id}>
                <input className="textInput profileBulletText" value={b.text} aria-label={`Bullet ${b.id}`}
                  onChange={(e) => setBulletText(ei, bi, e.target.value)} />
                {b.metrics.map((m, mi) => {
                  const inSource = metricValueInSource(m.value, masterCv);
                  return (
                    <div className={"profileMetric" + (inSource ? "" : " profileMetric--bad")} key={m.id}>
                      <input className="textInput profileMetricValue" value={m.value} aria-label="Metric value"
                        onChange={(e) => setMetric(ei, bi, mi, { value: e.target.value })} />
                      <input className="textInput profileMetricLabel" value={m.label} aria-label="Metric label"
                        onChange={(e) => setMetric(ei, bi, mi, { label: e.target.value })} />
                      <select className="appsSelect" value={m.direction} aria-label="Direction"
                        onChange={(e) => setMetric(ei, bi, mi, { direction: e.target.value as Direction })}>
                        {DIRECTION_OPTIONS.map((d) => (
                          <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                        ))}
                      </select>
                      {!inSource && <span className="profileMetricWarn" role="alert">not in your CV</span>}
                      {showSources && (
                        <p className="profileSource">From {m.source.section}, line {m.source.line ?? "?"}: {m.source.text}</p>
                      )}
                    </div>
                  );
                })}
                {showSources && (
                  <p className="profileSource">Bullet from {b.source.section}, line {b.source.line ?? "?"}</p>
                )}
              </div>
            ))}
          </div>
        ))}
        {profile.experience.length === 0 && <p className="cvHelp">No experience read from your CV.</p>}
      </Card>

      {/* Skills */}
      <Card>
        <SectionHeading folio="02">Skills</SectionHeading>
        <p className="cvHelp">Evidence is how strong a claim each skill can make. A &quot;production&quot; skill must be shown in a real work bullet.</p>
        <div className="profileSkills">
          {profile.skills.map((s, si) => (
            <div className="profileSkill" key={s.id}>
              <input className="textInput profileSkillName" value={s.name} aria-label="Skill name"
                onChange={(e) => setSkill(si, { name: e.target.value })} />
              <select className="appsSelect" value={s.tier} aria-label="Skill tier"
                onChange={(e) => setSkill(si, { tier: e.target.value as SkillTier })}>
                {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="appsSelect" value={s.evidence} aria-label="Evidence level"
                onChange={(e) => setSkill(si, { evidence: e.target.value as SkillEvidence })}>
                {EVIDENCE_OPTIONS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
              <span className="profileSkillRefs">{s.evidence_refs.length ? s.evidence_refs.join(", ") : "—"}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Projects */}
      {profile.projects.length > 0 && (
        <Card>
          <SectionHeading folio="03">Projects</SectionHeading>
          {profile.projects.map((p, pi) => (
            <div className="profileRole" key={p.id}>
              <div className="profileProjectHead">
                <input className="textInput" value={p.name} aria-label="Project name"
                  onChange={(e) => setProject(pi, { name: e.target.value })} />
                <input className="textInput" value={p.label} aria-label="Project label"
                  placeholder="e.g. personal portfolio project"
                  onChange={(e) => setProject(pi, { label: e.target.value })} />
              </div>
              {p.tools.length > 0 && <p className="profileTools">Tools: {p.tools.join(", ")}</p>}
              {p.bullets.map((b) => (
                <div className="profileBullet" key={b.id}>
                  <input className="textInput profileBulletText" value={b.text} readOnly aria-label={`Project bullet ${b.id}`} />
                  {showSources && <p className="profileSource">From {b.source.section}, line {b.source.line ?? "?"}</p>}
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {/* Education & certifications */}
      {(profile.education.length > 0 || profile.certifications.length > 0) && (
        <Card>
          <SectionHeading folio="04">Education & certifications</SectionHeading>
          {profile.education.map((ed, edi) => (
            <div className="profileEdu" key={ed.id}>
              <input className="textInput" value={ed.degree} aria-label="Degree"
                onChange={(e) => setEducation(edi, { degree: e.target.value })} />
              <input className="textInput" value={ed.institution} aria-label="Institution"
                onChange={(e) => setEducation(edi, { institution: e.target.value })} />
              <input className="textInput" value={ed.dates} aria-label="Dates"
                onChange={(e) => setEducation(edi, { dates: e.target.value })} />
              {ed.note && <p className="cvHelp">{ed.note}</p>}
            </div>
          ))}
          {profile.certifications.map((c) => (
            <p className="profileCert" key={c.id}>{c.name}</p>
          ))}
        </Card>
      )}

      {/* Summary facts */}
      {profile.summary_facts.length > 0 && (
        <Card>
          <SectionHeading folio="05">Summary</SectionHeading>
          {profile.summary_facts.map((sf) => (
            <p className="profileSummaryFact" key={sf.id}>{sf.text}</p>
          ))}
        </Card>
      )}

      {/* Unmapped — never dropped, always shown for review */}
      {profile.unmapped.length > 0 && (
        <Card variant="ruled">
          <SectionHeading folio="06">To review</SectionHeading>
          <p className="cvHelp">These lines from your CV could not be placed automatically. Nothing is lost — add them to the right section of your main CV, then rebuild.</p>
          <ul className="profileUnmapped">
            {profile.unmapped.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
