"use client";

// The Action Centre (4 Nov 2026, Chunk 12): everything still to do, in deadline order,
// with a countdown and a red, amber or green state that always carries its words too.
// The rules are lib/actionCentre; the read is /api/actions. Snoozing never moves the
// employer's date, and auto-closed items stay visible for a week with an undo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";
import { URGENCY_LABELS, isSnoozed, snoozeUntil, sortActions, urgencyOf } from "@/lib/actionCentre";
import { autoCloseMessage } from "@/lib/autoClose";
import { describeTiming, eventMs, type AvailabilityWindow, type PlanEvent } from "@/lib/plan";
import { DEFAULT_TIMEZONE, MINUTE_MS, formatWhen } from "@/lib/planTime";
import EventForm, { type EventFormMode } from "../next/EventForm";
import { CompanyInitial, KindTag, StageChip, safeHttpUrl } from "../next/planUi";
import QuickAdd, { type EmailSource } from "./QuickAdd";

type ActionApplication = { id: string; company_name: string; role: string; status: string };
type Data = { events: PlanEvent[]; closedByNote: PlanEvent[]; applications: ActionApplication[]; availability: AvailabilityWindow[] };
type Load = "loading" | "ready" | "expired" | "needs_migration" | "error";
type Toast = { message: string; undo?: () => Promise<void> | void };

const TOAST_MS = 8000;
const SOURCE_LABELS: Record<string, string> = { gmail: "Gmail", aiapply: "AIApply inbox", calendar: "Calendar" };
const URGENCY_ICONS = { red: "alert", amber: "clock", green: "check", none: "clock" } as const;

async function jsonFrom(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export default function ActionCentrePage() {
  const tz = DEFAULT_TIMEZONE;
  const [data, setData] = useState<Data | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [errorText, setErrorText] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState<EventFormMode | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readSeq = useRef(0);
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    const seq = ++readSeq.current;
    try {
      const res = await fetch("/api/actions");
      const body = await jsonFrom(res);
      if (seq !== readSeq.current) return;
      if (res.status === 401) { setLoad("expired"); return; }
      if (res.status === 503 && body.errorType === "needs_migration") { setErrorText(String(body.error)); setLoad("needs_migration"); return; }
      if (!res.ok) {
        // A failed background read keeps what is on screen, and any email being pasted.
        if (hasData.current) { setActionError("Couldn't refresh your to-do list, so this may be out of date."); return; }
        setErrorText(String(body.error || "Could not load your to-do list."));
        setLoad("error");
        return;
      }
      hasData.current = true;
      setData(body as unknown as Data);
      setNow(Date.now());
      setLoad("ready");
    } catch {
      if (seq !== readSeq.current) return;
      if (hasData.current) { setActionError("Couldn't refresh your to-do list, so this may be out of date."); return; }
      setErrorText("Couldn't reach the server. Check your connection and try again.");
      setLoad("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read; refresh sets state after its fetch
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);

  function showToast(next: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  const appById = useMemo(() => new Map((data?.applications ?? []).map((a) => [a.id, a])), [data]);
  const lists = useMemo(() => sortActions(data?.events ?? [], now), [data, now]);

  async function putEvent(body: Record<string, unknown>): Promise<boolean> {
    setActionError("");
    try {
      const res = await fetch("/api/events", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return true;
      const failed = await jsonFrom(res);
      setActionError(String(failed.error || "Could not save that change."));
    } catch {
      setActionError("Couldn't reach the server. Your change was not saved.");
    }
    return false;
  }

  function dropLocally(id: string) {
    setData((d) => (d ? { ...d, events: d.events.filter((e) => e.id !== id) } : d));
  }

  async function setStatus(event: PlanEvent, status: "done" | "missed") {
    dropLocally(event.id);
    if (!(await putEvent({ id: event.id, status }))) { void refresh(); return; }
    showToast({
      message: status === "done" ? `Done: ${event.title}.` : `Marked missed: ${event.title}.`,
      undo: async () => {
        await putEvent({ id: event.id, status: event.status });
        void refresh();
      },
    });
    void refresh();
  }

  async function snooze(event: PlanEvent) {
    if (!(await putEvent({ id: event.id, snooze: true }))) return;
    showToast({
      message: `Hidden for a day. The deadline itself has not moved.`,
      undo: async () => {
        await putEvent({ id: event.id, snooze: false });
        void refresh();
      },
    });
    void refresh();
  }

  async function reopen(event: PlanEvent) {
    // An item with no date goes back to having none.
    if (await putEvent({ id: event.id, status: eventMs(event) === null ? "to_book" : "scheduled", reopen: true })) void refresh();
  }

  async function closeFromConfirmation(applicationId: string, phrase: string): Promise<string | null> {
    try {
      const res = await fetch("/api/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: applicationId, append_note: `Confirmation pasted: "${phrase}"` }),
      });
      const body = await jsonFrom(res);
      if (!res.ok) return String(body.error || "Could not save that to the application's notes.");
      const auto = body.autoClose as { closed: { id: string; title: string }[]; stillOpen: string[] } | undefined;
      showToast({ message: auto ? autoCloseMessage(auto.closed, auto.stillOpen) : "Saved to the notes. Nothing was closed." });
      setQuickAdd(false);
      void refresh();
      return null;
    } catch {
      return "Couldn't reach the server. Nothing was saved.";
    }
  }

  function renderCard(event: PlanEvent) {
    const application = event.application_id ? appById.get(event.application_id) ?? null : null;
    const urgency = urgencyOf(event, now);
    const timing = event.status === "to_book" ? null : describeTiming(event, now, tz);
    const url = safeHttpUrl(event.location_or_link);
    const heading = application?.company_name ?? event.title;
    const snoozable = snoozeUntil(event, now) !== null;
    const snoozed = isSnoozed(event, now);
    return (
      <li key={event.id}>
        <article className="planCard actionCard" data-urgency={urgency} data-action-id={event.id} data-action-title={event.title}>
          <CompanyInitial name={heading} />
          <div className="planCardBody">
            <header className="planCardHead">
              <div className="planCardWho">
                <h3 className="planCardCompany">{heading}</h3>
                {application && <p className="planCardRole">{application.role}</p>}
              </div>
              <div className="planCardTags">
                {application && <StageChip status={application.status} />}
                <KindTag kind={event.kind} />
              </div>
            </header>
            {application && <p className="planCardTitle">{event.title}</p>}
            <p className="planCardWhen">
              <span className="actionUrgency" data-urgency={urgency} data-action-urgency={urgency}>
                <Icon name={URGENCY_ICONS[urgency]} />
                {URGENCY_LABELS[urgency]}
              </span>
              {timing ? (
                <>
                  <strong>{timing.when}</strong>
                  <span className="planCountdown" data-overdue={timing.state === "overdue" ? "" : undefined} data-action-countdown>{timing.left}</span>
                </>
              ) : (
                <strong>No date yet</strong>
              )}
            </p>
            {snoozed && <p className="planCardMeta" data-action-snoozed>Hidden until {formatWhen(Date.parse(event.snoozed_until ?? ""), tz)}. It comes back sooner if it falls due within 24 hours.</p>}
            {event.source && SOURCE_LABELS[event.source] && <p className="planCardMeta" data-action-source>The email is in {SOURCE_LABELS[event.source]}.</p>}
            {event.location_or_link && !url && <p className="planCardMeta">{event.location_or_link}</p>}
            {event.prep_notes && <p className="planCardNotes">{event.prep_notes}</p>}
            <div className="planCardActions">
              <button type="button" className="linkBtn" onClick={() => setStatus(event, "done")} data-action-done>Mark done</button>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" className="linkBtn" data-action-open>Open link</a>}
              {snoozed ? (
                <button type="button" className="linkBtn" onClick={async () => { if (await putEvent({ id: event.id, snooze: false })) void refresh(); }} data-action-unsnooze>Show again</button>
              ) : (
                <button
                  type="button"
                  className="linkBtn"
                  disabled={!snoozable}
                  title={snoozable ? undefined : "Due within 24 hours, so it stays here."}
                  onClick={() => snooze(event)}
                  data-action-snooze
                >
                  Hide for 1 day
                </button>
              )}
              <button type="button" className="linkBtn" onClick={() => setForm({ type: "edit", event, application: application as never })} data-action-edit>{event.status === "to_book" ? "Set a date" : "Edit"}</button>
              {timing?.state === "overdue" && <button type="button" className="linkBtn" onClick={() => setStatus(event, "missed")} data-action-missed>Mark missed</button>}
            </div>
          </div>
        </article>
      </li>
    );
  }

  const nothing = data && data.events.length === 0;

  return (
    <main className="page">
      <div className="container">
        <AppHeader title="To do" tagline="Every assessment, interview and deadline still to do, soonest first." />

        {load === "loading" && <Card><Skeleton lines={5} label="Loading your to-do list" /></Card>}
        {load === "expired" && (
          <Card><EmptyState title="You've been signed out" actions={<Button href="/auth/login?next=/app/actions">Sign in</Button>}>Sign in again to see your to-do list.</EmptyState></Card>
        )}
        {load === "needs_migration" && <div className="limitNotice" role="status" data-needs-migration>{errorText}</div>}
        {load === "error" && (
          <Card>
            <StatusText tone="error" role="alert">{errorText}</StatusText>
            <div className="planDialogActions"><Button variant="secondary" onClick={() => { setLoad("loading"); void refresh(); }}>Try again</Button></div>
          </Card>
        )}

        {load === "ready" && data && (
          <>
            <div className="nextToolbar">
              <p className="cvHelp" data-action-count>{lists.due.length === 1 ? "1 thing to do" : `${lists.due.length} things to do`}{lists.snoozed.length > 0 ? `, ${lists.snoozed.length} hidden for now` : ""}.</p>
              <div className="actionToolbarButtons">
                <Button variant="secondary" onClick={() => setQuickAdd((v) => !v)} aria-expanded={quickAdd} data-quick-add-open>Add from an email</Button>
                <Button variant={quickAdd ? "secondary" : undefined} onClick={() => setForm({ type: "new", preset: { kind: "assessment" } })} data-new-action>New event</Button>
              </div>
            </div>
            {actionError && <StatusText tone="error" role="alert" className="msgBelow">{actionError}</StatusText>}

            {quickAdd && (
              <QuickAdd
                onClose={() => setQuickAdd(false)}
                onConfirmation={closeFromConfirmation}
                onPreset={(preset: Partial<PlanEvent> & { source: EmailSource }) => {
                  setQuickAdd(false);
                  setForm({ type: "new", preset });
                }}
              />
            )}

            {nothing ? (
              <Card>
                <EmptyState
                  title="Nothing to do"
                  actions={<Button onClick={() => setQuickAdd(true)}>Add from an email</Button>}
                >
                  When an email gives you a test, a video or a deadline, paste it here and it lines up by date.
                </EmptyState>
              </Card>
            ) : (
              <ol className="actionList" data-action-list>{lists.due.map(renderCard)}</ol>
            )}

            {lists.snoozed.length > 0 && (
              <section className="planGroup" data-action-snoozed-list>
                <h2 className="planGroupHead">Hidden for now <span className="planGroupCount">{lists.snoozed.length}</span></h2>
                <ol className="actionList">{lists.snoozed.map(renderCard)}</ol>
              </section>
            )}

            {data.closedByNote.length > 0 && (
              <section className="planGroup" data-action-closed-list>
                <h2 className="planGroupHead">Closed by a confirmation in your notes</h2>
                <ul className="actionClosed">
                  {data.closedByNote.map((event) => (
                    <li key={event.id} data-action-closed={event.title}>
                      <span>{(event.application_id && appById.get(event.application_id)?.company_name) || "No application"}: {event.title}</span>
                      <button type="button" className="inlineLink" onClick={() => reopen(event)} data-action-reopen>Undo</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {form && (
        <EventForm
          mode={form}
          tz={tz}
          otherEvents={data?.events ?? []}
          windows={data?.availability ?? []}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setForm(null);
            showToast({ message });
            void refresh();
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
    </main>
  );
}
