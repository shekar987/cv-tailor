// Mock interview with an AI interviewer, for one tracker application.
//
// GET  ?applicationId=  → { interviews: [...] }        this application's interviews
// GET  ?id=             → { interview }                one interview (intents once finished)
// POST { action: "start", applicationId, type, provider? }
//        → { interview }                               1 tailor credit; the round's plan
// POST { action: "turn", interviewId, answerIndex, answer, mode, seconds?, provider? }
//        → { reply, progress, done, degraded? }        the interviewer's next line
// POST { action: "finish", interviewId, provider? }
//        → { feedback, questions }                     checks on every answer
//
// The wallet order is /api/prep's: every free read first (row, master CV,
// research, the CV that was sent), a missing JD or CV answers 400 and a
// missing table 503 before any metering. Starting spends one tailor credit
// and makes the plan call, refunded if it fails; every later call goes to the
// same wallet (lib/llmRouting callOnPath) and is capped per interview by
// MAX_ANSWERS counted from the stored transcript, plus the burst limit.
// lib/mockInterview decides everything the model doesn't.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callLLM, ProviderRateLimitError } from "@/lib/claude";
import { checkBurstLimit } from "@/lib/apiRateLimit";
import { resolveLlmRoute, callOnPath, llmPathOf, formatDuration, type LlmPath } from "@/lib/llmRouting";
import { MAX_CV_CHARS, CV_TOO_LONG, MAX_JD_CHARS } from "@/lib/limits";
import { interviewPlanPrompt, interviewTurnPrompt, interviewFeedbackPrompt } from "@/prompts/steps";
import { sanitizeCompanyResearch } from "@/lib/companyResearch";
import { companyNamesMatch } from "@/lib/companyMatch";
import { flattenTailoredCv, packFromRow } from "@/lib/prepPack";
import { ROUNDS, MAX_ANSWERS, MAX_ANSWER_CHARS, isInterviewType, isLogistics, personaFor, type InterviewType } from "@/lib/interviewTypes";
import {
  normalizePlan,
  planFromRow,
  transcriptFromRow,
  interviewState,
  openingEntries,
  decideTurn,
  normalizeTurnOutput,
  answerMetrics,
  answersByQuestion,
  reconcileFeedback,
  codeOnlyFeedback,
  type InterviewPlan,
  type PlannedQuestion,
  type TranscriptEntry,
} from "@/lib/mockInterview";
import { isNoQuestions, isRepeatRequest } from "@/lib/speechText";

export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SET_UP =
  "Mock interviews aren't set up in the database yet — run supabase/migrations/20260930120000_mock_interviews.sql in the Supabase SQL editor, then try again.";
// The 10-minute window in which a started interview with no answers is
// reopened instead of charged again (a double click, a reload).
const REUSE_MS = 10 * 60 * 1000;

const isMissingTable = (err: { code?: string } | null) => err?.code === "PGRST205" || err?.code === "42P01";
const isMissingColumn = (err: { code?: string } | null) => err?.code === "42703" || err?.code === "PGRST204";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const APP_LADDER = [
  "id, company_name, role, job_description, tailored_cv, prep_pack, sent_cv",
  "id, company_name, role, job_description, tailored_cv, prep_pack",
  "id, company_name, role, job_description, tailored_cv",
  "id, company_name, role, job_description",
];
type AppRow = {
  id: string;
  company_name: string;
  role: string;
  job_description: string | null;
  tailored_cv?: unknown;
  prep_pack?: unknown;
  sent_cv?: unknown;
};

type InterviewRow = {
  id: string;
  application_id: string;
  type: string;
  persona: string;
  llm_path: LlmPath;
  status: "active" | "finished";
  turn_seq: number;
  plan: unknown;
  transcript: unknown;
  feedback: unknown;
  created_at: string;
  finished_at: string | null;
};

async function readApplication(supabase: Supabase, userId: string, id: string): Promise<AppRow | null | "error"> {
  for (let rung = 0; rung < APP_LADDER.length; rung++) {
    const { data, error } = await supabase.from("applications").select(APP_LADDER[rung]).eq("id", id).eq("user_id", userId).maybeSingle();
    if (error && isMissingColumn(error) && rung < APP_LADDER.length - 1) continue;
    if (error) {
      console.error("interview: application read error:", error.message);
      return "error";
    }
    return (data as unknown as AppRow | null) ?? null;
  }
  return null;
}

async function readMasterCv(supabase: Supabase): Promise<string | NextResponse> {
  const { data, error } = await supabase.from("master_cvs").select("text").maybeSingle();
  if (error) {
    console.error("interview: master CV read error:", error.message);
    return NextResponse.json({ error: "Could not load your master CV" }, { status: 500 });
  }
  const cv = typeof data?.text === "string" ? data.text.trim() : "";
  if (!cv) return NextResponse.json({ error: "Save your master CV in Customize first — the interview is built from it.", errorType: "needs_cv" }, { status: 400 });
  if (cv.length > MAX_CV_CHARS) return NextResponse.json({ error: CV_TOO_LONG }, { status: 400 });
  return cv;
}

// Cached company research for this company (the prep route's lookup).
async function readResearch(supabase: Supabase, userId: string, company: string) {
  const { data: rows, error } = await supabase.from("company_profiles").select("data").eq("user_id", userId).order("fetched_at", { ascending: false }).limit(300);
  if (error || !Array.isArray(rows)) return { research: null as Record<string, unknown> | null, matched: [] as string[], gaps: [] as string[] };
  for (const r of rows) {
    const data = (r as { data?: unknown }).data as Record<string, unknown> | undefined;
    const profile = data?.profile as Record<string, unknown> | undefined;
    if (!companyNamesMatch(company, typeof profile?.company_name === "string" ? profile.company_name : "")) continue;
    const fit = data?.fitScore as Record<string, unknown> | undefined;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, 80)).slice(0, 25) : []);
    return { research: sanitizeCompanyResearch(profile), matched: list(fit?.matched_stack), gaps: list(fit?.missing_stack) };
  }
  return { research: null, matched: [], gaps: [] };
}

// What the employer saw: the tailored snapshot, else the text of the CV file
// the user uploaded for this application.
function cvTheySent(app: AppRow): string {
  const tailored = flattenTailoredCv(app.tailored_cv, 6_000);
  if (tailored) return tailored;
  const sent = app.sent_cv && typeof app.sent_cv === "object" ? (app.sent_cv as { text?: unknown }).text : null;
  return typeof sent === "string" ? sent.slice(0, 6_000) : "";
}

function firstNameFrom(name: unknown): string {
  const first = typeof name === "string" ? name.trim().split(/\s+/)[0] ?? "" : "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}

const pub = (q: PlannedQuestion | null) => (q ? { id: q.id, text: q.text } : null);

function personaPayload(type: InterviewType) {
  const p = personaFor(type);
  return { id: p.id, name: p.name, firstName: p.firstName, gender: p.gender, kokoroVoice: p.kokoroVoice, avatar: p.avatar, role: ROUNDS[type].interviewerRole };
}

function progressOf(plan: InterviewPlan, transcript: TranscriptEntry[]) {
  const s = interviewState(plan, transcript);
  const idx = s.current ? plan.questions.findIndex((q) => q.id === s.current!.id) + 1 : plan.questions.length;
  return { asked: idx, total: plan.questions.length, answers: s.answers, max: MAX_ANSWERS, phase: s.phase };
}

// The transcript as the client may see it.
const publicTranscript = (t: TranscriptEntry[]) => t.map(({ who, kind, questionId, text }) => ({ who, kind, questionId, text }));

function rateLimited(seconds: number) {
  return NextResponse.json(
    { error: `Too many requests. Please wait ${seconds}s and try again.`, errorType: "provider_limit", retryAfter: seconds },
    { status: 429, headers: { "Retry-After": String(seconds) } }
  );
}

async function signedIn(): Promise<{ supabase: Supabase; userId: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { supabase, userId: data.claims.sub as string };
}

async function readInterview(supabase: Supabase, userId: string, id: string): Promise<InterviewRow | null | NextResponse> {
  const { data, error } = await supabase
    .from("mock_interviews")
    .select("id, application_id, type, persona, llm_path, status, turn_seq, plan, transcript, feedback, created_at, finished_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
    console.error("interview: read error:", error.message);
    return NextResponse.json({ error: "Could not load that interview" }, { status: 500 });
  }
  return (data as InterviewRow | null) ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { supabase, userId } = caller;
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    const applicationId = url.searchParams.get("applicationId") ?? "";

    if (UUID_RE.test(id)) {
      const row = await readInterview(supabase, userId, id);
      if (row instanceof NextResponse) return row;
      if (!row) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
      const plan = planFromRow(row.plan);
      if (!plan || !isInterviewType(row.type)) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
      const transcript = transcriptFromRow(row.transcript);
      const finished = row.status === "finished";
      return NextResponse.json({
        interview: {
          id: row.id,
          applicationId: row.application_id,
          type: row.type,
          persona: personaPayload(row.type),
          status: row.status,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
          transcript: publicTranscript(transcript),
          questions: finished ? plan.questions : plan.questions.map(pub),
          progress: progressOf(plan, transcript),
          feedback: finished ? row.feedback ?? null : null,
        },
      });
    }

    if (!UUID_RE.test(applicationId)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const { data, error } = await supabase
      .from("mock_interviews")
      .select("id, type, persona, status, created_at, finished_at, readout:feedback->readout")
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ interviews: [], warning: NOT_SET_UP, errorType: "needs_migration" });
      console.error("interview: list error:", error.message);
      return NextResponse.json({ error: "Could not load your interviews" }, { status: 500 });
    }
    return NextResponse.json({ interviews: data ?? [] });
  } catch (err) {
    console.error("Interview GET error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json({ error: "Could not load your interviews" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await signedIn();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { supabase, userId } = caller;

    const burst = await checkBurstLimit(userId, "interview");
    if (!burst.ok) return rateLimited(burst.retryAfterSeconds);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (body.action === "start") return await start(supabase, userId, body);
    if (body.action === "turn") return await turn(supabase, userId, body);
    if (body.action === "finish") return await finish(supabase, userId, body);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ProviderRateLimitError) {
      const retry = error.retryAfterSeconds ? `Resets in ~${formatDuration(error.retryAfterSeconds * 1000)}.` : "Try again shortly.";
      return NextResponse.json({ error: `The service is busy right now. ${retry}`, errorType: "provider_limit", retryAfter: error.retryAfterSeconds ?? null }, { status: 429 });
    }
    console.error("Interview API error:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "The interview hit a problem. Try again." }, { status: 500 });
  }
}

// ── start ────────────────────────────────────────────────────────────────────

async function start(supabase: Supabase, userId: string, body: Record<string, unknown>) {
  const applicationId = typeof body.applicationId === "string" ? body.applicationId.trim() : "";
  if (!UUID_RE.test(applicationId)) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (!isInterviewType(body.type)) return NextResponse.json({ error: "Choose an interview round.", errorType: "invalid_type" }, { status: 400 });
  const type = body.type;

  const app = await readApplication(supabase, userId, applicationId);
  if (app === "error") return NextResponse.json({ error: "Could not load that application" }, { status: 500 });
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  // The table first: no credit is ever spent on an interview that can't be saved.
  const recent = await supabase
    .from("mock_interviews")
    .select("id, type, status, plan, transcript, created_at")
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(5);
  if (recent.error) {
    if (isMissingTable(recent.error)) return NextResponse.json({ error: NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
    console.error("interview: recent read error:", recent.error.message);
    return NextResponse.json({ error: "Could not start the interview" }, { status: 500 });
  }
  // A started interview with no answers yet, a moment ago: reopen it free.
  for (const r of recent.data ?? []) {
    const plan = planFromRow(r.plan);
    const transcript = transcriptFromRow(r.transcript);
    if (r.type !== type || !plan || Date.now() - Date.parse(r.created_at) > REUSE_MS) continue;
    if (interviewState(plan, transcript).answers > 0) continue;
    return NextResponse.json({ interview: startPayload(r.id, type, plan, transcript), cached: true });
  }

  const jd = (app.job_description ?? "").trim().slice(0, MAX_JD_CHARS);
  if (!jd) return NextResponse.json({ error: "Add the job description to this application first — the interview is built from it.", errorType: "needs_jd" }, { status: 400 });
  const cv = await readMasterCv(supabase);
  if (cv instanceof NextResponse) return cv;

  const { data: prof } = await supabase.from("cv_profiles").select("data").maybeSingle();
  const firstName = firstNameFrom((prof?.data as { name?: unknown } | undefined)?.name);
  const { research, matched, gaps } = await readResearch(supabase, userId, app.company_name);
  const pack = packFromRow(app.prep_pack);
  const honestGaps = pack ? pack.angle.honestGaps.map((g) => g.gap).slice(0, 4) : [];
  const sent = cvTheySent(app);

  const route = await resolveLlmRoute(supabase, userId, {
    bodyProvider: body.provider,
    geminiOnlyMessage: "Mock interviews run on an OpenRouter key once your free Claude credits are used — your saved Gemini key isn't used for them. Add an OpenRouter key in Settings to continue.",
  });
  if (!route.ok) return NextResponse.json(route.body, { status: route.status });

  const round = ROUNDS[type];
  let plan: InterviewPlan;
  try {
    const raw = await callLLM({
      provider: route.provider,
      apiKeyOverride: route.apiKeyOverride,
      system: interviewPlanPrompt(cv, { label: round.label, interviewerRole: round.interviewerRole, modelQuestions: round.modelQuestions, guidance: round.guidance, rubric: round.modelRubric }),
      userInput: JSON.stringify({
        company: app.company_name,
        role: app.role,
        job_description: jd,
        ...(sent ? { cv_they_sent: sent } : {}),
        ...(honestGaps.length ? { honest_gaps: honestGaps } : {}),
        ...(gaps.length ? { known_stack_gaps: gaps } : {}),
        ...(matched.length ? { matched_stack: matched } : {}),
        ...(research ? { company_research: research } : {}),
      }),
      expectJson: true,
      maxTokens: 3000,
    });
    const normalized = normalizePlan(raw, type, { firstName, company: app.company_name, role: app.role, cvText: cv });
    if (normalized.fromModel === 0) throw new Error("bad_plan");
    plan = normalized.plan;
  } catch (err) {
    await route.refund();
    if (err instanceof Error && err.message === "bad_plan") {
      return NextResponse.json({ error: "The model returned an unusable interview plan. Your credit was refunded — try again.", errorType: "bad_plan" }, { status: 500 });
    }
    if (route.reason === "own_key" && err instanceof ProviderRateLimitError) {
      return NextResponse.json({ limitReached: true, error: "Your OpenRouter key has hit its usage limit. Try again later.", errorType: "user_key_limit" }, { status: 429 });
    }
    throw err;
  }

  const transcript = openingEntries(plan);
  const { data: inserted, error: insertError } = await supabase
    .from("mock_interviews")
    .insert({ user_id: userId, application_id: applicationId, type, persona: personaFor(type).id, llm_path: llmPathOf(route), plan, transcript })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await route.refund();
    if (isMissingTable(insertError)) return NextResponse.json({ error: NOT_SET_UP, errorType: "needs_migration" }, { status: 503 });
    console.error("interview: insert error:", insertError?.message);
    return NextResponse.json({ error: "Could not save the interview. Your credit was refunded — try again." }, { status: 500 });
  }
  return NextResponse.json({ interview: startPayload(inserted.id, type, plan, transcript), cached: false });
}

function startPayload(id: string, type: InterviewType, plan: InterviewPlan, transcript: TranscriptEntry[]) {
  return {
    id,
    type,
    persona: personaPayload(type),
    say: transcript[0]?.text ?? plan.opening,
    question: pub(plan.questions[0]),
    upcoming: pub(plan.questions[1] ?? null),
    progress: progressOf(plan, transcript),
  };
}

// ── turn ─────────────────────────────────────────────────────────────────────

const STOCK_ACKS = ["Thank you.", "Thanks, that's helpful.", "Okay, thank you.", "Right, thanks."];

async function turn(supabase: Supabase, userId: string, body: Record<string, unknown>) {
  const id = typeof body.interviewId === "string" ? body.interviewId : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const answer = typeof body.answer === "string" ? body.answer.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS) : "";
  if (!answer) return NextResponse.json({ error: "Say or type an answer first." }, { status: 400 });
  const mode = body.mode === "typed" ? "typed" : "voice";
  const seconds = typeof body.seconds === "number" && body.seconds >= 0 && body.seconds < 3600 ? Math.round(body.seconds) : undefined;

  const row = await readInterview(supabase, userId, id);
  if (row instanceof NextResponse) return row;
  if (!row) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const plan = planFromRow(row.plan);
  if (!plan || !isInterviewType(row.type)) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const transcript = transcriptFromRow(row.transcript);
  const state = interviewState(plan, transcript);
  if (row.status === "finished" || state.phase === "done") return NextResponse.json({ error: "This interview has finished.", errorType: "finished" }, { status: 409 });
  if (body.answerIndex !== state.answers) {
    return NextResponse.json({ error: "The interview moved on in another tab.", errorType: "stale_turn", transcript: publicTranscript(transcript), progress: progressOf(plan, transcript) }, { status: 409 });
  }
  if (state.answers >= MAX_ANSWERS) return NextResponse.json({ error: "This interview has reached its length limit.", errorType: "turn_cap" }, { status: 429 });

  const cv = await readMasterCv(supabase);
  if (cv instanceof NextResponse) return cv;
  const app = await readApplication(supabase, userId, row.application_id);
  if (app === "error" || !app) return NextResponse.json({ error: "Could not load that application" }, { status: 500 });

  const q = state.current;
  // No model call where code already knows the reply: a repeat request, a
  // "no questions" at the close, and the practical questions (no probes).
  const needsModel = !isRepeatRequest(answer) && (state.phase === "close" ? !isNoQuestions(answer) : !!q && !isLogistics(q.rubric));
  let companySources = "";
  if (state.phase === "close") {
    const { research } = await readResearch(supabase, userId, app.company_name);
    companySources = [app.job_description ?? "", research ? JSON.stringify(research) : ""].join("\n").slice(0, MAX_JD_CHARS + 4000);
  }

  let modelOut = null;
  let degraded = false;
  if (needsModel) {
    const metrics = answerMetrics(answer, seconds ?? null, cv);
    const lastExchanges = transcript.slice(-4).map(({ who, text }) => ({ who, text: text.slice(0, 600) }));
    const onThisQuestion = q ? transcript.filter((e) => e.questionId === q.id).map(({ who, kind, text }) => ({ who, kind, text: text.slice(0, 800) })) : [];
    try {
      const raw = await callOnPath(supabase, userId, row.llm_path, body.provider, {
        system: interviewTurnPrompt({ name: personaFor(row.type).name, role: ROUNDS[row.type].interviewerRole, probeStyle: ROUNDS[row.type].probeStyle }),
        userInput: JSON.stringify({
          phase: state.phase === "close" ? "close" : "questions",
          question: q ? { text: q.text, intent: q.intent, strongAnswer: q.strongAnswer, rubric: q.rubric } : null,
          answer,
          earlier_on_this_question: onThisQuestion,
          last_exchanges: lastExchanges,
          cv_they_sent: cvTheySent(app).slice(0, 3_000),
          probe_allowed: !!q && !state.probed && !isLogistics(q.rubric),
          unsupported_figures: metrics.figuresNotInCv,
          word_count: metrics.words,
          we_heavy: metrics.weCount >= 3 && metrics.weCount > metrics.iCount * 2,
          ...(companySources ? { company_sources: companySources } : {}),
        }),
        expectJson: true,
        maxTokens: 500,
      });
      modelOut = normalizeTurnOutput(raw);
      if (!modelOut) degraded = true;
    } catch (err) {
      console.warn("interview: turn model failed, advancing:", err instanceof Error ? err.message : "unknown");
      degraded = true;
    }
  }
  if (!needsModel && q && isLogistics(q.rubric)) {
    modelOut = { reaction: STOCK_ACKS[state.answers % STOCK_ACKS.length], move: "next" as const, probe: "", clarify: false, clarification: "", answerToCandidate: "" };
  }

  const { entries, reply } = decideTurn(plan, transcript, answer, modelOut, { cvText: cv, companySources }, { mode, ...(seconds !== undefined ? { seconds } : {}) });
  const next = [...transcript, ...entries];
  const { data: updated, error: updateError } = await supabase
    .from("mock_interviews")
    .update({ transcript: next, turn_seq: row.turn_seq + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("turn_seq", row.turn_seq)
    .select("id");
  if (updateError) {
    console.error("interview: turn write error:", updateError.message);
    return NextResponse.json({ error: "Could not save that answer. Try again." }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "The interview moved on in another tab.", errorType: "stale_turn", transcript: publicTranscript(transcript), progress: progressOf(plan, transcript) }, { status: 409 });
  }
  return NextResponse.json({
    reply: { kind: reply.kind, say: reply.say, question: pub(reply.question), upcoming: pub(reply.upcoming) },
    progress: progressOf(plan, next),
    done: reply.done,
    ...(degraded ? { degraded: true } : {}),
  });
}

// ── finish ───────────────────────────────────────────────────────────────────

async function finish(supabase: Supabase, userId: string, body: Record<string, unknown>) {
  const id = typeof body.interviewId === "string" ? body.interviewId : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const row = await readInterview(supabase, userId, id);
  if (row instanceof NextResponse) return row;
  if (!row) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const plan = planFromRow(row.plan);
  if (!plan || !isInterviewType(row.type)) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  const transcript = transcriptFromRow(row.transcript);

  // Already reviewed: free, as stored (it was reconciled when written).
  if (row.status === "finished" && row.feedback && typeof row.feedback === "object" && (row.feedback as { partial?: unknown }).partial !== true) {
    return NextResponse.json({ feedback: row.feedback, questions: plan.questions });
  }
  const byQ = answersByQuestion(plan, transcript);
  if (byQ.size === 0) return NextResponse.json({ error: "Answer at least one question before asking for feedback.", errorType: "no_answers" }, { status: 400 });

  const cv = await readMasterCv(supabase);
  if (cv instanceof NextResponse) return cv;

  let feedback;
  try {
    const raw = await callOnPath(supabase, userId, row.llm_path, body.provider, {
      system: interviewFeedbackPrompt(cv),
      userInput: JSON.stringify({
        round: ROUNDS[row.type].label,
        answers: plan.questions
          .filter((q) => byQ.has(q.id) && !isLogistics(q.rubric))
          .map((q) => ({ id: q.id, question: q.text, rubric: q.rubric, intent: q.intent, strongAnswer: q.strongAnswer, answer: byQ.get(q.id)!.text })),
      }),
      expectJson: true,
      maxTokens: 4000,
    });
    feedback = reconcileFeedback(raw, plan, transcript, cv);
  } catch (err) {
    console.warn("interview: feedback model failed, code-only:", err instanceof Error ? err.message : "unknown");
    feedback = codeOnlyFeedback(plan, transcript, cv);
  }

  const now = new Date().toISOString();
  const { error: writeError } = await supabase
    .from("mock_interviews")
    .update({ feedback, status: "finished", finished_at: row.finished_at ?? now, updated_at: now })
    .eq("id", id)
    .eq("user_id", userId);
  if (writeError) console.error("interview: feedback write error:", writeError.message);
  return NextResponse.json({ feedback, questions: plan.questions, ...(writeError ? { warning: "Your feedback is shown but couldn't be saved." } : {}) });
}
