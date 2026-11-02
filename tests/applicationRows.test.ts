// Reading every tracker row through PostgREST's 1000-row ceiling, and the small
// list row the sheet receives (lib/applicationRows, 2 Nov 2026). The rows are
// made up; their sizes follow the owner's tracker as measured on 2 Nov. The
// routes themselves are exercised on a seeded account by
// scripts/smoke-tracker-paging.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LIST_PAGE_SIZE,
  MAX_APPLICATIONS,
  NOTES_PREVIEW_CHARS,
  notesListFields,
  readApplicationPages,
  toListRow,
  type OrderableQuery,
} from "../src/lib/applicationRows.ts";
import { computeInsights, rowFromApplication } from "../src/lib/insights.ts";
import { gateLine, type GatesSummary } from "../src/lib/knockouts.ts";

// A fake PostgREST: never answers more than 1000 rows per request, whatever is asked.
function fakeTable(total: number, failOnPage?: number) {
  const calls: { orders: string[]; from: number; to: number }[] = [];
  let built = 0;
  const freshQuery = (): OrderableQuery => {
    built++;
    const orders: string[] = [];
    const q: OrderableQuery = {
      order(column, { ascending }) {
        orders.push(`${column} ${ascending ? "asc" : "desc"}`);
        return q;
      },
      async range(from, to) {
        calls.push({ orders, from, to });
        if (failOnPage === calls.length) return { data: null, error: { code: "XX000", message: "boom" } };
        const end = Math.min(total, to + 1, from + 1000);
        const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => ({ id: `r${from + i}`, status: "Applied", role: "Software Engineer", company_name: `Co ${from + i}` }));
        return { data, error: null };
      },
    };
    return q;
  };
  return { freshQuery, calls, built: () => built };
}

test("1,013 rows come back whole over two pages, in one order, with a fresh query per page", async () => {
  const t = fakeTable(1013);
  const { rows, error } = await readApplicationPages<{ id: string }>(t.freshQuery);
  assert.equal(error, null);
  assert.equal(rows?.length, 1013);
  assert.equal(new Set(rows?.map((r) => r.id)).size, 1013, "no row repeated");
  assert.deepEqual(t.calls.map((c) => [c.from, c.to]), [[0, 999], [1000, 1999]]);
  for (const c of t.calls) assert.deepEqual(c.orders, ["date_applied desc", "created_at desc", "id asc"]);
  assert.equal(t.built(), 2, "a builder is used once");
});

test("the insights count every row of 1,013, not the first request's 1000", async () => {
  const { rows } = await readApplicationPages(fakeTable(1013).freshQuery);
  assert.equal(computeInsights((rows ?? []).map(rowFromApplication)).counted, 1013);
});

test("stops on a short page, on an empty page after a full one, and at the cap", async () => {
  const small = fakeTable(12);
  assert.equal((await readApplicationPages(small.freshQuery)).rows?.length, 12);
  assert.equal(small.calls.length, 1);
  const exact = fakeTable(LIST_PAGE_SIZE);
  assert.equal((await readApplicationPages(exact.freshQuery)).rows?.length, LIST_PAGE_SIZE);
  assert.equal(exact.calls.length, 2, "a full page may not be the last");
  const over = fakeTable(MAX_APPLICATIONS + 500);
  assert.equal((await readApplicationPages(over.freshQuery)).rows?.length, MAX_APPLICATIONS);
  assert.equal(over.calls.length, 2, "never reads past the cap");
});

test("an error on a later page returns the error and no partial rows", async () => {
  const { rows, error } = await readApplicationPages(fakeTable(1013, 2).freshQuery);
  assert.equal(rows, null);
  assert.equal(error?.message, "boom");
});

const ROW_BASE = {
  id: "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c",
  company_name: "Northgate Systems",
  role: "Software Engineer - Platform, London (R1234)",
  cv_reference: "Alex_Morgan_Northgate_Software_Engineer_CV",
  tailor_session_id: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  status: "Applied",
  salary: "£45,000 - £55,000",
  date_applied: "2026-10-01",
  followup_date: "2026-10-08",
  source: "tailored",
  created_at: "2026-10-01T12:34:56.123456+00:00",
  updated_at: "2026-10-02T12:34:56.123456+00:00",
  prep_generated_at: null,
  format_style: "ukji",
  sent_cv_name: null,
  last_contact_from: null,
  last_contact_at: null,
  referral: false,
  referrer_name: null,
  req_id: null,
  referral_status: null,
};
const SENTENCE = "You must have 3+ years of commercial experience building services in Python in a regulated environment, with evidence you can show us.";
const GATES: GatesSummary & { triage: unknown } = {
  read: "skip",
  hard: 1,
  soft: 1,
  unknown: 2,
  items: [
    { category: "years", verdict: "pass", requirement: SENTENCE },
    { category: "years", verdict: "hard", requirement: SENTENCE },
    { category: "location", verdict: "soft", requirement: SENTENCE },
    { category: "sponsorship", verdict: "unknown", requirement: SENTENCE },
    { category: "clearance", verdict: "unknown", requirement: SENTENCE },
  ],
  triage: { verdict: "skip", reasons: ["3+ years"], hits: [{ level: "skip", rule: "years", phrase: "3+ years", sentence: SENTENCE }] },
};

test("a list row carries no JD, no full notes, no triage and no null keys", () => {
  const notes = `Applied through the careers site. ${"Followed up with the recruiter. ".repeat(20)}`;
  const row = toListRow({ ...ROW_BASE, job_description: "A long posting. ".repeat(500), notes, gates: GATES });
  assert.equal("job_description" in row, false);
  assert.equal("notes" in row, false);
  assert.equal(row.has_job_description, true);
  assert.equal((row.notes_preview as string).length, NOTES_PREVIEW_CHARS);
  assert.equal(row.notes_more, true);
  for (const key of ["updated_at", "tailor_session_id", "req_id", "sent_cv_name"]) assert.equal(key in row, false, key);
  assert.equal(JSON.stringify(row).includes("triage"), false);
  assert.equal(row.referral, false, "false is a value, only null is left out");
  const bare = toListRow({ ...ROW_BASE, job_description: "  \n ", notes: null, gates: null });
  assert.equal("has_job_description" in bare, false, "blank text is no JD");
  assert.equal("notes_preview" in bare, false);
  assert.equal("gates" in bare, false);
});

test("the Gate line reads the same from the trimmed list row as from the stored gates", () => {
  for (const gates of [
    GATES,
    { ...GATES, read: "long_shot", hard: 0, items: GATES.items.filter((i) => i.verdict !== "hard") },
    { ...GATES, read: "apply", hard: 0, soft: 0, items: GATES.items.filter((i) => i.verdict === "pass" || i.verdict === "unknown") },
    { read: "apply", hard: 0, soft: 0, unknown: 0, items: [] },
  ]) {
    assert.deepEqual(gateLine(toListRow({ ...ROW_BASE, gates }).gates as GatesSummary), gateLine(gates as GatesSummary));
  }
  assert.equal("gates" in toListRow({ ...ROW_BASE, gates: { triage: GATES.triage } }), false, "a triage alone is no read");
});

test("notesListFields: short notes are whole, the not-submitted test reads past the preview", () => {
  assert.deepEqual(notesListFields("Called Sam."), { notes_preview: "Called Sam.", notes_more: undefined, notes_not_submitted: undefined });
  assert.deepEqual(notesListFields(null), { notes_preview: undefined, notes_more: undefined, notes_not_submitted: undefined });
  assert.deepEqual(notesListFields("   "), { notes_preview: undefined, notes_more: undefined, notes_not_submitted: undefined });
  const exact = "x".repeat(NOTES_PREVIEW_CHARS);
  assert.equal(notesListFields(exact).notes_more, undefined, "exactly the preview is the whole text");
  const late = `${"Long background on this role. ".repeat(10)}Application not submitted yet.`;
  const fields = notesListFields(late);
  assert.equal(fields.notes_not_submitted, true);
  assert.equal(fields.notes_preview?.includes("not submitted"), false);
});

const listMb = (gates: unknown) => {
  // Heavier than the owner's mix (JD 811 bytes on average, notes 398, most rows
  // hand-added): every row here is tailored, with long notes and a JD.
  const rows = Array.from({ length: MAX_APPLICATIONS }, (_, i) =>
    toListRow({ ...ROW_BASE, company_name: `Northgate Systems ${i}`, job_description: "Posting text. ".repeat(100), notes: "Notes about this application. ".repeat(14), gates })
  );
  return Buffer.byteLength(JSON.stringify({ applications: rows })) / 1048576;
};

test("the list at the 2,000-row cap stays under 1.5 MB with every row tailored", () => {
  const mb = listMb({ read: "apply", hard: 0, soft: 0, unknown: 2, items: GATES.items.filter((i) => i.verdict === "unknown"), triage: GATES.triage });
  assert.ok(mb < 1.5, `${mb.toFixed(2)} MB`);
});

test("even a knockout quote on all 2,000 rows stays far under Vercel's 4.5 MB limit", () => {
  const mb = listMb(GATES);
  assert.ok(mb < 2, `${mb.toFixed(2)} MB`);
});
