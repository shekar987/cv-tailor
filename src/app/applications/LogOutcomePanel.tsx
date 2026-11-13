"use client";

// "Log outcome" on /applications (13 Nov 2026, Chunk 26; lib/outcomeEmail holds every rule).
// Paste the email an employer sent, or search for the application, then one click on the
// right application: it moves to its ending, takes the outcome's date, and gets one dated
// line in its notes. The email is read in the browser and never sent or stored; only the
// sentence shown here goes into the notes, added on top of what is already there.
//
// The click is the user's own word on a named application, so it may end one that reached
// screening (the page sends it through MoveToClosedDialog's closeBody, with Undo). An
// application that already has the outcome is shown and never changed.
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { CLOSE_REASONS, CLOSE_REASON_LABELS, HIGHEST_STAGE_LABELS, activePending, closedAtFromDate, highestStage, isEnding, pendingLine, resultLine, statusForReason, type CloseReason } from "@/lib/closing";
import { formatDate } from "@/lib/formatDate";
import { MAX_APPENDED_NOTE } from "@/lib/notesWrite";
import { MAX_OUTCOME_EMAIL_CHARS, OUTCOME_SEARCH_LIMIT, manualOutcomeNoteLine, matchOutcomeRows, outcomeNoteLine, readOutcomeEmail, searchOutcomeRows, type NextStep, type OutcomeRow } from "@/lib/outcomeEmail";
import { STATUS_LABELS, normalizeStatus } from "@/lib/tracker";
import { MAX_SEARCH_CHARS } from "@/lib/trackerSearch";

export type OutcomePanelRow = OutcomeRow & {
  stages_reached?: readonly string[] | null;
  closed_at?: string | null;
  close_reason?: string | null;
  pending_outcome?: unknown;
};
export type OutcomeChoice = { reason: CloseReason; date: string; note: string };

type Done = { id: string; company: string; role: string; reason: CloseReason; date: string };

// A paste replaces the email; a keystroke corrects it. Only a change this large reads as a new email.
const NEW_EMAIL_CHARS = 20;

export default function LogOutcomePanel({
  rows, ready, today, next, onLog, onNext, onClose,
}: {
  rows: readonly OutcomePanelRow[];
  /** Every application is loaded. Until then a match could miss the right one, so none is shown. */
  ready: boolean;
  /** The user's own date, YYYY-MM-DD. */
  today: string;
  /** One thing to do after an outcome is saved. */
  next: NextStep;
  /** Saves it. Answers the error to show, or null. */
  onLog: (id: string, choice: OutcomeChoice) => Promise<string | null>;
  onNext: (kind: NextStep["kind"]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  // What the user chose over what the email reads as; null = follow the email.
  const [reasonPick, setReasonPick] = useState<CloseReason | null>(null);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [wordsPick, setWordsPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const doneBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);
  // The button that was clicked is gone once it is saved: focus goes to what was saved, not to the page.
  const doneId = done?.id;
  useEffect(() => {
    if (doneId) doneBox.current?.focus();
  }, [doneId]);

  const hasEmail = text.trim().length > 0;
  const read = useMemo(() => readOutcomeEmail(text), [text]);
  // An email that does not say is the user's to judge; with no email, a rejection is why most people are here.
  const reason: CloseReason | null = reasonPick ?? (hasEmail ? read.outcome : "rejected");
  const day = dayPick ?? (read.date && read.date <= today ? read.date : today);
  const words = wordsPick ?? (hasEmail ? read.sentence : "");
  const closedAt = closedAtFromDate(day);
  const dayOk = !!closedAt && day <= today;
  const note = !reason ? "" : hasEmail ? outcomeNoteLine(day, words) : manualOutcomeNoteLine(day, CLOSE_REASON_LABELS[reason], words);

  const searching = query.trim().length > 0;
  const found = useMemo(() => {
    if (!ready) return { matches: [], sure: false, more: 0 };
    if (searching) {
      const all = searchOutcomeRows(rows, query, rows.length);
      return { matches: all.slice(0, OUTCOME_SEARCH_LIMIT).map((row) => ({ row, why: "" })), sure: false, more: Math.max(0, all.length - OUTCOME_SEARCH_LIMIT) };
    }
    if (!hasEmail) return { matches: [], sure: false, more: 0 };
    const { matches, sure, more } = matchOutcomeRows(rows, text, read);
    return { matches: matches.map(({ row, why }) => ({ row, why })), sure, more };
  }, [ready, searching, hasEmail, rows, query, text, read]);

  // On a phone the match is below the email box: once an email finds one, bring its button
  // into view, so a paste is followed by one tap and no scrolling. Does nothing when it is
  // already on screen, and nothing while the user is typing a search.
  const list = useRef<HTMLUListElement>(null);
  const topMatch = hasEmail && !searching ? found.matches[0]?.row.id : undefined;
  useEffect(() => {
    if (topMatch) list.current?.scrollIntoView({ block: "nearest" });
  }, [topMatch]);

  function pasteEmail(value: string) {
    const next = value.slice(0, MAX_OUTCOME_EMAIL_CHARS);
    // A new email is read afresh: nothing chosen for the last one carries over. Fixing a
    // character in this one keeps the outcome, date and sentence the user picked.
    if (!text.trim() || !next.trim() || Math.abs(next.length - text.length) > NEW_EMAIL_CHARS) {
      setReasonPick(null);
      setDayPick(null);
      setWordsPick(null);
    }
    setText(next);
    setError("");
    setDone(null);
  }

  async function mark(row: OutcomePanelRow) {
    if (!reason || !dayOk || busy) return;
    setBusy(row.id);
    setError("");
    const failure = await onLog(row.id, { reason, date: day, note });
    setBusy(null);
    if (failure) {
      setError(failure);
      return;
    }
    setDone({ id: row.id, company: row.company_name, role: row.role, reason, date: day });
    setText("");
    setQuery("");
    setReasonPick(null);
    setDayPick(null);
    setWordsPick(null);
  }

  const label = reason ? CLOSE_REASON_LABELS[reason] : "";
  const doneRow = done ? rows.find((r) => r.id === done.id) : undefined;
  // Undone = it no longer has the outcome that was saved (it may have gone back to another ending).
  const undone = !!done && !!doneRow && normalizeStatus(doneRow.status) !== statusForReason(done.reason);

  return (
    <Card className="outcomePanel" data-outcome-panel aria-labelledby="outcome-title">
      <div className="outcomeHead">
        <h2 id="outcome-title" className="label">Log an outcome</h2>
        <button type="button" className="linkBtn" onClick={onClose} data-outcome-close>Close</button>
      </div>

      {done && (
        <div ref={doneBox} tabIndex={-1} className="outcomeDone" role="status" data-outcome-done={undone ? "undone" : done.id}>
          {undone ? (
            <p className="outcomeDone__line">That was undone. {done.company} is back at {STATUS_LABELS[normalizeStatus(doneRow?.status) ?? "applied"]}.</p>
          ) : (
            <>
              <p className="outcomeDone__line">
                Saved. <strong>{done.company}</strong> ({done.role}) is now {CLOSE_REASON_LABELS[done.reason]}, dated {formatDate(done.date)}. The line is in its notes, and your other notes are unchanged.
              </p>
              <p className="outcomeDone__next" data-outcome-next={next.kind}>
                <span className="outcomeDone__nextLabel">What to do next:</span> {next.text}{" "}
                {next.kind === "apply"
                  ? <Button variant="secondary" href="/app" data-outcome-next-action>{next.action}</Button>
                  : <Button variant="secondary" onClick={() => onNext(next.kind)} data-outcome-next-action>{next.action}</Button>}
              </p>
            </>
          )}
        </div>
      )}

      {/* Two ways in, side by side on a wide screen: the email, or a search. */}
      <div className="outcomeWays">
        <div className="outcomeWay">
          <label className="label" htmlFor="outcome-email">{done ? "Log another: paste the email" : "Paste the email you received"}</label>
          <textarea
            id="outcome-email"
            ref={box}
            className="outcomeText"
            rows={5}
            value={text}
            maxLength={MAX_OUTCOME_EMAIL_CHARS}
            placeholder="Paste the email here. It is read in your browser and is not saved. Only one sentence goes into the application's notes."
            onChange={(e) => pasteEmail(e.target.value)}
            data-outcome-text
          />
        </div>
        <div className="outcomeWay">
          <label className="label" htmlFor="outcome-search">Or search for the application</label>
          <input
            id="outcome-search"
            type="search"
            className="textInput outcomeSearch"
            value={query}
            maxLength={MAX_SEARCH_CHARS}
            placeholder="Search company or role"
            onChange={(e) => { setQuery(e.target.value); setError(""); }}
            data-outcome-search
          />
          <p className="cvHelp">Use this when you have no email, or when the email finds the wrong application.</p>
        </div>
      </div>

      {hasEmail && (
        <p className="outcomeRead" role="status" data-outcome-read={read.outcome ?? (read.invitation ? "invitation" : "unknown")}>
          {read.outcome === "rejected" && <>This reads as a rejection (&quot;{read.phrase}&quot;).</>}
          {!read.outcome && read.invitation && read.phrase && <>This email says two things: &quot;{read.phrase}&quot;, and an invitation. Choose the outcome below.</>}
          {!read.outcome && read.invitation && !read.phrase && <>This reads like an invitation, not a rejection. Add it on the To do page. If it is an outcome, choose it below.</>}
          {!read.outcome && !read.invitation && <>We could not tell the outcome from this email. Choose it below.</>}
        </p>
      )}

      {(hasEmail || searching) && (
        <div className="outcomeFields">
          <label className="outcomeField">
            <span className="label">Outcome</span>
            <select className="textInput" value={reason ?? ""} onChange={(e) => setReasonPick((e.target.value || null) as CloseReason | null)} data-outcome-reason>
              {!reason && <option value="">Choose the outcome</option>}
              {CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABELS[r]}</option>)}
            </select>
          </label>
          <label className="outcomeField">
            <span className="label">Date</span>
            <input type="date" className="textInput" value={day} max={today} onChange={(e) => setDayPick(e.target.value)} required data-outcome-date />
          </label>
          <label className="outcomeField outcomeField--wide">
            <span className="label">{hasEmail ? "Sentence to keep in the notes" : "Note (optional)"}</span>
            <input type="text" className="textInput" value={words} maxLength={MAX_APPENDED_NOTE} onChange={(e) => setWordsPick(e.target.value)} data-outcome-words />
          </label>
        </div>
      )}
      {(hasEmail || searching) && !dayOk && <p className="keyError" role="alert">Enter a date that is today or earlier.</p>}

      {(hasEmail || searching) && !ready && <p className="cvHelp" role="status" data-outcome-loading>Loading your applications…</p>}

      {(hasEmail || searching) && ready && found.matches.length === 0 && (
        <p className="outcomeEmpty" role="status" data-outcome-none>
          {searching
            ? "No application matches that search."
            : "No application matches this email. Search for it above."}
        </p>
      )}

      {found.matches.length > 0 && (
        <>
          <p className="outcomeListTitle" id="outcome-list-title">
            {searching ? "Search results" : found.matches.length === 1 ? "This looks like the application" : "Which application is it?"}
            {!searching && !found.sure && " Check the company and role before you click."}
          </p>
          <ul ref={list} className="outcomeList" aria-labelledby="outcome-list-title" data-outcome-matches={found.matches.length}>
            {found.matches.map(({ row, why }, index) => {
              const status = normalizeStatus(row.status);
              const already = !!reason && status === statusForReason(reason);
              const furthest = highestStage(row);
              const reported = activePending(row.pending_outcome);
              const reportedEnding = reported && isEnding(reported.outcome) ? reported : null;
              return (
                <li key={row.id} className="outcomeItem" data-outcome-row={row.id} data-outcome-already={already ? "" : undefined}>
                  <div className="outcomeItem__what">
                    <span className="outcomeItem__name"><strong>{row.company_name}</strong> · {row.role}</span>
                    <span className="outcomeItem__meta">
                      {status ? STATUS_LABELS[status] : String(row.status)}
                      {row.date_applied ? ` · applied ${formatDate(row.date_applied)}` : ""}
                      {why ? ` · ${why}` : ""}
                    </span>
                    {already && <span className="outcomeItem__note" data-outcome-already-note>Already {resultLine(row).replace(/^[A-Z]/, (c) => c.toLowerCase())}. Nothing to change.</span>}
                    {!already && reportedEnding && <span className="outcomeItem__note">Already reported: {pendingLine(reportedEnding)} Your click confirms it.</span>}
                    {!already && !reportedEnding && furthest && !isEnding(status) && (
                      <span className="outcomeItem__note">It reached {HIGHEST_STAGE_LABELS[furthest].toLowerCase()}. Your click confirms the outcome and closes it.</span>
                    )}
                  </div>
                  {!already && (
                    <Button
                      variant={found.sure && index === 0 ? "primary" : "secondary"}
                      onClick={() => void mark(row)}
                      disabled={!reason || !dayOk || busy !== null}
                      aria-label={reason ? `Mark as ${label.toLowerCase()}: ${row.company_name}, ${row.role}` : undefined}
                      data-outcome-mark={row.id}
                    >
                      {busy === row.id ? "Saving…" : reason ? `Mark as ${label.toLowerCase()}` : "Choose the outcome first"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {found.more > 0 && (
            <p className="cvHelp" data-outcome-more>
              {found.more === 1 ? "1 more application matches." : `${found.more} more applications match.`} {searching ? "Type more of the name to narrow it down." : "Search above to see them."}
            </p>
          )}
        </>
      )}

      {(hasEmail || searching) && note && (
        <p className="cvHelp" data-outcome-note>
          This line will be added to the top of the application&apos;s notes: &quot;{note}&quot; Your other notes stay as they are.
        </p>
      )}

      {error && <p role="alert" className="keyError" data-outcome-error>{error}</p>}
    </Card>
  );
}
