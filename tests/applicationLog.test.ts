// POST /api/applications/log's rules (Chunk 22, 12 Nov 2026): the form, the strict
// 90-day duplicate, source, force, the fingerprint; and the cover letter's place in the
// bucket. The route itself on the real database is scripts/smoke-fast-tracker.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOG_DUPLICATE_DAYS, duplicateMessage, findRecentDuplicate, logFormFingerprint, readForce, readLogForm, readLogSource, windowStart, type FormEntry, type LoggedRow,
} from "../src/lib/applicationLog.ts";
import { displayFileName, ownsPath, readSentDoc, sentCvPath } from "../src/lib/sentCv.ts";

const file = (name: string, sha = "f".repeat(64)) => ({ name, size: 1234, sha256: sha });

test("the form: known text fields, cv and cover_letter as files, nothing else", () => {
  const ok = readLogForm([
    { name: "company_name", value: "Sage" },
    { name: "role", value: "Graduate Engineer" },
    { name: "status", value: "Ready to submit" },
    { name: "cv", file: file("cv.pdf") },
    { name: "cover_letter", file: file("letter.docx") },
  ]);
  assert.deepEqual(ok, { body: { company_name: "Sage", role: "Graduate Engineer", status: "Ready to submit" }, files: ["cv", "cover_letter"] });
  const bad: FormEntry[][] = [
    [{ name: "company", value: "Sage" }],
    [{ name: "cv", value: "not a file" }],
    [{ name: "resume", file: file("cv.pdf") }],
    [{ name: "role", value: "A" }, { name: "role", value: "B" }],
  ];
  for (const entries of bad) assert.ok("error" in readLogForm(entries), JSON.stringify(entries));
});

test("source: by hand or a cold email; tailored rows come from /app", () => {
  assert.deepEqual(readLogSource(undefined), { source: "manual" });
  assert.deepEqual(readLogSource("Cold_Email"), { source: "cold-email" });
  assert.ok("error" in readLogSource("tailored"));
  assert.ok("error" in readLogSource("LinkedIn"), "where you applied is a note, not a source");
  assert.equal(readForce("1"), true);
  assert.equal(readForce("yes"), true);
  assert.equal(readForce("0"), false);
  assert.equal(readForce(undefined), false);
});

const row = (over: Partial<LoggedRow>): LoggedRow => ({ id: "r", company_name: "Sage", role: "Graduate Engineer", status: "Applied", date_applied: "2026-10-01", ...over });

test("a duplicate is the same whole company and role within 90 days", () => {
  const today = "2026-11-12";
  const draft = { company_name: "Sage Group plc", role: "Graduate Engineer - London", date_applied: null };
  assert.equal(findRecentDuplicate([row({})], draft, today)?.id, "r", "corporate words and a trailing place aside");
  assert.equal(findRecentDuplicate([row({ date_applied: "2026-08-14" })], draft, today)?.id, "r", "exactly 90 days back is inside");
  assert.equal(findRecentDuplicate([row({ date_applied: "2026-08-13" })], draft, today), null, "91 days back is not");
  assert.equal(findRecentDuplicate([row({ company_name: "Sage Pay" })], draft, today), null, "another company");
  assert.equal(findRecentDuplicate([row({ company_name: "Wise" })], { ...draft, company_name: "Wise Owl Consulting" }, today), null);
  assert.equal(findRecentDuplicate([row({ role: "Graduate Engineer in Test" })], draft, today), null, "another job");
  assert.equal(findRecentDuplicate([row({ role: "Senior Graduate Engineer" })], draft, today), null);
  // An undated (Ready to submit) row counts from the day it was added.
  assert.equal(findRecentDuplicate([row({ date_applied: null, created_at: "2026-11-10T09:00:00Z" })], draft, today)?.id, "r");
  // The nearest in time wins; the new row's own date is the reference when it has one.
  const near = findRecentDuplicate([row({ id: "old", date_applied: "2026-09-01" }), row({ id: "near", date_applied: "2026-11-01" })], { ...draft, date_applied: "2026-11-02" }, today);
  assert.equal(near?.id, "near");
  assert.equal(LOG_DUPLICATE_DAYS, 90);
  assert.equal(windowStart("2026-11-12"), "2026-08-14");
});

test("the 409 names the row and how to log anyway", () => {
  assert.equal(
    duplicateMessage(row({ status: "Ready to submit", date_applied: null, created_at: "2026-11-10T09:00:00Z" })),
    "Already in your tracker: Sage — Graduate Engineer, logged 10 Nov 2026 (Ready to submit). Nothing was saved. If this is a new application, send force=1 to log it again (with a new Idempotency-Key, if you send one)."
  );
  assert.match(duplicateMessage(row({})), /applied 1 Oct 2026 \(Applied\)/);
});

test("the fingerprint ignores field order and the multipart boundary, not the file's bytes", () => {
  const a: FormEntry[] = [{ name: "company_name", value: "Sage" }, { name: "cv", file: file("cv.pdf", "a".repeat(64)) }];
  const b: FormEntry[] = [{ name: "cv", file: file("cv.pdf", "a".repeat(64)) }, { name: "company_name", value: "Sage" }];
  const c: FormEntry[] = [{ name: "company_name", value: "Sage" }, { name: "cv", file: file("cv.pdf", "b".repeat(64)) }];
  assert.equal(logFormFingerprint(a), logFormFingerprint(b));
  assert.notEqual(logFormFingerprint(a), logFormFingerprint(c));
});

test("the cover letter lives in the application's own folder, under its own name", () => {
  const user = "00000000-0000-0000-0000-00000000000a";
  const app = "aaaaaaaa-0000-4000-8000-000000000001";
  const cv = sentCvPath(user, app, "My CV.pdf", "pdf", 1731400000000);
  const letter = sentCvPath(user, app, "Letter to Sage.docx", "docx", 1731400000000, "cover_letter");
  assert.equal(cv, `${user}/${app}/1731400000000-My-CV.pdf`);
  assert.equal(letter, `${user}/${app}/letter-1731400000000-Letter-to-Sage.docx`);
  assert.ok(ownsPath(letter, user, app), "no subfolder: account deletion lists two levels");
  assert.equal(letter.split("/").length, 3);
  assert.equal(displayFileName("", "pdf", "cover_letter"), "Cover letter.pdf");
  assert.equal(readSentDoc(undefined), "cv");
  assert.equal(readSentDoc("cover_letter"), "cover_letter");
  assert.equal(readSentDoc("resume"), null);
});
