"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import CvPreview from "../CvPreview";
import { getProfile, type Profile } from "@/lib/cvStore";
import { localIsoDate, addDays } from "@/lib/applicationSnapshot";
import { saveBlob } from "@/lib/saveBlob";
import { MAX_JD_CHARS as JD_LIMIT, MAX_NOTES_CHARS, JD_TOO_LONG } from "@/lib/limits";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Textarea from "@/components/ui/Textarea";
import StatusText from "@/components/ui/StatusText";

const PAGE_TAGLINE =
  "Every role you've applied to, in one sheet. Click any cell to edit it; click CV, JD or Notes to open that application's details.";

const STATUSES = ["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"] as const;
type Status = (typeof STATUSES)[number];

const MAX_JD_CHARS = JD_LIMIT;
const MAX_NOTES = MAX_NOTES_CHARS;

type Application = {
  id: string;
  company_name: string;
  role: string;
  cv_reference: string | null;
  tailor_session_id: string | null;
  status: Status;
  salary: string | null;
  date_applied: string;
  followup_date: string | null;
  notes: string | null;
  job_description: string | null;
  source: "tailored" | "manual";
  created_at: string;
  updated_at: string;
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
};

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
type PanelKind = "cv" | "jd" | "notes";

const COLUMNS: { key: SortKey | PanelKind; label: string; sortable: boolean }[] = [
  { key: "company_name", label: "Company Name", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "cv", label: "CV", sortable: false },
  { key: "jd", label: "JD", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "salary", label: "Salary", sortable: true },
  { key: "date_applied", label: "Date Applied", sortable: true },
  { key: "followup_date", label: "Follow-up Date", sortable: true },
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
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayLocal(): string {
  return localIsoDate(new Date());
}

// A follow-up is "due" while the application is still moving — a date in the
// past on a Rejected row is history, not a task.
const LIVE_STATUSES: ReadonlySet<Status> = new Set(["Applied", "Screening", "Interview"]);

function isDue(row: Application): boolean {
  return !!row.followup_date && row.followup_date <= todayLocal() && LIVE_STATUSES.has(row.status);
}

// Data colour only: outcomes get colour, in-flight statuses stay neutral.
const STATUS_TONES: Record<Status, string> = {
  Applied: "neutral",
  Screening: "neutral",
  Interview: "neutral",
  Offer: "success",
  Rejected: "danger",
  Withdrawn: "muted",
};

// Period filter on date_applied, in the user's own timezone. Calendar periods:
// "week" is Monday–Sunday of the current week, "month" the current month.
type Period = "all" | "today" | "week" | "month";
const PERIODS: { key: Period; label: string }[] = [
  { key: "all", label: "All" },
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

// Dates arrive as plain YYYY-MM-DD strings; format them without a Date
// round-trip so the day never shifts with the viewer's timezone.
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

type ApiResult = { ok: boolean; status: number; data: { error?: string } & Record<string, unknown> };

async function api(method: string, body?: unknown, query = ""): Promise<ApiResult> {
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

async function fetchApplications(): Promise<{ rows: Application[] } | { error: string; expired?: boolean }> {
  const { ok, status, data } = await api("GET");
  if (status === 401) return { error: SESSION_EXPIRED, expired: true };
  if (!ok) return { error: data.error || "Could not load your applications." };
  return { rows: (data.applications as Application[] | undefined) ?? [] };
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
  const rowsRef = useRef<Application[]>([]);
  rowsRef.current = rows;
  const [loaded, setLoaded] = useState(false);
  const [pageError, setPageError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  // Fallbacks for CV snapshots that were stored without a profile / order.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sectionOrder, setSectionOrder] = useState<unknown>(null);

  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const [periodFilter, setPeriodFilter] = useState<Period>("all");
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
  const [cvError, setCvError] = useState("");
  const [jdDraft, setJdDraft] = useState("");
  const [jdEditing, setJdEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [panelError, setPanelError] = useState("");

  const [newRow, setNewRow] = useState<NewRow | null>(null);
  const [newRowErr, setNewRowErr] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // One flag per kind of action, so deleting a row doesn't relabel an open
  // panel's Save button "Saving…".
  const [savingNew, setSavingNew] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState("");
  // A caution that isn't a failure (e.g. saved without the CV snapshot).
  const [notice, setNotice] = useState("");
  const [flash, setFlash] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Follow-ups due" computed filter — combines with, not replaces, status/period.
  const [dueOnly, setDueOnly] = useState(false);
  // The row that just saved, for a brief success flash on its cells.
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const rowFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApplications().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setPageError(result.error);
        if (result.expired) setSessionExpired(true);
      } else {
        setRows(result.rows);
      }
      setLoaded(true);
    });
    getProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
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
    };
  }, []);

  function showFlash(message: string) {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 3000);
  }

  function flashRow(id: string) {
    setFlashRowId(id);
    if (rowFlashTimer.current) clearTimeout(rowFlashTimer.current);
    rowFlashTimer.current = setTimeout(() => setFlashRowId(null), 700);
  }

  const bounds = periodBounds(periodFilter);

  // Funnel strip numbers — always over ALL rows, so the overview stays stable
  // while filters narrow the table below it.
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const r of rows) if (r.status in counts) counts[r.status] += 1;
    return counts;
  }, [rows]);
  const dueCount = useMemo(() => rows.filter(isDue).length, [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (statusFilter === "All" || r.status === statusFilter) &&
        (!bounds || (r.date_applied >= bounds.from && r.date_applied <= bounds.to)) &&
        (!dueOnly || isDue(r))
    );
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
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = compare(a, b);
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [rows, statusFilter, bounds?.from, bounds?.to, sortKey, sortDir, dueOnly]);

  // The export carries the same filters, so the file matches the screen.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "All") params.set("status", statusFilter);
    if (bounds) {
      params.set("from", bounds.from);
      params.set("to", bounds.to);
    }
    const qs = params.toString();
    return `/api/applications/export${qs ? `?${qs}` : ""}`;
  }, [statusFilter, bounds?.from, bounds?.to]);

  // The CV shown in the open panel. Memoised so CvPreview's React.memo holds.
  const panelCv = panel?.kind === "cv" ? cvCache[panel.id] : undefined;
  const panelCvData = useMemo(
    () =>
      panelCv
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

  // Apply locally first, then PUT one field; put it back if the save fails.
  // Only the keys in this patch are reverted — another cell's edit that
  // succeeded in the meantime must not be undone with it.
  // Returns the error message, or null on success.
  async function patchRow(id: string, patch: Partial<Application>): Promise<string | null> {
    const previous = rowsRef.current.find((r) => r.id === id);
    if (!previous) return "Application not found";
    const undo: Partial<Application> = {};
    for (const key of Object.keys(patch) as (keyof Application)[]) {
      (undo as Record<string, unknown>)[key] = previous[key];
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { ok, status, data } = await api("PUT", { id, ...patch });
    if (!ok) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...undo } : r)));
      if (status === 401) {
        setSessionExpired(true);
        return SESSION_EXPIRED;
      }
      return data.error || "Could not save that change.";
    }
    flashRow(id);
    return null;
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

  function handleCellKey(e: React.KeyboardEvent<HTMLInputElement>, field: TextField) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitCell();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelCell();
    } else if (e.key === "Tab") {
      const i = CELL_ORDER.indexOf(field);
      const next = (e.shiftKey ? CELL_ORDER[i - 1] : CELL_ORDER[i + 1]) ?? null;
      // Past the last (or before the first) editable cell, let the browser
      // move focus on naturally instead of stranding it on <body>.
      if (next) e.preventDefault();
      void commitCell(next);
    }
  }

  function changeStatus(row: Application, status: Status) {
    if (status === row.status) return;
    void patchRow(row.id, { status }).then((message) => setActionError(message ?? ""));
  }

  // ── Panels (CV / JD / Notes) ──────────────────────────────────────────────

  function togglePanel(row: Application, kind: PanelKind) {
    if (panel && panel.id === row.id && panel.kind === kind) {
      setPanel(null);
      return;
    }
    setPanel({ id: row.id, kind });
    setPanelError("");
    setCvError(""); // a failure on one row must not mask another row's cached CV
    if (kind === "jd") {
      setJdDraft(row.job_description ?? "");
      setJdEditing(!row.job_description);
    }
    if (kind === "notes") setNotesDraft(row.notes ?? "");
    if (kind === "cv" && !(row.id in cvCache)) void loadCv(row.id);
  }

  async function loadCv(id: string) {
    setCvError("");
    const { ok, data } = await api("GET", undefined, `?id=${encodeURIComponent(id)}`);
    if (!ok) {
      setCvError(data.error || "Could not load that CV.");
      return;
    }
    const app = data.application as { tailored_cv?: TailoredCv | null } | undefined;
    setCvCache((c) => ({ ...c, [id]: app?.tailored_cv ?? null }));
  }

  async function saveJd(row: Application) {
    const jd = jdDraft.trim();
    if (jd.length > MAX_JD_CHARS) {
      setPanelError(JD_TOO_LONG);
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    const message = await patchRow(row.id, { job_description: jd || null });
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
    const notes = notesDraft.trim();
    if (notes.length > MAX_NOTES) {
      setPanelError(`Notes are too long (max ${MAX_NOTES} characters).`);
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    const message = await patchRow(row.id, { notes: notes || null });
    setPanelBusy(false);
    if (message) {
      setPanelError(message);
      return;
    }
    setPanel(null);
    showFlash("Saved.");
  }

  // Download through fetch rather than a plain link: a failed export (expired
  // session, server error) then shows inline instead of navigating the whole
  // tracker to a page of raw JSON.
  async function exportCsv() {
    setExporting(true);
    setActionError("");
    try {
      const res = await fetch(exportHref);
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
    cancelCell();
    setPanel(null);
    setNewRow({
      company_name: "",
      role: "",
      status: "Applied",
      salary: "",
      date_applied: todayLocal(),
      followup_date: "",
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

  function textCell(row: Application, field: TextField) {
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
        title={due ? "Follow-up due — click to edit" : "Click to edit"}
        aria-label={value ? undefined : `${CELL_LABELS[field]}: empty, click to edit`}
      >
        {display || "—"}
      </button>
    );
  }

  function renderPanel(row: Application) {
    if (!panel) return null;

    if (panel.kind === "cv") {
      const snap = cvCache[row.id];
      return (
        <div className="appsPanel">
          <div className="appsPanelHead">
            <span className="appsPanelTitle">
              Tailored CV{row.cv_reference ? ` · ${row.cv_reference}` : ""}
            </span>
            <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
          </div>
          {cvError ? (
            <StatusText role="alert">{cvError}</StatusText>
          ) : snap === undefined ? (
            <p className="cvHelp">Loading the CV…</p>
          ) : snap === null || !panelCvData ? (
            <p className="appsMuted">
              No CV snapshot is stored for this application — it was saved before CV snapshots existed.
            </p>
          ) : (
            <CvPreview
              data={panelCvData}
              profile={snap.profile ?? profile}
              sectionOrder={snap.sectionOrder ?? sectionOrder}
              fileBaseName={row.cv_reference ?? "CV"}
            />
          )}
        </div>
      );
    }

    if (panel.kind === "jd") {
      return (
        <div className="appsPanel">
          <div className="appsPanelHead">
            <span className="appsPanelTitle">Job description</span>
            <div className="appsPanelActions">
              {!jdEditing && (
                <button
                  type="button"
                  className="appsActionBtn"
                  onClick={() => {
                    setJdDraft(row.job_description ?? "");
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
                  onClick={() => (row.job_description ? setJdEditing(false) : setPanel(null))}
                  disabled={panelBusy}
                >
                  Cancel
                </Button>
                {panelError && <StatusText as="span" role="alert">{panelError}</StatusText>}
              </div>
            </>
          ) : (
            <pre className="appsJd">{row.job_description}</pre>
          )}
        </div>
      );
    }

    return (
      <div className="appsPanel">
        <div className="appsPanelHead">
          <span className="appsPanelTitle">Notes</span>
          <button type="button" className="appsActionBtn" onClick={() => setPanel(null)}>Close</button>
        </div>
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="Recruiter name, referral, what you emphasised, next steps…"
          rows={4}
          disabled={panelBusy}
          aria-label="Notes"
        />
        <p className={"charCount" + (notesDraft.length > MAX_NOTES ? " over" : "")} aria-live="polite">
          {notesDraft.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}
        </p>
        <div className="actions">
          <Button variant="secondary" onClick={() => saveNotes(row)} disabled={panelBusy}>
            {panelBusy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setPanel(null)} disabled={panelBusy}>Cancel</Button>
          {panelError && <StatusText as="span" role="alert">{panelError}</StatusText>}
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <main className="page">
        <div className="container appsContainer">
          <AppHeader title="Applications" tagline={PAGE_TAGLINE} />
          <Card><Skeleton lines={4} label="Loading your applications" /></Card>
        </div>
      </main>
    );
  }

  const hasRows = rows.length > 0;
  const showTable = visible.length > 0 || newRow !== null;

  return (
    <main className="page">
      <div className="container appsContainer">
        <AppHeader title="Applications" tagline={PAGE_TAGLINE} />

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

        {hasRows && (
          <div className="appsFunnel" role="group" aria-label="Applications by status">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={
                  "appsFunnelChip" +
                  (statusFilter === s ? " active" : "") +
                  (statusCounts[s] === 0 ? " zero" : "")
                }
                onClick={() => setStatusFilter(statusFilter === s ? "All" : s)}
                aria-pressed={statusFilter === s}
              >
                {s} <strong>{statusCounts[s]}</strong>
              </button>
            ))}
            {dueCount > 0 && (
              <button
                type="button"
                className={"appsFunnelChip due" + (dueOnly ? " active" : "")}
                onClick={() => setDueOnly((v) => !v)}
                aria-pressed={dueOnly}
              >
                {dueCount} follow-up{dueCount === 1 ? "" : "s"} due
              </button>
            )}
          </div>
        )}

        <div className="appsToolbar">
          <div className="appsToolbarGroup">
            <label className="appsFilterLabel" htmlFor="statusFilter">Status</label>
            <select
              id="statusFilter"
              className="appsSelect"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "All" | Status)}
            >
              <option value="All">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="appsSeg" role="group" aria-label="Filter by date applied">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={"appsSegBtn" + (periodFilter === p.key ? " active" : "")}
                  onClick={() => setPeriodFilter(p.key)}
                  aria-pressed={periodFilter === p.key}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {hasRows && (
              <span className="appsCount">
                {visible.length} of {rows.length}
              </span>
            )}
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
          <div className="appsToolbarGroup">
            {/* Only offered when the current filters leave something to export. */}
            {visible.length > 0 && (
              <button type="button" className="customizeLink" onClick={exportCsv} disabled={exporting}>
                {exporting ? "Exporting…" : `Export CSV${periodFilter !== "all" || statusFilter !== "All" ? ` (${visible.length})` : ""}`}
              </button>
            )}
            <Button onClick={startNewRow} disabled={newRow !== null || sessionExpired}>+ Add row</Button>
          </div>
        </div>

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

        {hasRows && visible.length === 0 && !newRow && (
          <Card variant="dashed">
            <EmptyState
              title={
                <>
                  No applications
                  {periodFilter !== "all" ? ` ${PERIODS.find((p) => p.key === periodFilter)?.label.toLowerCase()}` : ""}
                  {statusFilter !== "All" ? ` with status “${statusFilter}”` : ""}
                  {dueOnly ? " with a follow-up due" : ""}
                </>
              }
              actions={
                <Button
                  variant="secondary"
                  onClick={() => { setPeriodFilter("all"); setStatusFilter("All"); setDueOnly(false); }}
                >
                  Clear filters
                </Button>
              }
            />
          </Card>
        )}

        {showTable && (
          <div className="appsTableWrap">
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
                      <td data-label="CV"><span className="appsCellStatic">—</span></td>
                      <td data-label="JD"><span className="appsCellStatic">after save</span></td>
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
                            <option key={s} value={s}>{s}</option>
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
                  </>
                )}

                {visible.map((row) => {
                  const open = panel?.id === row.id;
                  const confirming = confirmDeleteId === row.id;
                  const panelIs = (kind: PanelKind) => open && panel?.kind === kind;
                  return (
                    <RowGroup key={row.id}>
                      <tr className={"appsRow" + (open ? " open" : "") + (flashRowId === row.id ? " flashSave" : "")}>
                        <td data-label="Company Name">{textCell(row, "company_name")}</td>
                        <td data-label="Role">{textCell(row, "role")}</td>
                        <td data-label="CV">
                          {row.source === "tailored" ? (
                            <button
                              type="button"
                              className={"appsLinkBtn" + (panelIs("cv") ? " active" : "")}
                              onClick={() => togglePanel(row, "cv")}
                              title={row.cv_reference ?? undefined}
                            >
                              View CV
                            </button>
                          ) : (
                            <span className="appsCellStatic">—</span>
                          )}
                        </td>
                        <td data-label="JD">
                          <button
                            type="button"
                            className={"appsLinkBtn" + (panelIs("jd") ? " active" : "") + (row.job_description ? "" : " muted")}
                            onClick={() => togglePanel(row, "jd")}
                          >
                            {row.job_description ? "View JD" : "Add JD"}
                          </button>
                        </td>
                        <td data-label="Status">
                          <span className="appsStatusWrap">
                            <span className={"appsStatusDot " + STATUS_TONES[row.status]} aria-hidden="true" />
                            <select
                              className="appsCellSelect"
                              value={row.status}
                              onChange={(e) => changeStatus(row, e.target.value as Status)}
                              aria-label={`Status for ${row.company_name}`}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
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
                            className={"appsLinkBtn appsNotesBtn" + (panelIs("notes") ? " active" : "") + (row.notes ? "" : " muted")}
                            onClick={() => togglePanel(row, "notes")}
                            title={row.notes ?? undefined}
                          >
                            {row.notes || "Add notes"}
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
                            <button
                              type="button"
                              className="appsActionBtn danger"
                              onClick={() => setConfirmDeleteId(row.id)}
                              aria-label={`Delete ${row.company_name}`}
                              title="Delete"
                            >
                              ✕
                            </button>
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
          </div>
        )}
      </div>
    </main>
  );
}

// A row and its optional detail row share one key without an extra wrapper
// element, which <tbody> wouldn't allow.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
