"use client";

// Paste an email, get an event: lib/extractDeadline reads the date in the browser
// and the shared EventForm shows it for editing before anything is saved. The email's
// text is never sent or stored. A pasted confirmation closes rather than adds: it
// goes to the row's notes as a dated line, and the server closes what it can.
import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import StatusText from "@/components/ui/StatusText";
import { firstLink, guessEventKind } from "@/lib/actionCentre";
import { confirmationIn } from "@/lib/autoClose";
import { extractDeadline, type DeadlineRead } from "@/lib/extractDeadline";
import { EVENT_KIND_LABELS, type PlanEvent, type PlanApplication } from "@/lib/plan";
import { clockTime, dayKey, formatWhen, zonedTimeToMs, DEFAULT_TIMEZONE } from "@/lib/planTime";
import { statusLabel } from "@/lib/tracker";

export type EmailSource = "manual" | "gmail" | "aiapply";
const SOURCES: { value: EmailSource; label: string }[] = [
  { value: "gmail", label: "Gmail" },
  { value: "aiapply", label: "AIApply inbox" },
  { value: "manual", label: "Somewhere else" },
];

type PickerRow = Pick<PlanApplication, "id" | "company_name" | "role" | "status">;

export default function QuickAdd({
  onPreset, onConfirmation, onClose,
}: {
  onPreset: (preset: Partial<PlanEvent> & { source: EmailSource }) => void;
  onConfirmation: (applicationId: string, phrase: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const tz = DEFAULT_TIMEZONE;
  const [text, setText] = useState("");
  const [source, setSource] = useState<EmailSource>("gmail");
  const [receivedDate, setReceivedDate] = useState(() => dayKey(Date.now(), tz));
  const [receivedTime, setReceivedTime] = useState(() => clockTime(Date.now(), tz));
  const [picker, setPicker] = useState<PickerRow[] | null>(null);
  const [pickerError, setPickerError] = useState("");
  const [chosen, setChosen] = useState("");
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");

  const received = zonedTimeToMs(receivedDate, receivedTime, tz);
  const read: DeadlineRead | null = useMemo(() => (Number.isFinite(received) ? extractDeadline(text, received) : null), [text, received]);
  const confirmation = confirmationIn(text);
  const kind = guessEventKind(text);

  function useThis() {
    const atMs = read ? Date.parse(read.dueAt) : NaN;
    onPreset({
      kind,
      title: EVENT_KIND_LABELS[kind],
      due_at: Number.isFinite(atMs) ? read!.dueAt : null,
      starts_at: null,
      date_only: read?.dateOnly ?? false,
      timezone: tz,
      location_or_link: firstLink(text),
      status: "scheduled",
      source,
    });
  }

  async function loadPicker() {
    if (picker || pickerError) return;
    try {
      const res = await fetch("/api/plan?picker=1");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load your applications.");
      setPicker(body.applications as PickerRow[]);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : "Could not load your applications.");
    }
  }

  async function close() {
    if (!chosen || !confirmation) return;
    setClosing(true);
    setError("");
    const failure = await onConfirmation(chosen, confirmation);
    setClosing(false);
    if (failure) setError(failure);
  }

  return (
    <section className="actionQuickAdd" aria-label="Add from an email" data-quick-add>
      <label className="label" htmlFor="quickAddText">Paste the email</label>
      <textarea
        id="quickAddText"
        className="actionQuickAddText"
        rows={6}
        value={text}
        placeholder="Paste the email's text. It is read in your browser and never saved."
        onChange={(e) => {
          setText(e.target.value);
          if (confirmationIn(e.target.value)) void loadPicker();
        }}
        data-quick-add-text
      />
      <div className="actionQuickAddRow">
        <label className="actionQuickAddField">
          <span className="label">It arrived</span>
          <span className="actionQuickAddWhen">
            <input type="date" className="textInput" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} data-quick-add-date />
            <input type="time" className="textInput" value={receivedTime} onChange={(e) => setReceivedTime(e.target.value)} data-quick-add-time />
          </span>
        </label>
        <label className="actionQuickAddField">
          <span className="label">Which inbox</span>
          <select className="textInput" value={source} onChange={(e) => setSource(e.target.value as EmailSource)} data-quick-add-source>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {text.trim() && (
        <p className="actionQuickAddRead" data-quick-add-read data-found={read ? "" : undefined}>
          {read
            ? <>Reads as <strong>{formatWhen(Date.parse(read.dueAt), tz, read.dateOnly)}</strong>{read.approximate ? " (approximate: check it)" : ""}, from &quot;{read.matched}&quot;.</>
            : "No date found in this. You can enter one on the next step."}
        </p>
      )}

      {confirmation && (
        <div className="actionQuickAddConfirm" data-quick-add-confirmation>
          <p>This reads as a confirmation (&quot;{confirmation}&quot;), not a new task. Pick the application to close its open submission items.</p>
          {pickerError && <StatusText role="alert">{pickerError}</StatusText>}
          <div className="actionQuickAddRow">
            <select className="textInput" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={!picker} aria-label="Application" data-quick-add-application>
              <option value="">{picker ? "Choose an application" : "Loading your applications…"}</option>
              {(picker ?? []).map((a) => <option key={a.id} value={a.id}>{a.company_name}: {a.role.slice(0, 50)} ({statusLabel(a.status)})</option>)}
            </select>
            <Button variant="secondary" onClick={close} disabled={!chosen || closing} data-quick-add-close-items>{closing ? "Closing…" : "Close its items"}</Button>
          </div>
        </div>
      )}
      {error && <StatusText role="alert" className="msgBelow">{error}</StatusText>}

      <div className="actionQuickAddActions">
        <Button onClick={useThis} disabled={!text.trim()} data-quick-add-next>Next: check and save</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </section>
  );
}
