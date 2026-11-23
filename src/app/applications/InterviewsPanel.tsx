"use client";
// "Interviews & deadlines" (Chunk JH-1, 19 Nov 2026): the upcoming interviews, screenings
// and assessments, at the very top of the Applications dashboard. It reads the plan's
// EVENTS (lib/interviewsPanel upcomingInterviews), so a booked interview shows even when
// its row is at the wrong stage or has ended — the bp case, where all three rows were
// Rejected and the Tue 24 Nov interview was invisible. Each item carries a countdown, an
// "Add to calendar" (.ics) download, a "Prep pack" link and, when the row is behind the
// booking, a one-click "Move to <stage>".
//
// It sits above "Do these today", which keeps the row-level deadlines and follow-ups; the
// radar is told to skip these event kinds, so nothing shows twice.
//
// No next/* or @/ imports, so it can render under node:test like its neighbours.
import Icon from "../../components/ui/Icon";
import { STATUS_LABELS } from "../../lib/tracker";
import { buildIcs, icsFilename } from "../../lib/ics";
import type { UpcomingItem } from "../../lib/interviewsPanel";

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
  if (items.length === 0) return null;
  return (
    <section className="interviewsPanel" aria-labelledby="interviewsPanelTitle" data-interviews-panel={items.length}>
      <h2 className="interviewsPanel__title" id="interviewsPanelTitle">
        <Icon name="users" /> Interviews &amp; deadlines <span className="interviewsPanel__count">{items.length}</span>
      </h2>
      <p className="interviewsPanel__sub">Booked interviews, screenings and assessments — from your events, so one still shows if its status is wrong.</p>
      <ol className="interviewsPanel__list" role="list">
        {items.map((item) => (
          <li
            key={item.event_id}
            className={`interviewsPanel__item${item.overdue ? " interviewsPanel__item--overdue" : ""}`}
            data-interview-item={item.kind}
            data-needs-move={item.needsMove ? "1" : undefined}
          >
            <span className="interviewsPanel__kind">{item.kindLabel}</span>
            <span className="interviewsPanel__when">
              {item.when}
              {item.left ? <span className="interviewsPanel__left"> · {item.left}</span> : null}
            </span>
            <span className="interviewsPanel__who">
              {item.company_name}
              {item.role ? <span className="interviewsPanel__role"> · {item.role}</span> : null}
            </span>
            {item.needsMove && (
              <span className="interviewsPanel__flag" data-move-flag>
                Row says {item.currentStatus ? STATUS_LABELS[item.currentStatus] : "unknown"}
              </span>
            )}
            <span className="interviewsPanel__buttons">
              {item.needsMove && (
                <button
                  type="button"
                  className="appsActionBtn interviewsPanel__move"
                  onClick={() => onMove(item)}
                  disabled={busyId === item.event_id}
                  data-move-to-stage
                >
                  {busyId === item.event_id ? "Moving…" : `Move to ${STATUS_LABELS[item.impliedStatus]}`}
                </button>
              )}
              {item.at && (
                <button type="button" className="appsActionBtn" onClick={() => downloadIcs(item)} data-add-to-calendar>
                  Add to calendar
                </button>
              )}
              <a className="appsActionBtn" href={item.prepHref} data-prep-link>
                Prep pack
              </a>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
