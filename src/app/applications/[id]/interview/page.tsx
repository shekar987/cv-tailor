"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { TalkingHead } from "@/vendor/talkinghead/talkinghead.mjs";
import { getUsage, type Usage } from "@/lib/usage";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";
import { INTERVIEW_TYPES, ROUNDS, PERSONAS, type InterviewType } from "@/lib/interviewTypes";
import type { InterviewFeedback } from "@/lib/mockInterview";
import { detectCaps, suggestedVoice, type Caps, type VoiceChoice } from "@/lib/interview/capabilities";
import { loadKokoroVoice, loadBrowserVoices, pickBrowserVoice, browserVoice, silentVoice, type InterviewVoice } from "@/lib/interview/voice";
import AvatarStage, { type AvatarHandle } from "./AvatarStage";
import InterviewRoom, { type StartedInterview } from "./InterviewRoom";
import FeedbackView from "./FeedbackView";

// /applications/[id]/interview — a mock interview with an AI interviewer for
// one tracked application: pick the UK round, get interviewed out loud (or by
// typing), get checks on every answer. One tailor credit per interview.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_EXPIRED = "Your session has expired — sign in again to continue.";
// The natural voice must say a line at least this fast, or the conversation stalls.
const MIN_REALTIME = 1.2;

type Row = { id: string; company_name: string; role: string; status: string; job_description: string | null };
type Past = { id: string; type: string; status: string; created_at: string; readout: { band: string; label: string } | null };
type LoadState = "loading" | "ready" | "missing" | "expired" | "error";
type KokoroState = { state: "idle" } | { state: "loading"; pct: number } | { state: "ready"; factor: number } | { state: "too_slow"; factor: number } | { state: "failed"; reason: string };

function defaultRound(status: string): InterviewType {
  return status === "Interview" ? "competency" : "screening";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [load, setLoad] = useState<LoadState>("loading");
  const [row, setRow] = useState<Row | null>(null);
  const [past, setPast] = useState<Past[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [type, setType] = useState<InterviewType>("screening");
  const [voiceChoice, setVoiceChoice] = useState<VoiceChoice>("browser");
  const [kokoro, setKokoro] = useState<KokoroState>({ state: "idle" });
  const [kokoroVoice, setKokoroVoice] = useState<InterviewVoice | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  const [headReady, setHeadReady] = useState(false);
  const [answerMode, setAnswerMode] = useState<"voice" | "typed">("voice");
  const [silenceMs, setSilenceMs] = useState(3000);
  const [phase, setPhase] = useState<"setup" | "room" | "feedback">("setup");
  const [started, setStarted] = useState<StartedInterview | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [questions, setQuestions] = useState<{ id: string; text: string; intent?: string }[]>([]);
  const [feedbackRound, setFeedbackRound] = useState<InterviewType>("screening");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [mic, setMic] = useState<{ state: "idle" | "testing" | "ok" | "blocked"; level: number }>({ state: "idle", level: 0 });
  const avatarRef = useRef<AvatarHandle>(null);

  const persona = PERSONAS[ROUNDS[type].persona];
  const getHead = useCallback((): TalkingHead | null => avatarRef.current?.head ?? null, []);
  // The interviewer's voice: the natural one once loaded, else the browser's
  // best British voice for this interviewer, else captions.
  const voice = useMemo<InterviewVoice | null>(() => {
    if (voiceChoice === "silent") return silentVoice;
    if (voiceChoice === "kokoro") return kokoroVoice;
    if (typeof window !== "undefined" && !window.speechSynthesis) return silentVoice;
    return browserVoices ? browserVoice(pickBrowserVoice(browserVoices, persona.gender)) : null;
  }, [voiceChoice, kokoroVoice, browserVoices, persona.gender]);

  // ── Load the application, past interviews, usage, device capabilities ─────
  useEffect(() => {
    let active = true;
    async function run() {
      if (!UUID_RE.test(id)) { setLoad("missing"); return; }
      try {
        const [appRes, listRes] = await Promise.all([
          fetch(`/api/applications?id=${encodeURIComponent(id)}`),
          fetch(`/api/interview?applicationId=${encodeURIComponent(id)}`),
        ]);
        const app = await appRes.json().catch(() => ({}));
        const list = await listRes.json().catch(() => ({}));
        if (!active) return;
        if (appRes.status === 401) { setLoad("expired"); return; }
        if (appRes.status === 404) { setLoad("missing"); return; }
        if (!appRes.ok) { setError(app.error || "Couldn't load this application."); setLoad("error"); return; }
        const a = app.application as Row;
        setRow({ id: a.id, company_name: a.company_name, role: a.role, status: a.status, job_description: a.job_description });
        setType(defaultRound(a.status));
        setPast(Array.isArray(list.interviews) ? list.interviews : []);
        if (list.errorType === "needs_migration") { setError(list.warning); setErrorType("needs_migration"); }
        setLoad("ready");
      } catch {
        if (!active) return;
        setError("Couldn't reach the server. Check your connection and try again.");
        setLoad("error");
      }
      getUsage().then((u) => { if (active) setUsage(u); });
      detectCaps().then((c) => {
        if (!active) return;
        setCaps(c);
        setVoiceChoice(suggestedVoice(c));
      });
    }
    void run();
    return () => { active = false; };
  }, [id]);

  // ── Voices ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    let active = true;
    loadBrowserVoices().then((vs) => { if (active) setBrowserVoices(vs); });
    return () => { active = false; };
  }, []);
  // The natural voice switches speaker with the round (Emma's, Daniel's).
  useEffect(() => {
    if (voiceChoice === "kokoro") kokoroVoice?.setSpeaker?.(persona.kokoroVoice);
  }, [voiceChoice, kokoroVoice, persona.kokoroVoice]);

  async function loadNatural() {
    const head = getHead();
    if (!head || !caps) return;
    setKokoro({ state: "loading", pct: 0 });
    try {
      const { voice: v, realtimeFactor } = await loadKokoroVoice({
        voice: persona.kokoroVoice,
        voices: Object.values(PERSONAS).map((p) => p.kokoroVoice),
        audioCtx: head.audioCtx,
        fp16: caps.shaderF16,
        onProgress: (pct) => setKokoro({ state: "loading", pct }),
      });
      if (realtimeFactor < MIN_REALTIME) {
        setKokoro({ state: "too_slow", factor: realtimeFactor });
        setVoiceChoice("browser");
        return;
      }
      setKokoroVoice(v);
      setKokoro({ state: "ready", factor: realtimeFactor });
    } catch (err) {
      setKokoro({ state: "failed", reason: err instanceof Error ? err.message : "The natural voice couldn't load." });
      setVoiceChoice("browser");
    }
  }

  // ── Microphone check: permission early, and a level meter ──────────────────
  async function testMic() {
    setMic({ state: "testing", level: 0 });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const until = performance.now() + 4000;
      await new Promise<void>((resolve) => {
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
          peak = Math.max(peak, level);
          setMic({ state: "testing", level });
          if (performance.now() < until) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      setMic({ state: "ok", level: peak });
    } catch {
      setMic({ state: "blocked", level: 0 });
      setAnswerMode("typed");
    }
  }

  async function sample() {
    const v = voice;
    if (!v) return;
    v.stop(getHead());
    await v.speak(`Hi, I'm ${persona.firstName}. I'll be interviewing you today.`, getHead());
  }

  async function start() {
    if (!row || starting) return;
    setStarting(true);
    setError("");
    setErrorType(null);
    try {
      // Browsers only let audio play after a click: wake the avatar's audio now.
      await getHead()?.audioCtx.resume().catch(() => {});
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", applicationId: row.id, type }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { setLoad("expired"); return; }
      if (!res.ok) {
        setError(data.error || "Couldn't start the interview.");
        setErrorType(data.errorType ?? null);
        return;
      }
      setStarted(data.interview as StartedInterview);
      setPhase("room");
      getUsage().then(setUsage);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  const onFinished = useCallback((fb: InterviewFeedback, qs: unknown[]) => {
    setFeedback(fb);
    setQuestions(Array.isArray(qs) ? (qs as { id: string; text: string; intent?: string }[]) : []);
    setFeedbackRound((started?.type as InterviewType) ?? type);
    setPhase("feedback");
    fetch(`/api/interview?applicationId=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => { if (Array.isArray(d.interviews)) setPast(d.interviews); }).catch(() => {});
  }, [id, started, type]);

  async function viewPast(p: Past) {
    const res = await fetch(`/api/interview?id=${encodeURIComponent(p.id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.interview?.feedback) { setError(data.error || "That interview has no feedback yet."); return; }
    setFeedback(data.interview.feedback);
    setQuestions(data.interview.questions ?? []);
    setFeedbackRound(p.type as InterviewType);
    setPhase("feedback");
  }

  // The avatar rests while the feedback is open.
  useEffect(() => {
    const head = getHead();
    if (!head) return;
    if (phase === "feedback") head.stop();
    else head.start();
  }, [phase, getHead]);

  const quotaExhausted = !!usage && !usage.unlimited && usage.dailyUsed >= usage.dailyLimit;
  const remaining = usage ? Math.max(0, usage.dailyLimit - usage.dailyUsed) : null;
  const hasJd = !!row?.job_description?.trim();
  const round = ROUNDS[type];

  function renderError() {
    if (!error) return null;
    const notice = (title: string, body: string, href?: string, cta?: string) => (
      <div className="limitNotice" role="alert">
        <div className="limitNotice__title">{title}</div>
        <div className="limitNotice__body">{body}</div>
        {href && <Button href={href} className="limitNotice__cta">{cta}</Button>}
      </div>
    );
    switch (errorType) {
      case "needs_cv": return notice("Save your master CV first.", "The interviewer's questions are built from it.", "/customize", "Go to Customize →");
      case "needs_jd": return notice("Add the job description first.", "The interview is built from it. Paste it into this application in the tracker, then come back.", "/applications", "Open the tracker →");
      case "needs_migration": return notice("Mock interviews aren't switched on yet.", error);
      case "needs_keys": return notice("Your 3 free tailors are used up.", "Add your own key to keep going — it takes 2 minutes and the tool stays free.", "/settings", "Add your key in Settings →");
      case "needs_openrouter_key": return notice("Your Gemini key can't run mock interviews.", "Once your free Claude credits are used, interviews run on an OpenRouter key. Add one in Settings to continue.", "/settings", "Add an OpenRouter key →");
      case "key_decrypt_failed": return notice("Your API key needs to be re-entered.", "Your saved key can no longer be read. Please go to Settings and replace it.", "/settings", "Go to Settings →");
      case "user_key_limit": return notice("Your key's daily limit is reached.", "Its free quota resets daily — come back tomorrow to continue.");
      default: return <div className="limitNotice" role="alert">{error}</div>;
    }
  }

  const voiceNote =
    kokoro.state === "too_slow" ? `The natural voice is too slow on this device (${kokoro.factor.toFixed(1)}× real time), so ${persona.firstName} will use your browser's British voice.` :
    kokoro.state === "failed" ? `The natural voice couldn't load (${kokoro.reason}), so ${persona.firstName} will use your browser's British voice.` : "";

  return (
    <main className="page">
      <div className="container interviewPage">
        <AppHeader
          title="Mock interview"
          tagline={row ? `${row.role} at ${row.company_name} — a realistic UK interview, out loud, built from this job and the CV you sent.` : "A realistic UK interview, out loud, built from the job and the CV you sent."}
        />
        <p className="prepBack">
          <Link href="/applications" className="inlineLink">← Back to applications</Link>
          {row && <> · <Link href={`/applications/${row.id}/prep`} className="inlineLink">Prep pack</Link></>}
        </p>

        {load === "loading" && <Card><Skeleton lines={4} label="Loading the interview room" /></Card>}
        {load === "expired" && (
          <Card>
            <StatusText role="alert">{SESSION_EXPIRED}</StatusText>
            <div className="actions"><Button href={`/auth/login?next=/applications/${id}/interview`}>Sign in</Button></div>
          </Card>
        )}
        {load === "missing" && (
          <Card>
            <EmptyState title="This application doesn't exist" actions={<Button href="/applications">Back to applications</Button>}>It may have been deleted, or the link is wrong.</EmptyState>
          </Card>
        )}
        {load === "error" && <Card><StatusText role="alert">{error}</StatusText></Card>}
        {load === "ready" && row && !hasJd && (
          <Card>
            <EmptyState title="Add the job description first" actions={<Button href="/applications">Open the tracker</Button>}>
              The interviewer&apos;s questions come from the job description. Paste it into this application in the tracker, then come back.
            </EmptyState>
          </Card>
        )}

        {load === "ready" && row && hasJd && (
          <>
            {phase === "feedback" && feedback && (
              <FeedbackView feedback={feedback} questions={questions} roundLabel={ROUNDS[feedbackRound].label} onAgain={() => { setPhase("setup"); setStarted(null); }} />
            )}

            <div className={`interviewLayout${phase === "room" ? " interviewLayout--room" : ""}`} hidden={phase === "feedback"}>
              <div className="interviewLayout__stage">
                <AvatarStage
                  ref={avatarRef}
                  url={persona.avatar}
                  gender={persona.gender}
                  name={persona.name}
                  role={round.interviewerRole}
                  reducedMotion={!!caps?.reducedMotion}
                  speaking={speaking}
                  onReady={() => setHeadReady(true)}
                  onFailed={() => setHeadReady(false)}
                />
              </div>

              <div className="interviewLayout__side">
                {phase === "room" && started && (
                  <InterviewRoom
                    key={started.id}
                    interview={started}
                    voice={voice ?? silentVoice}
                    getHead={getHead}
                    typedOnly={answerMode === "typed"}
                    silenceWindowMs={silenceMs}
                    onSpeakingChange={setSpeaking}
                    onFinished={onFinished}
                    onLeave={() => { setPhase("setup"); setStarted(null); }}
                  />
                )}

                {phase === "setup" && (
                  <>
                    <Card>
                      <fieldset className="interviewRounds">
                        <legend className="label">Choose the round</legend>
                        {INTERVIEW_TYPES.map((t) => {
                          const r = ROUNDS[t];
                          const p = PERSONAS[r.persona];
                          return (
                            <label key={t} className="interviewRound" data-selected={t === type ? "true" : "false"}>
                              <input type="radio" name="round" value={t} checked={t === type} onChange={() => setType(t)} />
                              <span className="interviewRound__body">
                                <span className="interviewRound__title">{r.label}<span className="interviewRound__meta">~{r.minutes} min · {r.fixedBefore.length + r.modelQuestions + r.fixedAfter.length} questions</span></span>
                                <span className="interviewRound__summary">{r.summary}</span>
                                <span className="interviewRound__who">With {p.name}, {r.interviewerRole}</span>
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                    </Card>

                    <Card>
                      <div className="label">Voice and microphone</div>
                      <div className="interviewSetting">
                        <span className="interviewSetting__name">{persona.firstName}&apos;s voice</span>
                        <div className="interviewSetting__options" role="radiogroup" aria-label="Interviewer voice">
                          <label><input type="radio" name="voice" checked={voiceChoice === "browser"} onChange={() => setVoiceChoice("browser")} /> Your browser&apos;s British voice (instant)</label>
                          <label><input type="radio" name="voice" checked={voiceChoice === "kokoro"} onChange={() => setVoiceChoice("kokoro")} disabled={!caps?.webgpu} /> Natural British voice{caps?.webgpu ? "" : " (needs WebGPU — not on this browser)"}</label>
                          <label><input type="radio" name="voice" checked={voiceChoice === "silent"} onChange={() => setVoiceChoice("silent")} /> Captions only</label>
                        </div>
                        {voiceChoice === "kokoro" && kokoro.state !== "ready" && (
                          <div className="interviewSetting__detail">
                            {kokoro.state === "loading" ? (
                              <span role="status">Downloading the voice once (about 160–330 MB, then cached) · {kokoro.pct}%</span>
                            ) : (
                              <>
                                <span>Downloads about 160–330 MB once, then it&apos;s cached. A quick speed test decides whether this device can keep up.</span>
                                <Button variant="secondary" onClick={loadNatural} disabled={!headReady}>Load the natural voice</Button>
                              </>
                            )}
                          </div>
                        )}
                        {kokoro.state === "ready" && voiceChoice === "kokoro" && <div className="interviewSetting__detail">Loaded · {kokoro.factor.toFixed(1)}× real time on this device.</div>}
                        {voiceNote && <p className="interviewNotice" role="status">{voiceNote}</p>}
                        {voice && voiceChoice !== "silent" && (
                          <Button variant="ghost" onClick={sample}>Hear {persona.firstName}</Button>
                        )}
                      </div>

                      <div className="interviewSetting">
                        <span className="interviewSetting__name">Your answers</span>
                        <div className="interviewSetting__options" role="radiogroup" aria-label="How you answer">
                          <label><input type="radio" name="answer" checked={answerMode === "voice"} onChange={() => setAnswerMode("voice")} disabled={!caps?.speechRecognition} /> Speak{caps && !caps.speechRecognition ? " (this browser can't transcribe speech — use Chrome or Edge)" : ""}</label>
                          <label><input type="radio" name="answer" checked={answerMode === "typed"} onChange={() => setAnswerMode("typed")} /> Type</label>
                        </div>
                        {answerMode === "voice" && (
                          <div className="interviewSetting__detail">
                            <Button variant="secondary" onClick={testMic} disabled={mic.state === "testing"}>{mic.state === "testing" ? "Say something…" : "Test your microphone"}</Button>
                            {mic.state !== "idle" && (
                              <span className="interviewMeter" aria-hidden="true"><span className="interviewMeter__fill" style={{ transform: `scaleX(${mic.level})` }} /></span>
                            )}
                            {mic.state === "ok" && <span role="status">{mic.level > 0.05 ? "Heard you." : "Very quiet — check your microphone."}</span>}
                            {mic.state === "blocked" && <span role="status">The microphone is blocked. Allow it in the address bar, or type your answers.</span>}
                            <label className="interviewSetting__inline">
                              Send after a pause of{" "}
                              <select value={silenceMs} onChange={(e) => setSilenceMs(Number(e.target.value))}>
                                <option value={2000}>2 seconds</option>
                                <option value={3000}>3 seconds</option>
                                <option value={5000}>5 seconds</option>
                              </select>
                            </label>
                          </div>
                        )}
                        <p className="fitEvidence">
                          {answerMode === "voice"
                            ? "Chrome and Edge send your voice to Google or Microsoft to turn it into text; Jobhuntz never receives or stores audio, only the text. Typing sends nothing extra."
                            : "Your typed answers are saved with this interview so you can review them."}
                        </p>
                      </div>
                    </Card>

                    <Card className="interviewStart">
                      {renderError()}
                      <p className="cvHelp">
                        {round.label} with {persona.name} · about {round.minutes} minutes. Interviews stay private to you and are deleted with the application.
                      </p>
                      <div className="actions">
                        <Button onClick={start} disabled={starting || quotaExhausted || errorType === "needs_migration" || (voiceChoice === "kokoro" && !voice)} data-interview-start>
                          {starting ? "Preparing your interviewer…" : "Start interview · uses 1 credit"}
                        </Button>
                        {remaining !== null && !usage?.unlimited && <span className="cvHelp">{remaining} left today</span>}
                      </div>
                      {quotaExhausted && <p className="cvHelp">You&apos;ve used today&apos;s credits. Add your own key in Settings to keep going.</p>}
                    </Card>

                    {past.length > 0 && (
                      <Card>
                        <div className="label">Your interviews for this job</div>
                        <ul className="interviewPast">
                          {past.map((p) => (
                            <li key={p.id}>
                              <span>{ROUNDS[p.type as InterviewType]?.label ?? p.type} · {formatDate(p.created_at)}</span>
                              {p.readout ? <span className="interviewBand" data-band={p.readout.band}>{p.readout.label}</span> : <span className="cvHelp">{p.status === "active" ? "Not finished" : ""}</span>}
                              {p.readout && <Button variant="ghost" onClick={() => viewPast(p)}>View feedback</Button>}
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
