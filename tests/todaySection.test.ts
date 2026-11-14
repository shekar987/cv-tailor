// Chunk 27 (14 Nov 2026): the "Today (n)" section on /applications, the follow-ups card's
// words, the tab a new visit opens on, and the wording the owner asked for.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { todayCount, todayHint, todayItemLine, todayOpen } from "../src/lib/todaySection.ts";
import { dueTodayLabel, dueTodaySentence, followupsDueToday } from "../src/lib/followupsDue.ts";
import { TAB_LABELS, TAB_ORDER, defaultTab, fixLabel, type TabKey } from "../src/lib/applicationStage.ts";
import TodaySection from "../src/app/applications/TodaySection.tsx";

const TODAY = "2026-11-14";
const item = (id: string, kind: "deadline" | "followup" | "event", when = "Sat 14 Nov, 10:00 · due in 15h", action = "Technical interview", company_name = "Harbourline Bank") => ({ id, kind, when, action, company_name });

test("the follow-ups card says which it is: due today, or overdue with the date", () => {
  // The audit's card: "1 Follow-ups due today" over "0 dated today · 1 overdue".
  const one = followupsDueToday([{ followup_date: "2026-11-09", status: "applied" }], TODAY);
  assert.deepEqual(one, { total: 1, today: 0, earlier: 1, oldest: "2026-11-09" });
  assert.equal(dueTodayLabel(one), "Follow-up overdue (due 9 Nov)");
  assert.equal(dueTodaySentence(one), "1 follow-up overdue (due 9 Nov)");

  assert.equal(dueTodayLabel({ total: 1, today: 1, earlier: 0, oldest: null }), "Follow-up due today");
  assert.equal(dueTodayLabel({ total: 4, today: 4, earlier: 0, oldest: null }), "Follow-ups due today");
  assert.equal(dueTodayLabel({ total: 0, today: 0, earlier: 0, oldest: null }), "Follow-ups due today");
  assert.equal(dueTodayLabel({ total: 6, today: 0, earlier: 6, oldest: "2026-11-02" }), "Follow-ups overdue (oldest due 2 Nov)");
  assert.equal(dueTodayLabel({ total: 3, today: 2, earlier: 1, oldest: "2026-11-09" }), "Follow-ups due: 2 today, 1 overdue (due 9 Nov)");
  assert.equal(dueTodayLabel({ total: 8, today: 2, earlier: 6, oldest: "2026-11-02" }), "Follow-ups due: 2 today, 6 overdue (oldest due 2 Nov)");
  assert.equal(dueTodaySentence({ total: 8, today: 2, earlier: 6, oldest: "2026-11-02" }), "8 follow-ups due: 2 today, 6 overdue (oldest due 2 Nov)");
});

test("the oldest date is the earliest overdue one, and a count without it (an older answer) prints no date", () => {
  const rows = [
    { followup_date: "2026-11-11", status: "applied" },
    { followup_date: "2026-11-03", status: "Screening" },
    { followup_date: TODAY, status: "applied" },
    { followup_date: "2026-10-01", status: "rejected" },
    { followup_date: "2026-10-02", status: "screening", pending_outcome: { outcome: "rejected", date: TODAY, source: "gmail" } },
  ];
  assert.deepEqual(followupsDueToday(rows, TODAY), { total: 3, today: 1, earlier: 2, oldest: "2026-11-03" });
  assert.equal(followupsDueToday([{ followup_date: TODAY, status: "applied" }], TODAY).oldest, null);
  assert.equal(dueTodayLabel({ total: 1, today: 0, earlier: 1 }), "Follow-up overdue");
  assert.equal(dueTodayLabel({ total: 5, today: 1, earlier: 4 }), "Follow-ups due: 1 today, 4 overdue");
  for (const label of [dueTodayLabel({ total: 1, today: 0, earlier: 1, oldest: "2026-11-09" }), dueTodayLabel({ total: 3, today: 2, earlier: 1, oldest: "2026-11-09" })]) {
    assert.ok(!/dated today/.test(label), label);
  }
});

test("Today (n) counts the 48-hour list plus the follow-ups it does not hold, each once", () => {
  assert.equal(todayCount([], []), 0);
  assert.equal(todayCount([item("a", "deadline"), item("b", "event")], []), 2);
  assert.equal(todayCount([], ["x", "y"]), 2);
  // A follow-up on a screened application is in the list and due today: one thing, not two.
  assert.equal(todayCount([item("a", "followup"), item("b", "deadline")], ["a", "c"]), 3);
  // A deadline and a follow-up on the same application are two things to do.
  assert.equal(todayCount([item("a", "deadline")], ["a"]), 2);
  assert.equal(todayCount([], ["x", "x"]), 1);
});

test("the folded line names the soonest thing due, else the follow-ups, else says nothing is due", () => {
  const none = { total: 0, today: 0, earlier: 0, oldest: null };
  assert.equal(
    todayHint([item("a", "event"), item("b", "deadline", "Sun 15 Nov, 23:59 · due in 53h", "Online test", "Oakridge Bank")], { total: 2, today: 2, earlier: 0, oldest: null }),
    "Soonest: Sat 14 Nov, 10:00 · due in 15h · Harbourline Bank: Technical interview"
  );
  assert.equal(todayHint([], { total: 1, today: 0, earlier: 1, oldest: "2026-11-09" }), "1 follow-up overdue (due 9 Nov).");
  assert.equal(todayHint([], none), "Nothing is due today.");
  // The company is not written twice when the action already names it.
  assert.equal(todayItemLine({ company_name: "Kestrel Energy", action: "Follow up with Kestrel Energy (Screening)" }), "Follow up with Kestrel Energy (Screening)");
});

test("folded on a phone and open on a wider screen, until the user chooses", () => {
  assert.equal(todayOpen(null, true), false);
  assert.equal(todayOpen(null, false), true);
  assert.equal(todayOpen(true, true), true);
  assert.equal(todayOpen(false, false), false);
});

test("the section's header is the disclosure, and folding keeps the count, the warning and the body", () => {
  const body = createElement("p", { "data-body": "" }, "cards");
  const closed = renderToStaticMarkup(createElement(TodaySection, { count: 3, urgent: true, hint: "Soonest: Sat 14 Nov", open: false, onToggle: () => {} }, body));
  assert.match(closed, /<h2[^>]*><button[^>]*aria-expanded="false"[^>]*aria-controls="todayBody"/);
  assert.match(closed, /Today<\/span><span[^>]*>3<\/span>/);
  assert.match(closed, /data-tone="red"/);
  assert.match(closed, /data-today-hint[^>]*>Soonest: Sat 14 Nov</);
  assert.match(closed, /id="todayBody" hidden=""><p data-body="">cards<\/p>/, "hidden, never unmounted");
  assert.match(closed, />Show</);

  const open = renderToStaticMarkup(createElement(TodaySection, { count: 0, hint: "Nothing is due today.", open: true, onToggle: () => {} }, body));
  assert.match(open, /aria-expanded="true"/);
  assert.ok(!/data-today-hint/.test(open) && !/hidden=""/.test(open) && !/data-tone/.test(open));
  assert.match(open, />Hide</);

  // Until every application is loaded the number is not known, so none is shown.
  const loading = renderToStaticMarkup(createElement(TodaySection, { count: 0, loading: true, hint: "Nothing is due today.", open: false, onToggle: () => {} }, body));
  assert.match(loading, /aria-label="Counting"[^>]*>…</);
  assert.ok(!/Nothing is due today/.test(loading) && !/data-today-count/.test(loading));
});

test("a new visit opens on the furthest stage that holds anything: decided from the counts, never from a remembered tab", () => {
  const none = Object.fromEntries(TAB_ORDER.map((t) => [t, 0])) as Record<TabKey, number>;
  // The audit's screenshot opened on "Interview 3": that is the rule, not the capture script.
  assert.equal(defaultTab({ ...none, to_submit: 1, applied: 13, screening: 7, interview: 3, closed: 9 }), "interview");
  assert.equal(defaultTab({ ...none, applied: 13, screening: 7, closed: 9 }), "screening");
  assert.equal(defaultTab({ ...none, applied: 13, closed: 9 }), "applied");
  assert.equal(defaultTab({ ...none, closed: 9 }), "closed");
  assert.equal(defaultTab(none), "applied");
});

test("the wording the owner asked for", () => {
  assert.equal(TAB_LABELS.closed, "Rejected / closed");
  assert.equal(fixLabel({ statusToFix: 0, attachmentsToFix: 11 }), "Applications missing a job description or CV");
  assert.equal(fixLabel({ statusToFix: 2, attachmentsToFix: 11 }), "Applications to fix · 2 with the wrong status, 11 missing a job description or CV");
  assert.ok(!/\bJD\b|\bdata\b/i.test(fixLabel({ statusToFix: 2, attachmentsToFix: 11 })));
});
