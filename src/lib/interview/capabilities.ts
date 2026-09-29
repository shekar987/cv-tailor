// What this browser can do for the mock interview (browser-only).
//
// The voice is chosen per device (the owner's decision after the 29 Sep
// spike): Kokoro in the browser runs at ~0.35x real time on an integrated
// Intel GPU (12–13 s to say a 4.5 s sentence), so only a capable GPU gets the
// natural British Kokoro voice; everything else uses the browser's own
// British voice (Edge: Microsoft Sonia/Ryan/Libby Natural). After Kokoro
// loads, a real test sentence decides (lib/interview/voice).

export type Caps = {
  webgl: boolean;
  webgpu: boolean;
  gpuVendor: string;
  shaderF16: boolean;
  speechRecognition: boolean;
  speechSynthesis: boolean;
  coarsePointer: boolean;
  deviceMemory: number | null;
  reducedMotion: boolean;
};

export type VoiceChoice = "kokoro" | "browser" | "silent";

export async function detectCaps(): Promise<Caps> {
  const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  let webgl = false;
  try {
    webgl = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    webgl = false;
  }
  let webgpu = false, gpuVendor = "", shaderF16 = false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string }; features: Set<string> } | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        gpuVendor = (adapter.info?.vendor ?? "").toLowerCase();
        shaderF16 = adapter.features.has("shader-f16");
      }
    } catch {
      webgpu = false;
    }
  }
  return {
    webgl,
    webgpu,
    gpuVendor,
    shaderF16,
    speechRecognition: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    speechSynthesis: typeof window.speechSynthesis !== "undefined",
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}

// The voice to offer first. Kokoro only where it can keep up: WebGPU on a
// non-integrated GPU (Intel integrated measured far too slow), a desktop
// pointer and enough memory. The user can still choose either.
export function suggestedVoice(c: Caps): VoiceChoice {
  if (c.webgpu && !c.coarsePointer && !/intel/.test(c.gpuVendor) && (c.deviceMemory ?? 8) >= 8) return "kokoro";
  if (c.speechSynthesis) return "browser";
  return "silent";
}
