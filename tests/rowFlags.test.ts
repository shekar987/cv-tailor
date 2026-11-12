// A tracker row's flags (lib/tracker missingAttachments + rowCheck, app/applications
// RowFlags, 3 Nov 2026), the verdict on the list row, and the account export's
// chunks. The .tsx loads through tests/support/tsxLoader.mjs. The rows are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { missingAttachments, rowCheck, type RowFlagFields } from "../src/lib/tracker.ts";
import { listTriageFields, toListRow } from "../src/lib/applicationRows.ts";
import { accountExportChunks } from "../src/lib/account.ts";
import RowFlags from "../src/app/applications/RowFlags.tsx";

const render = (row: RowFlagFields, checking = false) =>
  renderToStaticMarkup(createElement(RowFlags, { row: { company_name: "Acme", ...row }, checking, onRunCheck: () => {}, onAddJd: () => {} }));

test("Missing JD / Missing CV only in Screening or Interview", () => {
  const bare = { source: "manual" };
  assert.deepEqual(missingAttachments({ ...bare, status: "Screening" }), ["Missing job description", "Missing CV"]);
  assert.deepEqual(missingAttachments({ ...bare, status: "Interview", has_job_description: true }), ["Missing CV"]);
  assert.deepEqual(missingAttachments({ ...bare, status: "Interview", sent_cv_name: "cv.pdf" }), ["Missing job description"]);
  assert.deepEqual(missingAttachments({ ...bare, status: "Screening", has_job_description: true, sent_cv_name: "cv.pdf" }), []);
  for (const status of ["Ready to submit", "Applied", "Offer", "Rejected", "Withdrawn"]) assert.deepEqual(missingAttachments({ ...bare, status }), [], status);
});

test("a tailored row carries its CV in the snapshot", () => {
  assert.deepEqual(missingAttachments({ status: "Interview", source: "tailored", has_job_description: true }), []);
  assert.deepEqual(missingAttachments({ status: "Interview", source: "tailored" }), ["Missing job description"]);
});

test("the Missing filter's test picks exactly the flagged rows", () => {
  const rows: RowFlagFields[] = [
    { status: "Screening", source: "manual" },
    { status: "Interview", source: "tailored", has_job_description: true },
    { status: "Interview", source: "tailored" },
    { status: "Applied", source: "manual" },
    { status: "Screening", source: "manual", has_job_description: true, sent_cv_name: "cv.pdf" },
  ];
  assert.deepEqual(rows.flatMap((r, i) => (missingAttachments(r).length > 0 ? [i] : [])), [0, 2]);
});

test("rowCheck: a row made outside /app is not checked until it is; a tailored row speaks only when it found something", () => {
  assert.deepEqual(rowCheck({ status: "Applied", source: "manual", has_job_description: true }), { kind: "run" });
  assert.deepEqual(rowCheck({ status: "Applied", source: "manual" }), { kind: "add_jd" });
  assert.equal(rowCheck({ status: "Applied", source: "tailored", has_job_description: true }), null);
  assert.equal(rowCheck({ status: "Applied", source: "tailored", triage_verdict: "apply" }), null);
  assert.deepEqual(rowCheck({ status: "Applied", source: "tailored", triage_verdict: "skip", triage_reasons: ["5+ years"] }), { kind: "checked", verdict: "skip", reasons: ["5+ years"] });
  assert.deepEqual(rowCheck({ status: "Applied", source: "manual", triage_verdict: "apply" }), { kind: "checked", verdict: "apply", reasons: [] });
});

test("the badge: Not checked + Run check; Not checked + Add a job description to check; the verdict once checked", () => {
  const run = render({ status: "Applied", source: "manual", has_job_description: true });
  assert.match(run, /data-not-checked="true">Not checked</);
  assert.match(run, /data-run-check="true"[^>]*>Run check</);
  assert.doesNotMatch(run, /Add a job description to check/);
  const add = render({ status: "Applied", source: "manual" });
  assert.match(add, /Not checked/);
  assert.match(add, /data-add-jd-check="true"[^>]*>Add a job description to check</);
  assert.doesNotMatch(add, /Run check/);
  const busy = render({ status: "Applied", source: "manual", has_job_description: true }, true);
  assert.match(busy, /disabled=""[^>]*>Checking…</);
  const skip = render({ status: "Applied", source: "manual", has_job_description: true, triage_verdict: "skip", triage_reasons: ["Go (not in your experience)"] });
  assert.match(skip, /rowFlag--skip" data-row-triage="skip" title="Go \(not in your experience\)">Skip: Go</);
  assert.doesNotMatch(skip, /Not checked/);
});

test("the badge: amber Missing JD / Missing CV beside the rest; nothing when a row has nothing to say", () => {
  const html = render({ status: "Interview", source: "manual" });
  assert.match(html, /rowFlag--missing" data-missing="Missing job description">Missing job description</);
  assert.match(html, /rowFlag--missing" data-missing="Missing CV">Missing CV</);
  assert.match(html, /Add a job description to check/);
  assert.equal(render({ status: "Applied", source: "tailored", has_job_description: true }), "");
});

test("the list row carries the verdict and two reasons, never the sentences", () => {
  const sentence = "Applicants must be authorized to work in the country of the role posting, both now and in the future.";
  const gates = { triage: { verdict: "skip", reasons: ["a", "b", "c"], hits: [{ level: "skip", rule: "rtw_permanent", phrase: "a", sentence }] } };
  const row = toListRow({ id: "x", status: "Applied", gates });
  assert.equal(row.triage_verdict, "skip");
  assert.deepEqual(row.triage_reasons, ["a", "b"]);
  assert.equal(JSON.stringify(row).includes(sentence), false);
  assert.deepEqual(listTriageFields({ triage: { verdict: "apply", reasons: [], hits: [] } }), { triage_verdict: "apply", triage_reasons: undefined });
  assert.deepEqual(listTriageFields({ triage: { verdict: "maybe" } }), { triage_verdict: undefined, triage_reasons: undefined });
  assert.deepEqual(listTriageFields(null), { triage_verdict: undefined, triage_reasons: undefined });
});

test("the account export's chunks join into exactly the payload", () => {
  const payload = {
    exportedAt: "2026-11-03T00:00:00.000Z",
    account: { id: "u1", email: "alex.morgan@example.com" },
    applications: { rows: [{ id: "a", notes: 'quote " and\nnewline' }, { id: "b" }], note: "kept" },
    mockInterviews: { rows: [] },
    empty: { rows: null, note: "table not present" },
  };
  const chunks = [...accountExportChunks(payload)];
  assert.deepEqual(JSON.parse(chunks.join("")), payload);
  assert.ok(chunks.length > 6, "rows are separate chunks");
  const none = { applications: { rows: [] } };
  assert.deepEqual(JSON.parse([...accountExportChunks(none)].join("")), none);
  const failed = { applications: { rows: null, note: "could not be read" } };
  assert.deepEqual(JSON.parse([...accountExportChunks(failed)].join("")), failed);
});
