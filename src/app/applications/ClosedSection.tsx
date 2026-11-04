"use client";

// "Closed after screening (n)" (4 Nov 2026, Chunk 15): rejected rows never vanish from the proof
// a CV got shortlisted, and they do not clutter the live list either. Folded by default; the
// fold is remembered per tab in this browser. Every rule is lib/closing.
import { useEffect, useState } from "react";
import RowMenu from "./RowMenu";
import { LESSON_PLACEHOLDER, MAX_LESSON_CHARS, progressChip, resultLine, type StageTab } from "@/lib/closing";
import type { PlanEvent } from "@/lib/plan";

const foldKey = (tab: StageTab) => `jobhuntz:closed-open:${tab}`;

function readFold(tab: StageTab): boolean {
  try {
    return window.localStorage.getItem(foldKey(tab)) === "1";
  } catch {
    return false;
  }
}

function writeFold(tab: StageTab, open: boolean) {
  try {
    window.localStorage.setItem(foldKey(tab), open ? "1" : "0");
  } catch {
    // The fold is a convenience: without storage it just starts folded.
  }
}

export type ClosedRow = {
  id: string;
  company_name: string;
  role: string | null;
  status: string;
  stages_reached?: string[] | null;
  closed_at?: string | null;
  close_reason?: string | null;
  lesson?: string | null;
};

function Lesson({ row, onSave }: { row: ClosedRow; onSave: (id: string, lesson: string | null) => void }) {
  const [value, setValue] = useState(row.lesson ?? "");
  const stored = row.lesson ?? "";
  const save = () => {
    const next = value.trim();
    if (next !== stored) onSave(row.id, next || null);
  };
  return (
    <input
      type="text"
      className="textInput closedLesson"
      value={value}
      maxLength={MAX_LESSON_CHARS}
      placeholder={LESSON_PLACEHOLDER}
      aria-label={`Lesson from ${row.company_name}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      data-closed-lesson
    />
  );
}

export default function ClosedSection({
  tab, rows, eventsOf, onReopen, onLesson,
}: {
  tab: StageTab;
  rows: readonly ClosedRow[];
  eventsOf: (id: string) => readonly PlanEvent[];
  onReopen: (row: ClosedRow) => void;
  onLesson: (id: string, lesson: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Read after mounting: the server has no storage, and the first paint must match it.
  useEffect(() => {
    let live = true;
    const remembered = readFold(tab);
    queueMicrotask(() => {
      if (live) setOpen(remembered);
    });
    return () => {
      live = false;
    };
  }, [tab]);

  return (
    <details
      className="closedSection"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next !== open) {
          setOpen(next);
          writeFold(tab, next);
        }
      }}
      data-closed-section={tab}
    >
      <summary className="closedSectionSummary" data-closed-summary>Closed after {tab} ({rows.length})</summary>
      {rows.length === 0 ? (
        <p className="fitEvidence closedEmpty" data-closed-empty>Nothing closed yet. A row you move to Closed stays here, with how far it got.</p>
      ) : (
        <ul className="closedList">
          {rows.map((row) => (
            <li key={row.id} className="closedRow" data-closed-row={row.company_name}>
              <div className="closedWho">
                <div className="closedCompany">{row.company_name}</div>
                {row.role && <div className="closedRole">{row.role}</div>}
              </div>
              <span className="closedChip" data-closed-chip>{progressChip(row, eventsOf(row.id))}</span>
              <span className="closedResult" data-closed-result>{resultLine(row)}</span>
              <Lesson key={row.lesson ?? ""} row={row} onSave={onLesson} />
              <RowMenu label={`Actions for ${row.company_name}`} items={[{ key: "reopen", label: "Reopen", onSelect: () => onReopen(row) }]} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
