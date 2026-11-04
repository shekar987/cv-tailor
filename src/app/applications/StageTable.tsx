"use client";

// The tracker's stage tabs (Screening, Interview, Assessment, Offer, Rejected, Won):
// the dates that decide what to do next, one row per application at that CURRENT
// stage. "Include past stages" adds the rows that have left it, marked as such.
// Soonest next event first. The full sheet, with its panels, is one click away.
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import StatusText from "@/components/ui/StatusText";
import EventForm, { type EventFormMode } from "@/app/app/next/EventForm";
import { KindTag, StageChip, browserTimeZone, copyText } from "@/app/app/next/planUi";
import {
  describeTiming, displayZone, eventMs, feedbackRequest, nextEventByApplication,
  type AvailabilityWindow, type PlanEvent,
} from "@/lib/plan";
import { HOUR_MS, formatWhen, shortDay, dayKey } from "@/lib/planTime";
import { PAGE_SIZE, STATUSES, STATUS_LABELS, isActiveStatus, normalizeStatus, type Status } from "@/lib/tracker";

export type StageRow = {
  id: string;
  company_name: string;
  role: string;
  status: Status;
  date_applied: string;
  last_contact_at?: string | null;
  last_contact_from?: string | null;
  outcome_reason?: string | null;
  stages_reached?: string[] | null;
};

type SortKey = "next" | "deadline" | "contact" | "company";
const DEADLINE_SOON_MS = 48 * HOUR_MS;

export default function StageTable({
  rows, stage, includePast, refreshKey, onStatus, onReason, onOpenSheet, onEventSaved,
}: {
  rows: readonly StageRow[];
  stage: Status;
  includePast: boolean;
  // Bumped after a status write lands: a row moved back to an active stage has events again.
  refreshKey: number;
  onStatus: (row: StageRow, status: Status) => void;
  onReason: (row: StageRow, reason: string) => void;
  onOpenSheet: (row: StageRow) => void;
  onEventSaved: (message: string, moved?: { id: string; status: Status }) => void;
}) {
  const [events, setEvents] = useState<PlanEvent[] | null>(null);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<EventFormMode | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "next", asc: true });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tz] = useState(browserTimeZone);

  async function loadEvents(signal?: { cancelled: boolean }) {
    try {
      // The plan's own read: what a closed application holds stays hidden here too.
      const res = await fetch("/api/plan");
      if (signal?.cancelled) return;
      const body = await res.json().catch(() => ({}));
      if (signal?.cancelled) return;
      if (!res.ok) {
        setEvents([]);
        setLoadError(body.error || "Could not load your events.");
        return;
      }
      setEvents(body.events ?? []);
      setWindows(body.availability ?? []);
      setLoadError("");
    } catch {
      if (!signal?.cancelled) {
        setEvents([]);
        setLoadError("Could not load your events.");
      }
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read of the table's events
    void loadEvents(signal);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { signal.cancelled = true; clearInterval(tick); };
  }, [refreshKey]);

  const next = useMemo(() => nextEventByApplication(events ?? [], now), [events, now]);
  const sorted = useMemo(() => {
    const value = (row: StageRow): number | string | null => {
      const entry = isActiveStatus(row.status) ? next.get(row.id) : undefined;
      // A row still to book sorts after the dated ones and before those with nothing.
      if (sort.key === "next") return entry?.next ? eventMs(entry.next) ?? Number.MAX_SAFE_INTEGER : null;
      if (sort.key === "deadline") return entry?.deadline ? eventMs(entry.deadline) : null;
      if (sort.key === "contact") return row.last_contact_at ? Date.parse(row.last_contact_at) : null;
      return row.company_name.toLowerCase();
    };
    const list = [...rows];
    list.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // An empty value always sorts last, whichever direction is active.
      if (av === null && bv === null) return a.company_name.localeCompare(b.company_name);
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.asc ? cmp : -cmp;
    });
    return list;
  }, [rows, next, sort]);

  function header(key: SortKey, label: string) {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.asc ? "ascending" : "descending") : "none"}>
        <button type="button" className={"appsSortBtn" + (active ? " active" : "")} onClick={() => setSort({ key, asc: active ? !sort.asc : true })} data-stage-sort={key}>
          {label}{active ? (sort.asc ? " ▲" : " ▼") : ""}
        </button>
      </th>
    );
  }

  const showFeedback = stage === "rejected";
  // Until the dates arrive, "None" would be untrue.
  const none = events === null ? <span className="skeleton stageCellLoading" aria-hidden="true" /> : <span className="cvHelp">None</span>;
  const scheduled = (events ?? []).filter((e) => e.status === "scheduled");

  return (
    <div className="stageTableWrap" data-stage-table={stage}>
      {loadError && <StatusText tone="error" role="alert" className="msgBelow">{loadError}</StatusText>}
      <table className="stageTable">
        <thead>
          <tr>
            {header("company", "Company")}
            <th scope="col">Status</th>
            {header("next", "Next event")}
            <th scope="col">Kind</th>
            {header("deadline", "Deadline")}
            {header("contact", "Last contact")}
            <th scope="col">Outcome</th>
            <th scope="col"><span className="srOnly">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((row) => {
            const entry = isActiveStatus(row.status) ? next.get(row.id) : undefined;
            const event = entry?.next ?? null;
            const timing = event && event.status !== "to_book" ? describeTiming(event, now, tz) : null;
            const deadline = entry?.deadline ?? null;
            const dueAt = deadline ? eventMs(deadline) : null;
            const soon = dueAt !== null && dueAt - now < DEADLINE_SOON_MS;
            const status = normalizeStatus(row.status) ?? row.status;
            const past = includePast && status !== stage && !(stage === "accepted" && status === "offer");
            return (
              <tr key={row.id} data-stage-row={row.company_name} data-past={past ? "" : undefined} data-won={status === "accepted" ? "" : undefined}>
                <td data-label="Company">
                  <button type="button" className="stageCompany" onClick={() => onOpenSheet(row)} title="Open in the full sheet">
                    {status === "accepted" && <Icon name="trophy" />}
                    <strong>{row.company_name}</strong>
                  </button>
                  <span className="planCardRole">{row.role}</span>
                  {past && <span className="cvHelp">Now {STATUS_LABELS[status as Status] ?? status}</span>}
                </td>
                <td data-label="Status">
                  <select
                    className="appsCellSelect"
                    value={row.status}
                    onChange={(e) => onStatus(row, e.target.value as Status)}
                    aria-label={`Status for ${row.company_name}`}
                    data-stage-status
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </td>
                <td data-label="Next event" data-stage-next>
                  {event && event.status === "to_book" ? (
                    <>
                      <span>{event.title}</span>
                      <span className="cvHelp">No date yet</span>
                    </>
                  ) : timing && event ? (
                    <>
                      <span>{event.title}</span>
                      <span>{timing.when}</span>
                      <span className="cvHelp">{timing.left}</span>
                    </>
                  ) : (
                    none
                  )}
                </td>
                <td data-label="Kind">{event ? <KindTag kind={event.kind} /> : none}</td>
                <td data-label="Deadline" data-stage-deadline data-soon={soon ? "" : undefined}>
                  {dueAt !== null && deadline ? (
                    <span className="stageDue">
                      {soon && <Icon name="alert" />}
                      {formatWhen(dueAt, displayZone(deadline, tz), deadline.date_only)}
                      {soon && <span className="srOnly">{dueAt < now ? " (overdue)" : " (under 48 hours)"}</span>}
                    </span>
                  ) : none}
                </td>
                <td data-label="Last contact">
                  {row.last_contact_at ? <span>{shortDay(dayKey(Date.parse(row.last_contact_at), tz))}<span className="cvHelp"> {row.last_contact_from === "them" ? "they wrote" : "you wrote"}</span></span> : <span className="cvHelp">None recorded</span>}
                </td>
                <td data-label="Outcome">
                  {status === "rejected" || status === "withdrawn" || status === "ghosted" || status === "accepted" || status === "offer" ? (
                    <>
                      <StageChip status={status} />
                      {showFeedback && (
                        <input
                          className="stageReason"
                          aria-label={`Rejection reason for ${row.company_name}`}
                          placeholder="Reason (optional)"
                          defaultValue={row.outcome_reason ?? ""}
                          maxLength={500}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (value !== (row.outcome_reason ?? "")) onReason(row, value);
                          }}
                          data-stage-reason
                        />
                      )}
                    </>
                  ) : <span className="cvHelp">Open</span>}
                </td>
                <td data-label="" className="stageActions">
                  {showFeedback ? (
                    <button
                      type="button"
                      className="linkBtn"
                      onClick={async () => {
                        if (await copyText(feedbackRequest(row.company_name, row.role))) {
                          setCopied(row.id);
                          setTimeout(() => setCopied(null), 2000);
                        }
                      }}
                      data-ask-feedback
                    >
                      {copied === row.id ? "Copied" : "Ask for feedback"}
                    </button>
                  ) : !loadError ? (
                    <button type="button" className="linkBtn" onClick={() => setForm({ type: "new", application: row, preset: { timezone: tz } })} data-stage-add>
                      Add date/time
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > limit && (
        <button type="button" className="linkBtn stageMore" onClick={() => setLimit((n) => n + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, sorted.length - limit)} more</button>
      )}
      {form && (
        <EventForm
          mode={form}
          tz={tz}
          otherEvents={scheduled}
          windows={windows}
          onClose={() => setForm(null)}
          onSaved={(message, moved) => {
            setForm(null);
            onEventSaved(message, moved);
            void loadEvents();
          }}
        />
      )}
    </div>
  );
}
