"use client";
// The deadline radar on /applications (10 Nov 2026, Chunk 21; lib/deadlines): a red strip at
// the top, "Due in the next 48 hours", each item saying what to do and which inbox the email
// went to. The same list is GET /api/applications?due=48h. DeadlineEditor is the row's Edit
// panel fields that feed it: the deadline, what is due, and the address applied from.
//
// No next/* or @/ imports, so a test can render it under node:test.
import { useState } from "react";
import Icon from "../../components/ui/Icon";
import { MAX_DEADLINE_NOTE, deadlineFields, deadlineFromFields, type DueItem } from "../../lib/deadlines";

export function DeadlineRadar({
  items,
  hours,
  busyKey,
  onOpen,
  onDone,
}: {
  items: DueItem[];
  hours: number;
  busyKey: string | null;
  onOpen: (item: DueItem) => void;
  onDone: (item: DueItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="dueRadar" aria-labelledby="dueRadarTitle" data-due-radar={items.length}>
      <h2 className="dueRadar__title" id="dueRadarTitle">
        <Icon name="alert" /> Due in the next {hours} hours <span className="dueRadar__count">{items.length}</span>
      </h2>
      <ul className="dueRadar__list">
        {items.map((item) => {
          const key = `${item.id}:${item.kind}`;
          const action = item.action.includes(item.company_name) ? item.action : `${item.company_name}: ${item.action}`;
          return (
            <li key={key} className={`dueRadar__item${item.overdue ? " dueRadar__item--overdue" : ""}`} data-due-item={item.kind} data-due-id={item.id}>
              <span className="dueRadar__when">{item.when}</span>
              <span className="dueRadar__action">{action}</span>
              <span className="dueRadar__buttons">
                <button type="button" className="appsActionBtn" onClick={() => onOpen(item)} data-due-open>
                  Open
                </button>
                {item.kind === "deadline" && (
                  <button type="button" className="appsActionBtn" onClick={() => onDone(item)} disabled={busyKey === key} data-due-done>
                    {busyKey === key ? "Saving…" : "Done"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type DeadlinePatch = { next_deadline: string | null; deadline_note: string | null; applied_from_email: string | null };

/** The deadline, what is due and the address applied from, saved together. */
export function DeadlineEditor({
  row,
  onSave,
}: {
  row: { id: string; company_name: string; next_deadline?: string | null; deadline_note?: string | null; applied_from_email?: string | null };
  onSave: (patch: DeadlinePatch) => Promise<string | null>;
}) {
  const initial = deadlineFields(row.next_deadline);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [note, setNote] = useState(row.deadline_note ?? "");
  const [email, setEmail] = useState(row.applied_from_email ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function save(clear: boolean) {
    const deadline = clear || !date ? null : deadlineFromFields(date, time);
    if (!clear && date && !deadline) {
      setMessage({ error: true, text: "Enter a real date and time." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const error = await onSave({ next_deadline: deadline, deadline_note: clear ? null : note.trim() || null, applied_from_email: email.trim() || null });
    setBusy(false);
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    if (clear) {
      setDate("");
      setTime("");
      setNote("");
    }
    setMessage({ error: false, text: clear ? "Deadline cleared." : "Saved." });
  }

  const id = `deadline-${row.id}`;
  return (
    <div className="rowEditWide deadlineEditor" data-deadline-editor>
      <span className="label">Next deadline</span>
      <div className="deadlineEditor__fields">
        <label className="deadlineEditor__field">
          <span className="cvHelp">Date</span>
          <input id={`${id}-date`} type="date" className="textInput" value={date} onChange={(e) => setDate(e.target.value)} data-deadline-date />
        </label>
        <label className="deadlineEditor__field">
          <span className="cvHelp">Time (UK)</span>
          <input id={`${id}-time`} type="time" className="textInput" value={time} onChange={(e) => setTime(e.target.value)} placeholder="23:59" data-deadline-time />
        </label>
        <label className="deadlineEditor__field deadlineEditor__field--wide">
          <span className="cvHelp">What is due</span>
          <input
            type="text"
            className="textInput"
            value={note}
            maxLength={MAX_DEADLINE_NOTE}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Complete the ${row.company_name} assessment`}
            data-deadline-note
          />
        </label>
        <label className="deadlineEditor__field deadlineEditor__field--wide">
          <span className="cvHelp">Applied from (email address)</span>
          <input type="email" className="textInput" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="The inbox the application used" data-applied-from />
        </label>
      </div>
      <div className="actions">
        <button type="button" className="appsActionBtn" onClick={() => void save(false)} disabled={busy} data-deadline-save>
          {busy ? "Saving…" : "Save"}
        </button>
        {row.next_deadline && (
          <button type="button" className="appsActionBtn" onClick={() => void save(true)} disabled={busy} data-deadline-clear>
            Clear deadline
          </button>
        )}
        {message && (
          <span className={message.error ? "error" : "savedMsg"} role={message.error ? "alert" : "status"}>
            {message.text}
          </span>
        )}
      </div>
      <p className="cvHelp">A date with no time is due at 23:59. It shows in the red strip from 48 hours before.</p>
    </div>
  );
}
