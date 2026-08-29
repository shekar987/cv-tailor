"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";

const STATUSES = ["Applied", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"] as const;
type Status = (typeof STATUSES)[number];

const MAX_JD_CHARS = 15_000; // matches /api/applications and /api/tailor

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

// The editable subset, as form strings (empty string = null on the wire).
type Draft = {
  company_name: string;
  role: string;
  status: Status;
  salary: string;
  date_applied: string;
  followup_date: string;
  notes: string;
};

type SortKey = "company_name" | "role" | "status" | "salary" | "date_applied" | "followup_date";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey | "cv_reference" | "notes"; label: string; sortable: boolean }[] = [
  { key: "company_name", label: "Company", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "cv_reference", label: "CV", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "salary", label: "Salary", sortable: true },
  { key: "date_applied", label: "Date applied", sortable: true },
  { key: "followup_date", label: "Follow-up", sortable: true },
  { key: "notes", label: "Notes", sortable: false },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Local calendar date. toISOString() is UTC and shifts the day near midnight.
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Dates arrive as plain YYYY-MM-DD strings; format them without a Date
// round-trip so the day never shifts with the viewer's timezone.
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function emptyDraft(): Draft {
  return {
    company_name: "",
    role: "",
    status: "Applied",
    salary: "",
    date_applied: todayLocal(),
    followup_date: "",
    notes: "",
  };
}

function draftFrom(app: Application): Draft {
  return {
    company_name: app.company_name,
    role: app.role,
    status: app.status,
    salary: app.salary ?? "",
    date_applied: app.date_applied,
    followup_date: app.followup_date ?? "",
    notes: app.notes ?? "",
  };
}

// Client-side pre-check so the common mistakes get instant feedback; the API
// re-validates everything.
function draftError(d: Draft): string {
  if (!d.company_name.trim()) return "Company name is required.";
  if (!d.role.trim()) return "Role is required.";
  if (!d.date_applied) return "Enter the date applied.";
  if (d.followup_date && d.followup_date < d.date_applied) {
    return "Follow-up date can't be earlier than the date applied.";
  }
  return "";
}

function draftToBody(d: Draft) {
  return {
    company_name: d.company_name,
    role: d.role,
    status: d.status,
    salary: d.salary,
    date_applied: d.date_applied,
    followup_date: d.followup_date || null,
    notes: d.notes,
  };
}

async function fetchApplications(): Promise<{ rows: Application[] } | { error: string }> {
  try {
    const res = await fetch("/api/applications");
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Could not load your applications." };
    return { rows: data.applications ?? [] };
  } catch {
    return { error: "Connection error. Please try again." };
  }
}

export default function ApplicationsPage() {
  const [rows, setRows] = useState<Application[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pageError, setPageError] = useState("");

  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const [sortKey, setSortKey] = useState<SortKey>("date_applied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [addJd, setAddJd] = useState("");
  const [addError, setAddError] = useState("");

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchApplications().then((result) => {
      if (cancelled) return;
      if ("error" in result) setPageError(result.error);
      else setRows(result.rows);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function showFlash(message: string) {
    setFlash(message);
    setTimeout(() => setFlash(""), 3000);
  }

  const visible = useMemo(() => {
    const filtered = statusFilter === "All" ? rows : rows.filter((r) => r.status === statusFilter);
    // Empty values always sort last, whichever direction is active.
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [rows, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "date_applied" || key === "followup_date" ? "desc" : "asc");
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, id: string) {
    // Controls inside the row do their own thing; only bare cell clicks toggle.
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a, label")) return;
    if (editingId === id) return;
    setExpandedId((cur) => (cur === id ? null : id));
  }

  function startEdit(app: Application) {
    setEditingId(app.id);
    setDraft(draftFrom(app));
    setEditError("");
    setConfirmDeleteId(null);
    setExpandedId(app.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditError("");
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveEdit() {
    if (!editingId || !draft) return;
    const err = draftError(draft);
    if (err) {
      setEditError(err);
      return;
    }
    setBusy(true);
    setEditError("");
    try {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...draftToBody(draft) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Could not save that application.");
        return;
      }
      const id = editingId;
      const d = draft;
      setRows((rs) =>
        rs.map((r) =>
          r.id === id
            ? {
                ...r,
                company_name: d.company_name.trim(),
                role: d.role.trim(),
                status: d.status,
                salary: d.salary.trim() || null,
                date_applied: d.date_applied,
                followup_date: d.followup_date || null,
                notes: d.notes.trim() || null,
              }
            : r
        )
      );
      cancelEdit();
      showFlash("Saved.");
    } catch {
      setEditError("Connection error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/applications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "Could not delete that application.");
        return;
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
      if (expandedId === id) setExpandedId(null);
      if (editingId === id) cancelEdit();
      showFlash("Deleted.");
    } catch {
      setActionError("Connection error. Please try again.");
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  }

  function openAdd() {
    setAddDraft(emptyDraft());
    setAddJd("");
    setAddError("");
    setShowAdd(true);
  }

  async function submitAdd() {
    const err = draftError(addDraft);
    if (err) {
      setAddError(err);
      return;
    }
    if (addJd.length > MAX_JD_CHARS) {
      setAddError("Job description is too long (max ~15,000 characters).");
      return;
    }
    setBusy(true);
    setAddError("");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draftToBody(addDraft), job_description: addJd, source: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Could not save that application.");
        return;
      }
      const result = await fetchApplications();
      if ("rows" in result) setRows(result.rows);
      setShowAdd(false);
      showFlash("Application added.");
    } catch {
      setAddError("Connection error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <main className="page">
        <div className="container appsContainer">
          <p className="cvHelp">Loading your applications…</p>
        </div>
      </main>
    );
  }

  const hasRows = rows.length > 0;

  return (
    <main className="page">
      <div className="container appsContainer">
        <header className="header">
          <div className="appBar">
            <div className="wordmark">Jobhuntz</div>
            <Link href="/app" className="customizeLink">← Back to app</Link>
          </div>
          <h1 className="settingsHeading">Applications</h1>
          <p className="tagline">
            Every role you&apos;ve applied to, in one place. Tailored CVs land here automatically;
            add the rest yourself.
          </p>
        </header>

        {pageError && (
          <p role="alert" className="keyError">{pageError}</p>
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
            {hasRows && (
              <span className="appsCount">
                {visible.length} of {rows.length}
              </span>
            )}
            {flash && <StatusText as="span" tone="success" role="status">{flash}</StatusText>}
            {actionError && <StatusText as="span" role="alert">{actionError}</StatusText>}
          </div>
          <div className="appsToolbarGroup">
            {/* Plain anchor, not next/link: Link would prefetch the download. */}
            {hasRows && (
              <a href="/api/applications/export" className="customizeLink">Export CSV</a>
            )}
            {!showAdd && <Button onClick={openAdd}>Add application</Button>}
          </div>
        </div>

        {showAdd && (
          <Card className="appsAddCard">
            <div className="appsFormGrid">
              <FormField label="Company" htmlFor="addCompany">
                <Input
                  id="addCompany"
                  value={addDraft.company_name}
                  onChange={(e) => setAddDraft((d) => ({ ...d, company_name: e.target.value }))}
                  placeholder="Acme Ltd"
                  maxLength={200}
                  disabled={busy}
                />
              </FormField>
              <FormField label="Role" htmlFor="addRole">
                <Input
                  id="addRole"
                  value={addDraft.role}
                  onChange={(e) => setAddDraft((d) => ({ ...d, role: e.target.value }))}
                  placeholder="Backend Engineer"
                  maxLength={200}
                  disabled={busy}
                />
              </FormField>
              <FormField label="Status" htmlFor="addStatus">
                <select
                  id="addStatus"
                  className="appsSelect appsSelectBlock"
                  value={addDraft.status}
                  onChange={(e) => setAddDraft((d) => ({ ...d, status: e.target.value as Status }))}
                  disabled={busy}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Salary" htmlFor="addSalary" help="Optional — as stated in the posting.">
                <Input
                  id="addSalary"
                  value={addDraft.salary}
                  onChange={(e) => setAddDraft((d) => ({ ...d, salary: e.target.value }))}
                  placeholder="£65,000–£75,000"
                  maxLength={100}
                  disabled={busy}
                />
              </FormField>
              <FormField label="Date applied" htmlFor="addDate">
                <Input
                  id="addDate"
                  type="date"
                  className="appsDateInput"
                  value={addDraft.date_applied}
                  onChange={(e) => setAddDraft((d) => ({ ...d, date_applied: e.target.value }))}
                  disabled={busy}
                />
              </FormField>
              <FormField label="Follow-up" htmlFor="addFollowup" help="Optional.">
                <Input
                  id="addFollowup"
                  type="date"
                  className="appsDateInput"
                  value={addDraft.followup_date}
                  min={addDraft.date_applied || undefined}
                  onChange={(e) => setAddDraft((d) => ({ ...d, followup_date: e.target.value }))}
                  disabled={busy}
                />
              </FormField>
              <FormField label="Notes" htmlFor="addNotes" className="full">
                <Textarea
                  id="addNotes"
                  value={addDraft.notes}
                  onChange={(e) => setAddDraft((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="Referral from…, recruiter name, what you emphasised…"
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                />
              </FormField>
              <FormField
                label="Job description"
                htmlFor="addJd"
                className="full"
                help="Optional, but worth pasting — you'll want it for interview prep weeks from now."
              >
                <Textarea
                  id="addJd"
                  value={addJd}
                  onChange={(e) => setAddJd(e.target.value)}
                  placeholder="Paste the posting…"
                  rows={6}
                  disabled={busy}
                />
                <p className={"appsCharCount" + (addJd.length > MAX_JD_CHARS ? " over" : "")}>
                  {addJd.length.toLocaleString()} / {MAX_JD_CHARS.toLocaleString()}
                </p>
              </FormField>
            </div>
            <div className="actions">
              <Button onClick={submitAdd} disabled={busy}>
                {busy ? "Saving…" : "Save application"}
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={busy}>
                Cancel
              </Button>
              {addError && <StatusText as="span" role="alert">{addError}</StatusText>}
            </div>
          </Card>
        )}

        {!hasRows && !showAdd && !pageError && (
          <Card variant="dashed">
            <div className="appsEmpty">
              <p>No applications yet.</p>
              <p className="cvHelp">
                Tailor a CV and click <strong>Applied</strong> to track it here, or add one you sent
                through another channel.
              </p>
              <div className="actions">
                <Button onClick={openAdd}>Add application</Button>
                <Button variant="secondary" href="/app">Tailor a CV</Button>
              </div>
            </div>
          </Card>
        )}

        {hasRows && visible.length === 0 && (
          <Card variant="dashed">
            <div className="appsEmpty">
              <p>No applications with status &ldquo;{statusFilter}&rdquo;.</p>
            </div>
          </Card>
        )}

        {visible.length > 0 && (
          <div className="appsTableWrap">
            <table className="appsTable">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key} scope="col">
                      {col.sortable ? (
                        <button
                          type="button"
                          className={"appsSortBtn" + (sortKey === col.key ? " active" : "")}
                          onClick={() => toggleSort(col.key as SortKey)}
                          aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
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
                {visible.map((app) => {
                  const editing = editingId === app.id && draft !== null;
                  const open = expandedId === app.id || editing;
                  const confirming = confirmDeleteId === app.id;
                  return (
                    <RowGroup key={app.id}>
                      <tr
                        className={"appsRow" + (open ? " open" : "") + (editing ? " editing" : "")}
                        onClick={(e) => handleRowClick(e, app.id)}
                        aria-expanded={open}
                      >
                        <td data-label="Company">
                          {editing ? (
                            <input
                              className="appsInput"
                              value={draft!.company_name}
                              onChange={(e) => updateDraft("company_name", e.target.value)}
                              maxLength={200}
                              aria-label="Company"
                            />
                          ) : (
                            <span className="appsPrimary">{app.company_name}</span>
                          )}
                        </td>
                        <td data-label="Role">
                          {editing ? (
                            <input
                              className="appsInput"
                              value={draft!.role}
                              onChange={(e) => updateDraft("role", e.target.value)}
                              maxLength={200}
                              aria-label="Role"
                            />
                          ) : (
                            app.role
                          )}
                        </td>
                        <td data-label="CV">
                          {app.cv_reference ? (
                            <span className="appsCvRef" title={app.cv_reference}>{app.cv_reference}</span>
                          ) : (
                            <span className="appsMuted">—</span>
                          )}
                        </td>
                        <td data-label="Status">
                          {editing ? (
                            <select
                              className="appsSelect"
                              value={draft!.status}
                              onChange={(e) => updateDraft("status", e.target.value as Status)}
                              aria-label="Status"
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={"appsStatus " + app.status.toLowerCase()}>{app.status}</span>
                          )}
                        </td>
                        <td data-label="Salary">
                          {editing ? (
                            <input
                              className="appsInput"
                              value={draft!.salary}
                              onChange={(e) => updateDraft("salary", e.target.value)}
                              maxLength={100}
                              aria-label="Salary"
                            />
                          ) : (
                            app.salary || <span className="appsMuted">—</span>
                          )}
                        </td>
                        <td data-label="Date applied">
                          {editing ? (
                            <input
                              type="date"
                              className="appsInput"
                              value={draft!.date_applied}
                              onChange={(e) => updateDraft("date_applied", e.target.value)}
                              aria-label="Date applied"
                            />
                          ) : (
                            formatDate(app.date_applied)
                          )}
                        </td>
                        <td data-label="Follow-up">
                          {editing ? (
                            <input
                              type="date"
                              className="appsInput"
                              value={draft!.followup_date}
                              min={draft!.date_applied || undefined}
                              onChange={(e) => updateDraft("followup_date", e.target.value)}
                              aria-label="Follow-up date"
                            />
                          ) : (
                            formatDate(app.followup_date)
                          )}
                        </td>
                        <td data-label="Notes" className="appsNotesCell">
                          {editing ? (
                            <span className="appsMuted">Edit below</span>
                          ) : app.notes ? (
                            <span title={app.notes}>{app.notes}</span>
                          ) : (
                            <span className="appsMuted">—</span>
                          )}
                        </td>
                        <td className="appsActions">
                          {editing ? (
                            <>
                              <button type="button" className="appsActionBtn" onClick={saveEdit} disabled={busy}>
                                {busy ? "Saving…" : "Save"}
                              </button>
                              <button type="button" className="appsActionBtn" onClick={cancelEdit} disabled={busy}>
                                Cancel
                              </button>
                            </>
                          ) : confirming ? (
                            <>
                              <span className="appsConfirm">Delete this application?</span>
                              <button
                                type="button"
                                className="appsActionBtn danger"
                                onClick={() => confirmDelete(app.id)}
                                disabled={busy}
                              >
                                {busy ? "Deleting…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                className="appsActionBtn"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={busy}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="appsActionBtn" onClick={() => startEdit(app)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className="appsActionBtn danger"
                                onClick={() => setConfirmDeleteId(app.id)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="appsDetail">
                          <td colSpan={COLUMNS.length + 1}>
                            <div className="appsDetailGrid">
                              <p className="appsDetailMeta">
                                {app.source === "tailored" ? "Saved from a tailoring run" : "Added manually"}
                                {app.cv_reference ? ` · CV: ${app.cv_reference}` : ""}
                              </p>

                              {editing ? (
                                <FormField label="Notes" htmlFor={`notes-${app.id}`}>
                                  <Textarea
                                    id={`notes-${app.id}`}
                                    value={draft!.notes}
                                    onChange={(e) => updateDraft("notes", e.target.value)}
                                    rows={3}
                                    maxLength={2000}
                                    disabled={busy}
                                  />
                                  {editError && (
                                    <p role="alert" className="keyError">{editError}</p>
                                  )}
                                </FormField>
                              ) : app.notes ? (
                                <div>
                                  <div className="label">Notes</div>
                                  <p className="appsJd">{app.notes}</p>
                                </div>
                              ) : null}

                              <div>
                                <div className="label">Job description</div>
                                {app.job_description ? (
                                  <pre className="appsJd">{app.job_description}</pre>
                                ) : (
                                  <p className="appsMuted">
                                    No job description was saved for this application.
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
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
