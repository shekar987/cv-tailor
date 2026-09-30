// The parts of TalkingHead (MIT, vendored) the mock interview uses; the
// source ships no types.
export class TalkingHead {
  constructor(node: HTMLElement, opt?: Record<string, unknown>);
  audioCtx: AudioContext;
  isSpeaking: boolean;
  lipsync: Record<string, unknown>;
  /** three.js WebGLRenderer and Scene: only the fields the stage tunes. */
  renderer: { toneMapping: number; toneMappingExposure: number };
  scene: { environmentIntensity: number };
  showAvatar(avatar: Record<string, unknown>, onprogress?: ((ev: ProgressEvent) => void) | null): Promise<void>;
  speakAudio(r: Record<string, unknown>, opt?: Record<string, unknown> | null, onsubtitles?: ((word: string) => void) | null): void;
  speakMarker(onmarker: () => void): Promise<void>;
  stopSpeaking(): void;
  setMood(mood: string): void;
  lookAtCamera(ms: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}
