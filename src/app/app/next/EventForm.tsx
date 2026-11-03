"use client";

// Add or reschedule one event. The clash warning runs as the user types and never
// blocks. Adding an event to an application that is not active moves it to the
// matching stage, and says so first: otherwise the event would be hidden at once by
// the plan's own rule. Shared by /app/next and the tracker's stage tabs.
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import StatusText from "@/components/ui/StatusText";
import {
  EVENT_KINDS, EVENT_KIND_LABELS, conflictsFor,
  type AvailabilityWindow, type Conflict, type EventKind, type PlanApplication, type PlanEvent,
} from "@/lib/plan";
import { DEFAULT_TIMEZONE, MINUTE_MS, clockTime, dayKey, formatWhen, zonedTimeToMs } from "@/lib/planTime";
import { STATUS_LABELS, isActiveStatus, normalizeStatus, statusLabel, type Status } from "@/lib/tracker";

export type EventFormMode =
  | { type: "new"; application?: Pick<PlanApplication, "id" | "company_name" | "role" | "status"> | null; preset?: Partial<PlanEvent> }
  | { type: "edit"; event: PlanEvent; application?: Pick<PlanApplication, "id" | "company_name" | "role" | "status"> | null };

type When = "time" | "deadline" | "book";
type PickerRow = Pick<PlanApplication, "id" | "company_name" | "role" | "status">;

const DEADLINE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>(["assessment", "take_home", "deadline", "offer_deadline", "follow_up"]);
const STAGE_FOR_KIND: Record<EventKind, Status> = {
  screening_call: "screening",
  interview: "interview",
  assessment: "assessment",
  take_home: "assessment",
  deadline: "screening",
  follow_up: "screening",
  offer_deadline: "offer",
  networking: "screening",
};
const DEFAULT_TITLES: Record<EventKind, string> = { ...EVENT_KIND_LABELS };

export function describeConflict(c: Conflict, tz: string): string {
  if (c.window) {
    const label = c.window.label || "a busy time";
    return c.gapMinutes > 0 ? `Within ${Math.round(c.gapMinutes)} minutes of ${label}.` : `Inside ${label} (${c.window.start_time.slice(0, 5)} to ${c.window.end_time.slice(0, 5)}).`;
  }
  const other = c.b;
  const at = other?.starts_at ? formatWhen(Date.parse(other.starts_at), tz) : "";
  const name = other?.title ?? "another event";
  return c.kind === "overlap" ? `Overlaps ${name} (${at}).` : `Only ${Math.round(c.gapMinutes)} minutes from ${name} (${at}).`;
}

function initialWhen(mode: EventFormMode): When {
  const e = mode.type === "edit" ? mode.event : mode.preset;
  if (e?.status === "to_book") return "book";
  if (e?.due_at && !e.starts_at) return "deadline";
  if (e?.starts_at) return "time";
  return e?.kind && DEADLINE_KINDS.has(e.kind) ? "deadline" : "time";
}

type SlotDraft = { date: string; time: string };

export default function EventForm({
  mode, tz, otherEvents, windows, onClose, onSaved,
}: {
  mode: EventFormMode;
  tz: string;
  otherEvents: readonly PlanEvent[];
  windows: readonly AvailabilityWindow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const existing = mode.type === "edit" ? mode.event : null;
  const seed = existing ?? (mode.type === "new" ? mode.preset : undefined);
  const zone = seed?.timezone ?? tz ?? DEFAULT_TIMEZONE;
  const seedAt = Date.parse(seed?.starts_at ?? seed?.due_at ?? "");
  const seedEnd = Date.parse(seed?.ends_at ?? "");

  const [application, setApplication] = useState<PickerRow | null>(mode.application ?? null);
  const [picker, setPicker] = useState<PickerRow[] | null>(null);
  const [pickerError, setPickerError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<EventKind>(seed?.kind ?? "interview");
  const [title, setTitle] = useState(seed?.title ?? "");
  const [stageLabel, setStageLabel] = useState(seed?.stage_label ?? "");
  const [when, setWhen] = useState<When>(() => initialWhen(mode));
  const [date, setDate] = useState(Number.isFinite(seedAt) ? dayKey(seedAt, zone) : "");
  const [time, setTime] = useState(Number.isFinite(seedAt) && !seed?.date_only ? clockTime(seedAt, zone) : "");
  const [noTime, setNoTime] = useState(seed?.date_only === true);
  const [duration, setDuration] = useState(Number.isFinite(seedAt) && Number.isFinite(seedEnd) ? Math.max(5, Math.round((seedEnd - seedAt) / MINUTE_MS)) : 30);
  const [timezone, setTimezone] = useState(zone);
  const [link, setLink] = useState(seed?.location_or_link ?? "");
  const [contact, setContact] = useState(seed?.contact_name ?? "");
  const [notes, setNotes] = useState(seed?.prep_notes ?? "");
  const [slots, setSlots] = useState<SlotDraft[]>(() => (seed?.offered_slots ?? []).map((s) => {
    const ms = Date.parse(s.starts_at);
    return { date: dayKey(ms, zone), time: clockTime(ms, zone) };
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus in, back out to the opener, Tab kept inside, Escape closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (application || mode.type === "edit") return;
    let cancelled = false;
    fetch("/api/plan?picker=1")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setPicker(data.applications ?? []);
        else setPickerError(data.error || "Could not load your applications.");
      })
      .catch(() => { if (!cancelled) setPickerError("Could not load your applications."); });
    return () => { cancelled = true; };
  }, [application, mode.type]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!picker) return [];
    const rows = q ? picker.filter((a) => `${a.company_name} ${a.role}`.toLowerCase().includes(q)) : picker.filter((a) => isActiveStatus(a.status));
    return rows.slice(0, 8);
  }, [picker, search]);

  const candidate: PlanEvent | null = useMemo(() => {
    if (when !== "time" || !date || !time) return null;
    const start = zonedTimeToMs(date, time, timezone);
    if (!Number.isFinite(start)) return null;
    return { id: existing?.id ?? "new", application_id: application?.id ?? null, kind, title: title || EVENT_KIND_LABELS[kind], status: "scheduled", starts_at: new Date(start).toISOString(), ends_at: new Date(start + duration * MINUTE_MS).toISOString() };
  }, [when, date, time, timezone, duration, kind, title, existing, application]);
  const clashes = candidate ? conflictsFor(candidate, otherEvents, windows, { tz }) : [];

  const movesTo = application && !isActiveStatus(application.status) && kind !== "networking" ? STAGE_FOR_KIND[kind] : null;

  function trapTab(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !panelRef.current) return;
    const controls = [...panelRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((el) => !el.hasAttribute("disabled"));
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function payload(): Record<string, unknown> | string {
    const finalTitle = title.trim() || DEFAULT_TITLES[kind];
    const base: Record<string, unknown> = {
      kind, title: finalTitle, stage_label: stageLabel, timezone, location_or_link: link, contact_name: contact, prep_notes: notes,
    };
    if (when === "book") {
      const offered: { starts_at: string; ends_at: null }[] = [];
      for (const s of slots) {
        if (!s.date && !s.time) continue;
        const ms = zonedTimeToMs(s.date, s.time, timezone);
        if (!Number.isFinite(ms)) return "Give each offered slot a date and a time.";
        offered.push({ starts_at: new Date(ms).toISOString(), ends_at: null });
      }
      return { ...base, status: "to_book", starts_at: null, ends_at: null, due_at: null, date_only: false, offered_slots: offered };
    }
    if (!date) return "Pick a date.";
    if (when === "deadline") {
      if (!noTime && !time) return "Pick a time, or tick that no time was given.";
      const ms = zonedTimeToMs(date, noTime ? "23:59" : time, timezone);
      return { ...base, status: "scheduled", starts_at: null, ends_at: null, due_at: new Date(ms).toISOString(), date_only: noTime, offered_slots: [] };
    }
    if (!time) return "Pick a time.";
    const start = zonedTimeToMs(date, time, timezone);
    return { ...base, status: "scheduled", starts_at: new Date(start).toISOString(), ends_at: new Date(start + duration * MINUTE_MS).toISOString(), due_at: null, date_only: false, offered_slots: [] };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!application && kind !== "networking") { setError("Pick the application this event belongs to."); return; }
    const body = payload();
    if (typeof body === "string") { setError(body); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/events", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existing ? { id: existing.id, ...body } : { ...body, application_id: application?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not save that event."); return; }
      if (movesTo && application) {
        const moved = await fetch("/api/applications", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: application.id, status: movesTo }),
        });
        if (!moved.ok) {
          const detail = await moved.json().catch(() => ({}));
          setError(detail.error || `The event is saved, but ${application.company_name} could not move to ${STATUS_LABELS[movesTo]}, so it stays hidden.`);
          return;
        }
      }
      onSaved(existing ? "Event updated." : movesTo ? `Event added, and ${application?.company_name} moved to ${STATUS_LABELS[movesTo]}.` : "Event added.");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="planDialogBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className="planDialog" role="dialog" aria-modal="true" aria-labelledby="eventFormTitle" onKeyDown={trapTab} data-event-form>
        <h2 id="eventFormTitle" className="planDialogTitle">{existing ? "Change this event" : "New event"}</h2>
        <form onSubmit={save} className="planForm">
          {mode.type === "new" && !mode.application && (
            <div className="planField planField--wide">
              <label className="label" htmlFor="evApplication">Application</label>
              {application ? (
                <p className="planPicked">
                  <strong>{application.company_name}</strong> · {application.role}{" "}
                  <button type="button" className="inlineLink" onClick={() => setApplication(null)}>Change</button>
                </p>
              ) : (
                <>
                  <input id="evApplication" className="textInput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your applications" autoComplete="off" data-event-search />
                  {pickerError && <StatusText tone="error" role="alert">{pickerError}</StatusText>}
                  {matches.length > 0 && (
                    <ul className="planPickerList">
                      {matches.map((a) => (
                        <li key={a.id}>
                          <button type="button" className="planPickerItem" onClick={() => setApplication(a)}>
                            <strong>{a.company_name}</strong> · {a.role} <span className="cvHelp">{statusLabel(a.status)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {kind === "networking" && <p className="cvHelp">A networking call needs no application.</p>}
                </>
              )}
            </div>
          )}
          {mode.application && <p className="planPicked planField--wide"><strong>{mode.application.company_name}</strong> · {mode.application.role}</p>}

          <div className="planField">
            <label className="label" htmlFor="evKind">Kind</label>
            <select id="evKind" className="textInput" value={kind} onChange={(e) => {
              const next = e.target.value as EventKind;
              setKind(next);
              if (!existing && !date) setWhen(DEADLINE_KINDS.has(next) ? "deadline" : "time");
            }}>
              {EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="planField">
            <label className="label" htmlFor="evStage">Stage (optional)</label>
            <input id="evStage" className="textInput" value={stageLabel} onChange={(e) => setStageLabel(e.target.value)} placeholder="Round 2: technical" maxLength={100} />
          </div>
          <div className="planField planField--wide">
            <label className="label" htmlFor="evTitle">Title</label>
            <input id="evTitle" className="textInput" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={EVENT_KIND_LABELS[kind]} maxLength={200} />
          </div>

          <fieldset className="planField planField--wide planWhen">
            <legend className="label">When</legend>
            {(["time", "deadline", "book"] as When[]).map((w) => (
              <label key={w} className="planRadio">
                <input type="radio" name="evWhen" value={w} checked={when === w} onChange={() => setWhen(w)} />
                {w === "time" ? "A set time" : w === "deadline" ? "A deadline" : "Still to book"}
              </label>
            ))}
          </fieldset>

          {when !== "book" && (
            <>
              <div className="planField">
                <label className="label" htmlFor="evDate">Date</label>
                <input id="evDate" type="date" className="textInput" value={date} onChange={(e) => setDate(e.target.value)} data-event-date />
              </div>
              <div className="planField">
                <label className="label" htmlFor="evTime">Time</label>
                <input id="evTime" type="time" className="textInput" value={time} onChange={(e) => setTime(e.target.value)} disabled={when === "deadline" && noTime} data-event-time />
              </div>
            </>
          )}
          {when === "deadline" && (
            <label className="planRadio planField--wide">
              <input type="checkbox" checked={noTime} onChange={(e) => setNoTime(e.target.checked)} data-event-notime />
              They gave a date but no time
            </label>
          )}
          {when === "time" && (
            <div className="planField">
              <label className="label" htmlFor="evDuration">Length (minutes)</label>
              <input id="evDuration" type="number" min={5} max={480} step={5} className="textInput" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} />
            </div>
          )}
          <div className="planField">
            <label className="label" htmlFor="evZone">Time zone</label>
            <select id="evZone" className="textInput" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {[...new Set([tz, DEFAULT_TIMEZONE, "Europe/Paris", "UTC", "America/New_York", timezone])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          {when === "book" && (
            <div className="planField planField--wide" data-event-slots>
              <div className="label">Slots they offered (optional)</div>
              {slots.map((s, i) => (
                <div key={i} className="planSlotRow">
                  <input type="date" aria-label={`Slot ${i + 1} date`} className="textInput" value={s.date} onChange={(e) => setSlots((all) => all.map((x, n) => (n === i ? { ...x, date: e.target.value } : x)))} />
                  <input type="time" aria-label={`Slot ${i + 1} time`} className="textInput" value={s.time} onChange={(e) => setSlots((all) => all.map((x, n) => (n === i ? { ...x, time: e.target.value } : x)))} />
                  <button type="button" className="inlineLink" onClick={() => setSlots((all) => all.filter((_, n) => n !== i))}>Remove</button>
                </div>
              ))}
              {slots.length < 10 && <button type="button" className="inlineLink" onClick={() => setSlots((all) => [...all, { date: "", time: "" }])}>Add a slot</button>}
            </div>
          )}

          <div className="planField planField--wide">
            <label className="label" htmlFor="evLink">Meeting link or place</label>
            <input id="evLink" className="textInput" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://… or an address" />
          </div>
          <div className="planField planField--wide">
            <label className="label" htmlFor="evContact">Contact (optional)</label>
            <input id="evContact" className="textInput" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} />
          </div>
          <div className="planField planField--wide">
            <label className="label" htmlFor="evNotes">Prep notes (optional)</label>
            <textarea id="evNotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </div>

          {clashes.length > 0 && (
            <ul className="planClashList planField--wide" role="status" data-event-clash>
              {clashes.map((c, i) => <li key={i}>{describeConflict(c, tz)}</li>)}
              <li className="cvHelp">You can still save it.</li>
            </ul>
          )}
          {movesTo && application && (
            <p className="cvHelp planField--wide" data-event-move>
              {application.company_name} is {statusLabel(normalizeStatus(application.status))}. Saving moves it to {STATUS_LABELS[movesTo]}, so this event shows on your plan.
            </p>
          )}
          {error && <StatusText tone="error" role="alert" className="planField--wide">{error}</StatusText>}

          <div className="planDialogActions planField--wide">
            <Button type="submit" disabled={saving} data-event-save>{saving ? "Saving…" : "Save event"}</Button>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
