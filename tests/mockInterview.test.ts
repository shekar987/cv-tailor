// Unit tests for the mock interview's code-decided rules (lib/mockInterview,
// lib/interviewTypes, lib/speechText). node:test; every text is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equalityViolation,
  cleanQuestion,
  normalizePlan,
  planFromRow,
  transcriptFromRow,
  interviewState,
  openingEntries,
  decideTurn,
  normalizeTurnOutput,
  scrubPraise,
  neutralReaction,
  firstQuestion,
  reconcileFeedback,
  readout,
  answerMetrics,
  starGaps,
  scoreOneAnswer,
  paceFlag,
  lengthFlag,
  DEFERRAL,
  type TranscriptEntry,
  type TurnModelOut,
} from "../src/lib/mockInterview.ts";
import { ROUNDS, INTERVIEW_TYPES, RTW_QUESTION, CLOSE_QUESTION, MAX_ANSWERS, openingLine, isInterviewType } from "../src/lib/interviewTypes.ts";
import { speakable, splitSentences, numberToWords, countFillers, isRepeatRequest, isThinkingRequest, isNoQuestions } from "../src/lib/speechText.ts";

const CV = `EXPERIENCE
Full Stack Engineer | Northgate Systems | Jul 2022 – Sep 2024
- Built REST APIs in FastAPI serving 3,000 users.
- Cut page load time by 20% with code splitting.
- Wrote 90+ Jest tests for the checkout flow.`;
const ctx = { firstName: "Alex", company: "Acme", role: "Software Engineer", cvText: CV };
const turnCtx = { cvText: CV, companySources: "Acme builds payroll software. Hybrid, 3 days a week in London." };

test("Equality Act: unlawful questions are caught, engineering words are not", () => {
  const unlawful = [
    "How old are you?",
    "Are you married?",
    "Do you have any children?",
    "Are you planning to start a family soon?",
    "Where are you originally from?",
    "Is English your first language?",
    "Do you have any health conditions we should know about?",
    "How many sick days did you take last year?",
    "What religion are you?",
    "What is your sexual orientation?",
    "Does your partner work in London?",
  ];
  for (const q of unlawful) assert.ok(equalityViolation(q), q);
  const lawful = [
    RTW_QUESTION,
    "How would you design a health check endpoint for this service?",
    "How does a child process differ from a thread?",
    "When would you override a method from a parent class?",
    "Have you built anything in React Native?",
    "How do you integrate with partner APIs?",
    "Tell me about a family of microservices you maintained.",
    "When did you graduate, and what did you study?",
  ];
  for (const q of lawful) assert.equal(equalityViolation(q), null, q);
  assert.equal(cleanQuestion("Are you married?"), "", "an unlawful question never reaches the plan");
  assert.equal(cleanQuestion("2) Describe your most recent project"), "Describe your most recent project.");
  assert.equal(cleanQuestion("I like Python"), "", "a statement is not a question");
});

test("rounds: six UK rounds, the screening call asks right to work, notice, salary and location in code", () => {
  assert.deepEqual([...INTERVIEW_TYPES], ["screening", "competency", "strengths", "technical", "hiring_manager", "final"]);
  assert.ok(isInterviewType("technical") && !isInterviewType("coding"));
  const s = ROUNDS.screening.fixedAfter.map((q) => q.rubric);
  assert.deepEqual(s, ["logistics_rtw", "logistics_notice", "logistics_salary", "logistics_location"]);
  assert.equal(ROUNDS.screening.fixedAfter[0].text, RTW_QUESTION);
  assert.equal(openingLine("hiring_manager", "Alex", "Acme"), "Hi Alex, thanks for joining. I'm Daniel, the Engineering Manager for this team at Acme. This should take about 30 minutes.");
  for (const t of INTERVIEW_TYPES) for (const q of [...ROUNDS[t].fixedBefore, ...ROUNDS[t].fixedAfter, ...ROUNDS[t].stock]) assert.equal(equalityViolation(q.text), null, q.text);
});

test("plan: the model's questions are cleaned, logistics and unlawful ones dropped, gaps filled, anchors traced", () => {
  const raw = {
    questions: [
      { text: "1. Tell me about a time you had to deliver under pressure at Northgate Systems", rubric: "star", intent: "delivery", cvAnchor: "Built REST APIs in FastAPI serving 3,000 users." },
      { text: "How old were you when you started coding?", rubric: "star" },
      { text: "What are your salary expectations?", rubric: "star" },
      { text: "Can you give me an example of explaining a technical problem to a non-technical colleague?", rubric: "star", cvAnchor: "Led a team of 12 engineers." },
      { text: "Tell me about a time you had to deliver under pressure at Northgate Systems?", rubric: "star" },
    ],
  };
  const { plan, fromModel } = normalizePlan(raw, "competency", ctx);
  assert.equal(fromModel, 2);
  const texts = plan.questions.map((q) => q.text);
  assert.equal(texts[0], ROUNDS.competency.fixedBefore[0].text);
  assert.equal(texts[1], "Tell me about a time you had to deliver under pressure at Northgate Systems.");
  assert.ok(!texts.some((t) => /old|salary/i.test(t)));
  assert.equal(plan.questions.length, 1 + ROUNDS.competency.modelQuestions);
  assert.equal(plan.questions[1].cvAnchor, "Built REST APIs in FastAPI serving 3,000 users.");
  assert.equal(plan.questions[2].cvAnchor, "", "an anchor not in the CV is blanked");
  assert.deepEqual(plan.questions.map((q) => q.id), ["q1", "q2", "q3", "q4", "q5"]);
  assert.match(plan.opening, /^Hi Alex, thanks for joining\. I'm Emma, an HR Business Partner at Acme\./);
  // Nothing usable from the model: the stock bank fills the round.
  const empty = normalizePlan({}, "screening", ctx);
  assert.equal(empty.fromModel, 0);
  assert.equal(empty.plan.questions.length, 1 + 2 + 4);
  assert.equal(empty.plan.questions.at(-4)!.text, RTW_QUESTION);
});

test("plan and transcript from a stored row are re-bounded", () => {
  const { plan } = normalizePlan({}, "technical", ctx);
  assert.deepEqual(planFromRow(JSON.parse(JSON.stringify(plan))), plan);
  assert.equal(planFromRow({ ...plan, type: "coding" }), null);
  const tampered = planFromRow({ ...plan, questions: [...plan.questions, { text: "Are you married?", rubric: "star" }] });
  assert.ok(tampered && !tampered.questions.some((q) => /married/.test(q.text)));
  const t = transcriptFromRow([{ who: "candidate", kind: "answer", questionId: "q1", text: "x".repeat(9000) }, { who: "robot", kind: "answer", text: "hi" }, { who: "interviewer", kind: "answer", text: "wrong kind" }]);
  assert.equal(t.length, 1);
  assert.equal(t[0].text.length, 4000);
});

function play(type: "screening" | "competency" = "competency") {
  const { plan } = normalizePlan({}, type, ctx);
  const transcript: TranscriptEntry[] = openingEntries(plan);
  return { plan, transcript };
}
const model = (o: Partial<TurnModelOut>): TurnModelOut => ({ reaction: "", move: "next", probe: "", clarify: false, clarification: "", answerToCandidate: "", ...o });

// A competency transcript sitting on a STAR question (q1 is the fixed
// background opener; the stock questions are STAR).
function onStar() {
  const { plan } = normalizePlan({}, "competency", ctx);
  const star = plan.questions.find((q) => q.rubric === "star")!;
  const transcript: TranscriptEntry[] = [{ who: "interviewer", kind: "opening", questionId: star.id, text: `Let's begin. ${star.text}` }];
  return { plan, transcript, star };
}

test("turn: adaptive probing keeps following up while the STAR answer is thin, then moves on; praise is scrubbed", () => {
  const { plan, transcript } = onStar();
  // First answer: no example, no result — probe (and praise is scrubbed).
  const a1 = decideTurn(plan, transcript, "I have worked on web apps.", model({ reaction: "Great answer! Thanks.", move: "probe", probe: "Which project was that, and what did you build yourself?" }), turnCtx);
  assert.equal(a1.reply.kind, "probe");
  assert.equal(a1.reply.say, "Thanks. Which project was that, and what did you build yourself?");
  transcript.push(...a1.entries);
  // Still no result: adaptive probing follows up AGAIN (the old one-probe rule
  // would have moved on here).
  const a2 = decideTurn(plan, transcript, "At Northgate Systems I built the REST APIs myself.", model({ move: "probe", probe: "And what was the result?" }), turnCtx);
  assert.equal(a2.reply.kind, "probe", "a second probe is allowed while the result is still missing");
  transcript.push(...a2.entries);
  // Now the answer has a personal action and a result (a figure): no gap, so
  // the interviewer moves on even though the model said probe.
  const a3 = decideTurn(plan, transcript, "I cut page load time by 20% with code splitting.", model({ move: "probe", probe: "Anything else?" }), turnCtx);
  assert.equal(a3.reply.kind, "next", "a complete answer is never probed");
});

test("turn: at most three probes on one STAR question, even when it stays incomplete", () => {
  const { plan, transcript } = onStar();
  for (let i = 0; i < 4; i++) {
    const r = decideTurn(plan, transcript, "We did some work on it.", model({ move: "probe", probe: "What did you do yourself, and what was the result?" }), turnCtx);
    transcript.push(...r.entries);
    if (i < 3) assert.equal(r.reply.kind, "probe", `probe ${i + 1}`);
    else assert.equal(r.reply.kind, "next", "the fourth follow-up is refused — three is the cap");
  }
});

test("turn: a question inside the reaction is dropped, so each turn asks one question (live run, 30 Sep)", () => {
  assert.equal(neutralReaction("Right, thanks. And how did the front-end work feed back into the back end?"), "Right, thanks.");
  const { plan, transcript } = play();
  const r = decideTurn(plan, transcript, "At Northgate Systems I built the APIs myself.", model({ reaction: "Right, thanks. And how did that go?", move: "next" }), turnCtx);
  assert.equal(r.reply.say, `Right, thanks. ${plan.questions[1].text}`);
  assert.ok(!/how did that go/.test(r.reply.say), "the smuggled question is gone");
});

test("live competency run (30 Sep): wrong-kind questions dropped, one-question probes, reactions that don't recap", () => {
  const raw = {
    questions: [
      { text: "Tell me about a time when you had to balance shipping quickly with quality. How did you manage that?", rubric: "star" },
      { text: "Can you walk me through how you'd build a frontend that streams an LLM response?", rubric: "technical" },
      { text: "How would you approach owning the CI/CD for a service you'd built?", rubric: "technical" },
    ],
  };
  const { plan, fromModel } = normalizePlan(raw, "competency", ctx);
  assert.equal(fromModel, 1);
  assert.ok(plan.questions.every((q) => q.rubric === "star" || q.fixed), "a competency round asks only STAR questions");
  assert.ok(!plan.questions.some((q) => /streams an LLM|CI\/CD/.test(q.text)));
  assert.equal(firstQuestion("What trade-offs did you make to hit that deadline? And how did you know it was safe to ship?"), "What trade-offs did you make to hit that deadline?");
  assert.equal(neutralReaction("Thanks, that's helpful. So you've got solid full-stack experience and you're currently on placement."), "Thanks, that's helpful.");
  assert.equal(neutralReaction("That's solid experience."), "");
  const transcript = openingEntries(plan);
  const r = decideTurn(plan, transcript, "I built the API at Northgate Systems.", model({ reaction: "Right, thanks. So you built the back-end API yourself.", move: "probe", probe: "What trade-offs did you make? And how did you know it was safe to ship?" }), turnCtx);
  assert.equal(r.reply.say, "Right, thanks. What trade-offs did you make?");
});

test("turn: a follow-up with an invented figure or an unlawful topic is refused; a failed model still advances", () => {
  const { plan, transcript } = play();
  // The answer has a clear gap (team-only, no result), so a probe is warranted —
  // what decides it here is whether the probe's figure is supported.
  const bad = decideTurn(plan, transcript, "We worked on performance.", model({ move: "probe", probe: "You said you cut load time by 45% — how?" }), turnCtx);
  assert.equal(bad.reply.kind, "next");
  const ok = decideTurn(plan, transcript, "We worked on performance.", model({ move: "probe", probe: "Your CV says 20% — how did you measure that?" }), turnCtx);
  assert.equal(ok.reply.kind, "probe");
  const unlawful = decideTurn(plan, transcript, "I worked late to finish it.", model({ move: "probe", probe: "Do you have children at home?" }), turnCtx);
  assert.equal(unlawful.reply.kind, "next");
  const failed = decideTurn(plan, transcript, "An answer.", null, turnCtx);
  assert.equal(failed.reply.kind, "next");
  assert.match(failed.reply.say, /^Thank you\. /);
});

test("turn: logistics questions get no follow-up; the close takes two candidate questions then says goodbye", () => {
  const { plan, transcript } = play("screening");
  // Answer everything with no probes.
  for (let i = 0; i < plan.questions.length; i++) {
    const r = decideTurn(plan, transcript, "A clear answer about my experience at Northgate Systems.", model({ move: "probe", probe: "Could you say more?" }), turnCtx);
    const q = plan.questions[i];
    if (q.rubric.startsWith("logistics_")) assert.notEqual(r.reply.kind, "probe", q.text);
    transcript.push(...r.entries);
    if (r.reply.kind === "probe") {
      transcript.push(...decideTurn(plan, transcript, "More detail.", model({}), turnCtx).entries);
    }
  }
  assert.equal(interviewState(plan, transcript).phase, "close");
  assert.match(transcript.at(-1)!.text, new RegExp(CLOSE_QUESTION.replace(/[.?]/g, "\\$&") + "$"));
  const q1 = decideTurn(plan, transcript, "How many days a week are in the office?", model({ answerToCandidate: "It's three days a week in London." }), turnCtx);
  assert.equal(q1.reply.kind, "answer_candidate");
  assert.match(q1.reply.say, /three days a week in London\. Is there anything else/);
  transcript.push(...q1.entries);
  const q2 = decideTurn(plan, transcript, "What's the team's budget for training?", model({ answerToCandidate: "Every engineer gets £2,500 a year." }), turnCtx);
  assert.equal(q2.reply.kind, "goodbye");
  assert.ok(q2.reply.say.startsWith(DEFERRAL), "a figure the JD and research don't state becomes an honest deferral");
  assert.ok(q2.reply.done);
});

test("turn: 'no questions' ends the interview; a repeat request repeats the question", () => {
  const { plan, transcript } = play();
  const again = decideTurn(plan, transcript, "Sorry, could you repeat that?", model({}), turnCtx);
  assert.equal(again.reply.kind, "clarify");
  assert.ok(again.reply.say.endsWith(plan.questions[0].text));
  transcript.push({ who: "interviewer", kind: "close", questionId: null, text: CLOSE_QUESTION });
  const bye = decideTurn(plan, transcript, "No, I think you've covered everything, thanks.", model({}), turnCtx);
  assert.equal(bye.reply.kind, "goodbye");
  assert.equal(bye.reply.done, true);
});

test("turn: near the answer cap the interview moves to the close", () => {
  const { plan, transcript } = play();
  for (let i = 0; i < MAX_ANSWERS - 3; i++) transcript.push({ who: "candidate", kind: "answer", questionId: "q1", text: "x" });
  const r = decideTurn(plan, transcript, "An answer.", model({ move: "probe", probe: "More?" }), turnCtx);
  assert.equal(r.reply.kind, "close_questions");
});

test("model output is normalized; praise-only reactions become empty", () => {
  assert.equal(normalizeTurnOutput("nope"), null);
  const o = normalizeTurnOutput({ reaction: "Thanks.", move: "probe", probe: "Why?", candidate_asked: "clarify", clarification: "I mean at work.", answer_to_candidate: "Yes." })!;
  assert.deepEqual([o.move, o.clarify, o.answerToCandidate], ["probe", true, "Yes."]);
  assert.equal(scrubPraise("Excellent answer. That's impressive!"), "");
  assert.equal(scrubPraise("Thanks, that's clear."), "Thanks, that's clear.");
});

test("feedback: a pass needs its quote in the answer; figures the CV lacks are flagged; logistics read by code", () => {
  const { plan } = normalizePlan({}, "screening", ctx);
  const transcript: TranscriptEntry[] = [
    ...openingEntries(plan),
    { who: "candidate", kind: "answer", questionId: "q1", text: "I'm a full stack engineer. At Northgate Systems I built REST APIs in FastAPI for 3,000 users and cut load time by 45%.", seconds: 40 },
    { who: "candidate", kind: "answer", questionId: plan.questions.find((q) => q.rubric === "logistics_rtw")!.id, text: "I'm on a Student visa and move to the Graduate Route in January 2027, so no sponsorship for two years." },
    { who: "candidate", kind: "answer", questionId: plan.questions.find((q) => q.rubric === "logistics_salary")!.id, text: "Um, I'm not sure, you know." },
  ];
  const raw = { answers: [{ id: "q1", answered: { pass: true, quote: "I'm a full stack engineer" }, example: { pass: true, quote: "I led the migration to Kubernetes" }, tryInstead: "Say you cut load time by 20%. Say you served 5,000 users.", cvLine: "Built REST APIs in FastAPI serving 3,000 users." }] };
  const fb = reconcileFeedback(raw, plan, transcript, CV);
  const q1 = fb.answers.find((a) => a.questionId === "q1")!;
  assert.deepEqual(q1.checks.map((c) => [c.key, c.pass]), [["answered", true], ["example", false]]);
  assert.deepEqual(q1.metrics.figuresNotInCv, ["45%"]);
  assert.equal(q1.tryInstead, "Say you cut load time by 20%.");
  assert.deepEqual(q1.tryInsteadFlags, [], "a suggestion made of the CV's own words is not marked");
  assert.equal(q1.cvLine, "Built REST APIs in FastAPI serving 3,000 users.");
  // A suggestion the CV does not support is kept but marked (30 Sep).
  const invented = reconcileFeedback(
    { answers: [{ id: "q1", tryInstead: "Mention the Kubernetes migration you led for the platform team at Northgate. Say you cut load time by 20%." }] },
    plan,
    transcript,
    CV
  ).answers.find((a) => a.questionId === "q1")!;
  assert.equal(invented.tryInstead, "Mention the Kubernetes migration you led for the platform team at Northgate. Say you cut load time by 20%.");
  assert.deepEqual(invented.tryInsteadFlags, ["Mention the Kubernetes migration you led for the platform team at Northgate."]);
  const rtw = fb.answers.find((a) => a.rubric === "logistics_rtw")!;
  assert.equal(rtw.checks[0].pass, true);
  const salary = fb.answers.find((a) => a.rubric === "logistics_salary")!;
  assert.equal(salary.checks[0].pass, false);
  assert.equal(salary.metrics.fillers, 2);
});

test("readout: fixed labels from counts; 3 of 12 can never read 'Ready'; an early end is 'incomplete'", () => {
  const mk = (pass: boolean[]) => ({ questionId: "q", question: "", rubric: "star" as const, answer: "", checks: pass.map((p) => ({ key: "answered" as const, pass: p, quote: "" })), metrics: answerMetrics("I built it at Northgate Systems and it worked well for the team over many months of steady use.", null, CV), tryInstead: "", cvLine: "" });
  const low = readout([mk([true, false, false, false]), mk([true, false, false, false]), mk([true, false, false, false])], 5);
  assert.equal(low.band, "not_ready");
  assert.notEqual(low.label, "Ready for this stage");
  assert.equal(readout([mk([true, true, true, true]), mk([true, true, true, false]), mk([true, true, true, true])], 5).band, "ready");
  assert.equal(readout([mk([true, true, true, true])], 6).band, "incomplete");
});

// ── Chunk 32: adaptive probing, rubric rows, stronger version, delivery ───────

test("starGaps: a complete STAR answer has no gaps; team-only or no-result answers do", () => {
  assert.deepEqual(starGaps("At Northgate I built the API and cut load time by 20%.", "star"), []);
  assert.deepEqual(starGaps("We built the whole thing together as a team on the project.", "star").sort(), ["action", "result"]);
  assert.deepEqual(starGaps("I improved the whole process a great deal over the year.", "star"), [], "an 'I' with a result word reads as complete");
  assert.deepEqual(starGaps("We did lots of things but I personally owned the rollout plan end to end.", "star"), ["result"], "action is clear, the result isn't");
  assert.deepEqual(starGaps("Anything at all here.", "logistics_rtw"), [], "logistics answers are never probed");
});

test("rubric rows: Situation/Action/Result/Relevance scored Missing/Partly/Clear from verified checks", () => {
  const { plan } = normalizePlan({}, "competency", ctx);
  const star = plan.questions.find((q) => q.rubric === "star")!;

  const good = "At Northgate Systems I rebuilt the checkout. I wrote the FastAPI endpoints myself and cut page load time by 20%.";
  const fbGood = reconcileFeedback(
    { answers: [{ id: star.id, answered: { pass: true, quote: "I rebuilt the checkout" }, example: { pass: true, quote: "At Northgate Systems I rebuilt the checkout" }, ownActions: { pass: true, quote: "I wrote the FastAPI endpoints myself" }, result: { pass: true, quote: "cut page load time by 20%" }, relevance: { level: "clear", quote: "I wrote the FastAPI endpoints myself" } }] },
    plan,
    [{ who: "candidate", kind: "answer", questionId: star.id, text: good, seconds: 60 }],
    CV
  );
  const rowsGood = Object.fromEntries((fbGood.answers[0].rubricRows ?? []).map((r) => [r.key, r.level]));
  assert.deepEqual([rowsGood.situation, rowsGood.action, rowsGood.result, rowsGood.relevance], ["clear", "clear", "clear", "clear"]);

  // Team-only, no figure, and a relevance quote that isn't in the answer.
  const weak = "We rebuilt the checkout and it went okay for the team.";
  const fbWeak = reconcileFeedback(
    { answers: [{ id: star.id, answered: { pass: true, quote: "We rebuilt the checkout" }, example: { pass: false, quote: "" }, ownActions: { pass: false, quote: "" }, result: { pass: false, quote: "" }, relevance: { level: "clear", quote: "this phrase is not in the answer" } }] },
    plan,
    [{ who: "candidate", kind: "answer", questionId: star.id, text: weak, seconds: 20 }],
    CV
  );
  const rowsWeak = Object.fromEntries((fbWeak.answers[0].rubricRows ?? []).map((r) => [r.key, r.level]));
  assert.deepEqual([rowsWeak.situation, rowsWeak.action, rowsWeak.result], ["partly", "missing", "missing"]);
  assert.equal(rowsWeak.relevance, "partly", "a relevance quote not found in the answer can't read 'clear'");
});

test("stronger version: the result placeholder is never flagged; an untraced claim is, an answer-supported one isn't", () => {
  const { plan } = normalizePlan({}, "competency", ctx);
  const star = plan.questions.find((q) => q.rubric === "star")!;
  const answer = "At Northgate Systems I built the REST APIs in FastAPI for the checkout.";
  const fb = reconcileFeedback(
    { answers: [{ id: star.id, tryInstead: "You built the REST APIs in FastAPI for the checkout yourself. You led the migration to Kubernetes for the platform team. Add your real result here." }] },
    plan,
    [{ who: "candidate", kind: "answer", questionId: star.id, text: answer, seconds: 40 }],
    CV
  );
  const a = fb.answers[0];
  const sents = a.strongerSentences ?? [];
  assert.equal(sents.length, 3);
  assert.equal(sents[0].traced, true, "restating the candidate's own answer is traced");
  assert.equal(sents[1].traced, false, "a claim in neither the answer nor the CV is flagged");
  assert.equal(sents[2].placeholder, true);
  assert.equal(sents[2].traced, true, "the honest result placeholder is never a 'not from your CV' flag");
  assert.deepEqual(a.tryInsteadFlags, ["You led the migration to Kubernetes for the platform team."]);
});

test("delivery metrics: wpm, pace and length flags, and the longest pause carried through", () => {
  const m = answerMetrics(("word ".repeat(100)).trim(), 60, CV, 3.2);
  assert.equal(m.wpm, 100);
  assert.equal(paceFlag(m.wpm), "slow");
  assert.equal(paceFlag(200), "fast");
  assert.equal(m.pauseSeconds, 3.2);
  assert.equal(answerMetrics("hi there", 5, CV).wpm, null, "too short to judge pace");
  assert.equal(lengthFlag("star", 30), "short");
  assert.equal(lengthFlag("star", 200), "long");
  assert.equal(lengthFlag("star", 90), null);
  assert.equal(lengthFlag("logistics_rtw", 10), null);
});

test("scoreOneAnswer: one answer re-scored exactly like the finish review (Retry)", () => {
  const { plan } = normalizePlan({}, "competency", ctx);
  const star = plan.questions.find((q) => q.rubric === "star")!;
  const scored = scoreOneAnswer(
    star,
    { text: "At Northgate Systems I built the REST APIs in FastAPI and cut load time by 20%.", seconds: 50, pauseSeconds: 2 },
    CV,
    { id: star.id, answered: { pass: true, quote: "I built the REST APIs in FastAPI" }, example: { pass: true, quote: "At Northgate Systems I built the REST APIs" }, ownActions: { pass: true, quote: "I built the REST APIs in FastAPI" }, result: { pass: true, quote: "cut load time by 20%" }, relevance: { level: "clear", quote: "I built the REST APIs in FastAPI" }, tryInstead: "", cvLine: "Built REST APIs in FastAPI serving 3,000 users." }
  );
  assert.ok(scored);
  assert.equal(scored!.rubric, "star");
  assert.ok(scored!.rubricRows && scored!.rubricRows.length === 4);
  assert.equal(scored!.metrics.pauseSeconds, 2);
  assert.equal(scored!.cvLine, "Built REST APIs in FastAPI serving 3,000 users.");
});

test("speech text: British numbers, money, per cent, acronyms and years", () => {
  assert.equal(numberToWords(150), "one hundred and fifty");
  assert.equal(numberToWords(2005), "two thousand and five");
  assert.equal(numberToWords(45300), "forty-five thousand three hundred");
  assert.equal(speakable("What are your salary expectations, £45,000 or £45k?"), "What are your salary expectations, forty-five thousand pounds or forty-five thousand pounds?");
  assert.equal(speakable("The band is £40–45k."), "The band is forty thousand to forty-five thousand pounds.");
  assert.equal(speakable("You cut load time by 20% for 3,000 users."), "You cut load time by twenty per cent for three thousand users.");
  assert.equal(speakable("Send your CV to HR, e.g. by email."), "Send your C V to H R, for example, by email.");
  assert.equal(speakable("Use the STAR method with our APIs in 2026."), "Use the STAR method with our A P Is in twenty twenty-six.");
  assert.equal(speakable("You wrote 90+ tests on the 1st project."), "You wrote ninety plus tests on the first project.");
});

test("speech text: sentences, fillers and short requests", () => {
  assert.deepEqual(splitSentences("Thanks. We use Node.js, e.g. for the API. Is that okay? Yes!"), ["Thanks.", "We use Node.js, e.g. for the API.", "Is that okay?", "Yes!"]);
  assert.deepEqual(countFillers("Um, I, you know, sort of built it. Um."), { count: 4, found: ["um", "you know", "sort of"] });
  assert.ok(isRepeatRequest("Sorry, could you repeat that?"));
  assert.ok(!isRepeatRequest("I had to repeat the deployment three times because the pipeline kept failing on the integration tests."));
  assert.ok(isThinkingRequest("Can I have a moment to think?"));
  assert.ok(isNoQuestions("No, I think you've covered everything."));
  assert.ok(!isNoQuestions("No worries. What does the team work on day to day?"));
});

import { flow, initialFlow, answerText, silenceDecision, type FlowState } from "../src/lib/interviewFlow.ts";

test("flow: speak → listen → think → speak; the microphone is never on while the interviewer speaks", () => {
  let s: FlowState = flow(initialFlow, { type: "START" });
  assert.equal(s.phase, "starting");
  s = flow(s, { type: "STARTED", say: "Hi.", question: { id: "q1", text: "Tell me about yourself." }, answers: 0 });
  assert.equal(s.phase, "speaking");
  assert.equal(flow(s, { type: "HEARD", finalText: "echo of the interviewer", interimText: "" }).finalText, "", "speech heard while speaking is ignored");
  s = flow(s, { type: "SPEECH_ENDED" });
  assert.equal(s.phase, "listening");
  assert.equal(flow(s, { type: "SUBMIT" }).phase, "listening", "nothing to send yet");
  s = flow(s, { type: "HEARD", finalText: "I studied computer science", interimText: "and then" });
  assert.equal(answerText(s), "I studied computer science and then");
  s = flow(s, { type: "SUBMIT" });
  assert.equal(s.phase, "thinking");
  s = flow(s, { type: "REPLY", say: "Thanks. Next question?", question: { id: "q2", text: "Next question?" }, done: false });
  assert.deepEqual([s.phase, s.answers, s.question!.id, answerText(s)], ["speaking", 1, "q2", ""]);
});

test("flow: pause and resume, a failed turn returns to listening, the goodbye leads to feedback", () => {
  let s: FlowState = { ...initialFlow, phase: "listening", question: { id: "q1", text: "Q?" } };
  s = flow(s, { type: "PAUSE" });
  assert.equal(s.phase, "paused");
  s = flow(s, { type: "RESUME" });
  assert.equal(s.phase, "listening");
  s = flow(flow(s, { type: "HEARD", finalText: "an answer here", interimText: "" }), { type: "SUBMIT" });
  s = flow(s, { type: "FAILED", error: "Network error" });
  assert.deepEqual([s.phase, s.error, answerText(s)], ["listening", "Network error", "an answer here"], "the answer is kept to resend");
  s = flow(flow(s, { type: "SUBMIT" }), { type: "REPLY", say: "Thanks for your time.", question: null, done: true });
  s = flow(s, { type: "SPEECH_ENDED" });
  assert.equal(s.phase, "finishing");
  assert.equal(flow(s, { type: "FEEDBACK" }).phase, "feedback");
});

test("silence: short fragments never auto-send; the countdown starts after a second and sends when full", () => {
  assert.deepEqual(silenceDecision(9000, 3, 3000), { action: "wait" });
  assert.deepEqual(silenceDecision(800, 20, 3000), { action: "wait" });
  const c = silenceDecision(2500, 20, 3000);
  assert.equal(c.action, "countdown");
  assert.ok(c.action === "countdown" && Math.abs(c.progress - 0.5) < 1e-9);
  assert.deepEqual(silenceDecision(4000, 20, 3000), { action: "submit" });
});
