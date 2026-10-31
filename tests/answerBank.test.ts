// The answer bank for application forms (lib/answerBank, 31 Oct 2026): the
// stored answers come from the user's Eligibility answers, and matchQuestion()
// reads a form's question. Consent and conviction questions are never answered.
import test from "node:test";
import assert from "node:assert/strict";
import { buildAnswerBank, matchQuestion, answerNote, answerFor, answersByQuestion, normaliseQuestion, QUESTION_BANK, type AnswerFacts } from "../src/lib/answerBank.ts";

const CAN_WORK_NOW: AnswerFacts = {
  rightToWork: { status: "time_limited", permissionEnds: "2027-12" },
  availability: { status: "now", from: null },
  canWorkFullTime: "yes",
};
const answer = (facts: AnswerFacts | null, key: string) => buildAnswerBank(facts).find((e) => e.key === key)?.answer ?? null;

// ── The stored answers ──────────────────────────────────────────────────────

test("the confirmed answers: sponsorship No, and the free-text sentence word for word", () => {
  assert.equal(answer(CAN_WORK_NOW, "sponsorship"), "No");
  assert.equal(answer(CAN_WORK_NOW, "visa_details"), "No sponsorship required. I am available immediately for full-time employment.");
  assert.equal(answer(CAN_WORK_NOW, "right_to_work"), "Yes");
  assert.equal(answer(CAN_WORK_NOW, "start_date"), "I am available immediately for full-time employment.");
  assert.equal(answer(CAN_WORK_NOW, "full_time"), "Yes");
  assert.equal(answer({ ...CAN_WORK_NOW, rightToWork: { status: "full" } }, "sponsorship"), "No");
});

test("other Eligibility answers give their own true answers; unanswered gives none", () => {
  const needs: AnswerFacts = { rightToWork: { status: "needs_sponsorship" }, availability: { status: "from", from: "2027-01" }, canWorkFullTime: "yes" };
  assert.equal(answer(needs, "sponsorship"), "Yes");
  assert.equal(answer(needs, "right_to_work"), "No");
  assert.equal(answer(needs, "visa_details"), "I will require visa sponsorship. I am available from January 2027 for full-time employment.");
  for (const e of buildAnswerBank(null)) assert.equal(e.answer, null, `${e.key} unanswered`);
  const unknown: AnswerFacts = { rightToWork: { status: "unknown" }, availability: { status: "unknown", from: null }, canWorkFullTime: "unknown" };
  for (const e of buildAnswerBank(unknown)) assert.equal(e.answer, null, `${e.key} unanswered`);
});

test("no consent or conviction answer exists in the bank", () => {
  const keys = buildAnswerBank(CAN_WORK_NOW).map((e) => e.key);
  assert.deepEqual(keys, ["sponsorship", "right_to_work", "visa_details", "start_date", "full_time"]);
});

// ── matchQuestion: ten form questions ───────────────────────────────────────

test("matcher 1: 'Will you now or in the future require sponsorship…' is the Yes/No, asking about the future", () => {
  assert.deepEqual(matchQuestion("Will you now or in the future require sponsorship for employment visa status?"), { key: "sponsorship", blocked: null, asksFuture: true });
});

test("matcher 2: 'Do you require visa sponsorship to work in the UK?' is the Yes/No", () => {
  assert.deepEqual(matchQuestion("Do you require visa sponsorship to work in the UK?"), { key: "sponsorship", blocked: null, asksFuture: false });
});

test("matcher 3: 'Please provide details of your visa status' wants the sentence", () => {
  assert.equal(matchQuestion("Please provide details of your visa status and any sponsorship requirements.").key, "visa_details");
  assert.equal(matchQuestion("What is your current immigration status?").key, "visa_details");
});

test("matcher 4: right to work, however it is phrased", () => {
  assert.equal(matchQuestion("Do you have the right to work in the UK?").key, "right_to_work");
  assert.equal(matchQuestion("Are you legally eligible to work in the United Kingdom?").key, "right_to_work");
});

test("matcher 5: start date and notice period", () => {
  assert.equal(matchQuestion("When can you start?").key, "start_date");
  assert.equal(matchQuestion("What is your notice period?").key, "start_date");
  assert.equal(matchQuestion("Earliest start date").key, "start_date");
});

test("matcher 6: full time", () => {
  assert.equal(matchQuestion("Are you able to work full-time (37.5 hours per week)?").key, "full_time");
});

test("matcher 7: a criminal-record question is blocked, never answered", () => {
  assert.deepEqual(matchQuestion("Do you have any unspent criminal convictions?"), { key: null, blocked: "convictions", asksFuture: false });
  assert.equal(matchQuestion("Have you ever been convicted of an offence?").blocked, "convictions");
  assert.equal(matchQuestion("Will you consent to a DBS check?").blocked, "convictions");
});

test("matcher 8: a consent or declaration is blocked, never answered", () => {
  assert.equal(matchQuestion("I consent to Acme processing my personal data for recruitment.").blocked, "consent");
  assert.equal(matchQuestion("I agree to the privacy notice").blocked, "consent");
  assert.equal(matchQuestion("I confirm that the information I have given is true.").blocked, "consent");
  assert.equal(matchQuestion("I confirm that I do not require sponsorship").blocked, "consent", "a declaration even when it names sponsorship");
});

test("matcher 9: questions the bank does not answer match nothing", () => {
  assert.deepEqual(matchQuestion("Why do you want to work at Acme?"), { key: null, blocked: null, asksFuture: false });
  assert.equal(matchQuestion("Do you agree to relocate to Leeds?").blocked, null, "agreeing to relocate is a real question, not a consent");
  assert.equal(matchQuestion("How long have you spent working with Python?").blocked, null);
  assert.equal(matchQuestion("").key, null);
});

test("matcher 10: a time-limited permission asked about the future carries a note; the answer stays", () => {
  const future = matchQuestion("Will you now or in the future require sponsorship?");
  assert.match(answerNote(future, CAN_WORK_NOW) ?? "", /time-limited \(until December 2027\)/);
  assert.equal(answer(CAN_WORK_NOW, "sponsorship"), "No", "the note never changes the answer");
  assert.equal(answerNote(matchQuestion("Do you require sponsorship?"), CAN_WORK_NOW), null, "no future, no note");
  assert.equal(answerNote(future, { ...CAN_WORK_NOW, rightToWork: { status: "full" } }), null, "permanent: no note");
});

// ── The bank keyed by question text, and the fuzzy matcher ─────────────────

test("matcher 11: the brief's question answers No, exactly from the bank", () => {
  const r = answerFor("Will you now or in the future require sponsorship?", CAN_WORK_NOW);
  assert.equal(r.key, "sponsorship");
  assert.equal(r.answer, "No");
  assert.equal(QUESTION_BANK[normaliseQuestion("Will you now or in the future require sponsorship?")], "sponsorship");
});

test("matcher 12: fuzzy — Workday and People First wording close to a bank question", () => {
  assert.equal(answerFor("Will you, now or in the future, require visa sponsorship?", CAN_WORK_NOW).answer, "No");
  assert.equal(answerFor("Do you currently have the legal right to work in the UK?", CAN_WORK_NOW).answer, "Yes");
  assert.equal(answerFor("Please provide details of your current visa status.", CAN_WORK_NOW).answer, "No sponsorship required. I am available immediately for full-time employment.");
  assert.equal(answerFor("When would you be available to start?", CAN_WORK_NOW).answer, "I am available immediately for full-time employment.");
});

test("normaliseQuestion folds case, punctuation, asides and spelling", () => {
  assert.equal(normaliseQuestion("Are you legally AUTHORISED to work in the UK? (Yes/No)"), "are you legally authorized to work in the uk");
  assert.equal(normaliseQuestion("Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B)?"), "will you now or in the future require sponsorship for employment visa status");
});

test("answersByQuestion: every bank question keyed to the user's own answer", () => {
  const byQ = answersByQuestion(CAN_WORK_NOW);
  assert.equal(byQ[normaliseQuestion("Do you require visa sponsorship?")], "No");
  assert.equal(byQ[normaliseQuestion("Do you have the right to work in the UK?")], "Yes");
  assert.equal(byQ[normaliseQuestion("What is your current immigration status?")], "No sponsorship required. I am available immediately for full-time employment.");
  assert.ok(Object.values(answersByQuestion(null)).every((a) => a === null), "nothing until the Eligibility answers are given");
  assert.ok(!Object.keys(QUESTION_BANK).some((q) => /consent|convict|criminal|agree/.test(q)), "no consent or convictions question in the bank");
});

test("a consent or convictions question never gets an answer, even close to a bank question", () => {
  assert.deepEqual(answerFor("I confirm that I will not require sponsorship", CAN_WORK_NOW), { answer: null, key: null, blocked: "consent", note: null });
  assert.equal(answerFor("Do you have any unspent convictions?", CAN_WORK_NOW).answer, null);
});
