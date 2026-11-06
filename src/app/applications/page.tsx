"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import CvPreview from "../CvPreview";
import CoverLetterPreview from "../CoverLetterPreview";
import SentCvBlock from "./SentCvBlock";
import { ReferralEditor } from "./ReferralAsks";
import { REFERRAL_STATUS_LABELS, nextReferralAction, nextReferralStatus, referralAsks, isReferralStatus, type ReferralFields, type ReferralStatus } from "@/lib/referrals";
import type { SentCvInfo } from "@/lib/sentCv";
import { getProfile, type Profile } from "@/lib/cvStore";
import TriageBadge from "../TriageBadge";
import { normalizeTriage } from "@/lib/triage/jdTriage";
import { notesListFields, listTriageFields } from "@/lib/applicationRows";
import RowFlags from "./RowFlags";
import { localIsoDate, addDays } from "@/lib/applicationSnapshot";
import { saveBlob } from "@/lib/saveBlob";
import { matchesSearch, MAX_SEARCH_CHARS } from "@/lib/trackerSearch";
import { MAX_JD_CHARS as JD_LIMIT, MAX_NOTES_CHARS, JD_TOO_LONG } from "@/lib/limits";
import { MIN_DECIDED, MIN_FOR_VERDICT, seniorityOf, type Insights, type Bucket, type ScoreOutcome, type ScoreVerdict, type Seniority } from "@/lib/insights";
import { bandFor, type VisibilityBand } from "@/lib/visibilityVerdict";
import { gateLine, type GatesSummary } from "@/lib/knockouts";
import { rowStyle, isFormatStyleId, normalizeFormatStyle, ROW_STYLE_LABELS, type RowStyle } from "@/lib/formatStyles/ids";
import { normalizeStyleCheck, summarizeStyleCheck } from "@/lib/styleCheck";
import { getUsage } from "@/lib/usage";
import AttentionStrip, { type AttentionFilter } from "./AttentionStrip";
import StageTabs, { type TabChoice } from "./StageTabs";
import ClosedSection, { type ClosedRow } from "./ClosedSection";
import WinsView from "./WinsView";
import MoveToClosedDialog, { closeBody, type CloseChoice } from "@/components/MoveToClosedDialog";
import { CONFIRMATION_MESSAGE, HIGHEST_STAGE_LABELS, UNDO_WINDOW_MS, activePending, closedRows, highestStage, isAsking, isClosed, isEnding, isMoveBack, isStepBack, liveOrder, needsConfirmation, normalizePendingOutcome, pendingBanner, pendingLine, reachedScreening, removableStages, removeStageLabel, removedStageNote, reasonForStatus, reopenTarget, stageSummary, type CloseReason, type PendingOutcome, type StageTab } from "@/lib/closing";
import RowMenu, { type RowMenuItem } from "./RowMenu";
import NextStepCell from "./NextStepCell";
import EventForm, { type EventFormMode } from "../app/next/EventForm";
import { browserTimeZone, copyText, safeHttpUrl } from "../app/next/planUi";
import { useConfirm } from "@/components/ConfirmDialog";
import Icon from "@/components/ui/Icon";
import { eventMs, feedbackRequest, type AvailabilityWindow, type PlanEvent } from "@/lib/plan";
import { snoozeUntil } from "@/lib/actionCentre";
import {
  STAGE_LABELS, TAB_LABELS, attentionCounts, countedElsewhere, defaultTab, deriveStage, eventsByApplication, isDataToFix, isDueSoon, nextStepFor,
  dueSoonCutoff, primaryAction, reachedTab, referralCard, roleLine, stageEvent, statusForNewRow, statusToMatch, tabCounts, tabForStatus, tabOfStage, visibleTabs,
} from "@/lib/applicationStage";
import {
  STATUSES,
  STATUS_LABELS,
  stagesAfterMove,
  normalizeStatus,
  statusLabel,
  hasProgressed,
  endedWithoutProgress,
  READY_TO_SUBMIT,
  isFollowupDue,
  findDuplicateApplication,
  roleTooLong,
  ROLE_WARN_CHARS,
  pageSlice,
  PAGE_SIZE,
  isReplyOwed,
  replyOwedFirst,
  rowCheck,
  CLOSED_STATUSES,
  isFollowupDueThisWeek,
  type Status,
} from "@/lib/tracker";
import type { TrackerCounts } from "@/lib/trackerCounts";
import CleanupPanel from "./CleanupPanel";
import type { TabKey } from "@/lib/applicationStage";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Textarea from "@/components/ui/Textarea";
import StatusText from "@/components/ui/StatusText";
import { formatDate } from "@/lib/formatDate";

const MAX_JD_CHARS = JD_LIMIT;
const MAX_NOTES = MAX_NOTES_CHARS;

type Application = {
  id: string;
  company_name: string;
  role: string;
  cv_reference: string | null;
  status: Status;
  salary: string | null;
  date_applied: string;
  followup_date: string | null;
  // The list carries no full text (lib/applicationRows toListRow): a flag for
  // the JD and a preview for the notes. The full text is rowText below, read
  // from the detail endpoint when a panel opens.
  has_job_description?: boolean;
  notes_preview?: string;
  notes_more?: boolean;
  notes_not_submitted?: boolean;
  // The stored triage's verdict and reasons (lib/applicationRows listTriageFields).
  triage_verdict?: "apply" | "review" | "skip";
  triage_reasons?: string[];
  source: "tailored" | "manual";
  created_at: string;
  // Stage 4: set (via a JSON-path alias in the list query) when a prep pack
  // is cached on the row; absent until the prep_pack migration is applied.
  prep_generated_at?: string | null;
  // The pre-check's eligibility read stored with the snapshot (JSON-path
  // alias in the list query): "Knockout: <quote>" / "Clear" per row.
  gates?: unknown;
  // The file name of the CV the user uploaded for this row (lib/sentCv; a
  // JSON-path alias in the list query), absent until that migration is applied.
  sent_cv_name?: string | null;
  // Who spoke last and when (migration 20261030120000; absent before it):
  // "them" more than a day ago = "Reply owed" (lib/tracker isReplyOwed).
  last_contact_from?: "me" | "them" | null;
  last_contact_at?: string | null;
  // A referral being sought (migration 20261031120000; absent before it):
  // the open asks show in the "Referral asks" strip (lib/referrals).
  referral?: boolean | null;
  referrer_name?: string | null;
  req_id?: string | null;
  referral_status?: ReferralStatus | null;
  // The format style the CV was made with, or the one picked by hand for a
  // manual row (lib/formatStyles; a JSON-path alias in the list query);
  // absent or null = not recorded.
  format_style?: string | null;
  // The stages this row has been through and why it ended (migration 20261103120000).
  stages_reached?: string[] | null;
  outcome_reason?: string | null;
  // Closing a row (migration 20261104130000; lib/closing): absent before it.
  closed_at?: string | null;
  close_reason?: CloseReason | null;
  lesson?: string | null;
  pending_outcome?: PendingOutcome | null;
  updated_at?: string | null;
};

// What the Applied button stored: the generated sections plus the profile and
// section order they were rendered with, so the document reads the same later.
type TailoredCv = {
  summary?: string;
  skills?: string;
  experience?: string;
  projects?: Record<string, string[]>;
  profile?: Profile | null;
  sectionOrder?: unknown;
  // Newer rows also carry the cover letter as sent and the server-scored
  // keyword analysis of this exact snapshot; older rows have neither.
  coverLetter?: string;
  ats?: unknown;
  gates?: unknown;
  // Since 17 Oct 2026: the format style and the style's own format check as
  // the page last ran it (lib/formatStyles, lib/styleCheck).
  formatStyle?: string;
  styleCheck?: unknown;
};

type StoredAts = {
  keywords: { hits: string[]; misses: string[] };
  required: { hits: string[]; misses: string[] };
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

// A user can write their own row under RLS, so the stored analysis is read
// defensively: only well-formed string lists count, and an empty result is
// treated as "not scored" rather than "0/0".
// The stored eligibility read, bounded to the shape gateLine() reads.
function readStoredGates(value: unknown): GatesSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.read !== "apply" && v.read !== "long_shot" && v.read !== "skip") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const items = Array.isArray(v.items)
    ? v.items
        .filter((x): x is { category: GatesSummary["items"][number]["category"]; verdict: GatesSummary["items"][number]["verdict"]; requirement?: string } =>
          !!x && typeof x === "object" && typeof (x as { category?: unknown }).category === "string" && typeof (x as { verdict?: unknown }).verdict === "string"
        )
        .map((x) => ({ category: x.category, verdict: x.verdict, ...(typeof x.requirement === "string" ? { requirement: x.requirement } : {}) }))
    : [];
  return { read: v.read, hard: n(v.hard), soft: n(v.soft), unknown: n(v.unknown), items };
}

function readStoredAts(value: unknown): StoredAts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lists = (x: unknown) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { hits: stringList(o.hits), misses: stringList(o.misses) };
  };
  const keywords = lists(v.keywords);
  const required = lists(v.required);
  const total = keywords.hits.length + keywords.misses.length + required.hits.length + required.misses.length;
  return total === 0 ? null : { keywords, required };
}

// The CV reference is "First_Last_Company_Role_CV"; the letter downloads
// under the same stem.
function letterFileName(cvReference: string | null): string {
  const stem = (cvReference ?? "").replace(/_?CV$/, "");
  return stem ? `${stem}_CoverLetter` : "CoverLetter";
}

// Does the score predict the outcome? Decided applications with a stored
// score, counted per band — the same weak / borderline / ready bands the
// score shows everywhere (lib/visibilityVerdict) — progressed against
// rejected, with the one honest statistic (the Mann-Whitney AUC) as a plain
// sentence and a fixed verdict label. Counts, never a model's grade; the
// panel says so when the score predicts nothing. The per-application list
// stays behind "As a table".
const VERDICT_LABEL: Record<ScoreVerdict, string> = { too_few: "Too few to judge", no_signal: "No signal", weak: "Weak signal", signal: "Signal" };
const BAND_ROWS: { band: VisibilityBand; label: string; range: string }[] = [
  { band: "ready", label: "Ready", range: "75%+" },
  { band: "borderline", label: "Borderline", range: "50–74%" },
  { band: "weak", label: "Weak", range: "under 50%" },
];
function ScoreOutcomePanel({ s }: { s: ScoreOutcome }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const counts = BAND_ROWS.map((r) => {
    const inBand = s.points.filter((p) => bandFor(p.hits, p.total) === r.band);
    return { ...r, progressed: inBand.filter((p) => p.outcome === "progressed").length, rejected: inBand.filter((p) => p.outcome === "rejected").length };
  });
  const maxCount = Math.max(1, ...counts.flatMap((c) => [c.progressed, c.rejected]));
  const topProgressed = s.topOutcomes.filter((o) => o === "progressed").length;
  const topLine =
    s.points.length < s.topN
      ? null
      : s.topAllRejected
        ? `Your ${s.topN} highest-scoring decided applications were all rejected.`
        : `Of your ${s.topN} highest-scoring decided applications, ${topProgressed} progressed.`;
  const verdictLine =
    s.verdict === "too_few"
      ? `${s.points.length} scored application${s.points.length === 1 ? " has" : "s have"} an outcome${s.auc === null ? ", all of one kind" : ""}; a read needs ${MIN_FOR_VERDICT} with both outcomes.`
      : s.verdict === "no_signal"
        ? "The score does not predict the outcome so far. Treat it as a checklist of the role's terms, not a forecast."
        : s.verdict === "weak"
          ? "A weak relationship at best: higher scores progressed slightly more often."
          : "Higher scores have progressed more often.";
  return (
    <div className="scoreOutcome">
      <p className="fitEvidence scoreOutcome__read" data-score-read>
        {s.auc !== null && (
          <>
            Pick one progressed and one rejected application at random: the progressed one has the higher score{" "}
            <strong>{pct(s.auc)}</strong> of the time. 50% would be a coin flip.{" "}
          </>
        )}
        {verdictLine}
        {topLine ? ` ${topLine}` : ""}
      </p>
      <div className="scoreBands" role="img" aria-label="Decided applications by search-visibility band: progressed against rejected">
        <div className="scoreBands__legend" aria-hidden="true">
          <span><i className="scoreSwatch progressed" /> Progressed ({s.progressed})</span>
          <span><i className="scoreSwatch rejected" /> Rejected ({s.rejected})</span>
        </div>
        {counts.map((c) => (
          <div key={c.band} className="scoreBand" data-score-band={c.band}>
            <div className="scoreBand__label">
              <strong>{c.label}</strong>
              <span>{c.range}</span>
            </div>
            <div className="scoreBand__bars">
              {(["progressed", "rejected"] as const).map((o) => {
                const n = c[o];
                return (
                  <div key={o} className={"scoreBar " + o} title={`${n} ${o} with a ${c.label.toLowerCase()} score`}>
                    <div className="scoreBar__fill" style={{ width: `${Math.max(n ? 4 : 0, Math.round((n / maxCount) * 100))}%` }} />
                    <span className="scoreBar__n">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <ul className="scoreOutcome__notes">
        <li>
          Mean score: rejected <strong>{pct(s.meanRejected)}</strong> across {s.rejected}; progressed <strong>{pct(s.meanProgressed)}</strong> across {s.progressed}.
        </li>
        {s.unscoredDecided > 0 && (
          <li>
            {s.unscoredDecided} decided application{s.unscoredDecided === 1 ? " has" : "s have"} no stored score and {s.unscoredDecided === 1 ? "is" : "are"} not counted here.
          </li>
        )}
        {s.pendingScored > 0 && <li>{s.pendingScored} scored application{s.pendingScored === 1 ? " is" : "s are"} still open.</li>}
      </ul>
      <details className="scoreTable">
        <summary>As a table</summary>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Score</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {s.points.map((p, i) => (
              <tr key={i} data-score-point={p.outcome}>
                <td>{p.company}</td>
                <td>{p.role}</td>
                <td>
                  {p.hits}/{p.total} ({Math.round(p.score * 100)}%)
                </td>
                <td>{p.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// The "What's working" headline as tiles: the rate, what is open, what the
// bands can use, and what the data lacks — each a figure with its own
// label, instead of one paragraph of numbers.
const LANE_LABEL: Record<Seniority, string> = { junior: "Junior / graduate titles", mid: "Mid-level titles", senior: "Senior titles" };
type Lane = { level: Seniority; applied: number; decided: number; progressed: number; rate: number | null };

// Progression by the LEVEL the role title reads as (lib/insights seniorityOf,
// over every submitted row — hand-added ones too): the owner's 448 rows on
// 7 Oct read 351 mid-level with 1 progressed against 88 junior with 5, and
// nothing else in the tracker separated outcomes at all. A rate shows only
// from MIN_DECIDED decided applications, as every other bucket.
export function laneStats(rows: { role: string; status: string }[]): Lane[] {
  return (["junior", "mid", "senior"] as Seniority[]).map((level) => {
    const lane = rows.filter((r) => { const s = normalizeStatus(r.status); return s !== "saved" && s !== "withdrawn" && seniorityOf(r.role) === level; });
    const progressed = lane.filter((r) => hasProgressed(r.status)).length;
    const decided = progressed + lane.filter((r) => endedWithoutProgress(r.status)).length;
    return { level, applied: lane.length, decided, progressed, rate: decided >= MIN_DECIDED ? progressed / decided : null };
  });
}

function LaneTile({ lanes }: { lanes: Lane[] }) {
  const rated = lanes.filter((l) => l.rate !== null);
  if (rated.length === 0) return null;
  const best = [...rated].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  return (
    <div className="statTile" data-stat="lane" data-lane-best={best.level}>
      <span className="statTile__value">{pct(best.rate ?? 0)}</span>
      <span className="statTile__label">{LANE_LABEL[best.level]} progress most</span>
      <span className="statTile__sub">
        {lanes
          .map((l) => `${LANE_LABEL[l.level].replace(" titles", "")}: ${l.rate === null ? `${l.decided} of ${MIN_DECIDED} decided needed` : `${pct(l.rate)} of ${l.decided} decided`} (${l.applied} applied)`)
          .join(" · ")}
        . Read off each row&apos;s title.
      </span>
    </div>
  );
}

// Progression by format style (lib/insights byStyle): the question the
// CareerSet trial asks. A style's rate shows only from MIN_DECIDED decided
// applications; rows with no recorded style are counted, never compared.
function StyleTile({ insights }: { insights: Insights }) {
  if (insights.byStyle.length === 0) return null;
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const rated = insights.byStyle.filter((b) => b.rate !== null);
  const best = rated.length > 0 ? [...rated].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0] : null;
  return (
    <div className="statTile" data-stat="style" data-style-best={best ? best.key : "none"}>
      <span className="statTile__value">{best ? pct(best.rate ?? 0) : "—"}</span>
      <span className="statTile__label">
        {rated.length >= 2 ? `${best!.label} style progresses most` : best ? `${best.label} style, so far` : "Format style: too few to judge"}
      </span>
      <span className="statTile__sub">
        {insights.byStyle
          .map((b) => `${b.label}: ${b.rate === null ? `${b.progressed + b.rejected} of ${MIN_DECIDED} decided needed` : `${pct(b.rate)} of ${b.progressed + b.rejected} decided`} (${b.n} applied)`)
          .join(" · ")}
        {insights.styleNotRecorded > 0 ? ` · ${insights.styleNotRecorded} with no recorded style, not compared` : ""}.
      </span>
    </div>
  );
}

function InsightsSummary({ insights, withoutJd, withoutCv, lanes, showStyle }: { insights: Insights; withoutJd: number; withoutCv: number; lanes: Lane[]; showStyle: boolean }) {
  const open = insights.counted - insights.decided;
  const unscored = insights.counted - insights.scored;
  return (
    <div className="statGrid" data-insights-summary>
      <LaneTile lanes={lanes} />
      {showStyle && <StyleTile insights={insights} />}
      <div className="statTile" data-stat="rate">
        <span className="statTile__value">{insights.overallRate === null ? "—" : `${Math.round(insights.overallRate * 100)}%`}</span>
        <span className="statTile__label">Progressed past the screen</span>
        <span className="statTile__sub">
          {insights.overallRate === null
            ? `${insights.decided} of the ${MIN_DECIDED} decided applications the rate needs`
            : `${insights.progressed} of ${insights.decided} decided`}
        </span>
      </div>
      <div className="statTile" data-stat="open">
        <span className="statTile__value">{open}</span>
        <span className="statTile__label">Still open</span>
        <span className="statTile__sub">
          {insights.rejected} rejected · {insights.progressed} progressed
          {insights.readyToSubmit > 0 ? ` · ${insights.readyToSubmit} ready to submit, not counted` : ""}
        </span>
      </div>
      <div className="statTile" data-stat="scored">
        <span className="statTile__value">
          {insights.scored}
          <small> / {insights.counted}</small>
        </span>
        <span className="statTile__label">With a search-visibility score</span>
        <span className="statTile__sub">
          {insights.scored === 0
            ? "kept from the next tailored run you save"
            : `${insights.gated > 0 ? `${insights.gated} with an eligibility read` : "no eligibility reads yet"}${unscored > 0 ? `; ${unscored} count in the rate only` : ""}`}
        </span>
      </div>
      {withoutJd + withoutCv > 0 && (
        <div className="statTile" data-stat="gaps">
          <span className="statTile__value">{withoutJd > 0 ? withoutJd : withoutCv}</span>
          <span className="statTile__label">{withoutJd > 0 ? "Without a job description" : "Added by hand, no CV file"}</span>
          <span className="statTile__sub" data-insights-gaps>
            {withoutJd > 0 && `${withoutJd} application${withoutJd === 1 ? " has" : "s have"} no job description`}
            {withoutJd > 0 && withoutCv > 0 && "; "}
            {withoutCv > 0 && `${withoutCv} added by hand ${withoutCv === 1 ? "has" : "have"} no CV file`}. Nothing can be read from them — add them from the
            row&apos;s JD and CV cells.
          </span>
        </div>
      )}
    </div>
  );
}

// One "What's working" group: a bar per bucket, filled to its progression
// rate. A bucket with too few decided applications shows no rate — a 1-of-1
// "100%" would mislead.
function InsightGroup({ title, buckets }: { title: string; buckets: Bucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div className="atsGroup">
      <div className="atsGroupLabel recs">{title}</div>
      <div className="fitBars">
        {buckets.map((b) => {
          const decided = b.progressed + b.rejected;
          const right =
            b.rate === null
              ? decided === 0
                ? "none decided yet"
                : `too few decided (${decided})`
              : `${Math.round(b.rate * 100)}% progressed (${b.progressed} of ${decided})`;
          return (
            <div key={b.key} data-insight-bucket={b.key}>
              <div className="fitBarTop">
                <span>
                  {b.label} · {b.n} application{b.n === 1 ? "" : "s"}
                </span>
                <span>{right}</span>
              </div>
              <div className="fitBarTrack">
                <div className="fitBarFill" style={{ width: `${Math.round((b.rate ?? 0) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cells that edit in place. Tab walks them in this order.
type TextField = "company_name" | "role" | "salary" | "date_applied" | "followup_date";
const CELL_ORDER: TextField[] = ["company_name", "role", "salary", "date_applied", "followup_date"];
const DATE_FIELDS: ReadonlySet<string> = new Set(["date_applied", "followup_date"]);
const CELL_LABELS: Record<TextField, string> = {
  company_name: "Company name",
  role: "Role",
  salary: "Salary",
  date_applied: "Date applied",
  followup_date: "Follow-up date",
};

type SortKey = TextField | "status";
type SortDir = "asc" | "desc";
type PanelKind = "cv" | "jd" | "notes" | "edit";

const COLUMNS: { key: SortKey | PanelKind | "gate"; label: string; sortable: boolean }[] = [
  { key: "company_name", label: "Company Name", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "cv", label: "CV", sortable: false },
  { key: "jd", label: "JD", sortable: false },
  { key: "gate", label: "Gate", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "salary", label: "Salary", sortable: true },
  { key: "date_applied", label: "Applied on", sortable: true },
  { key: "followup_date", label: "Follow-up", sortable: true },
  { key: "notes", label: "Notes", sortable: false },
];
const COL_COUNT = COLUMNS.length + 1; // + the delete column

type NewRow = {
  company_name: string;
  role: string;
  status: Status;
  salary: string;
  date_applied: string;
  followup_date: string;
  // The format style of the CV sent (lib/formatStyles); "unknown" = not recorded.
  formatStyle: RowStyle;
};
const ROW_STYLES: readonly RowStyle[] = ["unknown", "ukji", "careerset"];

function todayLocal(): string {
  return localIsoDate(new Date());
}

// A follow-up is "due" while the application is still moving — a date in the
// past on a Rejected row is history, not a task, and an unsent row has
// nothing to follow up (lib/tracker).
function isDue(row: Application): boolean {
  return isFollowupDue(row, todayLocal());
}

// Data colour only: outcomes get colour, in-flight statuses stay neutral.
const STATUS_TONES: Record<Status, string> = {
  saved: "muted",
  applied: "neutral",
  screening: "neutral",
  interview: "neutral",
  assessment: "neutral",
  offer: "success",
  accepted: "success",
  rejected: "danger",
  withdrawn: "muted",
  ghosted: "muted",
};

// Period filter on date_applied, in the user's own timezone. Calendar periods:
// "week" is Monday–Sunday of the current week, "month" the current month.
type Period = "all" | "today" | "week" | "month";
const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

function periodBounds(period: Period): { from: string; to: string } | null {
  if (period === "all") return null;
  const now = new Date();
  if (period === "today") {
    const today = localIsoDate(now);
    return { from: today, to: today };
  }
  if (period === "week") {
    const sinceMonday = (now.getDay() + 6) % 7;
    const monday = addDays(now, -sinceMonday);
    return { from: localIsoDate(monday), to: localIsoDate(addDays(monday, 6)) };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: localIsoDate(first), to: localIsoDate(last) };
}


type ApiResult = { ok: boolean; status: number; data: { error?: string } & Record<string, unknown> };

// Every write bumps this, so a full list that was read before a write landed is
// known to be older than the screen and is read again (the first paint shows one
// page, and the full list arrives a moment later).
let mutationCount = 0;
// The first paint: the open tab's newest rows, before the full list arrives.
const FIRST_PAGE_ROWS = 50;

async function api(method: string, body?: unknown, query = ""): Promise<ApiResult> {
  if (method !== "GET") mutationCount++;
  try {
    const res = await fetch(`/api/applications${query}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult["data"];
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Connection error. Please try again." } };
  }
}

const SESSION_EXPIRED = "Your session has expired — sign in again to see your applications.";

const EMPTY_LIST_FIELDS = { cv_reference: null, salary: null, followup_date: null };

// A row's full text from the detail read. undefined = not known yet, which is
// different from null = none: notes that are not known yet can never be saved
// back, or the preview would overwrite them.
type RowText = { job_description?: string | null; notes?: string | null; gates?: unknown };

// The full list (?all=1, the list exactly as it always was); `query` asks for one page instead.
async function fetchApplications(query = "?all=1"): Promise<{ rows: Application[] } | { error: string; expired?: boolean }> {
  const { ok, status, data } = await api("GET", undefined, query);
  if (status === 401) return { error: SESSION_EXPIRED, expired: true };
  if (!ok) return { error: data.error || "Could not load your applications." };
  // The list leaves out null keys to stay small; the sheet's required fields
  // read as null again here.
  // The API answers in its own spelling (lib/tracker API_STATUS); this page works in keys.
  const rows = ((data.applications as Application[] | undefined) ?? []).map((r) => ({ ...r, status: normalizeStatus(r.status) ?? r.status }));
  return { rows: rows.map((r) => ({ ...EMPTY_LIST_FIELDS, ...r })) };
}

// Salary is free text ("£65,000", "$120k–$140k", "12 LPA"); sort on the first
// number in it so "£120,000" no longer lands before "£65,000".
function salaryNumber(value: string | null): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

function newRowError(d: NewRow): string {
  if (!d.company_name.trim()) return "Company name is required.";
  if (!d.role.trim()) return "Role is required.";
  if (!d.date_applied) return "Enter the date applied.";
  if (d.followup_date && d.followup_date < d.date_applied) {
    return "Follow-up date can't be earlier than the date applied.";
  }
  return "";
}

export default function ApplicationsPage() {
  const [rows, setRows] = useState<Application[]>([]);
  // "What's working": progression by score band, eligibility read, role and
  // company, aggregated server-side over every row. Collapsed by default;
  // the headline rate is always visible.
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsNote, setInsightsNote] = useState("");
  // Decided applications against their stored score (lib/insights scoreOutcome).
  const [scoreOutcome, setScoreOutcome] = useState<ScoreOutcome | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const rowsRef = useRef<Application[]>([]);
  const autoCloseNote = useRef<string | null>(null);
  rowsRef.current = rows;
  const [loaded, setLoaded] = useState(false);
  // The full list is in (search, the sheet, Wins and the tiles need every row). Until
  // then the page shows one page per tab and the server's counts.
  const [fullLoaded, setFullLoaded] = useState(false);
  const fullLoadedRef = useRef(false);
  const [serverCounts, setServerCounts] = useState<(TrackerCounts & { today?: string }) | null>(null);
  const [pageError, setPageError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  // Fallbacks for CV snapshots that were stored without a profile / order.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sectionOrder, setSectionOrder] = useState<unknown>(null);

  // The open tab; null until the user picks one, when lib/applicationStage defaultTab decides.
  const [tab, setTab] = useState<TabChoice | null>(null);
  // An attention card filtering across the tabs.
  // "reopen" is the notice's filter (any row a sweep's question is waiting on), not one of the strip's cards.
  const [attention, setAttention] = useState<AttentionFilter | "reopen" | null>(null);
  // The open events behind the stages and the Next step column (/api/actions).
  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [eventsSettled, setEventsSettled] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventForm, setEventForm] = useState<EventFormMode | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => Promise<void> | void } | null>(null);
  // Move to Closed: the only way a row that reached screening ends (lib/closing).
  const [closing, setClosing] = useState<{ row: Application; reason: CloseReason; date: string } | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [wins, setWins] = useState(false);
  // A closed row's events, for how far it got: the open list leaves them out once a row has ended.
  const [closedEvents, setClosedEvents] = useState<ReadonlyMap<string, PlanEvent[]>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listSort, setListSort] = useState<"next" | "company" | "contact" | "applied">("next");
  // Whether the open tab is one the user asked for. The default is pinned once it is known,
  // so moving the last row out of a tab never jumps the page to another one.
  const [tabPicked, setTabPicked] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);
  const [tz] = useState(browserTimeZone);
  // What countdowns and "due soon" read. Moves each minute; the sheet's order does not (see now).
  const [clock, setClock] = useState(() => Date.now());
  const [confirm, confirmDialog] = useConfirm();
  // On a stage tab: the dated table, or the full sheet with its panels.
  const [spreadsheet, setSpreadsheet] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  // Opening a row in the sheet searches for it, so it is on the sheet's first page.
  const [stageRefresh, setStageRefresh] = useState(0);
  const [periodFilter, setPeriodFilter] = useState<Period>("all");
  // The format-style tag, filter, picker and tile are the owner's while the
  // two styles are compared (profiles.is_unlimited, read fail-soft).
  const [isOwner, setIsOwner] = useState(false);
  // The tracker clean-up's dry run (owner only, lib/trackerCleanup).
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [styleFilter, setStyleFilter] = useState<"all" | RowStyle>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date_applied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // The open cell. Refs mirror the state so the blur that follows an
  // Enter/Tab commit sees the cell is already closed and doesn't commit twice.
  const [editing, setEditing] = useState<{ id: string; field: TextField } | null>(null);
  const editingRef = useRef<{ id: string; field: TextField } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const cellDraftRef = useRef("");
  const [cellError, setCellError] = useState("");

  const [panel, setPanel] = useState<{ id: string; kind: PanelKind } | null>(null);
  const [cvCache, setCvCache] = useState<Record<string, TailoredCv | null>>({});
  // The CV file uploaded for a row (lib/sentCv), read with the snapshot.
  const [sentCache, setSentCache] = useState<Record<string, SentCvInfo | null>>({});
  // Per row: a load in flight and the error it ended in, so the View CV
  // button can say "Loading…", a failure never masks another row's panel,
  // and closing + reopening during a load doesn't fire a second GET.
  const [cvLoading, setCvLoading] = useState<Record<string, boolean>>({});
  const cvLoadingRef = useRef<Record<string, boolean>>({});
  const [cvErrors, setCvErrors] = useState<Record<string, string>>({});
  // The page of the sheet being shown, keyed by the filter/sort state it was
  // chosen under: a filter change silently returns to page 1 without an
  // effect (lib/tracker pageSlice clamps anything out of range).
  const [paging, setPaging] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  // The "move rows whose notes say they weren't submitted" offer: null =
  // not shown, "offer" = the one-line notice, "review" = the list + confirm.
  const [bulkReady, setBulkReady] = useState<"offer" | "review" | "dismissed" | "moving">("offer");
  const [jdDraft, setJdDraft] = useState("");
  const [jdEditing, setJdEditing] = useState(false);
  // Set only once the user types, so the box otherwise shows the full notes the
  // moment they arrive, whichever row is open by then.
  const [notesDraft, setNotesDraft] = useState<{ id: string; text: string } | null>(null);
  const [rowText, setRowText] = useState<Record<string, RowText>>({});
  const [textLoading, setTextLoading] = useState<Record<string, boolean>>({});
  const textLoadingRef = useRef<Record<string, boolean>>({});
  const [textErrors, setTextErrors] = useState<Record<string, string>>({});
  // The moment "Reply owed" is judged against, fixed for the page's life so
  // the order doesn't shift under the user while they work.
  const [now] = useState(() => Date.now());
  const [panelError, setPanelError] = useState("");

  const [newRow, setNewRow] = useState<NewRow | null>(null);
  const [newRowErr, setNewRowErr] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // One flag per kind of action, so deleting a row doesn't relabel an open
  // panel's Save button "Saving…".
  const [savingNew, setSavingNew] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The row whose referral step is saving (the strip disables its links).
  const [referralBusy, setReferralBusy] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState("");
  // A caution that isn't a failure (e.g. saved without the CV snapshot).
  const [notice, setNotice] = useState("");
  const [flash, setFlash] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Follow-ups due" computed filter — combines with, not replaces, status/period.
  // Screening or Interview rows with no JD or no CV (lib/tracker missingAttachments).
  // The row whose "Run check" is running.
  const [checkingId, setCheckingId] = useState<string | null>(null);
  // Free-text search over company, role and date applied (lib/trackerSearch —
  // the same matcher the CSV export applies, so the file matches the screen).
  const [query, setQuery] = useState("");
  const searchTerm = query.trim();
  // The row that just saved, for a brief success flash on its cells.
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const rowFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The full list, and in parallel the counts and the open tab's first page, which
    // paint first. A write made while the full list was on its way makes it stale:
    // it is read again (twice at most).
    const loadFull = async (tries = 0): Promise<void> => {
      const seq = mutationCount;
      const result = await fetchApplications();
      if (cancelled) return;
      if ("error" in result) {
        setPageError(result.error);
        if (result.expired) setSessionExpired(true);
        setLoaded(true);
        return;
      }
      if (mutationCount !== seq && tries < 2) return loadFull(tries + 1);
      fullLoadedRef.current = true;
      setRows(result.rows);
      setFullLoaded(true);
      setLoaded(true);
    };
    void loadFull();
    fetch(`/api/applications/counts?today=${todayLocal()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data: (TrackerCounts & { today?: string }) | null) => {
        if (cancelled || !data?.counts) return;
        setServerCounts(data);
        if (fullLoadedRef.current) return;
        const tabFirst = tabForStatus(new URLSearchParams(window.location.search).get("status")) ?? defaultTab(data.counts);
        const page = await fetchApplications(`?stage=${tabFirst}&limit=${FIRST_PAGE_ROWS}`);
        if (cancelled || fullLoadedRef.current || "error" in page) return;
        setRows(page.rows);
        setLoaded(true);
      })
      .catch(() => {
        /* the full list paints instead */
      });
    getProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
    getUsage().then((u) => {
      if (!cancelled) setIsOwner(!!u?.unlimited);
    });
    fetch("/api/applications/insights")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.insights) return;
        setInsights(data.insights as Insights);
        setInsightsNote(typeof data.scoredNote === "string" ? data.scoredNote : "");
        if (data.scoreOutcome && Array.isArray(data.scoreOutcome.points)) setScoreOutcome(data.scoreOutcome as ScoreOutcome);
      })
      .catch(() => {
        /* the card simply doesn't show */
      });
    // A link from the pipeline opens that stage's tab (lib/plan buildFunnel's nodes).
    const linked = tabForStatus(new URLSearchParams(window.location.search).get("status"));
    if (linked) {
      setTab(linked);
      setTabPicked(true);
    }
    fetch("/api/section-order")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.order) setSectionOrder(data.order);
      })
      .catch(() => {
        /* default order */
      });
    return () => {
      cancelled = true;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (rowFlashTimer.current) clearTimeout(rowFlashTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // The open events: what each row is waiting on. A failed read leaves the stored status
  // showing, and says so. Read again after anything that moves a row or an event.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/actions")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setEventsError(res.status === 401 ? "" : "Couldn't load your next steps, so stages show the stored status.");
          return;
        }
        setEvents((body.events ?? []) as PlanEvent[]);
        setWindows((body.availability ?? []) as AvailabilityWindow[]);
        setEventsError("");
      })
      .catch(() => {
        if (!cancelled) setEventsError("Couldn't load your next steps, so stages show the stored status.");
      })
      .finally(() => {
        if (!cancelled) setEventsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stageRefresh]);

  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filtersRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filtersOpen]);

  function showFlash(message: string) {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 3000);
  }

  function showToast(next: { message: string; undo?: () => Promise<void> | void }, ms = 8000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  function flashRow(id: string) {
    setFlashRowId(id);
    if (rowFlashTimer.current) clearTimeout(rowFlashTimer.current);
    rowFlashTimer.current = setTimeout(() => setFlashRowId(null), 700);
  }

  const bounds = periodBounds(periodFilter);

  // The overview is always over ALL rows, so it stays stable while filters narrow the
  // table. Tabs count the derived stage: every row once, so they add up to the total.
  const byApp = useMemo(() => eventsByApplication(events), [events]);
  // Every event, for a closed row's progress chip: fetched with everything else on
  // first load (it used to wait for the rows, and started ~4 s in on 1,127 of them).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/events")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setClosedEvents(eventsByApplication((body.events ?? []) as PlanEvent[]));
      })
      // The chip falls back to the stage reached.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stageRefresh]);
  // Until the full list is in, the tabs count from the server (every row); after, from the rows.
  const counts = useMemo(
    () => (!fullLoaded && serverCounts ? serverCounts.counts : tabCounts(rows, byApp)),
    [fullLoaded, serverCounts, rows, byApp]
  );
  const attentionAll = useMemo(() => attentionCounts(rows, events, todayLocal(), clock, tz), [rows, events, clock, tz]);
  // The follow-ups tile is this week's, from the server until the rows can count it.
  const attentionNumbers = useMemo(
    () => (!fullLoaded && serverCounts ? { ...attentionAll, followups: serverCounts.followups_due_this_week } : attentionAll),
    [fullLoaded, serverCounts, attentionAll]
  );
  // A tab opened before the full list is in gets its own first page.
  useEffect(() => {
    if (fullLoaded || !serverCounts || !loaded || tab === null || tab === "all") return;
    const want = Math.min(serverCounts.counts[tab as TabKey] ?? 0, FIRST_PAGE_ROWS);
    const have = rowsRef.current.filter((r) => tabOfStage(deriveStage(r.status, byApp.get(r.id))) === tab).length;
    if (have >= want) return;
    let cancelled = false;
    fetchApplications(`?stage=${tab}&limit=${FIRST_PAGE_ROWS}`).then((page) => {
      if (cancelled || fullLoadedRef.current || "error" in page) return;
      setRows((rs) => {
        const known = new Set(rs.map((r) => r.id));
        return [...rs, ...page.rows.filter((r) => !known.has(r.id))];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, fullLoaded, serverCounts, loaded, byApp]);
  const referral = useMemo(() => referralCard(rows), [rows]);
  const referralIds = useMemo(() => new Set(referralAsks(rows).map((r) => r.id)), [rows]);
  const tabNow: TabChoice = tab ?? defaultTab(counts);
  useEffect(() => {
    // Pins the default once, when the rows and events are known.
    if (tab === null && loaded && eventsSettled) setTab(defaultTab(counts));
  }, [tab, loaded, eventsSettled, counts]);
  const sheetMode = spreadsheet || newRow !== null;

  const visible = useMemo(() => {
    // An attention card filters across the tabs; otherwise the tab decides.
    const inView = (r: Application): boolean => {
      if (attention === "due") return (byApp.get(r.id) ?? []).some((e) => isDueSoon(e, clock, tz));
      if (attention === "followups") return isFollowupDueThisWeek(r, todayLocal());
      if (attention === "fix") return isDataToFix(r);
      if (attention === "referrals") return referralIds.has(r.id);
      if (attention === "reopen") return isAsking(r);
      if (searchTerm) return true;
      if (tabNow === "all") return true;
      if (tabOfStage(deriveStage(r.status, byApp.get(r.id))) === tabNow) return true;
      return includePast && !sheetMode && reachedTab(r.stages_reached, tabNow);
    };
    const stageTab = !attention && !searchTerm && !sheetMode && (tabNow === "screening" || tabNow === "interview");
    const filtered = rows.filter(
      (r) =>
        inView(r) &&
        // A closed row is in the Closed section under this table, never in Live.
        !(stageTab && isClosed(r)) &&
        (styleFilter === "all" || rowStyle(r.format_style) === styleFilter) &&
        (!bounds || (r.date_applied >= bounds.from && r.date_applied <= bounds.to)) &&
        matchesSearch(r, searchTerm)
    );
    // The list reads by what is soonest; the spreadsheet by its own columns.
    if (!sheetMode) {
      const soonest = (r: Application) => Math.min(...(byApp.get(r.id) ?? []).map((e) => eventMs(e) ?? Infinity), Infinity);
      const newest = (a: Application, b: Application) => b.date_applied.localeCompare(a.date_applied) || b.created_at.localeCompare(a.created_at);
      const list = [...filtered].sort((a, b) => {
        if (listSort === "company") return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" }) || newest(a, b);
        if (listSort === "contact") return (b.last_contact_at ?? "").localeCompare(a.last_contact_at ?? "") || newest(a, b);
        if (listSort === "applied") return newest(a, b);
        if (stageTab) return liveOrder(a, b, soonest) || newest(a, b);
        return soonest(a) - soonest(b) || newest(a, b);
      });
      // The Live section's order is its own: next event, pending outcome, last update.
      return stageTab || attention === "due" || listSort !== "next" ? list : replyOwedFirst(list, now);
    }
    // Empty values always sort last, whichever direction is active. Status
    // sorts in funnel order (Applied → … → Withdrawn), salary by its number.
    const compare = (a: Application, b: Application): number => {
      if (sortKey === "status") return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
      if (sortKey === "salary") {
        const an = salaryNumber(a.salary);
        const bn = salaryNumber(b.salary);
        if (an !== null && bn !== null && an !== bn) return an - bn;
      }
      return (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "", undefined, { sensitivity: "base" });
    };
    // "Empty" for the salary sort means no parsable figure — "Not Specified"
    // and "Voluntary (unpaid)" sort with the blanks, not alphabetically
    // in between £45k and £90k.
    const isEmpty = (r: Application) =>
      sortKey === "salary" ? salaryNumber(r.salary) === null : !(r[sortKey] ?? "");
    const sorted = [...filtered].sort((a, b) => {
      const aEmpty = isEmpty(a);
      const bEmpty = isEmpty(b);
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const cmp = compare(a, b);
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return b.created_at.localeCompare(a.created_at);
    });
    // A reply owed outranks any sort: those rows come first, in sort order.
    return replyOwedFirst(sorted, now);
  }, [rows, tabNow, attention, listSort, byApp, referralIds, clock, tz, styleFilter, bounds?.from, bounds?.to, sortKey, sortDir, searchTerm, now, includePast, sheetMode]);

  // Only PAGE_SIZE rows are painted at a time; search, filters, counts and the
  // export cover the whole set. A different filter/sort state starts at page 1.
  const pageKey = [tabNow, attention ?? "", listSort, styleFilter, periodFilter, sortKey, sortDir, sheetMode ? "sheet" : "list", searchTerm].join("\u0000");
  const sheet = pageSlice(visible, paging.key === pageKey ? paging.page : 1);
  const pageRows = sheet.items;
  function goToPage(page: number) {
    setPaging({ key: pageKey, page });
    setPanel(null);
  }

  // Rows the insights cannot use: no job description, or (added by hand) no
  // CV file. Shown beside the rate so the figures never look more complete
  // than the data.
  const withoutJd = useMemo(() => rows.filter((r) => isSubmittedRow(r) && !r.has_job_description).length, [rows]);
  const withoutCv = useMemo(() => rows.filter((r) => isSubmittedRow(r) && r.source === "manual" && !r.sent_cv_name).length, [rows]);

  // Progression by the level the title reads as, over every row.
  const lanes = useMemo(() => laneStats(rows), [rows]);

  // Rows marked Applied whose notes say they were never sent (lib/tracker).
  const notSubmitted = useMemo(() => rows.filter((r) => r.status === "applied" && r.notes_not_submitted), [rows]);

  // Live warnings on the add-row form: a row this company + role already has,
  // and a role long enough to be a title plus extras.
  const newRowDuplicate = newRow ? findDuplicateApplication(rows, newRow) : null;
  const newRowRoleLong = !!newRow && roleTooLong(newRow.role);

  // The CV shown in the open panel. Memoised so CvPreview's React.memo holds.
  const panelCv = panel?.kind === "cv" ? cvCache[panel.id] : undefined;
  // A snapshot with no section at all (a hand-added row's style tag, lib/formatStyles)
  // is not a CV: the panel shows what it does for a row without one.
  const panelCvData = useMemo(
    () =>
      panelCv && (panelCv.summary !== undefined || panelCv.skills !== undefined || panelCv.experience !== undefined || panelCv.projects !== undefined)
        ? {
            summary: panelCv.summary,
            skills: panelCv.skills,
            experience: panelCv.experience,
            projects: panelCv.projects,
          }
        : null,
    [panelCv]
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(DATE_FIELDS.has(key) ? "desc" : "asc");
  }

  // The format-style tag of a hand-added row (lib/formatStyles): applied
  // locally, then PUT as `formatStyle`; put back if the save fails.
  async function changeStyle(row: Application, value: string) {
    const next = isFormatStyleId(value) ? value : null;
    const previous = row.format_style ?? null;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, format_style: next } : r)));
    const { ok, status, data } = await api("PUT", { id: row.id, formatStyle: next });
    if (!ok) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, format_style: previous } : r)));
      if (status === 401) setSessionExpired(true);
      setActionError(status === 401 ? SESSION_EXPIRED : data.error || "Could not save that change.");
      return;
    }
    setCvCache((c) => (c[row.id] ? { ...c, [row.id]: { ...c[row.id]!, formatStyle: next ?? undefined } } : c));
    flashRow(row.id);
  }

  // Apply locally first, then PUT one field; put it back if the save fails.
  // Only the keys in this patch are reverted — another cell's edit that
  // succeeded in the meantime must not be undone with it.
  // Returns the error message, or null on success.
  // `body` rides in the request without touching the row: full text the row no
  // longer holds, and the triage profile.
  async function patchRow(id: string, patch: Partial<Application>, body: Record<string, unknown> = {}): Promise<string | null> {
    const previous = rowsRef.current.find((r) => r.id === id);
    if (!previous) return "Application not found";
    const undo: Partial<Application> = {};
    for (const key of Object.keys(patch) as (keyof Application)[]) {
      (undo as Record<string, unknown>)[key] = previous[key];
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { ok, status, data } = await api("PUT", { id, ...patch, ...body });
    // Moved elsewhere since this page last read it: nothing landed, and this page catches up.
    if (status === 202) {
      const stored = normalizeStatus(data.status);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...undo, ...(stored ? { status: stored } : {}), pending_outcome: normalizePendingOutcome(data.pending_outcome) } : r)));
      return "This application changed since this page loaded, so nothing was saved. Its row now shows where it stands.";
    }
    if (!ok) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...undo } : r)));
      if (status === 401) {
        setSessionExpired(true);
        return SESSION_EXPIRED;
      }
      return data.error || "Could not save that change.";
    }
    // Closing a row (Rejected / Withdrawn) cleared its follow-up on the
    // server and wrote the old date into the notes; mirror both.
    const autoClose = data.autoClose as { message?: unknown } | undefined;
    autoCloseNote.current = typeof autoClose?.message === "string" ? autoClose.message : null;
    if (typeof data.warning === "string") setNotice(data.warning);
    // A Reopen took the words of the report it answered into the notes.
    if (typeof data.reportNotes === "string") {
      const notes = data.reportNotes;
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...notesListFields(notes) } : r)));
      rememberText(id, { notes });
      setNotesDraft((d) => (d?.id === id ? { id, text: `${d.text}\n${notes.split("\n").at(-1)}` } : d));
    }
    const cleared = data.followupCleared as { followup_date: null; notes: string | null } | undefined;
    if (cleared) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, followup_date: null, ...notesListFields(cleared.notes) } : r)));
      rememberText(id, { notes: cleared.notes });
      showFlash("Follow-up cleared — the date is kept in the notes.");
    }
    // A JD edit re-triaged the row on the server (gates.triage); mirror it. With
    // no answer (the snapshot column is missing) the old triage no longer
    // describes this JD, and the panel reads the new text live instead.
    if ("gates" in data) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, gates: data.gates, ...listTriageFields(data.gates) } : r)));
    if ("job_description" in body) rememberText(id, { job_description: body.job_description as string | null, gates: data.gates });
    if ("notes" in body) rememberText(id, { notes: body.notes as string | null });
    flashRow(id);
    return null;
  }

  // Moves every row the "not submitted" review listed to Ready to submit,
  // one PUT each, then reloads the sheet. Each failure is reported once.
  async function moveNotSubmitted() {
    setBulkReady("moving");
    const failures: string[] = [];
    for (const row of notSubmitted) {
      // Reviewed and confirmed: the user's word, should a row have a screening on record.
      const message = await patchRow(row.id, { status: READY_TO_SUBMIT }, { confirmed_move_back: true });
      if (message) failures.push(`${row.company_name}: ${message}`);
    }
    const result = await fetchApplications();
    if ("rows" in result) setRows(result.rows);
    setBulkReady("dismissed");
    if (failures.length) setActionError(failures.join(" · "));
    else showFlash(`Moved ${notSubmitted.length} row${notSubmitted.length === 1 ? "" : "s"} to Ready to submit.`);
  }

  // ── Cell editing ──────────────────────────────────────────────────────────

  function openCell(row: Application, field: TextField) {
    const value = row[field] ?? "";
    editingRef.current = { id: row.id, field };
    cellDraftRef.current = value;
    setEditing({ id: row.id, field });
    setCellDraft(value);
    setCellError("");
  }

  function cancelCell() {
    editingRef.current = null;
    setEditing(null);
    setCellError("");
  }

  function cellValidationError(row: Application, field: TextField, value: string): string {
    if (field === "company_name" && !value) return "Company name is required.";
    if (field === "role" && !value) return "Role is required.";
    if (field === "date_applied" && !value) return "Enter the date applied.";
    const dateApplied = field === "date_applied" ? value : row.date_applied;
    const followup = field === "followup_date" ? value : (row.followup_date ?? "");
    if (followup && dateApplied && followup < dateApplied) {
      return "Follow-up date can't be earlier than the date applied.";
    }
    return "";
  }

  // Commit the open cell, optionally moving straight on to another cell in
  // the same row (Tab / Shift+Tab). A validation error keeps the cell open.
  async function commitCell(next: TextField | null = null) {
    const cur = editingRef.current;
    if (!cur) return;
    const row = rowsRef.current.find((r) => r.id === cur.id);
    if (!row) {
      cancelCell();
      return;
    }
    const value = cellDraftRef.current.trim();
    const err = cellValidationError(row, cur.field, value);
    if (err) {
      setCellError(err);
      return;
    }
    editingRef.current = null;
    if (next) openCell(row, next);
    else setEditing(null);
    setCellError("");
    if (value !== (row[cur.field] ?? "")) {
      const message = await patchRow(row.id, { [cur.field]: value || null } as Partial<Application>);
      if (message) setActionError(message);
      else setActionError("");
    }
  }

  // Tab walks the cells drawn on screen: the list shows only company and role, and the
  // rest live in the row's Edit panel.
  function cellOrder(field: TextField): readonly TextField[] {
    if (sheetMode) return CELL_ORDER;
    return field === "company_name" || field === "role" ? ["company_name", "role"] : ["salary", "date_applied", "followup_date"];
  }

  function handleCellKey(e: React.KeyboardEvent<HTMLInputElement>, field: TextField) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitCell();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelCell();
    } else if (e.key === "Tab") {
      const order = cellOrder(field);
      const i = order.indexOf(field);
      const next = (e.shiftKey ? order[i - 1] : order[i + 1]) ?? null;
      // Past the last (or before the first) editable cell, let the browser
      // move focus on naturally instead of stranding it on <body>.
      if (next) e.preventDefault();
      void commitCell(next);
    }
  }

  function openClose(row: Application, reason: CloseReason, date?: string) {
    setCloseError("");
    setClosing({ row, reason, date: date ?? todayLocal() });
  }

  async function submitClose(choice: CloseChoice) {
    if (!closing) return;
    const { row } = closing;
    setCloseBusy(true);
    setCloseError("");
    const message = await patchRow(
      row.id,
      { status: choice.status, stages_reached: stagesAfterMove(row.stages_reached, choice.status), closed_at: choice.closed_at, close_reason: choice.close_reason, lesson: choice.lesson, pending_outcome: null },
      closeBody(choice)
    );
    setCloseBusy(false);
    if (message) {
      setCloseError(message);
      return;
    }
    setClosing(null);
    setStageRefresh((n) => n + 1);
    showToast({ message: "Moved to Closed", undo: () => undoClose(row.id) }, UNDO_WINDOW_MS);
  }

  // Restored from what the close stored on the server. The history stays as it is.
  async function undoClose(id: string) {
    const { ok, status, data } = await api("PUT", { id, undo_close: true });
    if (!ok) {
      setActionError(status === 401 ? SESSION_EXPIRED : data.error || "Could not undo that.");
      return;
    }
    const { notes, ...restored } = data.restored as Partial<Application> & { notes?: string | null };
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...restored, status: normalizeStatus(restored.status) ?? r.status, ...(notes !== undefined ? notesListFields(notes) : {}) } : r)));
    if (notes !== undefined) rememberText(id, { notes });
    setActionError("");
    setStageRefresh((n) => n + 1);
  }

  // Reopen: where a report asked for, unless it already got further.
  async function reopenRow(row: ClosedRow) {
    const stage = reopenTarget(row);
    const answered = activePending(row.pending_outcome)?.outcome === "reopen" ? { pending_outcome: null } : {};
    const message = await patchRow(
      row.id,
      { status: stage, stages_reached: stagesAfterMove(row.stages_reached, stage), closed_at: null, close_reason: null, ...answered },
      { confirmed_reopen: true }
    );
    setActionError(message ?? "");
    if (!message) showFlash(`${row.company_name} is back at ${STATUS_LABELS[stage]}.`);
    setStageRefresh((n) => n + 1);
  }

  // "Move back": the row goes where the report said, and the question is answered.
  async function moveBackRow(row: Application, stage: Status) {
    const message = await patchRow(row.id, { status: stage, stages_reached: stagesAfterMove(row.stages_reached, stage), pending_outcome: null }, { confirmed_move_back: true });
    setActionError(message ?? "");
    if (!message) showFlash(`${row.company_name} is back at ${STATUS_LABELS[stage]}.`);
    setStageRefresh((n) => n + 1);
  }

  // The one exception to the append-only history: the user's own click, on their confirmation,
  // and the row's notes say so. The server takes it only from this page.
  async function removeStage(row: { id: string; company_name: string }, stage: Status) {
    const note = removedStageNote(stage, new Date());
    const yes = await confirm({
      title: `Remove ${STATUS_LABELS[stage]} from ${row.company_name}?`,
      message: `Only if it never got that far and you picked it by mistake. It comes off this row's record and any count that relied on it, and the row's notes will say: "${note}".`,
      confirmLabel: "Remove stage",
      danger: true,
    });
    if (!yes) return;
    mutationCount++;
    const res = await fetch(`/api/applications/${row.id}/remove-stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, confirmed_by_user: true }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 401) {
      setSessionExpired(true);
      return;
    }
    if (!res || !res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Could not remove that stage.");
      return;
    }
    const notes = typeof data.notes === "string" ? data.notes : null;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, stages_reached: data.stages_reached, ...notesListFields(notes) } : r)));
    rememberText(row.id, { notes });
    setNotesDraft((d) => (d?.id === row.id ? { id: row.id, text: `${notes?.split("\n")[0] ?? note}\n${d.text}` } : d));
    setActionError("");
    showFlash(`${STATUS_LABELS[stage]} removed from ${row.company_name}. Its notes say so.`);
    setStageRefresh((n) => n + 1);
  }

  async function saveLesson(id: string, lesson: string | null) {
    const message = await patchRow(id, { lesson });
    setActionError(message ?? "");
  }

  // "Not true": the banner goes and stays gone; the row never moved.
  async function dismissPending(row: { id: string; pending_outcome?: unknown }) {
    const seen = activePending(row.pending_outcome);
    mutationCount++;
    const res = await fetch(`/api/applications/${row.id}/pending-outcome`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismiss: true, outcome: seen?.outcome, date: seen?.date }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setActionError(data.error || "Could not save that. Try again.");
      return;
    }
    setActionError("");
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, pending_outcome: normalizePendingOutcome(data.pending_outcome) } : r)));
  }

  async function changeStatus(row: Application, status: Status) {
    if (status === row.status) return;
    // A row that reached screening leaves on the user's word, in the dialog.
    if (needsConfirmation(row, status, false)) {
      openClose(row, reasonForStatus(status));
      return;
    }
    // Moving it back asks as well: below screening, or a step back among the live stages.
    const movingBack = isMoveBack(row, status) || isStepBack(row, status);
    if (movingBack) {
      const furthest = highestStage(row);
      const yes = await confirm({
        title: `Move ${row.company_name} back to ${STATUS_LABELS[status]}?`,
        message: `It reached ${furthest ? HIGHEST_STAGE_LABELS[furthest].toLowerCase() : "screening"}, and that stays on its record and in your count. This only changes where it stands now. To end the application, use Move to Closed.`,
        confirmLabel: "Move it back",
      });
      if (!yes) return;
    }
    // Choosing an open stage for a closed row is the user's word that it is open again.
    const reopening = !isEnding(status) && isClosed(row);
    const reopened = reopening ? { closed_at: null, close_reason: null } : {};
    void patchRow(row.id, { status, stages_reached: stagesAfterMove(row.stages_reached, status), ...reopened }, { ...(movingBack ? { confirmed_move_back: true } : {}), ...(reopening ? { confirmed_reopen: true } : {}) }).then((message) => {
      if (message === CONFIRMATION_MESSAGE) {
        openClose(row, reasonForStatus(status));
        return;
      }
      setActionError(message ?? "");
      setStageRefresh((n) => n + 1);
    });
  }

  // ── Panels (CV / JD / Notes) ──────────────────────────────────────────────

  function togglePanel(row: Application, kind: PanelKind) {
    if (panel && panel.id === row.id && panel.kind === kind) {
      setPanel(null);
      return;
    }
    setPanel({ id: row.id, kind });
    setPanelError("");
    if (kind === "jd") {
      setJdDraft("");
      setJdEditing(!row.has_job_description);
      if (row.has_job_description && rowText[row.id]?.job_description === undefined) void loadRowText(row.id);
    }
    if (kind === "notes") {
      setNotesDraft(null);
      if (row.notes_more && rowText[row.id]?.notes === undefined) void loadRowText(row.id);
    }
    if (kind === "cv" && !(row.id in cvCache) && !cvLoadingRef.current[row.id]) void loadCv(row.id);
  }

  function rememberText(id: string, text: RowText) {
    setRowText((all) => ({ ...all, [id]: { ...all[id], ...text } }));
  }

  // The row's full JD and notes, from the detail endpoint, when a panel needs them.
  async function loadRowText(id: string) {
    if (textLoadingRef.current[id]) return;
    textLoadingRef.current = { ...textLoadingRef.current, [id]: true };
    setTextLoading(textLoadingRef.current);
    setTextErrors((e) => {
      const { [id]: _gone, ...rest } = e;
      void _gone;
      return rest;
    });
    const { ok, status, data } = await api("GET", undefined, `?id=${encodeURIComponent(id)}`);
    textLoadingRef.current = { ...textLoadingRef.current, [id]: false };
    setTextLoading(textLoadingRef.current);
    if (!ok) {
      if (status === 401) setSessionExpired(true);
      setTextErrors((e) => ({ ...e, [id]: status === 401 ? SESSION_EXPIRED : data.error || "Could not load this application." }));
      return;
    }
    const app = data.application as { job_description?: string | null; notes?: string | null; tailored_cv?: { gates?: unknown } | null } | undefined;
    rememberText(id, { job_description: app?.job_description ?? null, notes: app?.notes ?? null, gates: app?.tailored_cv?.gates });
  }

  // The notes as saved, or null while they are not known: only a preview is
  // on hand, and saving that would cut them short.
  function fullNotes(row: Application): string | null {
    if (!row.notes_more) return row.notes_preview ?? "";
    return rowText[row.id]?.notes ?? null;
  }

  async function loadCv(id: string) {
    cvLoadingRef.current = { ...cvLoadingRef.current, [id]: true };
    setCvLoading(cvLoadingRef.current);
    setCvErrors((e) => {
      const { [id]: _gone, ...rest } = e;
      void _gone;
      return rest;
    });
    const { ok, status, data } = await api("GET", undefined, `?id=${encodeURIComponent(id)}`);
    cvLoadingRef.current = { ...cvLoadingRef.current, [id]: false };
    setCvLoading(cvLoadingRef.current);
    if (!ok) {
      if (status === 401) setSessionExpired(true);
      setCvErrors((e) => ({ ...e, [id]: status === 401 ? SESSION_EXPIRED : data.error || "Could not load that CV." }));
      return;
    }
    const app = data.application as { tailored_cv?: TailoredCv | null; sent_cv?: SentCvInfo | null } | undefined;
    setCvCache((c) => ({ ...c, [id]: app?.tailored_cv ?? null }));
    setSentCache((c) => ({ ...c, [id]: app?.sent_cv ?? null }));
  }

  // An upload, replacement or removal in the CV panel (SentCvBlock).
  function sentCvChanged(row: Application, next: SentCvInfo | null) {
    setSentCache((c) => ({ ...c, [row.id]: next }));
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, sent_cv_name: next?.fileName ?? null } : r)));
    showFlash(next ? "CV saved with this application." : "CV file removed.");
  }

  // "Run check": the server triages the row's stored JD with the user's current
  // answers and CV, and stores it. Nothing is blocked by the answer.
  async function runCheck(row: Application) {
    setCheckingId(row.id);
    const { ok, status, data } = await api("PUT", { id: row.id, runCheck: true });
    setCheckingId(null);
    if (!ok) {
      if (status === 401) setSessionExpired(true);
      setActionError(status === 401 ? SESSION_EXPIRED : data.error || "Could not check that application.");
      return;
    }
    setActionError("");
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, gates: data.gates, ...listTriageFields(data.gates) } : r)));
    rememberText(row.id, { gates: data.gates });
    flashRow(row.id);
  }

  async function saveJd(row: Application) {
    const jd = jdDraft.trim();
    if (jd.length > MAX_JD_CHARS) {
      setPanelError(JD_TOO_LONG);
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    const message = await patchRow(row.id, { has_job_description: !!jd }, { job_description: jd || null });
    setPanelBusy(false);
    if (message) {
      setPanelError(message);
      return;
    }
    setJdEditing(false);
    if (!jd) setPanel(null);
    showFlash("Saved.");
  }

  async function saveNotes(row: Application) {
    const saved = fullNotes(row);
    // Nothing typed and the full text not loaded: there is nothing safe to send.
    if (saved === null) return;
    const notes = (notesDraft?.id === row.id ? notesDraft.text : saved).trim();
    if (notes.length > MAX_NOTES) {
      setPanelError(`Notes are too long (max ${MAX_NOTES} characters).`);
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    const message = await patchRow(row.id, notesListFields(notes), { notes: notes || null });
    setPanelBusy(false);
    if (message) {
      setPanelError(message);
      return;
    }
    setPanel(null);
    setStageRefresh((n) => n + 1);
    // A confirmation in the notes closes the row's open submission items (lib/autoClose).
    showFlash(autoCloseNote.current ?? "Saved.");
    autoCloseNote.current = null;
  }

  // "They wrote" / "I replied": who spoke last, now (lib/tracker isReplyOwed).
  async function recordContact(row: Application, from: "me" | "them") {
    const message = await patchRow(row.id, { last_contact_from: from, last_contact_at: new Date().toISOString() });
    if (message) {
      showFlash(message);
      return;
    }
    showFlash(from === "me" ? "Reply recorded." : "Recorded: they wrote. It shows as Reply owed after a day without your reply.");
  }

  // A referral's next step, from the row's menu (lib/referrals).
  async function stepReferral(row: Application, status: ReferralStatus) {
    setReferralBusy(row.id);
    const message = await patchRow(row.id, { referral_status: status });
    setReferralBusy(null);
    showFlash(message ?? `Referral: ${REFERRAL_STATUS_LABELS[status].toLowerCase()}.`);
  }

  // The Notes panel's referral editor.
  async function saveReferral(row: Application, fields: ReferralFields): Promise<string | null> {
    const message = await patchRow(row.id, fields as Partial<Application>);
    if (!message) showFlash(fields.referral ? "Referral saved." : "Referral removed.");
    return message;
  }

  // Download through fetch rather than a plain link: a failed export (expired
  // session, server error) then shows inline instead of navigating the whole
  // tracker to a page of raw JSON.
  async function exportCsv() {
    setExporting(true);
    setActionError("");
    try {
      // The rows on screen, whichever tab, card or search put them there.
      const label = [attention ?? (searchTerm || tabNow === "all" ? "" : TAB_LABELS[tabNow]), periodFilter === "all" ? "" : periodFilter, searchTerm].filter(Boolean).join(" ");
      const res = await fetch("/api/applications/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: visible.map((r) => r.id), label }),
      });
      if (res.status === 401) {
        setSessionExpired(true);
        setActionError(SESSION_EXPIRED);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "Could not export your applications.");
        return;
      }
      const disposition = res.headers.get("content-disposition") || "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || "applications.csv";
      saveBlob(await res.blob(), name);
    } catch {
      setActionError("Connection error. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // ── New row / delete ──────────────────────────────────────────────────────

  function startNewRow() {
    // The form lives in the list, not on Wins.
    setWins(false);
    cancelCell();
    setPanel(null);
    setNewRow({
      company_name: "",
      role: "",
      // On a stage tab a new row belongs to that stage, or it would vanish from view on save.
      status: statusForNewRow(attention || !tabPicked ? "all" : tabNow),
      salary: "",
      date_applied: todayLocal(),
      followup_date: "",
      formatStyle: "unknown",
    });
    setNewRowErr("");
  }

  async function saveNewRow() {
    if (!newRow || savingNew) return;
    const err = newRowError(newRow);
    if (err) {
      setNewRowErr(err);
      return;
    }
    setSavingNew(true);
    setNewRowErr("");
    const { ok, status, data } = await api("POST", {
      ...newRow,
      followup_date: newRow.followup_date || null,
      formatStyle: newRow.formatStyle === "unknown" ? null : newRow.formatStyle,
      source: "manual",
    });
    if (!ok) {
      if (status === 401) setSessionExpired(true);
      setNewRowErr(status === 401 ? SESSION_EXPIRED : data.error || "Could not save that application.");
      setSavingNew(false);
      return;
    }
    const result = await fetchApplications();
    if ("rows" in result) setRows(result.rows);
    setNewRow(null);
    setSavingNew(false);
    showFlash("Application added.");
    if (typeof data.warning === "string") setNotice(data.warning);
  }

  function handleNewRowKey(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveNewRow();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setNewRow(null);
    }
  }

  function updateNewRow<K extends keyof NewRow>(key: K, value: NewRow[K]) {
    setNewRow((d) => (d ? { ...d, [key]: value } : d));
  }

  async function confirmDelete(id: string) {
    setDeletingId(id);
    setActionError("");
    const { ok, status, data } = await api("DELETE", undefined, `?id=${encodeURIComponent(id)}`);
    if (!ok) {
      if (status === 401) setSessionExpired(true);
      setActionError(status === 401 ? SESSION_EXPIRED : data.error || "Could not delete that application.");
    } else {
      setRows((rs) => rs.filter((r) => r.id !== id));
      if (panel?.id === id) setPanel(null);
      if (editingRef.current?.id === id) cancelCell();
      showFlash("Deleted.");
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function textCell(row: Application, field: TextField, shown?: { display: string; title: string }) {
    const isEditing = editing?.id === row.id && editing.field === field;
    if (isEditing) {
      const isDate = DATE_FIELDS.has(field);
      return (
        <>
          <input
            className="appsCellInput"
            type={isDate ? "date" : "text"}
            autoFocus
            value={cellDraft}
            onChange={(e) => {
              cellDraftRef.current = e.target.value;
              setCellDraft(e.target.value);
            }}
            onKeyDown={(e) => handleCellKey(e, field)}
            onBlur={() => {
              if (editingRef.current?.id === row.id && editingRef.current.field === field) void commitCell();
            }}
            {...(isDate ? {} : { maxLength: field === "salary" ? 100 : 200 })}
            {...(field === "followup_date" && row.date_applied ? { min: row.date_applied } : {})}
            aria-label={CELL_LABELS[field]}
          />
          {cellError && <span className="appsCellError" role="alert">{cellError}</span>}
          {!cellError && field === "role" && roleTooLong(cellDraft) && (
            <span className="appsCellHint" data-role-long>
              {cellDraft.trim().length} characters — the sheet and insights work best with the job title alone; put the rest in Notes.
            </span>
          )}
        </>
      );
    }
    const value = row[field] ?? "";
    const display = DATE_FIELDS.has(field) ? formatDate(value || null) : value;
    const due = field === "followup_date" && isDue(row);
    return (
      <button
        type="button"
        className={"appsCellBtn" + (value ? "" : " empty") + (due ? " due" : "")}
        onClick={() => openCell(row, field)}
        title={shown?.title ?? (due ? "Follow-up due — click to edit" : "Click to edit")}
        aria-label={value ? undefined : `${CELL_LABELS[field]}: empty, click to edit`}
      >
        {shown?.display ?? (display || "—")}
      </button>
    );
  }

  // What has no column of its own in the list: edited here, in the row's panel.
  function renderEditPanel(row: Application) {
    const gate = gateLine(readStoredGates(row.gates));
    return (
      <div className="appsPanel" data-edit-panel>
        <div className="appsPanelHead">
          <span className="appsPanelTitle">Edit {row.company_name}</span>
          <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
        </div>
        <div className="rowEditGrid">
          <div><span className="label">Salary</span>{textCell(row, "salary")}</div>
          <div><span className="label">Applied on</span>{textCell(row, "date_applied")}</div>
          <div><span className="label">Follow-up</span>{textCell(row, "followup_date")}</div>
          {isOwner && (
            <div>
              <span className="label">CV style</span>
              {row.source === "tailored" ? (
                <span className="appsStyleTag" data-style-tag={rowStyle(row.format_style)}>{ROW_STYLE_LABELS[rowStyle(row.format_style)]}</span>
              ) : (
                <select className="appsCellSelect appsStyleSelect" value={rowStyle(row.format_style)} onChange={(e) => void changeStyle(row, e.target.value)} aria-label={`Format style of the CV sent to ${row.company_name}`} data-style-pick={rowStyle(row.format_style)}>
                  {ROW_STYLES.map((k) => <option key={k} value={k}>{ROW_STYLE_LABELS[k]}</option>)}
                </select>
              )}
            </div>
          )}
          <div><span className="label">Eligibility read</span><span className="cvHelp" data-gate={gate.label}>{gate.detail || gate.label}</span></div>
          {row.status === "rejected" && (
            <div className="rowEditWide">
              <label className="label" htmlFor={`reason-${row.id}`}>Rejection reason</label>
              <input
                id={`reason-${row.id}`}
                className="textInput"
                placeholder="Optional"
                defaultValue={row.outcome_reason ?? ""}
                maxLength={500}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value !== (row.outcome_reason ?? "")) void patchRow(row.id, { outcome_reason: value || null }).then((message) => setActionError(message ?? ""));
                }}
                data-stage-reason
              />
              <button
                type="button"
                className="linkBtn"
                onClick={async () => {
                  if (await copyText(feedbackRequest(row.company_name, row.role))) {
                    setCopiedFeedback(row.id);
                    setTimeout(() => setCopiedFeedback(null), 2000);
                  }
                }}
                data-ask-feedback
              >
                {copiedFeedback === row.id ? "Copied" : "Ask for feedback"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  async function putEvent(body: Record<string, unknown>): Promise<boolean> {
    setActionError("");
    try {
      const res = await fetch("/api/events", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return true;
      const failed = await res.json().catch(() => ({}));
      setActionError(failed.error || "Could not save that change.");
    } catch {
      setActionError("Connection error. Your change was not saved.");
    }
    return false;
  }

  async function markStepDone(event: PlanEvent) {
    if (!(await putEvent({ id: event.id, status: "done" }))) return;
    setStageRefresh((n) => n + 1);
    showToast({
      message: `Done: ${event.title}.`,
      undo: async () => {
        await putEvent({ id: event.id, status: event.status });
        setStageRefresh((n) => n + 1);
      },
    });
  }

  async function snoozeStep(event: PlanEvent) {
    if (!(await putEvent({ id: event.id, snooze: true }))) return;
    showToast({
      message: "Snoozed on the Action Centre for a day. The deadline itself has not moved.",
      undo: async () => {
        await putEvent({ id: event.id, snooze: false });
      },
    });
  }

  // "Submit" on a row still to send. It records what the user did; only they can send it.
  async function submitRow(row: Application) {
    const yes = await confirm({
      title: `Mark ${row.company_name} as submitted?`,
      message: "It moves to Applied, dated today. Do this once you have actually sent it.",
      confirmLabel: "Mark as submitted",
    });
    if (!yes) return;
    const before = { status: row.status, date_applied: row.date_applied, stages_reached: row.stages_reached };
    const message = await patchRow(row.id, { status: "applied", date_applied: todayLocal(), stages_reached: stagesAfterMove(row.stages_reached, "applied") });
    setActionError(message ?? "");
    if (message) return;
    setStageRefresh((n) => n + 1);
    showToast({
      message: `${row.company_name} moved to Applied.`,
      undo: async () => {
        const failed = await patchRow(row.id, before, { confirmed_move_back: true });
        setActionError(failed ?? "");
        setStageRefresh((n) => n + 1);
      },
    });
  }

  async function deleteRow(row: Application) {
    const yes = await confirm({
      title: `Delete ${row.company_name}?`,
      message: "This removes the row, its events and any CV file kept with it. It can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (yes) await confirmDelete(row.id);
  }

  function rowMenu(row: Application, step: ReturnType<typeof nextStepFor>, toMatch: Status | null): RowMenuItem[] {
    const event = step?.event ?? null;
    const check = rowCheck(row);
    const status = isReferralStatus(row.referral_status) ? row.referral_status : "offered";
    const referralNext = referralIds.has(row.id) ? nextReferralStatus(status) : null;
    const snoozable = event ? snoozeUntil(event, clock) !== null : false;
    const items: RowMenuItem[] = [
      event
        ? { key: "edit-step", label: "Edit date/time", onSelect: () => setEventForm({ type: "edit", event, application: row }) }
        : { key: "add-step", label: "Add date/time", onSelect: () => setEventForm({ type: "new", application: row, preset: { timezone: tz } }) },
    ];
    if (event) {
      items.push({ key: "done", label: "Mark done", onSelect: () => void markStepDone(event) });
      items.push({ key: "snooze", label: "Snooze 1 day", disabled: !snoozable, hint: snoozable ? undefined : "Due within 24 hours, so it stays on your list.", onSelect: () => void snoozeStep(event) });
    }
    items.push({ key: "edit-row", label: "Edit row", onSelect: () => { if (!(panel?.id === row.id && panel.kind === "edit")) togglePanel(row, "edit"); } });
    if (reachedScreening(row) && !isEnding(row.status)) {
      const banner = pendingBanner(row);
      const pending = banner?.kind === "close" ? banner.pending : undefined;
      items.push({ key: "move-closed", label: "Move to Closed", onSelect: () => openClose(row, pending ? reasonForStatus(pending.outcome) : "rejected", pending?.date) });
    }
    if (toMatch) items.push({ key: "match-status", label: `Update status to ${STATUS_LABELS[toMatch]}`, onSelect: () => void changeStatus(row, toMatch) });
    else items.push({
      key: "update-status",
      label: "Update status",
      onSelect: () => {
        const select = document.getElementById(`status-${row.id}`) as HTMLSelectElement | null;
        select?.focus();
        try {
          select?.showPicker?.();
        } catch {
          // Some browsers only open it from a direct click: it has focus, and the arrow keys change it.
        }
      },
    });
    items.push({ key: "cv", label: row.source === "tailored" || row.sent_cv_name ? "View CV" : "Add CV", onSelect: () => togglePanel(row, "cv") });
    items.push({ key: "jd", label: row.has_job_description ? "View JD" : "Add JD", onSelect: () => togglePanel(row, "jd") });
    items.push({ key: "notes", label: row.notes_preview ? "Notes" : "Add notes", onSelect: () => togglePanel(row, "notes") });
    items.push({ key: "prep", label: row.prep_generated_at ? "Prep pack ✓" : "Prep pack", href: `/applications/${row.id}/prep` });
    items.push({ key: "mock", label: "Mock interview", href: `/applications/${row.id}/interview` });
    if (check?.kind === "run") items.push({ key: "run-check", label: "Run JD check", disabled: checkingId === row.id, onSelect: () => void runCheck(row) });
    if (referralNext) items.push({ key: "referral-step", label: `Mark ${REFERRAL_STATUS_LABELS[referralNext].toLowerCase()}`, disabled: referralBusy === row.id, onSelect: () => void stepReferral(row, referralNext) });
    for (const stage of removableStages(row)) items.push({ key: `remove-${stage}`, label: removeStageLabel(stage), onSelect: () => void removeStage(row, stage) });
    items.push({ key: "delete", label: "Delete", danger: true, disabled: deletingId === row.id, onSelect: () => void deleteRow(row) });
    return items;
  }

  // One row of the four-column list. The company and role still edit in place.
  function renderListRow(row: Application) {
    const open = panel?.id === row.id;
    const rowEvents = byApp.get(row.id) ?? [];
    const stage = deriveStage(row.status, rowEvents);
    const step = nextStepFor(rowEvents, clock, tz);
    const banner = pendingBanner(row);
    const action = primaryAction(stage);
    // The button belongs to the test the stage came from, which may not be the next step.
    const testEvent = stageEvent(row.status, rowEvents);
    const link = safeHttpUrl(testEvent?.location_or_link);
    const role = roleLine(row);
    const meta = [
      attention === "followups" && row.followup_date ? `Follow-up ${formatDate(row.followup_date)}` : "",
      referralIds.has(row.id) ? `Referral: ${nextReferralAction(row)}` : "",
      row.last_contact_at ? `Last contact ${formatDate(row.last_contact_at.slice(0, 10))}` : "",
      row.referrer_name ? `referred by ${row.referrer_name}` : "",
    ].filter(Boolean).join(" · ");
    const addLink = (label: string) =>
      testEvent ? <button type="button" className="appsActionBtn" onClick={() => setEventForm({ type: "edit", event: testEvent, application: row })} data-row-add-link>{label}</button> : null;
    return (
      <RowGroup key={row.id}>
        <tr className={"stageListRow" + (open ? " open" : "") + (flashRowId === row.id ? " flashSave" : "")} data-stage-row={row.company_name}>
          <td className="stageListWho" data-label="Company">
            <div className="stageListCompany">{textCell(row, "company_name")}</div>
            <div className="stageListRole">{textCell(row, "role", { display: role, title: role })}</div>
            {meta && <div className="stageListMeta" data-row-meta>{meta}</div>}
            <RowFlags
              row={row}
              quiet
              showMissing={attention === "fix"}
              checking={checkingId === row.id}
              onRunCheck={() => void runCheck(row)}
              onAddJd={() => { if (!(panel?.id === row.id && panel.kind === "jd")) togglePanel(row, "jd"); }}
            />
            {isReplyOwed(row, now) && (
              <span className="replyOwed" data-reply-owed>
                <span className="replyOwed__badge" title={`They wrote on ${formatDate(row.last_contact_at?.slice(0, 10) ?? null)} and no reply is recorded since.`}>Reply owed</span>
                <button type="button" className="inlineLink" onClick={() => void recordContact(row, "me")} aria-label={`I replied to ${row.company_name}`} data-reply-done>I replied</button>
              </span>
            )}
          </td>
          <td className="stageListStage" data-label="Stage">
            <span className="stagePill" data-stage={stage} data-stage-pill={stage}>
              <span className="stagePillDot" aria-hidden="true" />
              {STAGE_LABELS[stage]}
              <span className="stagePillChevron" aria-hidden="true">▾</span>
              <select
                id={`status-${row.id}`}
                className="stagePillSelect"
                value={row.status}
                onChange={(e) => void changeStatus(row, e.target.value as Status)}
                aria-label={`Status for ${row.company_name}, shown as ${STAGE_LABELS[stage]}`}
                data-stage-status
              >
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </span>
          </td>
          <td className="stageListNext" data-label="Next step" data-stage-next>
            {step ? (
              <NextStepCell step={step} />
            ) : CLOSED_STATUSES.has(row.status) ? null : (
              <button type="button" className="nextStepAdd" onClick={() => setEventForm({ type: "new", application: row, preset: { timezone: tz } })} data-stage-add>Add next step</button>
            )}
          </td>
          <td className="stageListActions" data-label="">
            {action?.kind === "prep" && (
              <Link href={`/applications/${row.id}/interview`} className="appsActionBtn primary" aria-label={`Prep for ${row.company_name}`} data-row-primary="prep">Prep</Link>
            )}
            {action?.kind === "test" && (link ? <a href={link} target="_blank" rel="noopener noreferrer" className="appsActionBtn primary" data-row-primary="test">Open test</a> : addLink("Add test link"))}
            {action?.kind === "record" && (link ? <a href={link} target="_blank" rel="noopener noreferrer" className="appsActionBtn primary" data-row-primary="record">Record</a> : addLink("Add video link"))}
            {action?.kind === "submit" && <button type="button" className="appsActionBtn primary" onClick={() => void submitRow(row)} data-row-primary="submit">Submit</button>}
            <RowMenu label={`Actions for ${row.company_name}`} items={rowMenu(row, step, statusToMatch(row.status, stage))} />
          </td>
        </tr>
        {banner && (
          <tr className="pendingRow" data-pending-row={row.company_name}>
            <td colSpan={4}>
              <div className="pendingBanner" role="status" data-pending-banner={banner.kind}>
                <span>{pendingLine(banner.pending, row.company_name)}</span>
                {banner.pending.note && <span className="pendingNote" data-pending-note>{banner.pending.note}</span>}
                {banner.kind === "reopen" ? (
                  <button type="button" className="appsActionBtn" onClick={() => void reopenRow(row)} data-pending-reopen>Reopen</button>
                ) : banner.kind === "move_back" ? (
                  <button type="button" className="appsActionBtn" onClick={() => void moveBackRow(row, banner.pending.status as Status)} data-pending-move-back>Move back</button>
                ) : (
                  <button type="button" className="appsActionBtn" onClick={() => openClose(row, reasonForStatus(banner.pending.outcome), banner.pending.date)} data-pending-move>Move to Closed</button>
                )}
                <button type="button" className="inlineLink" onClick={() => void dismissPending(row)} data-pending-dismiss>Not true / dismiss</button>
              </div>
            </td>
          </tr>
        )}
        {open && (
          <tr className="appsDetail stageListDetail">
            <td colSpan={4}>{renderPanel(row)}</td>
          </tr>
        )}
      </RowGroup>
    );
  }

  function renderPanel(row: Application) {
    if (!panel) return null;
    if (panel.kind === "edit") return renderEditPanel(row);

    if (panel.kind === "cv") {
      const snap = cvCache[row.id];
      const storedAts = readStoredAts(snap?.ats);
      const kwTotal = storedAts ? storedAts.keywords.hits.length + storedAts.keywords.misses.length : 0;
      const reqTotal = storedAts ? storedAts.required.hits.length + storedAts.required.misses.length : 0;
      const hasSnapshot = !!snap && !!panelCvData;
      const cvError = cvErrors[row.id] ?? "";
      return (
        <div className="appsPanel">
          <div className="appsPanelHead">
            <span className="appsPanelTitle">
              {row.source === "tailored" ? `Tailored CV${row.cv_reference ? ` · ${row.cv_reference}` : ""}` : "CV you sent"}
            </span>
            <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
          </div>
          {!cvError && snap !== undefined && (
            <SentCvBlock
              key={row.id}
              applicationId={row.id}
              company={row.company_name}
              sentCv={sentCache[row.id] ?? null}
              compact={hasSnapshot}
              label={row.source === "tailored"}
              onChange={(next) => sentCvChanged(row, next)}
              onSessionExpired={() => {
                setSessionExpired(true);
                setActionError(SESSION_EXPIRED);
              }}
            />
          )}
          {cvError ? (
            <StatusText role="alert">
              {cvError}{" "}
              {!sessionExpired && (
                <button type="button" className="inlineLink" onClick={() => void loadCv(row.id)} data-cv-retry>
                  Try again
                </button>
              )}
            </StatusText>
          ) : snap === undefined ? (
            <p className="cvHelp" role="status" aria-live="polite" data-cv-loading>Loading the CV…</p>
          ) : !hasSnapshot ? (
            row.source === "tailored" ? (
              <p className="appsMuted">
                No CV snapshot is stored for this application — it was saved before CV snapshots existed.
              </p>
            ) : null
          ) : (
            <>
              <CvPreview
                data={panelCvData}
                profile={snap.profile ?? profile}
                sectionOrder={snap.sectionOrder ?? sectionOrder}
                fileBaseName={row.cv_reference ?? "CV"}
                formatStyle={normalizeFormatStyle(snap.formatStyle)}
              />
              {isOwner && (() => {
                const tag = rowStyle(snap.formatStyle ?? row.format_style);
                const check = normalizeStyleCheck(snap.styleCheck);
                const sum = check ? summarizeStyleCheck(check) : null;
                return (
                  <p className="fitEvidence" data-panel-style={tag}>
                    Format style: {ROW_STYLE_LABELS[tag]}
                    {sum ? ` · format check at save: ${sum.pass} of ${sum.pass + sum.fail} rules kept${sum.fail > 0 ? ` (${check!.filter((i) => i.status === "fail").map((i) => i.label.toLowerCase()).join(", ")})` : ""}` : ""}.
                  </p>
                );
              })()}
              {(() => {
                const line = gateLine(readStoredGates(row.gates ?? snap.gates));
                return (
                  <p className="fitEvidence" data-gate-line={line.label} data-warn={line.label === "Knockout" ? "" : undefined}>
                    {line.detail}
                  </p>
                );
              })()}
              {storedAts && (
                <div className="atsGroup">
                  <div className="atsGroupLabel recs">Recruiter search visibility · saved CV</div>
                  <p className="scoreNote" style={{ marginBottom: "var(--space-2)" }}>
                    {kwTotal > 0 && (
                      <>
                        <strong>{storedAts.keywords.hits.length}/{kwTotal}</strong> of the role&apos;s terms
                      </>
                    )}
                    {kwTotal > 0 && reqTotal > 0 && " · "}
                    {reqTotal > 0 && (
                      <>
                        <strong>{storedAts.required.hits.length}/{reqTotal}</strong> required skills
                      </>
                    )}
                  </p>
                  <p className="fitEvidence" style={{ marginBottom: "var(--space-3)" }}>
                    How likely a recruiter searching their pipeline for this role&apos;s terms is to surface your CV.
                    Scored from this saved document when you clicked Applied.
                  </p>
                  {kwTotal > 0 && (
                    <div className="stackChips">
                      {storedAts.keywords.hits.map((k, i) => (
                        <span key={`h${i}`} className="stackChip matched">{k}</span>
                      ))}
                      {storedAts.keywords.misses.map((k, i) => (
                        <span key={`m${i}`} className="stackChip muted">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {snap.coverLetter && (
                <div className="atsGroup">
                  <div className="atsGroupLabel recs">Cover letter · as sent</div>
                  <CoverLetterPreview
                    coverLetter={snap.coverLetter}
                    withDateLine={false}
                    fileBaseName={letterFileName(row.cv_reference)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    if (panel.kind === "jd") {
      const jdText = rowText[row.id]?.job_description;
      return (
        <div className="appsPanel">
          <div className="appsPanelHead">
            <span className="appsPanelTitle">Job description</span>
            <div className="appsPanelActions">
              {!jdEditing && jdText && (
                <button type="button" className="appsActionBtn" onClick={() => void runCheck(row)} disabled={checkingId === row.id} data-panel-check>
                  {checkingId === row.id ? "Checking…" : row.triage_verdict ? "Check again" : "Run check"}
                </button>
              )}
              {!jdEditing && (
                <button
                  type="button"
                  className="appsActionBtn"
                  disabled={jdText === undefined}
                  onClick={() => {
                    setJdDraft(jdText ?? "");
                    setJdEditing(true);
                  }}
                >
                  Edit
                </button>
              )}
              <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
            </div>
          </div>
          {jdEditing ? (
            <>
              <Textarea
                value={jdDraft}
                onChange={(e) => setJdDraft(e.target.value)}
                placeholder="Paste the job posting — you'll want it for interview prep weeks from now."
                rows={10}
                disabled={panelBusy}
                aria-label="Job description"
              />
              <p className={"charCount" + (jdDraft.length > MAX_JD_CHARS ? " over" : "")} aria-live="polite">
                {jdDraft.length.toLocaleString()} / {MAX_JD_CHARS.toLocaleString()}
              </p>
              <div className="actions">
                <Button variant="secondary" onClick={() => saveJd(row)} disabled={panelBusy}>
                  {panelBusy ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => (row.has_job_description ? setJdEditing(false) : setPanel(null))}
                  disabled={panelBusy}
                >
                  Cancel
                </Button>
                {panelError && <StatusText as="span" role="alert">{panelError}</StatusText>}
              </div>
            </>
          ) : jdText === undefined ? (
            textErrors[row.id] ? (
              <div className="actions">
                <StatusText as="span" role="alert">{textErrors[row.id]}</StatusText>
                <Button variant="secondary" onClick={() => void loadRowText(row.id)}>Try again</Button>
              </div>
            ) : (
              <Skeleton />
            )
          ) : (
            <>
              {/* The triage stored with the row; a row from before it existed asks for the check. */}
              <TriageBadge triage={normalizeTriage((rowText[row.id]?.gates as { triage?: unknown } | null | undefined)?.triage)} />
              <pre className="appsJd">{jdText}</pre>
            </>
          )}
        </div>
      );
    }

    const savedNotes = fullNotes(row);
    const notesValue = notesDraft?.id === row.id ? notesDraft.text : (savedNotes ?? "");
    return (
      <div className="appsPanel">
        <div className="appsPanelHead">
          <span className="appsPanelTitle">Notes</span>
          <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
        </div>
        {/* Locked until the full notes are here: the row only holds a preview. */}
        <Textarea
          value={notesValue}
          onChange={(e) => setNotesDraft({ id: row.id, text: e.target.value })}
          placeholder={savedNotes !== null ? "Recruiter name, referral, what you emphasised, next steps…" : textErrors[row.id] ? "" : "Loading your notes…"}
          rows={4}
          disabled={panelBusy || savedNotes === null}
          aria-label="Notes"
          aria-busy={!!textLoading[row.id] || undefined}
        />
        <p className={"charCount" + (notesValue.length > MAX_NOTES ? " over" : "")} aria-live="polite">
          {notesValue.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}
        </p>
        {savedNotes === null && textErrors[row.id] && (
          <div className="actions">
            <StatusText as="span" role="alert">{textErrors[row.id]}</StatusText>
            <Button variant="secondary" onClick={() => void loadRowText(row.id)}>Try again</Button>
          </div>
        )}
        <div className="actions">
          <Button variant="secondary" onClick={() => saveNotes(row)} disabled={panelBusy || savedNotes === null}>
            {panelBusy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setPanel(null)} disabled={panelBusy}>Cancel</Button>
          {panelError && <StatusText as="span" role="alert">{panelError}</StatusText>}
        </div>
        {/* Who spoke last: "them" a day ago or more marks the row Reply owed. */}
        <div className="appsContact" data-last-contact={row.last_contact_from ?? "none"}>
          <span className="appsContact__state">
            Last contact:{" "}
            {row.last_contact_from && row.last_contact_at
              ? `${row.last_contact_from === "them" ? "they wrote" : "you replied"} on ${formatDate(row.last_contact_at.slice(0, 10))}`
              : "not recorded"}
          </span>
          <button type="button" className="appsActionBtn" onClick={() => void recordContact(row, "them")} data-contact-them>
            They wrote
          </button>
          <button type="button" className="appsActionBtn" onClick={() => void recordContact(row, "me")} data-contact-me>
            I replied
          </button>
        </div>
        <ReferralEditor key={row.id} row={row} onSave={(fields) => saveReferral(row, fields)} />
      </div>
    );
  }

  if (!loaded || !eventsSettled) {
    return (
      <main className="page">
        <div className="container appsContainer">
          <AppHeader title="Applications" />
          <Card><Skeleton lines={4} label="Loading your applications" /></Card>
        </div>
      </main>
    );
  }

  const hasRows = rows.length > 0 || (!fullLoaded && (serverCounts?.total ?? 0) > 0);
  const showTable = visible.length > 0 || newRow !== null;
  // One line under the title. In progress is what the tabs count, so it adds up with them.
  const fmt = (n: number) => n.toLocaleString("en-GB");
  const rejectedCount = rows.filter((r) => r.status === "rejected").length;
  const withdrawnCount = rows.filter((r) => r.status === "withdrawn").length;
  const ghostedCount = rows.filter((r) => r.status === "ghosted").length;
  const summary = !fullLoaded && serverCounts ? (
    <span data-apps-summary>
      <strong>{fmt(serverCounts.total)}</strong> tracked · <strong>{fmt(counts.applied)}</strong> applied · <strong>{fmt(counts.screening + counts.interview + counts.assessment)}</strong> in progress
    </span>
  ) : hasRows ? (
    <span data-apps-summary>
      <strong>{fmt(rows.length)}</strong> tracked · <strong>{fmt(counts.applied)}</strong> applied · <strong>{fmt(counts.screening + counts.interview + counts.assessment)}</strong> in progress · <strong>{fmt(rejectedCount)}</strong> rejected
    </span>
  ) : null;
  const tomorrowName = new Date(dueSoonCutoff(clock, tz) - 1).toLocaleDateString("en-GB", { weekday: "long", timeZone: tz });
  const reopenRows = rows.filter(isAsking);
  const tabs: (TabChoice | "wins")[] = [...visibleTabs(counts, tabNow === "all" ? null : tabNow), ...(spreadsheet ? (["all"] as const) : []), "wins"];
  const winsOpen = wins && !attention && !searchTerm;
  // The Screening and Interview tabs are pages of their own: their title, their summary, Live and Closed.
  const stageTabNow: StageTab | null = !winsOpen && !attention && !searchTerm && !sheetMode && (tabNow === "screening" || tabNow === "interview") ? tabNow : null;
  // The page's own filters reach the Closed section too; the summary above stays all time.
  const closedHere = stageTabNow ? closedRows(rows.filter((r) => (styleFilter === "all" || rowStyle(r.format_style) === styleFilter) && (!bounds || (r.date_applied >= bounds.from && r.date_applied <= bounds.to))), stageTabNow) : [];
  const noFilters = periodFilter === "all" && styleFilter === "all";
  const viewLabel = !attention && searchTerm ? "across every tab" : attention === "reopen" ? "with new activity" : attention === "due" ? "due soon" : attention === "followups" ? "follow-ups due this week" : attention === "fix" ? "data to fix" : attention === "referrals" ? "referral asks" : tabNow === "all" ? "all applications" : `in ${TAB_LABELS[tabNow]}`;
  const viewTotal = !attention && searchTerm ? rows.length : attention === "reopen" ? reopenRows.length : attention === "due" ? attentionNumbers.dueSoonRows : attention === "followups" ? attentionNumbers.followups : attention === "fix" ? attentionNumbers.dataToFix : attention === "referrals" ? referralIds.size : tabNow === "all" ? rows.length : counts[tabNow];
  const elsewhere = !attention && !searchTerm && tabNow !== "all" && tabNow !== "assessment" ? countedElsewhere(rows, byApp, tabNow) : 0;
  const activeFilters = (styleFilter !== "all" ? 1 : 0) + (includePast ? 1 : 0) + (listSort !== "next" ? 1 : 0);

  return (
    <main className="page">
      <div className="container appsContainer">
        <AppHeader
          title="Applications"
          tagline={stageTabNow ? <span data-stage-summary>{stageSummary(rows, stageTabNow, counts[stageTabNow]).text}</span> : summary}
          actions={
            <>
              {hasRows && visible.length > 0 && !winsOpen && (
                <Button variant="ghost" onClick={exportCsv} disabled={exporting} title={`Export these ${visible.length} rows as a CSV`} data-apps-export>
                  {exporting ? "Exporting…" : "Export"}
                </Button>
              )}
              {isOwner && hasRows && (
                <Button variant="ghost" onClick={() => setCleanupOpen((o) => !o)} aria-expanded={cleanupOpen} data-apps-cleanup>
                  Clean-up
                </Button>
              )}
              <Button onClick={startNewRow} disabled={newRow !== null || sessionExpired} data-apps-add>+ Add application</Button>
            </>
          }
        />

        {pageError && (
          <p role="alert" className="keyError">
            {pageError}
            {sessionExpired && (
              <>
                {" "}
                <Link href="/auth/login?next=/applications" className="inlineLink">Sign in</Link>
              </>
            )}
          </p>
        )}
        {notice && (
          <div className="limitNotice" role="status">
            {notice}{" "}
            <button type="button" className="inlineLink" onClick={() => setNotice("")}>Dismiss</button>
          </div>
        )}

        {eventsError && <div className="limitNotice" role="status" data-events-error>{eventsError}</div>}

        {reopenRows.length > 0 && attention !== "reopen" && (
          <div className="limitNotice" role="status" data-reopen-notice>
            New activity on {reopenRows.length} {reopenRows.length === 1 ? "application" : "applications"}.{" "}
            <button type="button" className="inlineLink" onClick={() => { setWins(false); setSpreadsheet(false); setQuery(""); setPeriodFilter("all"); setStyleFilter("all"); setPanel(null); setAttention("reopen"); }} data-reopen-show>Show</button>
          </div>
        )}

        {hasRows && (
          <AttentionStrip
            counts={attentionNumbers}
            loading={!fullLoaded}
            dueLabel={`Due by ${tomorrowName} night`}
            referral={referral}
            active={attention === "reopen" ? null : attention}
            onFilter={(next) => {
              setAttention((current) => (current === next ? null : next));
              setPanel(null);
            }}
            onOpenReferral={(id) => {
              const row = rowsRef.current.find((r) => r.id === id);
              if (!row) return;
              // It may be on any tab: the referral view holds it, with its Notes panel open.
              setAttention("referrals");
              setSpreadsheet(false);
              setQuery("");
              setPeriodFilter("all");
              setStyleFilter("all");
              if (!(panel?.id === id && panel.kind === "notes")) togglePanel(row, "notes");
            }}
          />
        )}

        {hasRows && (
          <div className="appsBar">
            <StageTabs
              tabs={tabs}
              counts={counts}
              total={rows.length}
              wins={rows.filter(reachedScreening).length}
              selected={winsOpen ? "wins" : attention || searchTerm ? null : tabNow}
              panelId={winsOpen || (!sheetMode && visible.length > 0) ? "appsPanelRegion" : undefined}
              onSelect={(next) => {
                setWins(next === "wins");
                if (next !== "wins") setTab(next);
                setTabPicked(true);
                setAttention(null);
                setQuery("");
                setPanel(null);
              }}
            />
            <div className="appsTools">
              <div className="appsSearchWrap">
                <input
                  type="search"
                  className="appsSearch"
                  placeholder="Search company or role"
                  aria-label="Search applications by company, role or date applied"
                  value={query}
                  maxLength={MAX_SEARCH_CHARS}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                  data-apps-search
                />
                {query && (
                  <button type="button" className="appsSearchClear" onClick={() => setQuery("")} aria-label="Clear search" data-apps-search-clear>×</button>
                )}
              </div>
              <select className="appsToolSelect" aria-label="Period applied in" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as Period)} data-apps-period>
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <div className="appsFilters" ref={filtersRef}>
                <button
                  type="button"
                  className="appsToolBtn"
                  aria-expanded={filtersOpen}
                  aria-haspopup="dialog"
                  onClick={() => setFiltersOpen((v) => !v)}
                  onKeyDown={(e) => { if (e.key === "Escape") setFiltersOpen(false); }}
                  data-apps-filters
                >
                  Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
                </button>
                {filtersOpen && (
                  <div className="appsFiltersPanel" role="dialog" aria-label="Filters" onKeyDown={(e) => { if (e.key === "Escape") setFiltersOpen(false); }} data-apps-filters-panel>
                    {isOwner && (
                      <label className="appsFilterField">
                        <span className="label">CV style</span>
                        <select className="appsToolSelect" value={styleFilter} onChange={(e) => setStyleFilter(e.target.value as "all" | RowStyle)} data-style-filter={styleFilter}>
                          <option value="all">Any</option>
                          {ROW_STYLES.map((k) => <option key={k} value={k}>{ROW_STYLE_LABELS[k]}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="appsFilterField">
                      <span className="label">Sort by</span>
                      <select className="appsToolSelect" value={listSort} onChange={(e) => setListSort(e.target.value as typeof listSort)} disabled={spreadsheet} data-apps-sort>
                        <option value="next">Next step</option>
                        <option value="company">Company</option>
                        <option value="contact">Last contact</option>
                        <option value="applied">Date applied</option>
                      </select>
                    </label>
                    <label className="planRadio">
                      <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} data-include-past />
                      Include past stages
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(flash || actionError) && (
          <div className="appsStatusLine">
            {flash && <StatusText as="span" tone="success" role="status">{flash}</StatusText>}
            {actionError && (
              <StatusText as="span" role="alert">
                {actionError}
                {sessionExpired && (
                  <>
                    {" "}
                    <Link href="/auth/login?next=/applications" className="inlineLink">Sign in</Link>
                  </>
                )}
              </StatusText>
            )}
          </div>
        )}

        {cleanupOpen && isOwner && (
          <CleanupPanel
            confirm={confirm}
            onClose={() => setCleanupOpen(false)}
            onApplied={async () => {
              const result = await fetchApplications();
              if ("rows" in result) setRows(result.rows);
              setStageRefresh((n) => n + 1);
            }}
          />
        )}

        {attention === "fix" && notSubmitted.length > 0 && bulkReady !== "dismissed" && (
          <div className="limitNotice" role="status" data-bulk-ready={bulkReady}>
            {bulkReady === "offer" ? (
              <>
                {notSubmitted.length === 1 ? "One application's notes say it was not submitted, but its status is Applied." : `${notSubmitted.length} applications' notes say they were not submitted, but their status is Applied.`}{" "}
                <button type="button" className="inlineLink" onClick={() => setBulkReady("review")}>Review</button>{" "}
                <button type="button" className="inlineLink" onClick={() => setBulkReady("dismissed")}>Dismiss</button>
              </>
            ) : (
              <>
                <p>These rows would move to <strong>Ready to submit</strong> (not counted as applications until you move them back):</p>
                <ul className="atsList">
                  {notSubmitted.map((r) => (
                    <li key={r.id}>
                      <strong>{r.company_name}</strong> — {r.role} ({formatDate(r.date_applied)}): “{(r.notes_preview ?? "").slice(0, 90)}
                      {(r.notes_preview ?? "").length > 90 || r.notes_more ? "…" : ""}”
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <Button variant="secondary" onClick={moveNotSubmitted} disabled={bulkReady === "moving"} data-bulk-ready-confirm>
                    {bulkReady === "moving" ? "Moving…" : `Move ${notSubmitted.length} to Ready to submit`}
                  </Button>
                  <button type="button" className="inlineLink" onClick={() => setBulkReady("dismissed")} disabled={bulkReady === "moving"}>
                    Leave them
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!hasRows && !newRow && !pageError && (
          <Card variant="dashed">
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 10h18M9 4v16" />
                </svg>
              }
              title="No applications yet"
              actions={
                <>
                  <Button onClick={startNewRow}>+ Add row</Button>
                  <Button variant="secondary" href="/app">Tailor a CV</Button>
                </>
              }
            >
              Tailor a CV and click <strong>Applied</strong> to track it here, or add a row for one you sent
              through another channel.
            </EmptyState>
          </Card>
        )}

        {hasRows && stageTabNow && visible.length === 0 && !newRow && noFilters && (
          <p className="fitEvidence" data-live-empty>Nothing live at this stage.</p>
        )}
        {hasRows && visible.length === 0 && !newRow && !winsOpen && !(stageTabNow && noFilters) && (
          <Card variant="dashed">
            <EmptyState
              title={
                <>
                  No applications
                  {periodFilter !== "all" ? ` ${PERIODS.find((p) => p.key === periodFilter)?.label.toLowerCase()}` : ""}
                  {!attention && tabNow !== "all" ? ` in ${TAB_LABELS[tabNow]}` : ""}
                  {attention ? ` under ${viewLabel}` : ""}
                  {styleFilter !== "all" ? ` in the ${ROW_STYLE_LABELS[styleFilter]} style` : ""}
                  {searchTerm ? ` matching “${searchTerm}”` : ""}
                </>
              }
              actions={
                <Button
                  variant="secondary"
                  onClick={() => { setPeriodFilter("all"); setStyleFilter("all"); setAttention(null); setIncludePast(false); setQuery(""); }}
                >
                  Clear filters
                </Button>
              }
            />
          </Card>
        )}

        {winsOpen ? (
          <div id="appsPanelRegion" role="tabpanel" aria-labelledby="stage-tab-wins">
            <WinsView rows={rows} showStyle={isOwner} />
          </div>
        ) : !sheetMode ? (
          visible.length > 0 && (
            <div id="appsPanelRegion" role="tabpanel" aria-labelledby={attention || searchTerm ? undefined : `stage-tab-${tabNow}`} aria-label={attention || searchTerm ? viewLabel : undefined} className="stageListWrap" data-stage-table={attention ?? tabNow}>
              <table className="stageList">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Next step</th>
                    <th scope="col"><span className="srOnly">Actions</span></th>
                  </tr>
                </thead>
                <tbody>{pageRows.map(renderListRow)}</tbody>
              </table>
            </div>
          )
        ) : showTable && (
          <div className="appsTableWrap riseIn riseIn--delayed">
            <table className="appsTable">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      // aria-sort belongs on the column header, not the button inside it.
                      aria-sort={col.sortable ? (sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          className={"appsSortBtn" + (sortKey === col.key ? " active" : "")}
                          onClick={() => toggleSort(col.key as SortKey)}
                        >
                          {col.label}
                          {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                  <th scope="col" className="appsActions">
                    <span className="srOnly">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {newRow && (
                  <>
                    <tr className="appsNewRow">
                      <td data-label="Company Name">
                        <input
                          className="appsCellInput"
                          autoFocus
                          value={newRow.company_name}
                          onChange={(e) => updateNewRow("company_name", e.target.value)}
                          onKeyDown={handleNewRowKey}
                          placeholder="Company"
                          maxLength={200}
                          aria-label="Company name"
                          disabled={savingNew}
                        />
                      </td>
                      <td data-label="Role">
                        <input
                          className="appsCellInput"
                          value={newRow.role}
                          onChange={(e) => updateNewRow("role", e.target.value)}
                          onKeyDown={handleNewRowKey}
                          placeholder="Role"
                          maxLength={200}
                          aria-label="Role"
                          disabled={savingNew}
                        />
                      </td>
                      <td data-label="CV">
                        {isOwner ? (
                          <select
                            className="appsCellSelect appsStyleSelect"
                            value={newRow.formatStyle}
                            onChange={(e) => updateNewRow("formatStyle", rowStyle(e.target.value))}
                            onKeyDown={handleNewRowKey}
                            aria-label="Format style of the CV sent"
                            title="The format style of the CV you sent"
                            disabled={savingNew}
                            data-new-style
                          >
                            {ROW_STYLES.map((k) => (
                              <option key={k} value={k}>{ROW_STYLE_LABELS[k]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="appsCellStatic">—</span>
                        )}
                      </td>
                      <td data-label="JD"><span className="appsCellStatic">after save</span></td>
                      <td data-label="Gate"><span className="appsCellStatic">—</span></td>
                      <td data-label="Status">
                        <select
                          className="appsCellSelect"
                          value={newRow.status}
                          onChange={(e) => updateNewRow("status", e.target.value as Status)}
                          onKeyDown={handleNewRowKey}
                          aria-label="Status"
                          disabled={savingNew}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Salary">
                        <input
                          className="appsCellInput"
                          value={newRow.salary}
                          onChange={(e) => updateNewRow("salary", e.target.value)}
                          onKeyDown={handleNewRowKey}
                          placeholder="Optional"
                          maxLength={100}
                          aria-label="Salary"
                          disabled={savingNew}
                        />
                      </td>
                      <td data-label="Date Applied">
                        <input
                          className="appsCellInput"
                          type="date"
                          value={newRow.date_applied}
                          onChange={(e) => updateNewRow("date_applied", e.target.value)}
                          onKeyDown={handleNewRowKey}
                          aria-label="Date applied"
                          disabled={savingNew}
                        />
                      </td>
                      <td data-label="Follow-up Date">
                        <input
                          className="appsCellInput"
                          type="date"
                          value={newRow.followup_date}
                          min={newRow.date_applied || undefined}
                          onChange={(e) => updateNewRow("followup_date", e.target.value)}
                          onKeyDown={handleNewRowKey}
                          aria-label="Follow-up date"
                          disabled={savingNew}
                        />
                      </td>
                      <td data-label="Notes"><span className="appsCellStatic">after save</span></td>
                      <td className="appsActions">
                        <button type="button" className="appsActionBtn primary" onClick={saveNewRow} disabled={savingNew}>
                          {savingNew ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="appsActionBtn" onClick={() => setNewRow(null)} disabled={savingNew}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                    {newRowErr && (
                      <tr className="appsNewRow">
                        <td colSpan={COL_COUNT}>
                          <span className="appsCellError" role="alert">{newRowErr}</span>
                        </td>
                      </tr>
                    )}
                    {(newRowDuplicate || newRowRoleLong) && (
                      <tr className="appsNewRow">
                        <td colSpan={COL_COUNT}>
                          {newRowDuplicate && (
                            <span className="appsCellHint" role="status" data-dup-warning>
                              You already have <strong>{newRowDuplicate.company_name}</strong> — {newRowDuplicate.role} ({formatDate(newRowDuplicate.date_applied)}, {statusLabel(newRowDuplicate.status)}).
                              Save anyway only if this is a different posting.
                            </span>
                          )}
                          {newRowRoleLong && (
                            <span className="appsCellHint" role="status" data-role-long>
                              {newRow.role.trim().length} characters is long for a role (over {ROLE_WARN_CHARS}) — the sheet and insights work best with the job title alone; put the rest in Notes.
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )}

                {pageRows.map((row) => {
                  const open = panel?.id === row.id;
                  const confirming = confirmDeleteId === row.id;
                  const panelIs = (kind: PanelKind) => open && panel?.kind === kind;
                  return (
                    <RowGroup key={row.id}>
                      <tr className={"appsRow" + (open ? " open" : "") + (flashRowId === row.id ? " flashSave" : "")}>
                        <td data-label="Company Name">
                          {textCell(row, "company_name")}
                          <RowFlags
                            row={row}
                            checking={checkingId === row.id}
                            onRunCheck={() => void runCheck(row)}
                            onAddJd={() => { if (!panelIs("jd")) togglePanel(row, "jd"); }}
                          />
                          {isReplyOwed(row, now) && (
                            <span className="replyOwed" data-reply-owed>
                              <span
                                className="replyOwed__badge"
                                title={`They wrote on ${formatDate(row.last_contact_at?.slice(0, 10) ?? null)} and no reply is recorded since.`}
                              >
                                Reply owed
                              </span>
                              <button
                                type="button"
                                className="inlineLink"
                                onClick={() => void recordContact(row, "me")}
                                aria-label={`I replied to ${row.company_name}`}
                                data-reply-done
                              >
                                I replied
                              </button>
                            </span>
                          )}
                        </td>
                        <td data-label="Role">{textCell(row, "role")}</td>
                        <td data-label="CV">
                          {/* A row added by hand has no tailored CV; its CV
                              cell opens the panel to upload the file sent. */}
                          <button
                            type="button"
                            className={
                              "appsLinkBtn" +
                              (panelIs("cv") ? " active" : "") +
                              (row.source === "tailored" || row.sent_cv_name ? "" : " muted")
                            }
                            onClick={() => togglePanel(row, "cv")}
                            title={row.sent_cv_name ?? row.cv_reference ?? undefined}
                            data-cv-cell={row.source === "tailored" || row.sent_cv_name ? "view" : "add"}
                            aria-busy={cvLoading[row.id] ? true : undefined}
                          >
                            {cvLoading[row.id] ? "Loading…" : row.source === "tailored" || row.sent_cv_name ? "View CV" : "Add CV"}
                          </button>
                          {/* The format-style tag (lib/formatStyles): a tailored row
                              keeps the style it was made with; a hand-added row is
                              told by hand. The owner's account only. */}
                          {isOwner &&
                            (row.source === "tailored" ? (
                              <span className="appsStyleTag" data-style-tag={rowStyle(row.format_style)}>
                                {ROW_STYLE_LABELS[rowStyle(row.format_style)]}
                              </span>
                            ) : (
                              <select
                                className="appsCellSelect appsStyleSelect"
                                value={rowStyle(row.format_style)}
                                onChange={(e) => void changeStyle(row, e.target.value)}
                                aria-label={`Format style of the CV sent to ${row.company_name}`}
                                title="The format style of the CV you sent"
                                data-style-pick={rowStyle(row.format_style)}
                              >
                                {ROW_STYLES.map((k) => (
                                  <option key={k} value={k}>{ROW_STYLE_LABELS[k]}</option>
                                ))}
                              </select>
                            ))}
                        </td>
                        <td data-label="JD">
                          <button
                            type="button"
                            className={"appsLinkBtn" + (panelIs("jd") ? " active" : "") + (row.has_job_description ? "" : " muted")}
                            onClick={() => togglePanel(row, "jd")}
                          >
                            {row.has_job_description ? "View JD" : "Add JD"}
                          </button>
                        </td>
                        <td data-label="Gate">
                          {(() => {
                            const line = gateLine(readStoredGates(row.gates));
                            return (
                              <span
                                className={"appsGateDot " + (line.label === "Knockout" ? "knockout" : line.label === "Clear" ? "matched" : line.label === "Long shot" ? "longshot" : "muted")}
                                title={line.detail}
                                data-gate={line.label}
                              >
                                <span className="srOnly">{line.label}: {line.detail}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td data-label="Status">
                          <span className="appsStatusWrap">
                            <span className={"appsStatusDot " + STATUS_TONES[row.status]} aria-hidden="true" />
                            <select
                              className="appsCellSelect"
                              value={row.status}
                              onChange={(e) => void changeStatus(row, e.target.value as Status)}
                              aria-label={`Status for ${row.company_name}`}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td data-label="Salary">{textCell(row, "salary")}</td>
                        <td data-label="Date Applied">{textCell(row, "date_applied")}</td>
                        <td data-label="Follow-up Date">{textCell(row, "followup_date")}</td>
                        <td data-label="Notes" className="appsNotesCell">
                          <button
                            type="button"
                            className={"appsLinkBtn appsNotesBtn" + (panelIs("notes") ? " active" : "") + (row.notes_preview ? "" : " muted")}
                            onClick={() => togglePanel(row, "notes")}
                            title={row.notes_preview ? `${row.notes_preview}${row.notes_more ? "…" : ""}` : undefined}
                          >
                            {row.notes_preview || "Add notes"}
                          </button>
                        </td>
                        <td className="appsActions">
                          {confirming ? (
                            <>
                              <span className="appsConfirm">Delete?</span>
                              <button
                                type="button"
                                className="appsActionBtn danger"
                                onClick={() => confirmDelete(row.id)}
                                disabled={deletingId === row.id}
                              >
                                {deletingId === row.id ? "Deleting…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                className="appsActionBtn"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deletingId === row.id}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <Link
                                href={`/applications/${row.id}/prep`}
                                className={
                                  "appsActionBtn" +
                                  (row.prep_generated_at || row.status === "screening" || row.status === "interview" ? " primary" : "")
                                }
                                aria-label={`Interview prep for ${row.company_name}`}
                                title={row.prep_generated_at ? "Open your prep pack" : "Prepare for the interview"}
                              >
                                {row.prep_generated_at ? "Prep ✓" : "Prep"}
                              </Link>
                              <Link
                                href={`/applications/${row.id}/interview`}
                                className="appsActionBtn"
                                aria-label={`Mock interview for ${row.company_name}`}
                                title="Practise out loud with an AI interviewer"
                              >
                                Interview
                              </Link>
                              <button
                                type="button"
                                className="appsActionBtn danger"
                                onClick={() => setConfirmDeleteId(row.id)}
                                aria-label={`Delete ${row.company_name}`}
                                title="Delete"
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="appsDetail">
                          <td colSpan={COL_COUNT}>{renderPanel(row)}</td>
                        </tr>
                      )}
                    </RowGroup>
                  );
                })}
              </tbody>
            </table>
            {sheet.pages > 1 && (
              <nav className="appsPager" aria-label="Pages of applications" data-apps-pager>
                <button type="button" className="appsActionBtn" onClick={() => goToPage(sheet.page - 1)} disabled={sheet.page === 1}>
                  ← Previous
                </button>
                <span className="appsCount">
                  Page {sheet.page} of {sheet.pages} · {PAGE_SIZE} rows a page
                </span>
                <button type="button" className="appsActionBtn" onClick={() => goToPage(sheet.page + 1)} disabled={sheet.page === sheet.pages}>
                  Next →
                </button>
              </nav>
            )}
          </div>
        )}

        {stageTabNow && hasRows && (
          <ClosedSection
            key={stageTabNow}
            tab={stageTabNow}
            rows={closedHere}
            eventsOf={(id) => closedEvents.get(id) ?? []}
            onReopen={(row) => void reopenRow(row)}
            onRemoveStage={(row, stage) => void removeStage(row, stage)}
            onDismiss={(row) => void dismissPending(row)}
            onLesson={(id, lesson) => void saveLesson(id, lesson)}
          />
        )}

        {hasRows && !newRow && !winsOpen && (
          <div className="appsFoot" data-apps-foot>
            <div className="appsFootLeft">
              <span data-apps-count>
                {sheet.pages > 1 ? `Showing ${sheet.from}–${sheet.to} of ${visible.length} ${viewLabel}` : `Showing ${visible.length} of ${Math.max(viewTotal, visible.length)} ${viewLabel}`}
                {!fullLoaded && <span className="appsFootNote" data-apps-loading-rest> · loading the rest</span>}
              </span>
              {!attention && !searchTerm && tabNow === "closed" && (
                <span className="appsFootNote" data-closed-breakdown>{fmt(rejectedCount)} rejected · {fmt(withdrawnCount)} withdrawn · {fmt(ghostedCount)} ghosted</span>
              )}
              {elsewhere > 0 && (
                <span className="appsFootNote" data-counted-elsewhere>
                  {elsewhere} more stored as {tabNow !== "all" ? TAB_LABELS[tabNow] : ""} {elsewhere === 1 ? "counts" : "count"} under Assessment: a test is open.
                </span>
              )}
            </div>
            {!sheetMode && sheet.pages > 1 && (
              <nav className="appsPager" aria-label="Pages of applications" data-apps-pager>
                <button type="button" className="appsActionBtn" onClick={() => goToPage(sheet.page - 1)} disabled={sheet.page === 1}>← Previous</button>
                <span className="appsCount">Page {sheet.page} of {sheet.pages}</span>
                <button type="button" className="appsActionBtn" onClick={() => goToPage(sheet.page + 1)} disabled={sheet.page === sheet.pages}>Next →</button>
              </nav>
            )}
            <button
              type="button"
              className="linkBtn"
              onClick={() => {
                if (spreadsheet && tabNow === "all") setTab(null);
                setSpreadsheet((v) => !v);
                setPanel(null);
              }}
              data-stage-sheet
            >
              {spreadsheet ? "← Back to the list" : "Open as spreadsheet →"}
            </button>
          </div>
        )}

        {/* The insights read off the sheet above them: the figures come second,
            the rows first. */}
        {insights && insights.counted >= 5 && (
          <Card data-insights title={insightsNote || undefined}>
            <div className="appsPanelHead">
              <span className="appsPanelTitle">What&apos;s working</span>
              <button
                type="button"
                className="appsActionBtn"
                onClick={() => setShowInsights((v) => !v)}
                aria-expanded={showInsights}
              >
                {showInsights ? "Hide" : "Show breakdown"}
              </button>
            </div>
            <InsightsSummary insights={insights} withoutJd={withoutJd} withoutCv={withoutCv} lanes={lanes} showStyle={isOwner} />
            {showInsights && (
              <>
                <InsightGroup title="By search visibility of the saved CV" buckets={insights.byVisibility} />
                <InsightGroup title="By required-skill coverage" buckets={insights.byRequired} />
                <InsightGroup title="By eligibility read at the pre-check" buckets={insights.byGate} />
                <InsightGroup title="By role seniority" buckets={insights.bySeniority} />
                <InsightGroup title="By role" buckets={insights.byRole} />
                <InsightGroup title="By company" buckets={insights.byCompany} />
                <InsightGroup title="By how the row was made" buckets={insights.bySource} />
                <InsightGroup title="By follow-up date" buckets={insights.byFollowup} />
                <InsightGroup title="By page count of the CV sent" buckets={insights.byPages} />
                <InsightGroup title="By posting age when you applied" buckets={insights.byPostingAge} />
                {isOwner && <InsightGroup title="By format style" buckets={insights.byStyle} />}
                {insights.byVisibility.length + insights.byRequired.length + insights.byGate.length === 0 && (
                  <p className="fitEvidence">
                    Score and eligibility bands appear once applications saved from a tailored run have outcomes.
                  </p>
                )}
              </>
            )}
          </Card>
        )}

        {scoreOutcome && scoreOutcome.points.length > 0 && (
          <Card data-score-outcome data-score-verdict={scoreOutcome.verdict}>
            <div className="appsPanelHead">
              <span className="appsPanelTitle">Does the score predict the outcome?</span>
              <span className="verdictPill" data-verdict={scoreOutcome.verdict}>{VERDICT_LABEL[scoreOutcome.verdict]}</span>
            </div>
            <ScoreOutcomePanel s={scoreOutcome} />
          </Card>
        )}
      </div>

      {eventForm && (
        <EventForm
          mode={eventForm}
          tz={tz}
          otherEvents={events}
          windows={windows}
          onClose={() => setEventForm(null)}
          onSaved={(message, moved) => {
            setEventForm(null);
            if (moved?.reportNotes !== undefined) {
              const notes = moved.reportNotes;
              setRows((rs) => rs.map((r) => (r.id === moved.id ? { ...r, ...notesListFields(notes) } : r)));
              rememberText(moved.id, { notes });
            }
            if (moved) setRows((rs) => rs.map((r) => (r.id === moved.id ? { ...r, closed_at: null, close_reason: null, status: moved.status, stages_reached: stagesAfterMove(r.stages_reached, moved.status) } : r)));
            showFlash(message);
            setStageRefresh((n) => n + 1);
          }}
        />
      )}

      {toast && (
        <div className="planToast" role="status" data-toast>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="planToastUndo"
              data-toast-undo
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                void undo?.();
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="planToastClose" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" /></button>
        </div>
      )}
      {closing && (
        <MoveToClosedDialog
          company={closing.row.company_name}
          reason={closing.reason}
          date={closing.date}
          lesson={closing.row.lesson ?? ""}
          busy={closeBusy}
          error={closeError}
          onCancel={() => setClosing(null)}
          onSubmit={(choice) => void submitClose(choice)}
        />
      )}
      {confirmDialog}
    </main>
  );
}

// Submitted = an application the user actually sent; a "Ready to submit"
// row is kept but not counted (lib/tracker isSubmitted).
function isSubmittedRow(row: Application): boolean {
  return row.status !== READY_TO_SUBMIT;
}

// A row and its optional detail row share one key without an extra wrapper
// element, which <tbody> wouldn't allow.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
