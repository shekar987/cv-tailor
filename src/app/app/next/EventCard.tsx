"use client";

// One item on the plan. The actions call back to the page, which owns the data and
// the undo toast. Nothing in here decides what is live: that is lib/plan.
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import {
  bookingReply, describeTiming, suggestSlots,
  type AvailabilityWindow, type PlanEvent, type PlanItem, type SuggestedSlot,
} from "@/lib/plan";
import { clockTime, dayKey, longDay } from "@/lib/planTime";
import { CompanyInitial, KindTag, StageChip, copyText, safeHttpUrl } from "./planUi";

export type CardActions = {
  onDone: (item: PlanItem) => void;
  onCancel: (item: PlanItem) => void;
  onReschedule: (item: PlanItem) => void;
  onNextRound: (item: PlanItem) => void;
  onOutcome: (item: PlanItem, outcome: "pass" | "rejected" | "offer") => void;
  onBook: (item: PlanItem, slot: SuggestedSlot) => void;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="planCopy"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      <Icon name={state === "copied" ? "check" : "copy"} />
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </button>
  );
}

function SlotHelper({ item, events, windows, now, tz, onBook }: { item: PlanItem; events: readonly PlanEvent[]; windows: readonly AvailabilityWindow[]; now: number; tz: string; onBook: CardActions["onBook"] }) {
  const offered = item.event.offered_slots ?? [];
  const { slots, usedDefaultHours } = suggestSlots({ windows, events, now, tz, offered });
  const reply = bookingReply(slots, tz);
  return (
    <div className="planSlots" data-slot-helper>
      {slots.length === 0 ? (
        <p className="cvHelp">
          {offered.length === 0
            ? "No free time in the next two weeks. Add your free times in the Week view."
            : offered.every((o) => Date.parse(o.starts_at) <= now)
              ? "Every slot they offered has passed."
              : "None of the slots still open is free: each clashes with something on your schedule or falls too close to it."}
        </p>
      ) : (
        <>
          {usedDefaultHours && <p className="cvHelp">You have no free times saved, so these are weekdays from 09:00 to 17:30. Add yours in the Week view.</p>}
          <ul className="planSlotList">
            {slots.map((s) => (
              <li key={s.start} data-slot={clockTime(s.start, tz)}>
                <span>{longDay(dayKey(s.start, tz))}, {clockTime(s.start, tz)}{s.offered ? "" : ` to ${clockTime(s.end, tz)}`}</span>
                {s.offered && <button type="button" className="inlineLink" onClick={() => onBook(item, s)} data-slot-book>Book this</button>}
              </li>
            ))}
          </ul>
          <CopyButton text={reply} label="Copy reply" />
        </>
      )}
    </div>
  );
}

export default function EventCard({
  item, now, tz, selected, leaving, events, windows, actions,
}: {
  item: PlanItem;
  now: number;
  tz: string;
  selected: boolean;
  leaving: boolean;
  events: readonly PlanEvent[];
  windows: readonly AvailabilityWindow[];
  actions: CardActions;
}) {
  const { event, application } = item;
  const [showSlots, setShowSlots] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const toBook = event.status === "to_book";
  const url = safeHttpUrl(event.location_or_link);
  const hasOffers = (event.offered_slots ?? []).length > 0;
  const timing = toBook ? null : describeTiming(event, now, tz);
  const heading = application?.company_name ?? event.title;

  return (
    <article
      className={"planCard" + (leaving ? " planCard--leaving" : "") + (selected ? " planCard--selected" : "")}
      data-event-id={event.id}
      data-event-title={event.title}
      tabIndex={-1}
    >
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
        {(application || event.stage_label) && (
          <p className="planCardTitle">{application ? event.title : ""}{application && event.stage_label ? " · " : ""}{event.stage_label}</p>
        )}

        {toBook ? (
          <p className="planCardWhen" data-event-when>
            <Icon name="clock" /> <strong>{hasOffers ? "Slots offered: reply to book" : "Not booked yet: reply with your times"}</strong>
          </p>
        ) : timing ? (
          <p className="planCardWhen" data-event-when>
            <Icon name="clock" />
            <strong>{timing.when}</strong>
            <span className="planCountdown" data-overdue={timing.state === "overdue" ? "" : undefined} data-event-countdown>
              {timing.left}
            </span>
          </p>
        ) : null}

        {event.location_or_link && (
          <p className="planCardLink">
            <Icon name={url ? "link" : "building"} />
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inlineLink">{url.replace(/^https?:\/\//i, "").slice(0, 60)}</a> : <span>{event.location_or_link}</span>}
            <CopyButton text={event.location_or_link} label="Copy" />
          </p>
        )}
        {event.contact_name && <p className="planCardMeta">With {event.contact_name}</p>}
        {event.prep_notes && <p className="planCardNotes">{event.prep_notes}</p>}
        {application?.prep_generated_at && (
          <p className="planCardMeta"><Link href={`/applications/${application.id}/prep`} className="inlineLink">Interview pack</Link></p>
        )}

        {toBook && showSlots && <SlotHelper item={item} events={events} windows={windows} now={now} tz={tz} onBook={actions.onBook} />}

        <div className="planCardActions">
          {toBook ? (
            <button type="button" className="linkBtn" aria-expanded={showSlots} onClick={() => setShowSlots((v) => !v)} data-suggest-replies>Suggest replies</button>
          ) : (
            <button type="button" className="linkBtn" onClick={() => actions.onDone(item)} data-event-done>Mark done</button>
          )}
          <button type="button" className="linkBtn" onClick={() => actions.onReschedule(item)} data-event-reschedule>{toBook ? "Set a time" : "Reschedule"}</button>
          <button type="button" className="linkBtn" onClick={() => actions.onCancel(item)} data-event-cancel>Cancel</button>
          {application && !toBook && <button type="button" className="linkBtn" onClick={() => actions.onNextRound(item)} data-event-next>Add next round</button>}
          {application && (
            showOutcome ? (
              <span className="planOutcome" role="group" aria-label={`Outcome for ${heading}`}>
                <button type="button" className="linkBtn" onClick={() => actions.onOutcome(item, "pass")} data-outcome="pass">Pass</button>
                <button type="button" className="linkBtn" onClick={() => actions.onOutcome(item, "rejected")} data-outcome="rejected">Rejected</button>
                <button type="button" className="linkBtn" onClick={() => actions.onOutcome(item, "offer")} data-outcome="offer">Offer</button>
              </span>
            ) : (
              <button type="button" className="linkBtn" onClick={() => setShowOutcome(true)} data-event-outcome>Set outcome</button>
            )
          )}
        </div>
      </div>
    </article>
  );
}
