"use client";

import type { CSSProperties } from "react";

// The default interviewer stage (Chunk 30): a video-call tile, not a 3D face.
// Modern voice and interview tools (ChatGPT voice, ElevenLabs, Google Interview
// Warmup, Yoodli) use a reactive orb or ring with clear states and put the
// question text first, so a monogram with two rings reads as craft where a
// low-poly 3D head read as a game asset. Purely presentational: page.tsx owns
// the state and the levels and passes them down. Imports nothing but React
// types, so node:test can render it.

export type CallAccent = "amber" | "teal";
export type CallState = "idle" | "speaking" | "listening" | "thinking";

type Props = {
  name: string;
  role: string;
  initials: string;
  accent: CallAccent;
  state: CallState;
  captionText: string;
  /** The interviewer's audio level, 0..1, driving the speaking ring. */
  audioLevel: number;
  /** Your microphone level, 0..1, for the meter under the tile while you answer. */
  micLevel: number;
  reducedMotion: boolean;
};

const MIC_SEGMENTS = 12;

function chipText(state: CallState, firstName: string): string {
  switch (state) {
    case "speaking": return `${firstName} is speaking`;
    case "listening": return "Listening…";
    case "thinking": return "Thinking…";
    default: return `${firstName} is ready`;
  }
}

export default function CallStage({ name, role, initials, accent, state, captionText, audioLevel, micLevel, reducedMotion }: Props) {
  const firstName = name.split(" ")[0] || name;
  // Only the animated build carries the ring animations; reduced motion omits
  // the class so no scale or rotation ever runs (the test checks this).
  const rootClass = `callStage${reducedMotion ? "" : " callStage--animated"}`;
  const level = Number.isFinite(audioLevel) ? Math.min(1, Math.max(0, audioLevel)) : 0;
  const lit = Math.round(Math.min(1, Math.max(0, micLevel || 0)) * MIC_SEGMENTS);

  return (
    <div className="callStageWrap">
      <div
        className={rootClass}
        data-accent={accent}
        data-state={state}
        data-reduced-motion={reducedMotion ? "true" : "false"}
        style={{ "--audio-level": level } as CSSProperties}
      >
        <div className="callStage__chip" role="status" aria-live="polite">
          <span className="callStage__dot" aria-hidden="true" />
          <span className="callStage__chipText">{chipText(state, firstName)}</span>
        </div>

        <div className="callStage__center">
          <div className="callStage__rings" aria-hidden="true">
            <span className="callStage__ring callStage__ring--outer" />
            <span className="callStage__ring callStage__ring--inner" />
            <svg className="callStage__dashed" viewBox="0 0 132 132" aria-hidden="true">
              <circle cx="66" cy="66" r="64" />
            </svg>
          </div>
          <div className="callStage__monogram" aria-hidden="true">{initials}</div>
        </div>

        <div className="callStage__foot">
          <p className="callStage__caption" aria-hidden="true">{captionText}</p>
          <div className="callStage__nameplate">
            <span className="callStage__name">{name}</span>
            <span className="callStage__role">{role}</span>
          </div>
        </div>

        <span className="srOnly">{`${name}, ${role}, your interviewer. ${chipText(state, firstName)}.`}</span>
      </div>

      {state === "listening" && (
        <div className="callMeter" aria-hidden="true" data-level={lit}>
          <span className="callMeter__label">Your microphone</span>
          <span className="callMeter__segments">
            {Array.from({ length: MIC_SEGMENTS }, (_, i) => (
              <span key={i} className="callMeter__seg" data-on={i < lit ? "true" : "false"} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
