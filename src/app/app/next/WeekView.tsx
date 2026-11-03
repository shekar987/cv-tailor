"use client";

// Monday to Sunday with times down the side: events, free and busy windows, and
// slots still on offer, so a clash shows at a glance. The user's free and busy
// times are added here too.
import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import StatusText from "@/components/ui/StatusText";
import {
  conflictsFor, eventEndMs, eventMs, windowOnDay,
  type AvailabilityWindow, type PlanApplication, type PlanEvent,
} from "@/lib/plan";
import { addDays, clockTime, dayKey, mondayOf, shortDay } from "@/lib/planTime";

const HOUR_PX = 40;
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Block = { key: string; top: number; height: number; label: string; time: string; type: "event" | "busy" | "free" | "offer" | "deadline"; clash?: boolean; lane: number; lanes: number };
type RawBlock = { startMin: number; endMin: number; block: Omit<Block, "top" | "height" | "lane" | "lanes"> };

// Windows lie behind; anything else at the same moment shares the column's width.
function assignLanes(items: RawBlock[]): Map<RawBlock, { lane: number; lanes: number }> {
  const out = new Map<RawBlock, { lane: number; lanes: number }>();
  const front = items.filter((i) => i.block.type !== "busy" && i.block.type !== "free").sort((a, b) => a.startMin - b.startMin);
  let cluster: RawBlock[] = [];
  let clusterEnd = -1;
  const close = () => {
    const laneEnds: number[] = [];
    const placed = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMin);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.endMin;
      return { item, lane };
    });
    for (const { item, lane } of placed) out.set(item, { lane, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };
  for (const item of front) {
    if (cluster.length && item.startMin >= clusterEnd) close();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) close();
  return out;
}

export default function WeekView({
  events, windows, applications, now, tz, onChanged,
}: {
  events: readonly PlanEvent[];
  windows: readonly AvailabilityWindow[];
  applications: readonly PlanApplication[];
  now: number;
  tz: string;
  onChanged: () => void;
}) {
  const [monday, setMonday] = useState(() => mondayOf(dayKey(now, tz)));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const today = dayKey(now, tz);

  const { columns, untimed, startHour, endHour } = useMemo(() => {
    // Minutes since midnight on a day, in the user's zone.
    const minutes = (ms: number) => {
      const [h, m] = clockTime(ms, tz).split(":").map(Number);
      return h * 60 + m;
    };
    const companies = new Map(applications.map((a) => [a.id, a.company_name]));
    const nameOf = (e: PlanEvent) => (e.application_id ? companies.get(e.application_id) : null) ?? e.title;
    const raw = new Map<string, RawBlock[]>(days.map((d) => [d, []]));
    const noTime = new Map<string, string[]>(days.map((d) => [d, []]));
    const push = (day: string, startMin: number, endMin: number, block: RawBlock["block"]) => raw.get(day)?.push({ startMin, endMin: Math.max(endMin, startMin + 15), block });

    for (const e of events) {
      if (e.status === "to_book") {
        for (const [i, slot] of (e.offered_slots ?? []).entries()) {
          const start = Date.parse(slot.starts_at);
          if (!Number.isFinite(start)) continue;
          const startMin = minutes(start);
          push(dayKey(start, tz), startMin, startMin + 30, { key: `${e.id}-${i}`, label: `${nameOf(e)} (offered)`, time: clockTime(start, tz), type: "offer" });
        }
        continue;
      }
      const at = eventMs(e);
      if (at === null) continue;
      const day = dayKey(at, tz);
      if (e.date_only) { noTime.get(day)?.push(`${nameOf(e)}: ${e.title} due`); continue; }
      if (!e.starts_at) {
        const startMin = minutes(at);
        push(day, startMin, startMin + 15, { key: e.id, label: `${nameOf(e)}: ${e.title} due`, time: clockTime(at, tz), type: "deadline" });
        continue;
      }
      const end = eventEndMs(e) ?? at;
      const startMin = minutes(at);
      const clash = conflictsFor(e, events, windows, { tz }).length > 0;
      push(day, startMin, startMin + (end - at) / 60_000, { key: e.id, label: nameOf(e), time: clockTime(at, tz), type: "event", clash });
    }
    for (const day of days) {
      for (const w of windows) {
        const on = windowOnDay(w, day);
        if (!on) continue;
        const startMin = minutes(on.start);
        push(day, startMin, startMin + (on.end - on.start) / 60_000, { key: `${w.id}-${day}`, label: w.label || (w.kind === "busy" ? "Busy" : "Free"), time: clockTime(on.start, tz), type: w.kind });
      }
    }
    const all = [...raw.values()].flat();
    const startHour = Math.min(7, ...all.map((b) => Math.floor(b.startMin / 60)));
    const endHour = Math.max(20, ...all.map((b) => Math.ceil(b.endMin / 60)));
    const columns = days.map((day) => {
      const items = raw.get(day) ?? [];
      const lanes = assignLanes(items);
      return {
        day,
        blocks: items.map((item) => ({
          ...item.block,
          top: ((item.startMin - startHour * 60) / 60) * HOUR_PX,
          height: ((item.endMin - item.startMin) / 60) * HOUR_PX,
          lane: lanes.get(item)?.lane ?? 0,
          lanes: lanes.get(item)?.lanes ?? 1,
        })) as Block[],
      };
    });
    return { columns, untimed: noTime, startHour, endHour };
  }, [days, events, windows, applications, tz]);

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = hours.length * HOUR_PX;

  // The add form.
  const [mode, setMode] = useState<"date" | "weekly">("date");
  const [date, setDate] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [kind, setKind] = useState<"busy" | "free">("busy");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label, start_time: start, end_time: end, timezone: tz, ...(mode === "date" ? { date } : { weekday }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not save that time."); return; }
      setLabel(""); setStart(""); setEnd("");
      onChanged();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError("");
    const res = await fetch(`/api/availability?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) { setError("Could not delete that time."); return; }
    onChanged();
  }

  const sorted = [...windows].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.weekday ?? 0) - (b.weekday ?? 0) || a.start_time.localeCompare(b.start_time));

  return (
    <div className="weekView" data-week-view>
      <div className="weekNav">
        <button type="button" className="linkBtn" onClick={() => setMonday((m) => addDays(m, -7))}>Previous week</button>
        <strong className="weekNavLabel">{shortDay(monday)} to {shortDay(addDays(monday, 6))}</strong>
        <button type="button" className="linkBtn" onClick={() => setMonday((m) => addDays(m, 7))}>Next week</button>
        {!days.includes(today) && <button type="button" className="linkBtn" onClick={() => setMonday(mondayOf(today))}>This week</button>}
      </div>

      <div className="weekScroll" tabIndex={0} role="region" aria-label="Your week">
        <div className="weekGrid">
          <div className="weekCorner" aria-hidden="true" />
          {days.map((d) => (
            <div key={d} className="weekDayHead" data-today={d === today ? "" : undefined}>
              {shortDay(d)}
              {(untimed.get(d) ?? []).map((u, i) => <span key={i} className="weekDue">{u}</span>)}
            </div>
          ))}
          <div className="weekTimes" style={{ height: gridHeight }} aria-hidden="true">
            {hours.map((h) => <span key={h} style={{ height: HOUR_PX }}>{String(h).padStart(2, "0")}:00</span>)}
          </div>
          {columns.map(({ day, blocks }) => (
            <div key={day} className="weekColumn" style={{ height: gridHeight, backgroundSize: `100% ${HOUR_PX}px` }} data-week-day={day}>
              {blocks.map((b) => (
                <div
                  key={b.key}
                  className="weekBlock"
                  data-type={b.type}
                  data-clash={b.clash ? "" : undefined}
                  style={{ top: b.top, height: Math.max(b.height, 20), left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`, width: `calc(${100 / b.lanes}% - 4px)` }}
                  title={`${b.time} ${b.label}${b.clash ? " (clash)" : ""}`}
                >
                  <span className="weekBlockText">{b.time} {b.label}{b.clash ? " · clash" : ""}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="cvHelp weekLegend">
        Solid: booked. Dashed: slots offered, not booked. Striped: busy. Green tint: free.
      </p>

      <section className="weekWindows">
        <h2 className="planRailTitle">Your free and busy times</h2>
        <p className="cvHelp">Shifts, university, the gym: anything an interview should not land on. Clash checks and suggested replies read these.</p>
        <form className="weekForm" onSubmit={add}>
          <select className="textInput" aria-label="Free or busy" value={kind} onChange={(e) => setKind(e.target.value as "busy" | "free")} data-window-kind>
            <option value="busy">Busy</option>
            <option value="free">Free</option>
          </select>
          <select className="textInput" aria-label="One day or every week" value={mode} onChange={(e) => setMode(e.target.value as "date" | "weekly")}>
            <option value="date">One day</option>
            <option value="weekly">Every week</option>
          </select>
          {mode === "date" ? (
            <input type="date" className="textInput" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} data-window-date />
          ) : (
            <select className="textInput" aria-label="Day of the week" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          )}
          <input type="time" className="textInput" aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} data-window-start />
          <input type="time" className="textInput" aria-label="To" value={end} onChange={(e) => setEnd(e.target.value)} data-window-end />
          <input className="textInput" aria-label="Label" placeholder="Label, e.g. Shift" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} data-window-label />
          <Button type="submit" variant="secondary" disabled={saving} data-window-add>{saving ? "Adding…" : "Add"}</Button>
        </form>
        {error && <StatusText tone="error" role="alert">{error}</StatusText>}
        {sorted.length > 0 && (
          <ul className="weekWindowList">
            {sorted.map((w) => (
              <li key={w.id} data-window-row>
                <span className="stageChip" data-stage={w.kind === "busy" ? "rejected" : "offer"}>{w.kind === "busy" ? "Busy" : "Free"}</span>
                <span>{w.date ? shortDay(w.date) : `Every ${WEEKDAY_NAMES[(w.weekday ?? 1) - 1]}`}, {w.start_time.slice(0, 5)} to {w.end_time.slice(0, 5)}{w.label ? ` · ${w.label}` : ""}</span>
                <button type="button" className="inlineLink" onClick={() => remove(w.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
