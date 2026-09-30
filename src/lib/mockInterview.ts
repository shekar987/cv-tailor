// The mock interview's rules, decided in code (imports only siblings with
// ".ts", so node:test runs it). The model writes the round's questions, the
// interviewer's short reactions, at most one follow-up per question and
// quoted checks on each answer; everything else is here:
//   - the plan: fixed UK questions around the model's, the Equality Act 2010
//     filter, gaps filled from a vetted stock bank, CV anchors traced;
//   - each turn: whether a follow-up is allowed, praise scrubbed (a real UK
//     interviewer stays neutral), figures in a follow-up or an answer to the
//     candidate checked against their sources, the next question chosen;
//   - the feedback: a check passes only when its quote is really in the
//     answer, figures are checked against the master CV, and the readout is
//     computed with fixed labels (the visibilityVerdict lesson: never let the
//     model grade).

import {
  ROUNDS,
  RUBRICS,
  CLOSE_QUESTION,
  ANOTHER_QUESTION,
  MAX_ANSWERS,
  MAX_CANDIDATE_QUESTIONS,
  MAX_ANSWER_CHARS,
  isInterviewType,
  isLogistics,
  openingLine,
  goodbyeLine,
  type InterviewType,
  type Rubric,
  type StockQuestion,
} from "./interviewTypes.ts";
import { makeLineTracer, normalizeEvidenceText } from "./prepPack.ts";
import { contentOverlap } from "./supportCheck.ts";
import { wordCount, countFillers, isNoQuestions, isRepeatRequest } from "./speechText.ts";

export type PlannedQuestion = {
  id: string;
  text: string;
  intent: string;
  strongAnswer: string[];
  cvAnchor: string;
  rubric: Rubric;
  fixed: boolean;
};

export type InterviewPlan = {
  version: 1;
  type: InterviewType;
  company: string;
  role: string;
  firstName: string;
  opening: string;
  questions: PlannedQuestion[];
};

export type EntryKind =
  | "opening"
  | "question"
  | "probe"
  | "clarify"
  | "close"
  | "answer_candidate"
  | "goodbye"
  | "answer"
  | "candidate_question";

export type TranscriptEntry = {
  who: "interviewer" | "candidate";
  kind: EntryKind;
  questionId: string | null;
  text: string;
  mode?: "voice" | "typed";
  seconds?: number;
};

const INTERVIEWER_KINDS = new Set<EntryKind>(["opening", "question", "probe", "clarify", "close", "answer_candidate", "goodbye"]);
const CANDIDATE_KINDS = new Set<EntryKind>(["answer", "candidate_question"]);
const MAX_TRANSCRIPT = 80;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// ── Equality Act 2010 ────────────────────────────────────────────────────────

// Questions a UK interviewer must never ask: age, marriage and family plans,
// pregnancy, religion, race and national origin (beyond the lawful right-to-
// work question), health and disability, sexual orientation, gender
// reassignment. Phrase-level, so "health check endpoint", "child process",
// "parent class" and "React Native" never trip it. Returns what matched.
const EQUALITY_RES: [string, RegExp][] = [
  ["age", /\bhow old\b|\byour age\b|\bdate of birth\b|\bwhen were you born\b|\byear (?:you were born|of birth)\b|\bwhen did you (?:leave|finish) school\b|\bnear(?:ing)? retirement\b/i],
  ["marriage or family", /\b(?:are you|you're) (?:married|single|engaged|divorced)\b|\bmarital status\b|\b(?:husband|wife|spouse|boyfriend|girlfriend)\b|\b(?:your|a) partner (?:work|do|mind|think|feel)s?\b|\b(?:do you have|have you got|any plans (?:to|for)|planning (?:to have|on having)|plan (?:to|on) (?:have|having)|thinking (?:of|about) having) (?:any )?(?:children|kids|a family|a baby)\b|\bstart(?:ing)? a family\b|\bchildcare\b|\bmaternity\b|\bpaternity\b|\bpregnan/i],
  ["religion", /\breligio|\b(?:church|mosque|synagogue|gurdwara)\b|\bdo you (?:pray|worship)\b|\bholy days?\b|\bwhat (?:is|'s) your faith\b/i],
  ["race or national origin", /\bwhere are you (?:originally |really )?from\b|\bwhere were you born\b|\byour (?:nationality|ethnicity|race|accent|heritage)\b|\bnative (?:language|speaker|tongue)\b|\bfirst language\b|\bmother tongue\b|\bcountry of origin\b/i],
  ["health or disability", /\byour health\b|\bhealth (?:condition|problem|issue)s?\b|\bmedical (?:condition|history|issue)s?\b|\bdisab(?:led|ility|ilities)\b|\bsick (?:days|leave)\b|\bdays off sick\b|\bmental health\b|\bany (?:illness|illnesses)\b|\b(?:take|on) (?:any )?medication\b/i],
  ["sexual orientation or gender identity", /\bsexual(?:ity| orientation)\b|\bare you (?:gay|straight|lesbian|bisexual)\b|\bgender (?:identity|reassignment)\b|\btransgender\b/i],
];

export function equalityViolation(text: string): string | null {
  for (const [topic, re] of EQUALITY_RES) if (re.test(text)) return topic;
  return null;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

// The model never writes the practical questions code asks the same way.
const LOGISTICS_TOPIC_RE = /\b(?:visa|sponsor(?:ship)?|right to work|eligible to work|salary|pay (?:range|expectations)|compensation|notice period|start date|when (?:could|can) you start|relocat)/i;
const QUESTION_OPENER_RE = /^(?:tell|talk|walk|describe|give|share|explain|take me|imagine|suppose|say)\b/i;

function similar(a: string, b: string): boolean {
  const ta = new Set(normalizeEvidenceText(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizeEvidenceText(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size) >= 0.75;
}

// One question as the interviewer will say it, or "" when it can't be used.
export function cleanQuestion(text: unknown): string {
  let t = str(text, 400).replace(/^(?:\d+[.)]|[-•*])\s*/, "").replace(/^["“]|["”]$/g, "").trim();
  if (t.length < 12 || t.length > 280 || wordCount(t) > 40) return "";
  if (!/\?$/.test(t)) {
    if (!QUESTION_OPENER_RE.test(t)) return "";
    if (!/[.!]$/.test(t)) t += ".";
  }
  if (equalityViolation(t)) return "";
  return t;
}

export type PlanContext = { firstName: string; company: string; role: string; cvText: string };

export function normalizePlan(raw: unknown, type: InterviewType, ctx: PlanContext): { plan: InterviewPlan; fromModel: number } {
  const round = ROUNDS[type];
  const traced = makeLineTracer(ctx.cvText);
  const items = raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions) ? ((raw as { questions: unknown[] }).questions) : [];
  const fixed = [...round.fixedBefore, ...round.fixedAfter];
  const chosen: Omit<PlannedQuestion, "id">[] = [];
  const taken = (t: string) => fixed.some((f) => similar(f.text, t)) || chosen.some((c) => similar(c.text, t));
  for (const item of items) {
    if (chosen.length >= round.modelQuestions) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = cleanQuestion(o.text);
    if (!text || LOGISTICS_TOPIC_RE.test(text) || taken(text)) continue;
    const rubric = typeof o.rubric === "string" && (RUBRICS as readonly string[]).includes(o.rubric) ? (o.rubric as Rubric) : round.modelRubric;
    if (!round.modelRubrics.includes(rubric)) continue;
    const anchor = str(o.cvAnchor, 300);
    chosen.push({
      text,
      intent: str(o.intent, 140),
      strongAnswer: (Array.isArray(o.strongAnswer) ? o.strongAnswer : []).map((s) => str(s, 100)).filter(Boolean).slice(0, 3),
      cvAnchor: anchor && traced(anchor) ? anchor : "",
      rubric,
      fixed: false,
    });
  }
  const fromModel = chosen.length;
  for (const s of round.stock) {
    if (chosen.length >= round.modelQuestions) break;
    if (!taken(s.text)) chosen.push(stockQuestion(s));
  }
  const all = [...round.fixedBefore.map(fixedQuestion), ...chosen, ...round.fixedAfter.map(fixedQuestion)];
  return {
    plan: {
      version: 1,
      type,
      company: str(ctx.company, 120),
      role: str(ctx.role, 160),
      firstName: str(ctx.firstName, 40),
      opening: openingLine(type, str(ctx.firstName, 40), str(ctx.company, 120)),
      questions: all.map((q, i) => ({ ...q, id: `q${i + 1}` })),
    },
    fromModel,
  };
}

function stockQuestion(s: StockQuestion): Omit<PlannedQuestion, "id"> {
  return { text: s.text, intent: "", strongAnswer: [], cvAnchor: "", rubric: s.rubric, fixed: false };
}
function fixedQuestion(s: StockQuestion): Omit<PlannedQuestion, "id"> {
  return { text: s.text, intent: "", strongAnswer: [], cvAnchor: "", rubric: s.rubric, fixed: true };
}

// A stored plan, re-bounded: a user can write their own row under RLS.
export function planFromRow(value: unknown): InterviewPlan | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !isInterviewType(v.type) || !Array.isArray(v.questions)) return null;
  const questions: PlannedQuestion[] = [];
  for (const q of v.questions.slice(0, 12)) {
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const text = str(o.text, 300);
    const rubric = typeof o.rubric === "string" && (RUBRICS as readonly string[]).includes(o.rubric) ? (o.rubric as Rubric) : null;
    if (!text || !rubric || equalityViolation(text)) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      text,
      intent: str(o.intent, 140),
      strongAnswer: (Array.isArray(o.strongAnswer) ? o.strongAnswer : []).map((s) => str(s, 100)).filter(Boolean).slice(0, 3),
      cvAnchor: str(o.cvAnchor, 300),
      rubric,
      fixed: o.fixed === true,
    });
  }
  if (questions.length === 0) return null;
  return {
    version: 1,
    type: v.type,
    company: str(v.company, 120),
    role: str(v.role, 160),
    firstName: str(v.firstName, 40),
    opening: str(v.opening, 400),
    questions,
  };
}

export function transcriptFromRow(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  const out: TranscriptEntry[] = [];
  for (const e of value.slice(0, MAX_TRANSCRIPT)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const who = o.who === "interviewer" || o.who === "candidate" ? o.who : null;
    const kind = typeof o.kind === "string" ? (o.kind as EntryKind) : null;
    if (!who || !kind || !(who === "interviewer" ? INTERVIEWER_KINDS : CANDIDATE_KINDS).has(kind)) continue;
    out.push({
      who,
      kind,
      questionId: typeof o.questionId === "string" ? o.questionId.slice(0, 8) : null,
      text: str(o.text, MAX_ANSWER_CHARS),
      ...(o.mode === "voice" || o.mode === "typed" ? { mode: o.mode } : {}),
      ...(typeof o.seconds === "number" && o.seconds >= 0 && o.seconds < 3600 ? { seconds: Math.round(o.seconds) } : {}),
    });
  }
  return out;
}

// ── Where the interview is ───────────────────────────────────────────────────

export type InterviewState = {
  phase: "questions" | "close" | "done";
  current: PlannedQuestion | null;
  probed: boolean;
  answers: number;
  candidateQuestions: number;
  asked: number;
};

export function interviewState(plan: InterviewPlan, transcript: TranscriptEntry[]): InterviewState {
  let phase: InterviewState["phase"] = "questions";
  let currentId: string | null = null;
  const probed = new Set<string>();
  const asked = new Set<string>();
  let answers = 0;
  let candidateQuestions = 0;
  for (const e of transcript) {
    if (e.who === "candidate") {
      answers++;
      if (e.kind === "candidate_question") candidateQuestions++;
      continue;
    }
    if (e.kind === "question" || e.kind === "opening") {
      if (e.questionId) { currentId = e.questionId; asked.add(e.questionId); }
    } else if (e.kind === "probe" && e.questionId) probed.add(e.questionId);
    else if (e.kind === "close") phase = "close";
    else if (e.kind === "goodbye") phase = "done";
  }
  const current = plan.questions.find((q) => q.id === currentId) ?? null;
  return { phase, current, probed: current ? probed.has(current.id) : false, answers, candidateQuestions, asked: asked.size };
}

// The opening entries: the code-written greeting and the first question.
export function openingEntries(plan: InterviewPlan): TranscriptEntry[] {
  const first = plan.questions[0];
  return [{ who: "interviewer", kind: "opening", questionId: first.id, text: `${plan.opening} ${first.text}` }];
}

// ── A turn ───────────────────────────────────────────────────────────────────

export type TurnModelOut = {
  reaction: string;
  move: "probe" | "next";
  probe: string;
  clarify: boolean;
  clarification: string;
  answerToCandidate: string;
};

export function normalizeTurnOutput(raw: unknown): TurnModelOut | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    reaction: str(o.reaction, 200),
    move: o.move === "probe" ? "probe" : "next",
    probe: str(o.probe, 300),
    clarify: o.candidate_asked === "clarify" || o.clarify === true,
    clarification: str(o.clarification, 400),
    answerToCandidate: str(o.answer_to_candidate ?? o.answerToCandidate, 500),
  };
}

// A real UK interviewer doesn't grade an answer out loud.
const PRAISE_RE = /\b(?:great|excellent|impressive|fantastic|brilliant|perfect|amazing|wonderful|awesome|outstanding|superb|terrific|solid|love (?:that|this|it)|well done|nice one|spot on|good answer|strong (?:answer|experience|background|example))\b/i;
export function scrubPraise(text: string): string {
  const kept = str(text, 400)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s && !PRAISE_RE.test(s));
  return kept.join(" ").trim();
}

// The reaction only acknowledges: a question inside it would be a second,
// unchecked probe on top of the next question (the live run on 30 Sep said
// "And how did the front-end work feed back…? Are you currently eligible…?").
// And only its first sentence: the live competency run recapped every answer
// ("So you've got solid full-stack experience…"), which reads as grading.
export function neutralReaction(text: string): string {
  const first = scrubPraise(text)
    .split(/(?<=[.!?])\s+/)
    .find((s) => s && !s.includes("?"));
  return first && wordCount(first) <= 12 ? first.trim() : "";
}

// One question per follow-up: the live run asked "What trade-offs did you
// make…? And how did you know it was safe to ship?".
export function firstQuestion(text: string): string {
  const i = text.indexOf("?");
  return i === -1 ? text.trim() : text.slice(0, i + 1).trim();
}

function digitsIn(text: string): string[] {
  return normalizeEvidenceText(text).match(/\d+/g) ?? [];
}
// Every number in `text` appears in one of the sources.
function numbersSupported(text: string, sources: string[]): boolean {
  const have = new Set(sources.flatMap(digitsIn));
  return digitsIn(text).every((d) => have.has(d));
}

// What a follow-up must pass: one question, lawful, no invented figures.
function usableLine(text: string, sources: string[], needsQuestion: boolean): boolean {
  if (!text || text.length > 300) return false;
  if (needsQuestion && !/\?/.test(text)) return false;
  if (equalityViolation(text) || PRAISE_RE.test(text)) return false;
  return numbersSupported(text, sources);
}

export const DEFERRAL = "That's a good question. I don't want to guess, so I'll check with the team and come back to you on it.";
export const STOCK_REACTION = "Thank you.";

export type TurnReply = {
  kind: "probe" | "next" | "clarify" | "close_questions" | "answer_candidate" | "goodbye";
  say: string;
  question: PlannedQuestion | null;
  upcoming: PlannedQuestion | null;
  done: boolean;
};

export type TurnContext = {
  cvText: string;
  // What the interviewer may state facts from at the close: the job
  // description and any company research.
  companySources: string;
};

const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

// The candidate's answer and the interviewer's reply. `model` is null when
// the model call failed: the interview advances with a stock reaction.
export function decideTurn(
  plan: InterviewPlan,
  transcript: TranscriptEntry[],
  answer: string,
  model: TurnModelOut | null,
  ctx: TurnContext,
  meta: { mode?: "voice" | "typed"; seconds?: number } = {}
): { entries: TranscriptEntry[]; reply: TurnReply } {
  const state = interviewState(plan, transcript);
  const text = str(answer, MAX_ANSWER_CHARS);
  const q = state.current;
  const reaction = model ? neutralReaction(model.reaction) : STOCK_REACTION;
  const candidate = (kind: EntryKind): TranscriptEntry => ({ who: "candidate", kind, questionId: q?.id ?? null, text, ...meta });
  const say = (kind: EntryKind, line: string, questionId: string | null): TranscriptEntry => ({ who: "interviewer", kind, questionId, text: line });

  if (state.phase === "close") {
    if (isNoQuestions(text)) {
      const bye = goodbyeLine(plan.firstName);
      return { entries: [candidate("candidate_question"), say("goodbye", bye, null)], reply: { kind: "goodbye", say: bye, question: null, upcoming: null, done: true } };
    }
    const proposed = model?.answerToCandidate ?? "";
    const reply = proposed && usableLine(proposed, [ctx.companySources, text], false) ? proposed : DEFERRAL;
    const last = state.candidateQuestions + 1 >= MAX_CANDIDATE_QUESTIONS;
    const line = last ? join(reply, goodbyeLine(plan.firstName)) : join(reply, ANOTHER_QUESTION);
    return {
      entries: [candidate("candidate_question"), say(last ? "goodbye" : "answer_candidate", line, null)],
      reply: { kind: last ? "goodbye" : "answer_candidate", say: line, question: null, upcoming: null, done: last },
    };
  }

  if (!q) {
    const line = join(reaction, CLOSE_QUESTION);
    return { entries: [candidate("answer"), say("close", line, null)], reply: { kind: "close_questions", say: line, question: null, upcoming: null, done: false } };
  }

  // "Sorry, could you repeat that?" reached the server: say it again.
  if (isRepeatRequest(text)) {
    const line = join("Of course.", q.text);
    return { entries: [candidate("answer"), say("clarify", line, q.id)], reply: { kind: "clarify", say: line, question: q, upcoming: null, done: false } };
  }

  const sources = [text, ctx.cvText];
  if (model?.clarify && usableLine(model.clarification, sources, false)) {
    return {
      entries: [candidate("answer"), say("clarify", model.clarification, q.id)],
      reply: { kind: "clarify", say: model.clarification, question: q, upcoming: null, done: false },
    };
  }

  const nearCap = state.answers + 1 >= MAX_ANSWERS - MAX_CANDIDATE_QUESTIONS;
  const probe = model ? firstQuestion(model.probe) : "";
  if (model?.move === "probe" && !state.probed && !isLogistics(q.rubric) && !nearCap && usableLine(probe, sources, true)) {
    const line = join(reaction, probe);
    return { entries: [candidate("answer"), say("probe", line, q.id)], reply: { kind: "probe", say: line, question: q, upcoming: null, done: false } };
  }

  const idx = plan.questions.findIndex((x) => x.id === q.id);
  const next = nearCap ? null : plan.questions[idx + 1] ?? null;
  const ack = reaction || STOCK_REACTION;
  if (next) {
    const line = join(ack, next.text);
    return {
      entries: [candidate("answer"), say("question", line, next.id)],
      reply: { kind: "next", say: line, question: next, upcoming: plan.questions[idx + 2] ?? null, done: false },
    };
  }
  const line = join(ack, CLOSE_QUESTION);
  return { entries: [candidate("answer"), say("close", line, null)], reply: { kind: "close_questions", say: line, question: null, upcoming: null, done: false } };
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export const CHECK_KEYS = ["answered", "example", "ownActions", "result"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

// Which of the model's checks apply to each kind of question.
export const CHECKS_FOR: Record<Rubric, CheckKey[]> = {
  background: ["answered", "example"],
  motivation: ["answered", "example"],
  star: ["answered", "example", "ownActions", "result"],
  strength: ["answered", "example"],
  technical: ["answered", "example", "ownActions"],
  logistics_rtw: [],
  logistics_notice: [],
  logistics_salary: [],
  logistics_location: [],
};

export const CHECK_LABELS: Record<CheckKey | "clear", string> = {
  answered: "Answered the question asked",
  example: "Used a specific example",
  ownActions: "Said what you did yourself",
  result: "Gave the result",
  clear: "Gave a clear, direct answer",
};

// Logistics answers, read by code.
const LOGISTICS_CLEAR: Partial<Record<Rubric, RegExp>> = {
  logistics_rtw: /\b(?:visa|sponsor|right to work|eligible|graduate route|settled status|citizen|british|indefinite leave|ilr|work permit|skilled worker)\b/i,
  logistics_notice: /\b(?:\d+|one|two|three|four|six|eight|a|an)\s+(?:weeks?|months?)\b|\bimmediately\b|\bstraight away\b|\bno notice\b|\bavailable from\b|\bstart (?:on|from|in)\b/i,
  logistics_salary: /£\s?\d|\b\d{2,3}\s?k\b|\bthousand\b|\bsalary (?:band|range)\b|\bthe (?:band|range) (?:you|in the)/i,
  logistics_location: /\b(?:hybrid|office|remote|commut|days? a week|days? in|on[- ]site|relocat|travel|based in|live in)\b/i,
};

export type Check = { key: CheckKey | "clear"; pass: boolean; quote: string };
export type AnswerMetrics = { words: number; seconds: number | null; fillers: number; fillerWords: string[]; iCount: number; weCount: number; figuresNotInCv: string[] };
export type AnswerFeedback = {
  questionId: string;
  question: string;
  rubric: Rubric;
  answer: string;
  checks: Check[];
  metrics: AnswerMetrics;
  tryInstead: string;
  // The sentences of tryInstead that neither trace to a CV line nor are made
  // of the CV's words (30 Sep; the same rule as the prep pack's check) — the
  // view marks them "Not from your CV". Absent on feedback stored before.
  tryInsteadFlags?: string[];
  cvLine: string;
};
export type InterviewFeedback = {
  version: 1;
  partial: boolean;
  answers: AnswerFeedback[];
  readout: Readout;
};

export function answerMetrics(text: string, seconds: number | null, cvText: string): AnswerMetrics {
  const fillers = countFillers(text);
  const cvDigits = new Set(digitsIn(cvText));
  // Figures as spoken ("40%", "3,000 users") whose numbers the CV never has.
  const spoken = text.match(/[£$€]?\d[\d,.]*\s?(?:%|k\b|m\b|x\b)?/g) ?? [];
  const notInCv = spoken.filter((f) => digitsIn(f).some((d) => !cvDigits.has(d))).map((f) => f.trim());
  return {
    words: wordCount(text),
    seconds,
    fillers: fillers.count,
    fillerWords: fillers.found,
    iCount: (text.match(/\b(?:I|I'm|I've|I'd|my|me)\b/g) ?? []).length,
    weCount: (text.match(/\b(?:we|we're|we've|our|us)\b/gi) ?? []).length,
    figuresNotInCv: [...new Set(notInCv)].slice(0, 6),
  };
}

// The candidate's words for each question (answer plus any follow-up answer).
export function answersByQuestion(plan: InterviewPlan, transcript: TranscriptEntry[]): Map<string, { text: string; seconds: number | null }> {
  const out = new Map<string, { text: string; seconds: number | null }>();
  for (const e of transcript) {
    if (e.who !== "candidate" || e.kind !== "answer" || !e.questionId) continue;
    if (!plan.questions.some((q) => q.id === e.questionId)) continue;
    const cur = out.get(e.questionId) ?? { text: "", seconds: null };
    out.set(e.questionId, {
      text: join(cur.text, e.text),
      seconds: e.seconds == null ? cur.seconds : (cur.seconds ?? 0) + e.seconds,
    });
  }
  return out;
}

// The prep pack's rule (lib/prepCheck NOT_IN_CV_OVERLAP): a suggested
// sentence is not from the CV when no CV line traces it and under half its
// content words are the CV's.
const TRY_OVERLAP = 0.5;
const TRY_MIN_WORDS = 6;

// Model feedback, reconciled: a pass needs a quote found in the answer; the
// suggested wording keeps only figures the CV has, and each of its sentences
// is marked when the CV does not support it; the CV line must be in it.
export function reconcileFeedback(raw: unknown, plan: InterviewPlan, transcript: TranscriptEntry[], cvText: string, partial = false): InterviewFeedback {
  const byQ = answersByQuestion(plan, transcript);
  const rawList = raw && typeof raw === "object" && Array.isArray((raw as { answers?: unknown }).answers) ? ((raw as { answers: unknown[] }).answers) : [];
  const modelById = new Map<string, Record<string, unknown>>();
  for (const a of rawList) if (a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string") modelById.set((a as { id: string }).id, a as Record<string, unknown>);
  const inCv = makeLineTracer(cvText);
  const answers: AnswerFeedback[] = [];
  for (const q of plan.questions) {
    const given = byQ.get(q.id);
    if (!given) continue;
    const inAnswer = makeLineTracer(given.text);
    const m = modelById.get(q.id) ?? {};
    let checks: Check[];
    if (isLogistics(q.rubric)) {
      const re = LOGISTICS_CLEAR[q.rubric];
      const pass = !!re && re.test(given.text) && wordCount(given.text) >= 3;
      checks = [{ key: "clear", pass, quote: pass ? (given.text.match(re!)?.[0] ?? "") : "" }];
    } else {
      checks = CHECKS_FOR[q.rubric].map((key) => {
        const c = m[key] && typeof m[key] === "object" ? (m[key] as Record<string, unknown>) : {};
        const quote = str(c.quote, 300);
        const pass = c.pass === true && !!quote && inAnswer(quote);
        return { key, pass, quote: pass ? quote : "" };
      });
    }
    const trySentences = str(m.tryInstead, 400)
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s && numbersSupported(s, [cvText]));
    const tryInstead = trySentences.join(" ");
    const cvLines = cvText.split("\n").filter((l) => l.trim());
    const tryInsteadFlags = trySentences.filter((s) => s.split(/\s+/).length >= TRY_MIN_WORDS && !inCv(s) && contentOverlap(s, cvLines) < TRY_OVERLAP);
    const cvLine = str(m.cvLine, 300);
    answers.push({
      questionId: q.id,
      question: q.text,
      rubric: q.rubric,
      answer: given.text,
      checks,
      metrics: answerMetrics(given.text, given.seconds, cvText),
      tryInstead,
      tryInsteadFlags,
      cvLine: cvLine && inCv(cvLine) ? cvLine : "",
    });
  }
  return { version: 1, partial, answers, readout: readout(answers, plan.questions.length) };
}

// ── Readout ──────────────────────────────────────────────────────────────────

export type ReadoutBand = "incomplete" | "not_ready" | "getting_there" | "ready";
export const READOUT_LABELS: Record<ReadoutBand, string> = {
  incomplete: "Ended early: not enough answers to judge",
  not_ready: "Not interview-ready yet",
  getting_there: "Getting there",
  ready: "Ready for this stage",
};
export type Readout = { band: ReadoutBand; label: string; passed: number; total: number; priorities: string[] };

const ADVICE: Record<string, string> = {
  answered: "Answer the question you were asked first, then add the context.",
  example: "Use one specific example from your CV (a named project or role) instead of speaking in general terms.",
  ownActions: "Say what you did yourself: \"I\" for your part, not \"we\".",
  result: "Finish with the outcome, and the figure if your CV has one.",
  clear: "Give practical answers plainly: your visa and sponsorship position, notice period, a salary range in pounds, and how the location works for you.",
  figures: "Check your figures: you said numbers your CV doesn't show. Use the CV's exact figures or none.",
  fillers: "Cut filler words (um, you know, sort of). A short pause sounds more confident.",
  short: "Develop short answers into one to two minutes with an example.",
  long: "Keep answers under about three minutes: stop once you've given the result.",
};

export function readout(answers: AnswerFeedback[], plannedQuestions: number): Readout {
  const checks = answers.flatMap((a) => a.checks);
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const fails = new Map<string, number>();
  const bump = (k: string) => fails.set(k, (fails.get(k) ?? 0) + 1);
  for (const a of answers) {
    for (const c of a.checks) if (!c.pass) bump(c.key);
    if (a.metrics.figuresNotInCv.length) bump("figures");
    if (a.metrics.words > 0 && a.metrics.fillers / a.metrics.words > 0.03) bump("fillers");
    if (!isLogistics(a.rubric) && a.metrics.words < 40) bump("short");
    if (a.metrics.words > 450) bump("long");
  }
  const priorities = [...fails.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => ADVICE[k]).filter(Boolean);
  let band: ReadoutBand;
  if (answers.length < Math.max(2, Math.ceil(plannedQuestions / 2)) || total === 0) band = "incomplete";
  else if (passed / total >= 0.75) band = "ready";
  else if (passed / total >= 0.5) band = "getting_there";
  else band = "not_ready";
  return { band, label: READOUT_LABELS[band], passed, total, priorities };
}

// Feedback from code alone, when the feedback call fails.
export function codeOnlyFeedback(plan: InterviewPlan, transcript: TranscriptEntry[], cvText: string): InterviewFeedback {
  return reconcileFeedback(null, plan, transcript, cvText, true);
}
