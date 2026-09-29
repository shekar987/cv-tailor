"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TalkingHead } from "@/vendor/talkinghead/talkinghead.mjs";

// The interviewer: a TalkingHead 1.7 avatar (MIT) — a real-time 3D figure with
// eye contact, blinking, idle motion and lip-sync. Loaded in the browser only.
// TalkingHead normally imports its lip-sync modules by a computed path the
// bundler can't follow, so the English one is imported here and registered
// by hand. When 3D can't run, the page shows the portrait card instead.

export type AvatarHandle = { head: TalkingHead | null };

type Props = {
  url: string;
  gender: "female" | "male";
  name: string;
  role: string;
  reducedMotion: boolean;
  speaking: boolean;
  onReady?: (head: TalkingHead) => void;
  onFailed?: (reason: string) => void;
};

const AvatarStage = forwardRef<AvatarHandle, Props>(function AvatarStage({ url, gender, name, role, reducedMotion, speaking, onReady, onFailed }, ref) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<TalkingHead | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [progress, setProgress] = useState(0);
  const onReadyRef = useRef(onReady);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onReadyRef.current = onReady;
    onFailedRef.current = onFailed;
  });

  useImperativeHandle(ref, () => ({ get head() { return headRef.current; } }), []);

  useEffect(() => {
    let cancelled = false;
    const node = nodeRef.current;
    if (!node) return;
    async function load() {
      try {
        const [{ TalkingHead }, { LipsyncEn }] = await Promise.all([
          import("@/vendor/talkinghead/talkinghead.mjs"),
          import("@/vendor/talkinghead/lipsync-en.mjs"),
        ]);
        if (cancelled || !node) return;
        const head = new TalkingHead(node, {
          ttsEndpoint: null,
          lipsyncModules: [],
          // Head and shoulders, like a video call: a little closer and higher
          // than TalkingHead's "upper" view.
          ...(window.matchMedia("(max-width: 640px)").matches ? { cameraView: "head" } : { cameraView: "upper", cameraDistance: -0.3, cameraY: 0.08 }),
          modelFPS: 30,
          cameraRotateEnable: false,
          modelMovementFactor: reducedMotion ? 0 : 1,
          avatarIdleEyeContact: 0.6,
          avatarSpeakingEyeContact: 0.85,
          lightAmbientIntensity: 2.2,
          lightDirectIntensity: 18,
        });
        head.lipsync.en = new LipsyncEn();
        await head.showAvatar({ url, body: gender === "female" ? "F" : "M", avatarMood: "neutral", lipsyncLang: "en" }, (ev) => {
          if (ev.lengthComputable && ev.total > 0) setProgress(Math.round((ev.loaded / ev.total) * 100));
        });
        if (cancelled) {
          head.dispose();
          return;
        }
        headRef.current = head;
        setState("ready");
        onReadyRef.current?.(head);
      } catch (err) {
        if (cancelled) return;
        setState("failed");
        onFailedRef.current?.(err instanceof Error ? err.message : "The 3D interviewer couldn't load.");
      }
    }
    setState("loading");
    setProgress(0);
    void load();
    const pause = () => {
      if (!headRef.current) return;
      if (document.visibilityState === "visible") headRef.current.start();
      else headRef.current.stop();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", pause);
      const head = headRef.current;
      headRef.current = null;
      if (head) {
        head.stopSpeaking();
        head.dispose();
      }
      node.replaceChildren();
    };
  }, [url, gender, reducedMotion]);

  return (
    <div className="interviewStage" data-speaking={speaking ? "true" : "false"} data-avatar-state={state}>
      <div ref={nodeRef} className="interviewStage__canvas" aria-hidden="true" />
      {state !== "ready" && (
        <div className="interviewStage__poster">
          <div className="interviewStage__monogram" aria-hidden="true">{name.split(" ").map((p) => p[0]).join("")}</div>
          <div className="interviewStage__posterText">
            {state === "loading" ? `Setting up the room${progress ? ` · ${progress}%` : "…"}` : "The 3D interviewer couldn't load on this device — the interview works the same with captions."}
          </div>
        </div>
      )}
      <div className="interviewStage__nameplate">
        <span className="interviewStage__name">{name}</span>
        <span className="interviewStage__role">{role}</span>
      </div>
      <span className="srOnly">{`${name}, ${role}, your interviewer${speaking ? ", speaking" : ""}.`}</span>
    </div>
  );
});

export default AvatarStage;
