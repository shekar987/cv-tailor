// "Log outcome" (Chunk 26): six made-up emails in the shapes real senders use (a founder's
// own email, Ashby, an AIApply inbox update, Teamtailor as Gmail pastes it, SmartRecruiters,
// a corporate early-careers team), read with no model call. Every company here is made up.
//
// The second half pins the inputs a fresh review of the first version got wrong (13 Nov
// 2026): non-rejections read as rejections, and the wrong application called the sure one.
// Run this file after any change to lib/outcomeEmail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_APPENDED_NOTE, cleanNoteLine } from "../src/lib/notesWrite.ts";
import { matchOutcomeRows, outcomeNoteLine, readEmailDate, readOutcomeEmail, searchOutcomeRows, type OutcomeRow } from "../src/lib/outcomeEmail.ts";

const email = (name: string) => readFileSync(new URL(`./fixtures/outcome-emails/${name}.txt`, import.meta.url), "utf8");

const row = (id: string, company_name: string, role: string, status = "applied", date_applied = "2026-10-20"): OutcomeRow => ({ id, company_name, role, status, date_applied });

// One user's applications: each fixture's company, and rows that must not be picked.
const ROWS: OutcomeRow[] = [
  row("harbour", "Harbourline", "Junior Software Engineer"),
  row("harbour-lights", "Harbour Lights Ltd", "Junior Software Engineer"),
  row("quill-new", "Quillstone", "Graduate Software Engineer", "applied", "2026-11-01"),
  row("quill-old", "Quillstone", "Data Engineer", "rejected", "2026-08-02"),
  row("marlowe", "Marlowe Finch", "Analyst Developer", "screening"),
  row("tidewell", "Tidewell", "Backend Developer"),
  row("penrose", "Penrose & Hale LLP", "Technology Graduate"),
  row("arden", "Ardenmoor", "Technology Consulting Graduate Programme", "interview"),
  row("next", "Next", "Software Engineer"),
  row("team", "Team", "Developer"),
  row("ncore", "n.Core", "AI Engineer"),
  row("bt", "BT", "Graduate Engineer"),
];

type Expect = { company: string; id: string; phrase: RegExp; sentence: RegExp; date: string | null };
const FIXTURES: Record<string, Expect> = {
  direct: { company: "Harbourline", id: "harbour", phrase: /won't be taking it forward/, sentence: /^We had a lot of strong applicants .* won't be taking it forward this time\.$/, date: null },
  ashby: { company: "Quillstone", id: "quill-new", phrase: /decided not to progress/, sentence: /^After reviewing your application, we have decided not to progress it to the next stage\.$/, date: "2026-11-12" },
  aiapply: { company: "Marlowe Finch", id: "marlowe", phrase: /application has been unsuccessful/, sentence: /^Unfortunately, on this occasion your application has been unsuccessful\.$/, date: "2026-11-13" },
  teamtailor: { company: "Tidewell", id: "tidewell", phrase: /not this time/, sentence: /^Sadly it is not this time\.$/, date: null },
  smartrecruiters: { company: "Penrose & Hale", id: "penrose", phrase: /other candidates/, sentence: /^We have reviewed your application and have decided to move forward with other candidates/, date: "2026-11-13" },
  corporate: { company: "Ardenmoor", id: "arden", phrase: /not be progressing your application/, sentence: /^We regret to inform you that we will not be progressing your application any further\.$/, date: "2026-11-13" },
};

for (const [name, want] of Object.entries(FIXTURES)) {
  test(`${name}: reads a rejection, who it is from, and the right application`, () => {
    const text = email(name);
    const read = readOutcomeEmail(text);
    assert.equal(read.outcome, "rejected");
    assert.equal(read.invitation, false);
    assert.match(read.phrase, want.phrase);
    assert.match(read.sentence, want.sentence);
    assert.equal(read.date, want.date);
    assert.ok(read.companies.includes(want.company), `companies: ${read.companies.join(" | ")}`);
    const { matches, sure, more } = matchOutcomeRows(ROWS, text, read);
    assert.equal(matches[0]?.row.id, want.id, `matches: ${matches.map((m) => `${m.row.id}:${m.score}`).join(" ")}`);
    assert.ok(matches[0].signs >= 2, `two parts of the email agree: ${read.named.map((n) => `${n.from}=${n.name}`).join(", ")}`);
    assert.equal(sure, true, "one application is clearly ahead");
    assert.ok(matches.length <= 3);
    assert.equal(more, 0);
  });
}

test("a sending tool is never the company", () => {
  for (const name of ["ashby", "aiapply", "teamtailor", "smartrecruiters"]) {
    const { companies } = readOutcomeEmail(email(name));
    assert.ok(!companies.some((c) => /ashby|aiapply|teamtailor|smartrecruiters/i.test(c)), `${name}: ${companies.join(" | ")}`);
  }
});

test("the same company twice: the open application first, the rejected one shown as ended", () => {
  const { matches } = matchOutcomeRows(ROWS, email("ashby"));
  assert.deepEqual(matches.map((m) => m.row.id), ["quill-new", "quill-old"], "and the company called Team is not listed for \"Talent Team\"");
  assert.equal(matches[0].ended, false);
  assert.equal(matches[1].ended, true);
  assert.match(matches[0].why, /from this company and this role/);
});

test("two open applications at one company and no role in the email: listed, but not sure", () => {
  const rows = [row("a", "Quillstone", "Data Engineer", "applied", "2026-11-02"), row("b", "Quillstone", "Platform Engineer", "applied", "2026-11-03")];
  const { matches, sure } = matchOutcomeRows(rows, email("ashby"));
  assert.equal(matches.length, 2);
  assert.equal(sure, false);
  assert.equal(matches[0].row.id, "b", "the newest application breaks the tie");
});

test("more than three applications at one company: three are listed, and the rest are counted", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`q${i}`, "Quillstone", `Engineer ${i}`, "applied", `2026-11-0${i + 1}`));
  const { matches, more, sure } = matchOutcomeRows(rows, email("ashby"));
  assert.equal(matches.length, 3);
  assert.equal(more, 2);
  assert.equal(sure, false);
});

test("a whole-name match only: Harbourline is not Harbour Lights", () => {
  const ids = matchOutcomeRows(ROWS, email("direct")).matches.map((m) => m.row.id);
  assert.ok(!ids.includes("harbour-lights"));
});

test("a name with a dot and a lower-case start, and a two-letter name", () => {
  const dotted = "Subject: Your application to n.Core\n\nDear Alex,\n\nThank you for applying to n.Core. Unfortunately you have not been selected for interview.";
  const read = readOutcomeEmail(dotted);
  assert.equal(read.outcome, "rejected");
  assert.equal(read.companies[0], "n.Core");
  const found = matchOutcomeRows(ROWS, dotted, read);
  assert.equal(found.matches[0]?.row.id, "ncore");
  assert.equal(found.sure, true, "the subject and the body agree");
  const short = "Hello Alex, thank you for your application to BT. We regret to inform you that you have been unsuccessful.";
  assert.equal(matchOutcomeRows(ROWS, short).matches[0]?.row.id, "bt");
  assert.equal(matchOutcomeRows(ROWS, "We debt-collect. Unfortunately your application was unsuccessful.").matches.length, 0);
});

test("an invitation is not a rejection, and an email that says both is left to the user", () => {
  const invite = readOutcomeEmail("Hi Alex,\n\nWe would like to invite you to a first interview for the Backend Developer role at Tidewell. Please book a slot.");
  assert.equal(invite.outcome, null);
  assert.equal(invite.invitation, true);
  const both = readOutcomeEmail("Hi Alex,\n\nWe are pleased to invite you to an interview for the first role. For the second role, we regret to inform you that your application was unsuccessful.");
  assert.equal(both.outcome, null);
  assert.equal(both.invitation, true);
  assert.match(both.phrase, /unsuccessful/);
  // "Apply again" and an offer of feedback in a rejection are no invitation.
  assert.equal(readOutcomeEmail(email("ashby")).invitation, false);
  const feedback = readOutcomeEmail("Dear Alex,\n\nWe have decided not to progress your application. We would like to offer feedback if that is useful, and we invite you to apply again next year.");
  assert.equal(feedback.outcome, "rejected");
  // A rejection after a test still reads as one.
  const afterTest = readOutcomeEmail("Hi Alex,\n\nThank you for taking the time to complete our online assessment. Unfortunately, we won't be taking your application further.");
  assert.equal(afterTest.outcome, "rejected");
  assert.equal(afterTest.invitation, false);
});

test("an email that states no outcome reads as none, and still names the company", () => {
  const read = readOutcomeEmail("Hi Alex,\n\nThanks for applying to Harbourline. We have received your application and will be in touch.");
  assert.equal(read.outcome, null);
  assert.equal(read.invitation, false);
  assert.equal(read.sentence, "Thanks for applying to Harbourline.");
  assert.equal(read.companies[0], "Harbourline");
  assert.deepEqual(readOutcomeEmail(""), { outcome: null, phrase: "", invitation: false, companies: [], named: [], sentence: "", date: null });
});

test("a rejection stated only in the subject is quoted from the subject", () => {
  const read = readOutcomeEmail("Subject: Your application to Harbourline was unsuccessful\n\nHi Alex,\n\nThank you for your interest in Harbourline. We wish you well.");
  assert.equal(read.outcome, "rejected");
  assert.equal(read.sentence, "Your application to Harbourline was unsuccessful");
});

test("the note line: dated, quoted, and always within one appended note", () => {
  assert.equal(outcomeNoteLine("2026-11-13", "Sadly it is  not this time."), "Outcome email 13 Nov 2026: Sadly it is not this time.");
  assert.equal(outcomeNoteLine("2026-11-13", ""), "Outcome email 13 Nov 2026.");
  const long = outcomeNoteLine("2026-11-13", `We regret ${"very ".repeat(200)}much.`);
  assert.equal(long.length, MAX_APPENDED_NOTE);
  assert.ok(long.endsWith("…"));
  assert.ok("line" in cleanNoteLine(long), "the server's own check takes it");
});

test("the date of an email: only from a line that states the year, and can be read one way", () => {
  assert.equal(readEmailDate("Thu, 12 Nov 2026 16:41:07 +0000"), "2026-11-12");
  assert.equal(readEmailDate("13 November 2026 09:15"), "2026-11-13");
  assert.equal(readEmailDate("November 3rd, 2026"), "2026-11-03");
  assert.equal(readEmailDate("2026-11-13T08:00:00Z"), "2026-11-13");
  assert.equal(readEmailDate("13/11/2026"), "2026-11-13", "day first: 13 can only be the day");
  assert.equal(readEmailDate("11/13/2026"), "2026-11-13", "month first: 13 can only be the day");
  assert.equal(readEmailDate("03/11/2026"), null, "3 November in the UK, 11 March in the US: not read");
  assert.equal(readEmailDate("05/05/2026"), "2026-05-05");
  assert.equal(readEmailDate("Thu, 13 Nov, 10:02"), null, "no year, no date");
  assert.equal(readEmailDate("31 Feb 2026"), null);
  assert.equal(readOutcomeEmail(email("teamtailor")).date, null, "\"10:12 (2 hours ago)\" is not a date");
});

test("the search box: the tracker's matcher, open applications first", () => {
  assert.deepEqual(searchOutcomeRows(ROWS, "quillstone").map((r) => r.id), ["quill-new", "quill-old"]);
  assert.deepEqual(searchOutcomeRows(ROWS, "graduate programme").map((r) => r.id), ["arden"]);
  assert.deepEqual(searchOutcomeRows(ROWS, "  "), []);
  assert.equal(searchOutcomeRows(ROWS, "e", 3).length, 3);
});

// ── The review of 13 Nov 2026: what must never read as a rejection ───────────

const NOT_A_REJECTION: Record<string, string> = {
  "application received": "Your application has been received. Due to the volume of applications, if you have not heard from us within 14 days, please assume that you have been unsuccessful on this occasion.",
  "a condition": "Thank you for applying. If we decide not to move forward with your application, we will let you know by email.",
  "a conditional fit": "Thanks for applying. If your skills are not a fit for this role, we will keep your CV on file.",
  "only shortlisted contacted": "We are reviewing applications alongside other candidates and will be in touch.",
  "an offer": "Following your final interview, we would like to offer you the position of Software Engineer at Acme. You stood out among the other candidates.",
  "a holding email": "Thank you for coming in. We have a few other candidates to see this week and will come back to you by Friday.",
  "a pass": "You have been successful at this stage and we would like to progress you to a video interview. Unsuccessful applicants were notified last week.",
  "a test invitation": "You've progressed to the next stage. Here is your HackerRank link. Candidates who do not finish in time will not be progressing further.",
  "scheduling": "We'd like to move you to the next round. Can you do Tuesday? If not this time, suggest another.",
  "a job alert": "New jobs for you. Apply now, not this time next week.",
  "a survey": "How was your interview? Unsuccessful and successful applicants alike can leave feedback here.",
  "a maybe": "Your application is with the hiring manager. You may be unsuccessful if the role closes early.",
};

for (const [name, body] of Object.entries(NOT_A_REJECTION)) {
  test(`not a rejection: ${name}`, () => {
    const read = readOutcomeEmail(`Hi Alex,\n\n${body}\n\nThe Acme Team`);
    assert.equal(read.outcome, null, `phrase: "${read.phrase}"`);
  });
}

test("plain rejections in other words still read as rejections", () => {
  const plain = [
    "Unfortunately, we won't be taking your application forward.",
    "We have decided not to proceed with your application.",
    "Unfortunately you have been unsuccessful on this occasion.",
    "After careful thought we have decided to move forward with another candidate.",
    "We have offered the role to another candidate.",
    "Not this time, I'm afraid.",
    "We regret to inform you that the position has been filled.",
    "We are unable to progress your application any further.",
    "They will not be taking it forward.",
    "We feel you are not the right fit for this role at the moment.",
  ];
  for (const sentence of plain) assert.equal(readOutcomeEmail(`Dear Alex,\n\nThank you for applying. ${sentence}\n\nKind regards`).outcome, "rejected", sentence);
  // A condition AFTER the statement does not undo it.
  assert.equal(readOutcomeEmail("Hi Alex,\n\nWe have decided not to progress your application, but please get in touch if you would like feedback.").outcome, "rejected");
});

// ── The review of 13 Nov 2026: what must never be the sure application ───────

const one = (company: string, role = "Software Engineer", status = "applied") => [row("only", company, role, status)];
const REJECTED = "Unfortunately we will not be progressing your application.";

test("a one-word company name found loose in the text is listed, never sure", () => {
  const cases: [string, string][] = [
    ["Next", `Thank you for applying for the Software Engineer role. ${REJECTED} Next time we open roles we will let you know.`],
    ["Reach", `Thank you for applying for the Software Engineer role. ${REJECTED} Reach out if you would like feedback.`],
    ["Indeed", `${REJECTED} Indeed, it was a hard choice between strong people.`],
    ["Wise", `${REJECTED} Wise words from our CTO: keep applying.`],
    ["Sky", `${REJECTED} Sky high numbers of applications made this hard.`],
    ["On", `On this occasion, ${REJECTED.toLowerCase()}`],
  ];
  for (const [company, body] of cases) {
    const { matches, sure } = matchOutcomeRows(one(company), `Hi Sam,\n\n${body}\n\nKind regards,\nThe Globex Team`);
    assert.equal(sure, false, company);
    for (const m of matches) assert.equal(m.signs, 0, company);
  }
  // The user's own first name is not a company either.
  assert.equal(matchOutcomeRows(one("Alex"), `Hi Alex,\n\n${REJECTED}\n\nThe Globex Team`).sure, false);
});

test("a recruiter's email about one company that mentions another: neither is sure, and the real one is listed", () => {
  const text = `From: Sam Patel <sam@talentfirm.co.uk>\nSubject: Update on your application\n\nHi Alex,\n\nUnfortunately Acme won't be moving forward with your application. On a brighter note, I have a similar role at Globex that may suit you.\n\nSam`;
  const rows = [row("acme", "Acme", "Backend Engineer", "interview"), row("globex", "Globex", "Backend Engineer")];
  const { matches, sure } = matchOutcomeRows(rows, text);
  assert.equal(sure, false);
  assert.deepEqual(matches.map((m) => m.row.id).sort(), ["acme", "globex"]);
});

test("a place, a person's surname and a longer name are not the company", () => {
  const london = `Hi Alex,\n\nThank you for your application for the Graduate role in London. Unfortunately you have not been successful.\n\nThe Globex Team`;
  assert.equal(matchOutcomeRows(one("London Stock Exchange", "Graduate"), london).sure, false);
  assert.equal(matchOutcomeRows(one("London Stock Exchange", "Graduate"), london).matches.length, 0, "\"in London\" names a place");
  const surname = `From: Hannah Wise <hannah.wise@initech.com>\nSubject: Your application\n\nHi Alex,\n\n${REJECTED}\n\nHannah`;
  const wise = matchOutcomeRows(one("Wise"), surname);
  assert.equal(wise.sure, false);
  assert.ok(wise.matches.every((m) => m.signs === 0));
  const owl = `From: Wise Owl Consulting <jobs@wiseowl.co.uk>\n\nHi Alex,\n\n${REJECTED}\n\nThe Wise Owl Consulting Team`;
  assert.equal(matchOutcomeRows(one("Wise"), owl).sure, false);
  const other = `From: Globex Careers <careers@globex.com>\n\nHi Alex,\n\n${REJECTED} We know you are also working with Acme this month.\n\nThe Globex Team`;
  assert.equal(matchOutcomeRows(one("Acme"), other).sure, false);
  const lower = `Hi Alex,\n\n${REJECTED} On Fridays people just eat lunch together here.\n\nThe Globex Team`;
  assert.equal(matchOutcomeRows(one("Just Eat"), lower).matches.length, 0, "a name is matched as it is spelled");
});

test("a job title in a subject is not the company, and the employer after it is", () => {
  const read = readOutcomeEmail("Subject: Your application to Software Engineer at Acme\n\nHi Alex,\n\nThank you for applying. " + REJECTED);
  assert.ok(!read.companies.includes("Software Engineer"), read.companies.join(" | "));
  assert.ok(read.companies.includes("Acme"), read.companies.join(" | "));
});

test("one sign is not enough; two that agree are", () => {
  // The body alone names it once.
  const once = `Hi Alex,\n\nThank you for applying to Harbourline. ${REJECTED}\n\nBest,\nPriya`;
  const single = matchOutcomeRows(one("Harbourline"), once);
  assert.equal(single.matches[0]?.signs, 1);
  assert.equal(single.sure, false);
  // The body and the signature.
  const twice = matchOutcomeRows(one("Harbourline"), `${once}\nCo-founder, Harbourline`);
  assert.equal(twice.matches[0]?.signs, 2);
  assert.equal(twice.sure, true);
  // An ended application is never the sure one.
  assert.equal(matchOutcomeRows(one("Harbourline", "Software Engineer", "rejected"), `${once}\nCo-founder, Harbourline`).sure, false);
});

test("an odd paste never makes the reader crawl", () => {
  const pastes = [
    `Hi Alex,\n\n${REJECTED}\n\nA${" ".repeat(19000)}x`,
    `From: ${"a".repeat(19000)}\n\n${REJECTED}`,
    `Thank you for applying to X${".".repeat(19000)}`,
    "apply to x ".repeat(1800),
    `${"Team\n".repeat(3000)}`,
    `Thank you for your application ${"to Acme at Globex with Initech ".repeat(600)}`,
  ];
  for (const paste of pastes) {
    const started = performance.now();
    const read = readOutcomeEmail(paste);
    matchOutcomeRows(ROWS, paste, read);
    const ms = performance.now() - started;
    assert.ok(ms < 500, `${paste.slice(0, 30)}…: ${Math.round(ms)} ms`);
  }
});
