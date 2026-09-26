// The waiting-room games shown while a tailor runs (app/TailorGamePopup).
// Framework-free and import-free so node:test runs the simulations: each game
// keeps its physics in update() and its drawing in render(), and draws in one
// logical view the popup scales to the screen.
//
// The games carry no text about jobs, recruitment or careers — a number for
// the score is the only text drawn on the canvas.

export const VIEW_W = 480;
export const VIEW_H = 320;
// The simulation steps at a fixed 60 Hz whatever the display's refresh rate.
export const STEP = 1 / 60;

export type GameKind = "platformer" | "flyer";

// Filled by the popup from the keyboard and the touch buttons. `jumpPressed`
// is the press edge: one full jump or one flap per press, however short the
// tap (a phone tap is ~100 ms). The popup clears it after each step.
export type InputState = {
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
};
export const emptyInput = (): InputState => ({ left: false, right: false, jumpPressed: false });

// Read by the popup from the --game-* tokens in globals.css.
export type Palette = {
  skyTop: string;
  skyBottom: string;
  hillFar: string;
  hillNear: string;
  cloud: string;
  ground: string;
  groundTop: string;
  platform: string;
  platformTop: string;
  block: string;
  blockEdge: string;
  spike: string;
  wall: string;
  wallEdge: string;
  suit: string;
  suitShade: string;
  shirt: string;
  tie: string;
  skin: string;
  hair: string;
  shoe: string;
  hud: string;
  hudShadow: string;
  font: string;
};

export interface Game {
  readonly kind: GameKind;
  update(dt: number, input: InputState): void;
  render(ctx: CanvasRenderingContext2D, palette: Palette): void;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A seeded generator (mulberry32): the same seed builds the same level, so
// the tests can hold the level generator to its reachability rules.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Steps the simulation at STEP and draws once per animation frame. A long
// frame (a background tab, a slow device) is clamped rather than replayed,
// so the game never fast-forwards. Returns stop().
export function runLoop(
  step: (dt: number) => void,
  draw: () => void,
  raf: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id)
): () => void {
  let last = -1;
  let acc = 0;
  let id = 0;
  let running = true;
  const frame = (t: number) => {
    if (!running) return;
    if (last < 0) last = t;
    acc += Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;
    draw();
    if (running) id = raf(frame);
  };
  id = raf(frame);
  return () => {
    running = false;
    caf(id);
  };
}

// Sky, far and near hills and clouds, scrolled by `offset` (world pixels).
export function drawBackdrop(ctx: CanvasRenderingContext2D, pal: Palette, offset: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Clouds drift at a tenth of the speed.
  ctx.fillStyle = pal.cloud;
  const cloudOffset = offset * 0.12;
  const first = Math.floor(cloudOffset / 170) - 1;
  for (let i = first; i < first + 5; i++) {
    const cx = i * 170 - cloudOffset + ((i * 53) % 60);
    const cy = 40 + ((i * 37) % 50);
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.arc(cx + 16, cy - 6, 17, 0, Math.PI * 2);
    ctx.arc(cx + 34, cy, 13, 0, Math.PI * 2);
    ctx.fill();
  }

  hills(ctx, offset * 0.2, 214, 26, 0.012, pal.hillFar);
  hills(ctx, offset * 0.45, 244, 18, 0.021, pal.hillNear);
}

function hills(ctx: CanvasRenderingContext2D, offset: number, baseY: number, amp: number, freq: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let sx = 0; sx <= VIEW_W; sx += 8) {
    const wx = sx + offset;
    ctx.lineTo(sx, baseY - amp * (0.6 * Math.sin(wx * freq) + 0.4 * Math.sin(wx * freq * 2.3 + 1.7)));
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

// The only text on a canvas: a number (and a unit), top-right or centred.
export function drawScore(ctx: CanvasRenderingContext2D, pal: Palette, text: string, align: "right" | "center"): void {
  ctx.font = `700 ${align === "center" ? 28 : 16}px ${pal.font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const x = align === "center" ? VIEW_W / 2 : VIEW_W - 14;
  ctx.lineWidth = 4;
  ctx.strokeStyle = pal.hudShadow;
  ctx.strokeText(text, x, 12);
  ctx.fillStyle = pal.hud;
  ctx.fillText(text, x, 12);
}
