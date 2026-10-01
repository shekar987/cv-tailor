import test from "node:test";
import assert from "node:assert/strict";
import {
  mentionsRightToWork,
  stripRightToWorkLines,
  stripRightToWorkSentences,
  stripRightToWorkBullets,
  rightToWorkStatement,
  classifyRightToWorkText,
  rightToWorkDisagrees,
  mentionsAvailability,
  reconcileAvailabilitySentences,
  reconcileRightToWorkSentences,
  monthName,
  type RtwFacts,
} from "../src/lib/rightToWorkText.ts";

test("mentionsRightToWork: the status vocabulary, not a company called Visa", () => {
  for (const s of [
    "Currently in the UK on a Student visa with full-time work authorised.",
    "From January 2027 I move to the Graduate Route with no sponsorship required.",
    "I have the right to work in the UK.",
    "No visa sponsorship needed.",
    "Eligible to work in the UK without restriction.",
    "Holds indefinite leave to remain (ILR).",
    "British citizenship required.",
  ]) assert.equal(mentionsRightToWork(s), true, s);
  for (const s of [
    "Built a payments integration for Visa and Mastercard card networks.",
    "Shipped 20+ API modules at Brane Group.",
    "Led the migration to Next.js 16.",
  ]) assert.equal(mentionsRightToWork(s), false, s);
});

test("stripRightToWorkSentences: the offending sentence goes, the line keeps the rest, paragraphs survive", () => {
  const summary = [
    "Full Stack Engineer with 2 years building AI-enabled services at Brane Group.",
    "Shipped 20+ API modules and cut frontend load time by 20%. Currently on a Student visa with full work authorisation, moving to the Graduate Route in January 2027.",
    "Built Jobhuntz, a Next.js and Supabase CV tool with 90+ automated tests.",
  ].join("\n");
  const r = stripRightToWorkSentences(summary);
  assert.equal(r.removed.length, 1);
  assert.match(r.removed[0], /Student visa/);
  assert.equal(r.text.split("\n").length, 3);
  assert.match(r.text.split("\n")[1], /^Shipped 20\+ API modules and cut frontend load time by 20%\.$/);
  assert.equal(mentionsRightToWork(r.text), false);

  // A cover-letter paragraph that is only the status disappears whole; the
  // blank line between the neighbours does not double up.
  const letter = "Dear Hiring Manager,\n\nI am applying for the Software Engineer role.\n\nI hold a Student visa with full-time work rights and will not need sponsorship until 2027.\n\nAt Brane Group I shipped 20+ API modules.\n\nKind regards,\nSoma";
  const l = stripRightToWorkSentences(letter);
  assert.equal(l.removed.length, 1);
  assert.equal(l.text, "Dear Hiring Manager,\n\nI am applying for the Software Engineer role.\n\nAt Brane Group I shipped 20+ API modules.\n\nKind regards,\nSoma");
});

test("stripRightToWorkSentences: nothing to strip returns the text unchanged", () => {
  const t = "Line one.\n\nLine two, e.g. this one. Line three.";
  const r = stripRightToWorkSentences(t);
  assert.deepEqual(r, { text: t, removed: [] });
});

test("stripRightToWorkLines and stripRightToWorkBullets: whole bullets go", () => {
  const exp = "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024\n• Shipped 20+ API modules.\n• Right to work in the UK, no sponsorship required.\n\nResearch Assistant | UEL | 2026 – Present\n• Analysed 11 platforms.";
  const r = stripRightToWorkLines(exp);
  assert.deepEqual(r.removed, ["• Right to work in the UK, no sponsorship required."]);
  assert.equal(r.text, "Full Stack Engineer | Brane Group | Jul 2023 – Sep 2024\n• Shipped 20+ API modules.\n\nResearch Assistant | UEL | 2026 – Present\n• Analysed 11 platforms.");
  const p = stripRightToWorkBullets({ "0": ["Built a RAG pipeline.", "Available immediately with full working rights."], "1": ["Deployed on Vercel."] });
  assert.deepEqual(p.removed, ["Available immediately with full working rights."]);
  assert.deepEqual(p.projects, { "0": ["Built a RAG pipeline."], "1": ["Deployed on Vercel."] });
  assert.deepEqual(stripRightToWorkBullets(null), { projects: null, removed: [] });
});

// ── The statement (30 Sep audit: Eligibility is the one source) ──────────────

const facts = (over: Partial<RtwFacts> & { rtw?: Partial<RtwFacts["rightToWork"]>; av?: Partial<RtwFacts["availability"]> } = {}): RtwFacts => ({
  rightToWork: { status: "unknown", countries: [], permissionEnds: null, ...(over.rtw ?? {}) },
  availability: { status: "unknown", from: null, ...(over.av ?? {}) },
  canWorkFullTime: over.canWorkFullTime ?? "unknown",
});

test("rightToWorkStatement: one fixed sentence per right-to-work answer, none when unset", () => {
  const cases: [RtwFacts, string | null][] = [
    [facts({ rtw: { status: "full", countries: ["UK"] } }), "I have the permanent right to work in the UK and will not require visa sponsorship."],
    [facts({ rtw: { status: "full", countries: ["Ireland"] } }), "I have the permanent right to work in Ireland and will not require visa sponsorship."],
    [facts({ rtw: { status: "full" } }), "I have the permanent right to work in the UK and will not require visa sponsorship."],
    [
      facts({ rtw: { status: "time_limited", countries: ["UK"], permissionEnds: "2027-01" } }),
      "I currently hold a visa that allows me to work in the UK without sponsorship until January 2027, and would require sponsorship to continue beyond that.",
    ],
    [facts({ rtw: { status: "time_limited" } }), "I currently hold a visa that allows me to work in the UK without sponsorship, and would require sponsorship to continue beyond that."],
    [facts({ rtw: { status: "needs_sponsorship", countries: ["UK"] } }), "I will require visa sponsorship to work in the UK."],
    [facts(), null],
  ];
  for (const [e, want] of cases) {
    const s = rightToWorkStatement(e);
    assert.equal(s.rtwSentence, want, JSON.stringify(e.rightToWork));
    assert.equal(s.availabilitySentence, null);
    assert.equal(s.formBlock, want ?? "");
  }
  assert.equal(monthName("2027-01"), "January 2027");
  assert.equal(monthName("2027-13"), null);
  assert.equal(monthName(null), null);
});

test("rightToWorkStatement: availability and full-time answers, every combination", () => {
  const cases: [RtwFacts, string | null][] = [
    [facts({ av: { status: "now" }, canWorkFullTime: "yes" }), "I am available to start immediately and can work full time."],
    [facts({ av: { status: "now" }, canWorkFullTime: "no" }), "I am available to start immediately, though not full time."],
    [facts({ av: { status: "now" } }), "I am available to start immediately."],
    [facts({ av: { status: "from", from: "2027-02" }, canWorkFullTime: "yes" }), "I am available to start from February 2027 and can work full time."],
    [facts({ av: { status: "from", from: "2027-02" } }), "I am available to start from February 2027."],
    [facts({ av: { status: "from", from: null } }), null],
    [facts({ canWorkFullTime: "yes" }), "I can work full time."],
    [facts({ canWorkFullTime: "no" }), "I am not able to work full time."],
    [facts(), null],
  ];
  for (const [e, want] of cases) assert.equal(rightToWorkStatement(e).availabilitySentence, want, JSON.stringify(e));
  const both = rightToWorkStatement(facts({ rtw: { status: "time_limited", countries: ["UK"], permissionEnds: "2027-01" }, av: { status: "now" }, canWorkFullTime: "yes" }));
  assert.equal(
    both.formBlock,
    "I currently hold a visa that allows me to work in the UK without sponsorship until January 2027, and would require sponsorship to continue beyond that.\nI am available to start immediately and can work full time."
  );
});

test("classifyRightToWorkText: one reading or nothing — never a guess", () => {
  const cases: [string[], ReturnType<typeof classifyRightToWorkText>][] = [
    [["Graduate Route visa valid until January 2027."], "time_limited"],
    [["Currently in the UK on a Student visa with full-time work authorised.", "From January 2027 I move to the Graduate Route with no sponsorship required."], "time_limited"],
    [["Student visa; will require sponsorship after graduation."], "time_limited"],
    [["Available immediately for full-time work with no sponsorship required."], null],
    [["No sponsorship required."], null],
    [["Full right to work in the UK, no sponsorship required."], "full"],
    [["Holds Indefinite Leave to Remain (ILR)."], "full"],
    [["British citizen."], "full"],
    [["Will require visa sponsorship."], "needs_sponsorship"],
    [["I need sponsorship to work in the UK."], "needs_sponsorship"],
    [["Does not require sponsorship."], null],
    [["British citizen. Requires sponsorship for roles outside the UK."], null],
    [["Right to work in the UK."], null],
    [["Visa"], null],
    [[], null],
  ];
  for (const [lines, want] of cases) assert.equal(classifyRightToWorkText(lines), want, lines.join(" | "));
  assert.deepEqual(rightToWorkDisagrees(["Graduate Route visa valid until January 2027."], "full"), { cv: "time_limited", eligibility: "full" });
  assert.equal(rightToWorkDisagrees(["Graduate Route visa valid until January 2027."], "time_limited"), null);
  assert.equal(rightToWorkDisagrees(["No sponsorship required."], "needs_sponsorship"), null, "an unreadable CV line never disagrees");
  assert.equal(rightToWorkDisagrees(["British citizen."], "unknown"), null, "no answer, no warning");
});

test("mentionsAvailability: start dates and full-time claims, not hybrid work or a role's hours", () => {
  for (const s of [
    "I am available to start immediately.",
    "I can start from January 2027.",
    "I'm able to work full-time now.",
    "My notice period is one month.",
    "I am available from March and can work full time.",
  ]) assert.equal(mentionsAvailability(s), true, s);
  for (const s of [
    "I am based in London and available for hybrid work.",
    "The role is a full-time position in your Leeds office.",
    "I built the pricing service in Python.",
  ]) assert.equal(mentionsAvailability(s), false, s);
});

test("reconcileAvailabilitySentences: the template replaces the model's sentence, or it goes with a question", () => {
  const letter = "Dear Acme team,\nI am applying for the Engineer role.\nI am available to start immediately and can work full time now. I built the pricing service in Python.\nKind regards,\nAlex";
  const set = reconcileAvailabilitySentences(letter, facts({ av: { status: "from", from: "2027-02" }, canWorkFullTime: "no" }));
  assert.equal(set.text, "Dear Acme team,\nI am applying for the Engineer role.\nI am available to start from February 2027, though not full time. I built the pricing service in Python.\nKind regards,\nAlex");
  assert.deepEqual(set.replaced, [{ from: "I am available to start immediately and can work full time now.", to: "I am available to start from February 2027, though not full time." }]);
  assert.equal(set.asked, false);
  const unset = reconcileAvailabilitySentences(letter, facts());
  assert.equal(unset.text, "Dear Acme team,\nI am applying for the Engineer role.\nI built the pricing service in Python.\nKind regards,\nAlex");
  assert.deepEqual(unset.removed, ["I am available to start immediately and can work full time now."]);
  assert.equal(unset.asked, true);
  const twice = reconcileAvailabilitySentences("I can start immediately. I am ready to start in March.", facts({ av: { status: "now" } }));
  assert.equal(twice.text, "I am available to start immediately.", "a second availability sentence goes rather than repeating the template");
  assert.equal(reconcileAvailabilitySentences("I am based in London and available for hybrid work.", facts()).text, "I am based in London and available for hybrid work.");
});

test("reconcileRightToWorkSentences: the model's visa sentence always goes; template mode hands back the statement", () => {
  const letter = "I am applying for the Engineer role.\nI hold a Student visa and will not need sponsorship. I built the pricing service in Python.";
  const strip = reconcileRightToWorkSentences(letter, facts(), "strip");
  assert.equal(strip.text, "I am applying for the Engineer role.\nI built the pricing service in Python.");
  assert.equal(strip.statement, null);
  assert.equal(strip.asked, false);
  const tmpl = reconcileRightToWorkSentences(letter, facts({ rtw: { status: "time_limited", countries: ["UK"] } }), "template");
  assert.equal(tmpl.text, strip.text);
  assert.equal(tmpl.statement, "I currently hold a visa that allows me to work in the UK without sponsorship, and would require sponsorship to continue beyond that.");
  assert.equal(tmpl.asked, false);
  const unset = reconcileRightToWorkSentences(letter, facts(), "template");
  assert.equal(unset.statement, null);
  assert.equal(unset.asked, true);
});

test("career facts about full-time work are not availability; Visa the company, a sponsored hackathon and an immigration product are not status lines (review, 1 Oct)", async () => {
  const { mentionsAvailability, mentionsRightToWork } = await import("../src/lib/rightToWorkText.ts");
  assert.ok(!mentionsAvailability("I spent two years working full-time at Brane Group building the LLM platform."));
  assert.ok(!mentionsAvailability("I was able to balance a full-time role with my MSc."));
  assert.ok(mentionsAvailability("I am available for full-time work from January."));
  assert.ok(mentionsAvailability("I can work full time and start immediately."));
  assert.ok(!mentionsRightToWork("Integrated the Visa and Mastercard payment APIs with retries."));
  assert.ok(!mentionsRightToWork("Won a hackathon sponsored by AWS."));
  assert.ok(!mentionsRightToWork("Built an immigration case-management portal for a law firm."));
  assert.ok(!mentionsRightToWork("Designed the sponsorship-tier billing model."), "no: 'sponsorship' alone is the status word");
  assert.ok(mentionsRightToWork("Currently on a Student Visa; will require sponsorship after graduation."));
  assert.ok(mentionsRightToWork("I hold a visa that allows me to work."));
  assert.ok(mentionsRightToWork("British citizenship held since 2019."));
});
