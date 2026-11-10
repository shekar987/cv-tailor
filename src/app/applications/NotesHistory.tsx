"use client";
// "Restore previous notes" in a row's Notes panel (10 Nov 2026, Chunk 21): the versions the
// notes had before a change, kept by the database (notes_history, migration 20261110120000),
// newest first, each readable in full. It opens on the changes that took text away (a wipe,
// an edit), because on a busy row a week of appends would bury them; "Show every version"
// lists the appends too. Restoring one is an ordinary notes save on the current version, so
// the notes it replaces are kept in turn. Loaded only when opened.
import { useState } from "react";
import { DEFAULT_TIMEZONE, clockTime, dayKey, dayMonthYear } from "../../lib/planTime";

type Version = { id: string; old_notes: string; lost_text?: boolean; changed_at: string };
type Loaded = { items: Version[]; all: boolean; total: number };

export function versionLabel(changedAt: string): string {
  const ms = Date.parse(changedAt);
  return Number.isFinite(ms) ? `${dayMonthYear(dayKey(ms, DEFAULT_TIMEZONE))} ${clockTime(ms, DEFAULT_TIMEZONE)}` : changedAt;
}

export default function NotesHistory({ applicationId, disabled, onRestore }: { applicationId: string; disabled: boolean; onRestore: (text: string, label: string) => void }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; data: Loaded | null; error: string }>({ status: "idle", data: null, error: "" });

  async function load(all: boolean) {
    setState({ status: "loading", data: null, error: "" });
    try {
      const res = await fetch(`/api/applications/${applicationId}/notes-history${all ? "?all=1" : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", data: null, error: typeof data.error === "string" ? data.error : "Could not load the earlier versions." });
        return;
      }
      setState({ status: "ready", data: { items: Array.isArray(data.history) ? (data.history as Version[]) : [], all: data.all === true, total: typeof data.total === "number" ? data.total : 0 }, error: "" });
    } catch {
      setState({ status: "error", data: null, error: "Connection error. Try again." });
    }
  }

  const data = state.data;
  return (
    <details
      className="notesHistory"
      data-notes-history
      onToggle={(e) => {
        // React hands this handler the toggle of every version inside it too: only this
        // element's own opening loads, or opening a version would reload the list and shut it.
        if (e.target !== e.currentTarget) return;
        if ((e.currentTarget as HTMLDetailsElement).open && state.status !== "loading") void load(false);
      }}
    >
      <summary className="inlineLink">Restore previous notes</summary>
      {state.status === "loading" && <p className="cvHelp">Loading earlier versions…</p>}
      {state.status === "error" && (
        <p className="error" role="alert">
          {state.error}{" "}
          <button type="button" className="inlineLink" onClick={() => void load(false)}>
            Try again
          </button>
        </p>
      )}
      {state.status === "ready" && data && (
        <>
          <p className="cvHelp">
            {data.all
              ? "Every earlier version, newest first."
              : data.items.length > 0
                ? "The changes that took text out of these notes, newest first."
                : data.total > 0
                  ? "No change has taken text out of these notes: every earlier version is still inside them."
                  : "No earlier versions yet. Every change from now on is kept here."}
            {!data.all && data.total > data.items.length && (
              <>
                {" "}
                <button type="button" className="inlineLink" onClick={() => void load(true)} data-notes-history-all>
                  Show every version ({data.total.toLocaleString("en-GB")})
                </button>
              </>
            )}
          </p>
          {data.items.length > 0 && (
            <ol className="notesHistory__list">
              {data.items.map((v) => {
                const label = versionLabel(v.changed_at);
                return (
                  <li key={v.id} data-notes-version={v.id} data-lost-text={v.lost_text === false ? "false" : "true"}>
                    <details>
                      <summary>
                        <span className="notesHistory__when">Before {label}</span>{" "}
                        <span className="cvHelp">
                          {v.lost_text === false ? "(kept whole by the next change) " : ""}
                          {v.old_notes.split("\n")[0].slice(0, 80)}
                          {v.old_notes.length > 80 ? "…" : ""} ({v.old_notes.length.toLocaleString("en-GB")} characters)
                        </span>
                      </summary>
                      <pre className="notesHistory__text">{v.old_notes}</pre>
                      <button type="button" className="appsActionBtn" disabled={disabled} onClick={() => onRestore(v.old_notes, label)} data-notes-restore>
                        Restore this version
                      </button>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </details>
  );
}
