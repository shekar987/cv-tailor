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
  reconcileFeedback,
  readout,
  answerMetrics,
  DEFERRAL,
  type TranscriptEntry,
  type TurnModelOut,
} from "../src/lib/mockInterview.ts";
import { ROUNDS, INTERVIEW_TYPES, RTW_QUESTION, CLOSE_QUESTION, MAX_ANSWERS, openingLine, isInterviewType } from "../src/lib/interviewTypes.ts";
import { speakable, splitSentences, numberToWords, countFillers, isRepeatRequest, isThinkingRequest, isNoQuestions } from "../src/lib/speechText.ts";

const CV = `EXPERIENCE
Full Stack Engineer | Brane Group | Jul 2022 – Sep 2024
- Built REST APIs in FastAPI serving 3,000 users.
- Cut page load time by 20% with code splitting.
- Wrote 90+ Jest tests for the checkout flow.`;
const ctx = { firstName: "Soma", company: "Acme", role: "Software Engineer", cvText: CV };
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
  assert.equal(openingLine("hiring_manager", "Soma", "Acme"), "Hi Soma, thanks for joining. I'm Daniel, the Engineering Manager for this team at Acme. This should take about 30 minutes.");
  for (const t of INTERVIEW_TYPES) for (const q of [...ROUNDS[t].fixedBefore, ...ROUNDS[t].fixedAfter, ...ROUNDS[t].stock]) assert.equal(equalityViolation(q.text), null, q.text);
});

test("plan: the model's questions are cleaned, logistics and unlawful ones dropped, gaps filled, anchors traced", () => {
  const raw = {
    questions: [
      { text: "1. Tell me about a time you had to deliver under pressure at Brane Group", rubric: "star", intent: "delivery", cvAnchor: "Built REST APIs in FastAPI serving 3,000 users." },
      { text: "How old were you when you started coding?", rubric: "star" },
      { text: "What are your salary expectations?", rubric: "star" },
      { text: "Can you give me an example of explaining a technical problem to a non-technical colleague?", rubric: "star", cvAnchor: "Led a team of 12 engineers." },
      { text: "Tell me about a time you had to deliver under pressure at Brane Group?", rubric: "star" },
    ],
  };
  const { plan, fromModel } = normalizePlan(raw, "competency", ctx);
  assert.equal(fromModel, 2);
  const texts = plan.questions.map((q) => q.text);
  assert.equal(texts[0], ROUNDS.competency.fixedBefore[0].text);
  assert.equal(texts[1], "Tell me about a time you had to deliver under pressure at Brane Group.");
  assert.ok(!texts.some((t) => /old|salary/i.test(t)));
  assert.equal(plan.questions.length, 1 + ROUNDS.competency.modelQuestions);
  assert.equal(plan.questions[1].cvAnchor, "Built REST APIs in FastAPI serving 3,000 users.");
  assert.equal(plan.questions[2].cvAnchor, "", "an anchor not in the CV is blanked");
  assert.deepEqual(plan.questions.map((q) => q.id), ["q1", "q2", "q3", "q4", "q5"]);
  assert.match(plan.opening, /^Hi Soma, thanks for joining\. I'm Emma, an HR Business Partner at Acme\./);
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

test("turn: one follow-up per question, then the next question; praise is scrubbed", () => {
  const { plan, transcript } = play();
  const a1 = decideTurn(plan, transcript, "I have worked on web apps.", model({ reaction: "Great answer! Thanks.", move: "probe", probe: "Which project was that, and what did you build yourself?" }), turnCtx);
  assert.equal(a1.reply.kind, "probe");
  assert.equal(a1.reply.say, "Thanks. Which project was that, and what did you build yourself?");
  transcript.push(...a1.entries);
  const a2 = decideTurn(plan, transcript, "At Brane Group I built the REST APIs.", model({ move: "probe", probe: "And what was the result?" }), turnCtx);
  assert.equal(a2.reply.kind, "next", "a second probe on the same question is refused");
  assert.equal(a2.reply.question!.id, "q2");
  assert.equal(a2.reply.say, `Thank you. ${plan.questions[1].text}`);
});

test("turn: a follow-up with an invented figure or an unlawful topic is refused; a failed model still advances", () => {
  const { plan, transcript } = play();
  const bad = decideTurn(plan, transcript, "I improved performance a lot.", model({ move: "probe", probe: "You said you cut load time by 45% — how?" }), turnCtx);
  assert.equal(bad.reply.kind, "next");
  const ok = decideTurn(plan, transcript, "I cut page load time with code splitting.", model({ move: "probe", probe: "Your CV says 20% — how did you measure that?" }), turnCtx);
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
    const r = decideTurn(plan, transcript, "A clear answer about my experience at Brane Group.", model({ move: "probe", probe: "Could you say more?" }), turnCtx);
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
    { who: "candidate", kind: "answer", questionId: "q1", text: "I'm a full stack engineer. At Brane Group I built REST APIs in FastAPI for 3,000 users and cut load time by 45%.", seconds: 40 },
    { who: "candidate", kind: "answer", questionId: plan.questions.find((q) => q.rubric === "logistics_rtw")!.id, text: "I'm on a Student visa and move to the Graduate Route in January 2027, so no sponsorship for two years." },
    { who: "candidate", kind: "answer", questionId: plan.questions.find((q) => q.rubric === "logistics_salary")!.id, text: "Um, I'm not sure, you know." },
  ];
  const raw = { answers: [{ id: "q1", answered: { pass: true, quote: "I'm a full stack engineer" }, example: { pass: true, quote: "I led the migration to Kubernetes" }, tryInstead: "Say you cut load time by 20%. Say you served 5,000 users.", cvLine: "Built REST APIs in FastAPI serving 3,000 users." }] };
  const fb = reconcileFeedback(raw, plan, transcript, CV);
  const q1 = fb.answers.find((a) => a.questionId === "q1")!;
  assert.deepEqual(q1.checks.map((c) => [c.key, c.pass]), [["answered", true], ["example", false]]);
  assert.deepEqual(q1.metrics.figuresNotInCv, ["45%"]);
  assert.equal(q1.tryInstead, "Say you cut load time by 20%.");
  assert.equal(q1.cvLine, "Built REST APIs in FastAPI serving 3,000 users.");
  const rtw = fb.answers.find((a) => a.rubric === "logistics_rtw")!;
  assert.equal(rtw.checks[0].pass, true);
  const salary = fb.answers.find((a) => a.rubric === "logistics_salary")!;
  assert.equal(salary.checks[0].pass, false);
  assert.equal(salary.metrics.fillers, 2);
});

test("readout: fixed labels from counts; 3 of 12 can never read 'Ready'; an early end is 'incomplete'", () => {
  const mk = (pass: boolean[]) => ({ questionId: "q", question: "", rubric: "star" as const, answer: "", checks: pass.map((p) => ({ key: "answered" as const, pass: p, quote: "" })), metrics: answerMetrics("I built it at Brane Group and it worked well for the team over many months of steady use.", null, CV), tryInstead: "", cvLine: "" });
  const low = readout([mk([true, false, false, false]), mk([true, false, false, false]), mk([true, false, false, false])], 5);
  assert.equal(low.band, "not_ready");
  assert.notEqual(low.label, "Ready for this stage");
  assert.equal(readout([mk([true, true, true, true]), mk([true, true, true, false]), mk([true, true, true, true])], 5).band, "ready");
  assert.equal(readout([mk([true, true, true, true])], 6).band, "incomplete");
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
