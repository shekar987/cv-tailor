"use client";
// "Interviews & deadlines" (Chunk JH-1, 19 Nov 2026; calmed down in JH-5, 24 Nov 2026):
// the upcoming interviews, screenings and assessments, at the very top of the Applications
// dashboard. It reads the plan's EVENTS (lib/interviewsPanel upcomingInterviews), so a booked
// interview shows even when its row is at the wrong stage or has ended — the bp case, where
// all three rows were Rejected and the Tue 24 Nov interview was invisible.
//
// JH-5 makes it simple: one clear main action per item (the item itself links to the Prep
// pack, the most useful next step before an interview), and at most 3 items by default with
// a "Show all (N)" button, so the Applications table is not pushed below the fold. "Move to
// <stage>" stays visible when the row is behind the booking (it is the one action that fixes
// data); every other action ("Add to calendar") sits behind one "More" disclosure per item.
//
// It sits above "Do these today", which keeps the row-level deadlines and follow-ups; the
// radar is told to skip these event kinds, so nothing shows twice.
//
// No next/* or @/ imports, so it can render under node:test like its neighbours.
import { useState } from "react";
import Icon from "../../components/ui/Icon.tsx";
import { STATUS_LABELS } from "../../lib/tracker.ts";
import { buildIcs, icsFilename } from "../../lib/ics.ts";
import { moreActionsLabel, panelHiddenCount, panelVisible, showAllLabel, type UpcomingItem } from "../../lib/interviewsPanel.ts";

function downloadIcs(item: UpcomingItem) {
  if (!item.at) return;
  const minutes = item.kind === "interview" || item.kind === "screening_call" || item.kind === "video" ? 45 : 60;
  const ics = buildIcs({
    uid: `${item.event_id}@jobhuntz.app`,
    title: item.title,
    start: item.at,
    dateOnly: item.date_only,
    durationMinutes: minutes,
    description: `${item.kindLabel} — ${item.role || "role"} at ${item.company_name}`,
    location: item.location ?? undefined,
    stamp: new Date().toISOString(),
  });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = icsFilename(`${item.company_name}-${item.kindLabel}`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InterviewsPanel({
  items,
  busyId,
  onMove,
}: {
  items: UpcomingItem[];
  busyId: string | null;
  onMove: (item: UpcomingItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const visible = panelVisible(items, showAll);
  const hidden = panelHiddenCount(items.length);
  return (
    <section className="interviewsPanel" aria-labelledby="interviewsPanelTitle" data-interviews-panel={items.length}>
      <h2 className="interviewsPanel__title" id="interviewsPanelTitle">
        <Icon name="users" /> Interviews &amp; deadlines <span className="interviewsPanel__count">{items.length}</span>
      </h2>
      <ol className="interviewsPanel__list" role="list">
        {visible.map((item) => (
          <li
            key={item.event_id}
            className={`interviewsPanel__item${item.overdue ? " interviewsPanel__item--overdue" : ""}`}
            data-interview-item={item.kind}
            data-needs-move={item.needsMove ? "1" : undefined}
          >
            {/* The one main action: open the prep pack for this interview. */}
            <a
              className="interviewsPanel__main"
              href={item.prepHref}
              data-prep-link
              aria-label={`${item.kindLabel} · ${item.company_name}${item.role ? ` · ${item.role}` : ""} — open prep pack`}
            >
              <span className="interviewsPanel__kind">{item.kindLabel}</span>
              <span className="interviewsPanel__who">
                {item.company_name}
                {item.role ? <span className="interviewsPanel__role"> · {item.role}</span> : null}
              </span>
              <span className="interviewsPanel__when">
                {item.when}
                {item.left ? <span className="interviewsPanel__left"> · {item.left}</span> : null}
              </span>
            </a>
            <span className="interviewsPanel__actions">
              {/* The row is behind the booking: the one data-fixing action stays visible. */}
              {item.needsMove && (
                <button
                  type="button"
                  className="appsActionBtn interviewsPanel__move"
                  onClick={() => onMove(item)}
                  disabled={busyId === item.event_id}
                  data-move-to-stage
                  title={`Row says ${item.currentStatus ? STATUS_LABELS[item.currentStatus] : "unknown"}`}
                >
                  {busyId === item.event_id ? "Moving…" : `Move to ${STATUS_LABELS[item.impliedStatus]}`}
                </button>
              )}
              {/* Everything else behind one keyboard-reachable disclosure. */}
              <details className="interviewsPanel__more">
                <summary className="appsActionBtn interviewsPanel__moreBtn" aria-label={moreActionsLabel(item)}>
                  More
                </summary>
                <div className="interviewsPanel__menu" role="group" aria-label={moreActionsLabel(item)}>
                  <a className="appsActionBtn" href={item.prepHref} data-prep-link-more>
                    Open prep pack
                  </a>
                  {item.at && (
                    <button type="button" className="appsActionBtn" onClick={() => downloadIcs(item)} data-add-to-calendar>
                      Add to calendar
                    </button>
                  )}
                </div>
              </details>
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <div className="interviewsPanel__footer">
          <button
            type="button"
            className="appsActionBtn interviewsPanel__showAll"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-label={showAll ? "Show fewer interviews and deadlines" : showAllLabel(items.length)}
            data-show-all
          >
            {showAll ? "Show fewer" : `Show all (${items.length})`}
          </button>
        </div>
      )}
    </section>
  );
}
