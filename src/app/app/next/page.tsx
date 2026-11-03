"use client";

// /app/next: the first page after sign-in. Every upcoming screening, interview,
// assessment and deadline in priority order, always current: a mutation refetches,
// so an application marked Rejected leaves at once, with an undo. The rules are
// lib/plan's; this file draws them and owns the actions. /api/plan is free.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";
import {
  bookingReply, buildPlan, describeTiming, displayZone, eventDays, findConflicts,
  type AvailabilityWindow, type Funnel, type PlanApplication, type PlanEvent, type PlanItem, type SuggestedSlot,
} from "@/lib/plan";
import { addDays, dayKey, formatWhen, mondayOf, monthName, shortDay, weekdayOf } from "@/lib/planTime";
import { normalizeStatus, type Status } from "@/lib/tracker";
import EventCard, { type CardActions } from "./EventCard";
import EventForm, { describeConflict, type EventFormMode } from "./EventForm";
import { CompanyInitial, StageChip, browserTimeZone, copyText } from "./planUi";
import WeekView from "./WeekView";

const PipelineChart = dynamic(() => import("./PipelineChart"), {
  ssr: false,
  loading: () => <Skeleton lines={5} label="Loading the pipeline" />,
});

type PlanData = { applications: PlanApplication[]; events: PlanEvent[]; availability: AvailabilityWindow[]; funnel: Funnel };
type Load = "loading" | "ready" | "needs_migration" | "expired" | "error";
type View = "plan" | "week" | "pipeline";
type Toast = { message: string; undo?: () => Promise<void> | void };

const TICK_MS = 30_000;
const LIVE_EVERY_MS = 5 * 60_000;
const TOAST_MS = 8000;
const LEAVE_MS = 220;
const NEXT_STAGE: Partial<Record<Status, Status>> = { screening: "interview" };

function MiniCalendar({ events, now, tz, selected, onSelect }: { events: readonly PlanEvent[]; now: number; tz: string; selected: string | null; onSelect: (day: string | null) => void }) {
  const today = dayKey(now, tz);
  const [month, setMonth] = useState(() => `${today.slice(0, 7)}-01`);
  const dots = useMemo(() => eventDays(events, tz), [events, tz]);
  const start = mondayOf(month);
  const nextMonth = addDays(month, 32).slice(0, 7);
  const cells: string[] = [];
  for (let d = start; d.slice(0, 7) !== nextMonth || weekdayOf(d) !== 1; d = addDays(d, 1)) cells.push(d);
  return (
    <section className="planRailCard" aria-label="Calendar" data-mini-calendar>
      <div className="calHead">
        <button type="button" className="calNav" aria-label="Previous month" onClick={() => setMonth(`${addDays(month, -1).slice(0, 7)}-01`)}><Icon name="chevron-left" /></button>
        <strong>{monthName(month)}</strong>
        <button type="button" className="calNav" aria-label="Next month" onClick={() => setMonth(`${nextMonth}-01`)}><Icon name="chevron-right" /></button>
      </div>
      <div className="calGrid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="calDow" aria-hidden="true">{d}</span>)}
        {cells.map((d) => {
          const count = dots.get(d) ?? 0;
          return (
            <button
              key={d}
              type="button"
              className="calDay"
              data-outside={d.slice(0, 7) !== month.slice(0, 7) ? "" : undefined}
              data-today={d === today ? "" : undefined}
              data-selected={d === selected ? "" : undefined}
              data-has-events={count ? "" : undefined}
              aria-pressed={d === selected}
              aria-label={`${shortDay(d)}${count ? `, ${count} event${count === 1 ? "" : "s"}` : ""}`}
              disabled={count === 0}
              onClick={() => onSelect(d === selected ? null : d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function NextPage() {
  const [data, setData] = useState<PlanData | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [errorText, setErrorText] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [tz] = useState(browserTimeZone);
  const [view, setView] = useState<View>("plan");
  const [form, setForm] = useState<EventFormMode | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest read may land: a read begun before a write must not bring back
  // what the write removed. A failed read keeps the plan on screen and says so.
  const readSeq = useRef(0);
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    const seq = ++readSeq.current;
    const failed = (message: string) => {
      if (hasData.current) { setActionError("Couldn't refresh your plan, so this may be out of date."); return; }
      setErrorText(message);
      setLoad("error");
    };
    try {
      const res = await fetch("/api/plan");
      const body = await res.json().catch(() => ({}));
      if (seq !== readSeq.current) return;
      if (res.status === 401) { setLoad("expired"); return; }
      if (res.status === 503 && body.errorType === "needs_migration") { setErrorText(body.error); setLoad("needs_migration"); return; }
      if (!res.ok) { failed(body.error || "Could not load your plan."); return; }
      hasData.current = true;
      setData(body as PlanData);
      setNow(Date.now());
      setLoad("ready");
    } catch {
      if (seq === readSeq.current) failed("Couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read; refresh sets state after its fetch
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(tick); };
  }, [refresh]);

  const events = useMemo(() => data?.events ?? [], [data]);
  const windows = useMemo(() => data?.availability ?? [], [data]);
  const applications = useMemo(() => data?.applications ?? [], [data]);
  const plan = useMemo(() => buildPlan({ events, applications, now, tz }), [events, applications, now, tz]);
  const conflicts = useMemo(() => findConflicts(events, windows, { tz }), [events, windows, tz]);

  // Countdown changes reach a screen reader at most every five minutes.
  const lastLive = useRef(0);
  const nextEvent = plan.nextUp?.event ?? null;
  const nextName = plan.nextUp ? plan.nextUp.application?.company_name ?? plan.nextUp.event.title : "";
  useEffect(() => {
    if (!nextEvent) return;
    if (now - lastLive.current < LIVE_EVERY_MS) return;
    const timing = describeTiming(nextEvent, now, tz);
    if (!timing) return;
    lastLive.current = now;
    setLiveText(`Next up: ${nextName}, ${timing.left}.`);
  }, [nextEvent, nextName, now, tz]);

  function showToast(next: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  async function putEvent(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/events", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setActionError(body.error || "Could not save that change. Try again.");
      return false;
    }
    return true;
  }

  async function putApplication(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/applications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setActionError(body.error || "Could not save that change. Try again.");
      return false;
    }
    return true;
  }

  // The card animates out, the write lands, then the server's answer replaces the data.
  function leaveThen(ids: string[], write: () => Promise<boolean>, after?: () => void) {
    setActionError("");
    setLeaving((s) => new Set([...s, ...ids]));
    setTimeout(async () => {
      const ok = await write();
      setLeaving((s) => { const next = new Set(s); for (const id of ids) next.delete(id); return next; });
      if (ok) after?.();
      await refresh();
    }, LEAVE_MS);
  }

  function endEvent(item: PlanItem, status: "done" | "cancelled", message: string) {
    const previous = item.event.status;
    leaveThen([item.event.id], () => putEvent(item.event.id, { status }), () => {
      showToast({
        message,
        undo: async () => {
          if (await putEvent(item.event.id, { status: previous })) await refresh();
        },
      });
    });
  }

  function moveApplication(application: PlanApplication, status: Status, reasonEvents: PlanItem[], message: string) {
    const previous = normalizeStatus(application.status) ?? "screening";
    const followup = application.followup_date ?? null;
    leaveThen(reasonEvents.map((i) => i.event.id), () => putApplication(application.id, { status }), () => {
      showToast({
        message,
        undo: async () => {
          if (await putApplication(application.id, { status: previous, ...(followup ? { followup_date: followup } : {}) })) await refresh();
        },
      });
    });
  }

  const allItems = plan.ordered;
  const actions: CardActions = {
    onDone: (item) => endEvent(item, "done", `Marked done: ${item.application?.company_name ?? item.event.title}.`),
    onCancel: (item) => endEvent(item, "cancelled", `Cancelled: ${item.application?.company_name ?? item.event.title}.`),
    onReschedule: (item) => setForm({ type: "edit", event: item.event, application: item.application, ...(item.event.status === "to_book" ? { when: "time" as const } : {}) }),
    onNextRound: (item) => setForm({ type: "new", application: item.application, preset: { kind: item.event.kind === "screening_call" ? "interview" : item.event.kind, timezone: item.event.timezone } }),
    onOutcome: (item, outcome) => {
      const application = item.application;
      if (!application) return;
      if (outcome === "rejected") {
        const gone = allItems.filter((i) => i.application?.id === application.id);
        moveApplication(application, "rejected", gone, `${application.company_name} moved to Rejected. Its events are hidden.`);
      } else if (outcome === "offer") {
        moveApplication(application, "offer", [], `${application.company_name} moved to Offer.`);
      } else {
        const stage = normalizeStatus(application.status);
        const next = stage ? NEXT_STAGE[stage] : undefined;
        leaveThen([item.event.id], async () => {
          const done = await putEvent(item.event.id, { status: "done" });
          return done && (next ? await putApplication(application.id, { status: next }) : true);
        }, () => {
          setForm({ type: "new", application: next ? { ...application, status: next } : application, preset: { kind: "interview", timezone: item.event.timezone } });
        });
      }
    },
    onBook: (item, slot: SuggestedSlot) => {
      setActionError("");
      void (async () => {
        // The offered slots stay on the event, so Undo puts the offer back as it was.
        const ok = await putEvent(item.event.id, { status: "scheduled", starts_at: new Date(slot.start).toISOString(), ends_at: slot.endGiven ? new Date(slot.end).toISOString() : null });
        if (ok) {
          const copied = await copyText(bookingReply([slot], tz));
          showToast({
            message: `Booked ${formatWhen(slot.start, tz)}. ${copied ? "A reply is copied: send it to confirm." : "Reply to them to confirm."}`,
            undo: async () => {
              if (await putEvent(item.event.id, { status: "to_book", starts_at: null, ends_at: null })) await refresh();
            },
          });
          await refresh();
        }
      })();
    },
  };

  const filterDay = useCallback(
    (items: PlanItem[]) => (dayFilter ? items.filter((i) => i.at !== null && dayKey(i.at, displayZone(i.event, tz)) === dayFilter) : items),
    [dayFilter, tz]
  );
  // n, j, k, d, ignored while typing or while the form is open. j, k and d walk only
  // the cards on screen, so d can never finish an event nobody can see.
  const walk = useRef({ ids: [] as string[], selectedId, items: allItems, form: false, onPlan: true });
  useEffect(() => {
    const drawn = view === "plan" ? filterDay(allItems) : [];
    walk.current = { ids: drawn.map((i) => i.event.id), selectedId, items: drawn, form: form !== null, onPlan: view === "plan" };
  });
  const doneRef = useRef(actions.onDone);
  useEffect(() => { doneRef.current = actions.onDone; });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || walk.current.form) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const { ids, selectedId: current, items, onPlan } = walk.current;
      if (e.key === "n") { e.preventDefault(); setForm({ type: "new" }); return; }
      if (e.key === "j" || e.key === "k") {
        if (ids.length === 0) return;
        e.preventDefault();
        const at = current ? ids.indexOf(current) : -1;
        const next = e.key === "j" ? Math.min(at + 1, ids.length - 1) : Math.max(at === -1 ? 0 : at - 1, 0);
        const id = ids[next];
        setSelectedId(id);
        const el = document.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "d" && current && onPlan) {
        const item = items.find((i) => i.event.id === current);
        if (item && item.event.status === "scheduled") { e.preventDefault(); doneRef.current(item); }
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const renderCard = (item: PlanItem) => (
    <li key={item.event.id}>
      <EventCard item={item} now={now} tz={tz} selected={selectedId === item.event.id} leaving={leaving.has(item.event.id)} events={events} windows={windows} actions={actions} />
    </li>
  );
  const nothing = plan.ordered.length === 0 && plan.waiting.length === 0;
  const hero = plan.nextUp;
  const heroTiming = hero ? describeTiming(hero.event, now, tz) : null;

  return (
    <main className="page">
      <div className="container">
        <AppHeader title="What's next" tagline="Every screening, interview, assessment and deadline, most urgent first." />
        <p className="srOnly" aria-live="polite" data-next-live>{liveText}</p>

        {load === "loading" && (
          <div className="nextLayout" data-next-skeleton>
            <div className="planMain"><Card><Skeleton lines={5} label="Loading your plan" /></Card></div>
            <aside className="planRail"><Card><Skeleton lines={4} label="Loading your calendar" /></Card></aside>
          </div>
        )}
        {load === "expired" && (
          <Card><EmptyState title="You've been signed out" actions={<Button href="/auth/login?next=/app/next">Sign in</Button>}>Sign in again to see your plan.</EmptyState></Card>
        )}
        {load === "needs_migration" && (
          <div className="limitNotice" role="status" data-needs-migration>{errorText}</div>
        )}
        {load === "error" && (
          <Card>
            <StatusText tone="error" role="alert">{errorText}</StatusText>
            <div className="planDialogActions"><Button variant="secondary" onClick={() => { setLoad("loading"); void refresh(); }}>Try again</Button></div>
          </Card>
        )}

        {load === "ready" && data && (
          <>
            {hero && heroTiming && (
              <div className="nextHero" data-next-hero>
                <span className="label">Next up</span>
                <strong>{hero.application?.company_name ?? hero.event.title}</strong>
                <span>{heroTiming.when} · {heroTiming.left}</span>
              </div>
            )}

            <div className="nextToolbar">
              <div className="appsSeg" role="group" aria-label="View">
                {(["plan", "week", "pipeline"] as View[]).map((v) => (
                  <button key={v} type="button" className={"appsSegBtn" + (view === v ? " active" : "")} aria-pressed={view === v} onClick={() => setView(v)} data-view={v}>
                    {v === "plan" ? "Plan" : v === "week" ? "Week" : "Pipeline"}
                  </button>
                ))}
              </div>
              <Button onClick={() => setForm({ type: "new" })} data-new-event>New event</Button>
            </div>
            {actionError && <StatusText tone="error" role="alert" className="msgBelow">{actionError}</StatusText>}

            <div className="nextLayout">
              <div className="planMain">
                {view === "plan" && (
                  nothing ? (
                    <Card>
                      <EmptyState
                        title="Nothing to do yet"
                        actions={<><Button onClick={() => setForm({ type: "new" })}>Add an interview or deadline</Button><Button variant="secondary" href="/app">Tailor a CV</Button></>}
                      >
                        When an application reaches screening, its calls, assessments and deadlines line up here, most urgent first.
                      </EmptyState>
                    </Card>
                  ) : (
                    <>
                      {dayFilter && (
                        <p className="planFilterNote">
                          Showing {shortDay(dayFilter)}. <button type="button" className="inlineLink" onClick={() => setDayFilter(null)}>Show everything</button>
                        </p>
                      )}
                      {plan.sections.map((group) => {
                        const items = filterDay(group.items);
                        if (items.length === 0) return null;
                        return (
                          <section key={group.key} className="planGroup" data-group={group.key}>
                            <h2 className="planGroupHead">
                              {group.key === "overdue" && <Icon name="alert" />}
                              {group.label} <span className="planGroupCount">{items.length}</span>
                            </h2>
                            {group.key === "needs_booking" && <p className="cvHelp planGroupNote">They are waiting on a time from you. An unanswered offer can lose the interview.</p>}
                            <ul className="planList">{items.map(renderCard)}</ul>
                          </section>
                        );
                      })}
                      {!dayFilter && plan.waiting.length > 0 && (
                        <section className="planGroup" data-group="waiting">
                          <h2 className="planGroupHead">Waiting on them <span className="planGroupCount">{plan.waiting.length}</span></h2>
                          <ul className="planWaiting">
                            {plan.waiting.map(({ application, daysSinceContact: days, basis, nudge }) => (
                              <li key={application.id} className="planWaitingRow" data-waiting-id={application.id} data-waiting={application.company_name}>
                                <CompanyInitial name={application.company_name} />
                                <div className="planWaitingText">
                                  <strong>{application.company_name}</strong>
                                  <span className="planCardRole">{application.role}</span>
                                  <span className="cvHelp">
                                    {basis === "contact"
                                      ? (days === 0 ? "In touch today" : days === 1 ? "1 day since contact" : `${days} days since contact`)
                                      : (days === null ? "No contact recorded" : days === 0 ? "Applied today; no contact recorded" : days === 1 ? "Applied yesterday; no contact recorded" : `Applied ${days} days ago; no contact recorded`)}
                                    {application.followup_date ? ` · follow-up ${shortDay(application.followup_date)}` : ""}
                                  </span>
                                  {nudge && (
                                    <span className="planNudge" data-nudge={nudge} data-nudge-basis={basis}>
                                      <Icon name="mail" />
                                      {basis === "contact"
                                        ? `T+${nudge}: ${nudge === 7 ? "send a first follow-up" : nudge === 14 ? "send a second follow-up" : "send a last follow-up, then consider Ghosted"}`
                                        : `T+${nudge} from applying: if you have heard nothing, follow up`}
                                    </span>
                                  )}
                                </div>
                                <div className="planWaitingActions">
                                  <StageChip status={application.status} />
                                  <button type="button" className="linkBtn" onClick={() => setForm({ type: "new", application })}>Add date/time</button>
                                  <button
                                    type="button"
                                    className="linkBtn"
                                    onClick={() => {
                                      const from = application.last_contact_from ?? null;
                                      const at = application.last_contact_at ?? null;
                                      void (async () => {
                                        setActionError("");
                                        if (await putApplication(application.id, { last_contact_from: "me", last_contact_at: new Date().toISOString() })) {
                                          showToast({
                                            message: `Recorded: you followed up with ${application.company_name} today.`,
                                            undo: async () => {
                                              if (await putApplication(application.id, { last_contact_from: from, last_contact_at: at })) await refresh();
                                            },
                                          });
                                          await refresh();
                                        }
                                      })();
                                    }}
                                    data-waiting-followed
                                  >
                                    Followed up today
                                  </button>
                                  <button type="button" className="linkBtn" onClick={() => moveApplication(application, "rejected", [], `${application.company_name} moved to Rejected.`)} data-waiting-reject>Rejected</button>
                                  <button type="button" className="linkBtn" onClick={() => moveApplication(application, "ghosted", [], `${application.company_name} moved to Ghosted.`)}>Ghosted</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      <p className="cvHelp planShortcuts">Keys: <kbd>n</kbd> new event, <kbd>j</kbd> / <kbd>k</kbd> move, <kbd>d</kbd> done.</p>
                    </>
                  )
                )}
                {view === "week" && <WeekView events={events} windows={windows} applications={applications} now={now} tz={tz} onChanged={() => void refresh()} />}
                {view === "pipeline" && <PipelineChart funnel={data.funnel} />}
              </div>

              <aside className="planRail" aria-label="Calendar, clashes and pipeline">
                <MiniCalendar events={events} now={now} tz={tz} selected={dayFilter} onSelect={(d) => { setDayFilter(d); setView("plan"); }} />
                <section className="planRailCard" data-conflicts>
                  <h2 className="planRailTitle">Clashes</h2>
                  {conflicts.length === 0 ? (
                    <p className="cvHelp"><Icon name="check" /> Nothing overlaps.</p>
                  ) : (
                    <ul className="planClashList">
                      {conflicts.map((c, i) => (
                        <li key={i} data-conflict={c.kind}>
                          <strong>{c.a.title}</strong>{c.a.starts_at ? ` (${formatWhen(Date.parse(c.a.starts_at), tz)})` : ""}: {describeConflict(c, tz)}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="planRailCard" data-funnel>
                  <h2 className="planRailTitle">Pipeline</h2>
                  <ol className="planFunnel">
                    {data.funnel.nodes.map((n) => (
                      <li key={n.key}>
                        <Link href={`/applications?status=${n.key}`} className="planFunnelRow" data-stage={n.key === "accepted" ? "accepted" : n.key} data-funnel-step={n.key}>
                          <span className="planFunnelName">{n.label}</span>
                          <span className="planFunnelCount">{n.count}</span>
                          <span className="planFunnelRate">{n.here} here now{n.key === "accepted" ? "" : n.tooFew ? " · too few to judge" : ` · ${Math.round((n.furtherRate ?? 0) * 100)}% of those decided went further`}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <p className="cvHelp">
                    {data.funnel.rejected} rejected · {data.funnel.ghosted} ghosted · <button type="button" className="inlineLink" onClick={() => setView("pipeline")}>see the map</button>
                  </p>
                  <p className="cvHelp" data-funnel-caveat>Stages are recorded from 3 Nov 2026: an earlier rejection counts at Applied, and an earlier row shows only its current stage.</p>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>

      {form && (
        <EventForm
          mode={form}
          tz={tz}
          otherEvents={events}
          windows={windows}
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
