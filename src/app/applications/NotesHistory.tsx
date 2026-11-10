"use client";
// "Restore previous notes" in a row's Notes panel (10 Nov 2026, Chunk 21): every version the
// notes had before a change, kept by the database (notes_history, migration 20261110120000),
// newest first, each readable in full. Restoring one is an ordinary notes save on the row's
// current version, so the notes it replaces are kept in the history in turn. Loaded only
// when opened.
import { useState } from "react";
import { DEFAULT_TIMEZONE, clockTime, dayKey, dayMonthYear } from "../../lib/planTime";

type Version = { id: string; old_notes: string; changed_at: string };

export function versionLabel(changedAt: string): string {
  const ms = Date.parse(changedAt);
  return Number.isFinite(ms) ? `${dayMonthYear(dayKey(ms, DEFAULT_TIMEZONE))} ${clockTime(ms, DEFAULT_TIMEZONE)}` : changedAt;
}

export default function NotesHistory({ applicationId, disabled, onRestore }: { applicationId: string; disabled: boolean; onRestore: (text: string, label: string) => void }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; items: Version[]; error: string }>({ status: "idle", items: [], error: "" });

  async function load() {
    setState({ status: "loading", items: [], error: "" });
    try {
      const res = await fetch(`/api/applications/${applicationId}/notes-history`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", items: [], error: typeof data.error === "string" ? data.error : "Could not load the earlier versions." });
        return;
      }
      setState({ status: "ready", items: Array.isArray(data.history) ? (data.history as Version[]) : [], error: "" });
    } catch {
      setState({ status: "error", items: [], error: "Connection error. Try again." });
    }
  }

  return (
    <details
      className="notesHistory"
      data-notes-history
      onToggle={(e) => {
        // React hands this handler the toggle of every version inside it too: only this
        // element's own opening loads, or opening a version would reload the list and shut it.
        if (e.target !== e.currentTarget) return;
        if ((e.currentTarget as HTMLDetailsElement).open && state.status !== "loading") void load();
      }}
    >
      <summary className="inlineLink">Restore previous notes</summary>
      {state.status === "loading" && <p className="cvHelp">Loading earlier versions…</p>}
      {state.status === "error" && (
        <p className="error" role="alert">
          {state.error}{" "}
          <button type="button" className="inlineLink" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {state.status === "ready" && state.items.length === 0 && <p className="cvHelp">No earlier versions yet. Every change from now on is kept here.</p>}
      {state.status === "ready" && state.items.length > 0 && (
        <ol className="notesHistory__list">
          {state.items.map((v) => {
            const label = versionLabel(v.changed_at);
            return (
              <li key={v.id} data-notes-version={v.id}>
                <details>
                  <summary>
                    <span className="notesHistory__when">Before {label}</span>{" "}
                    <span className="cvHelp">
                      {v.old_notes.split("\n")[0].slice(0, 80)}
                      {v.old_notes.length > 80 ? "…" : ""} ({v.old_notes.length.toLocaleString()} characters)
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
    </details>
  );
}
