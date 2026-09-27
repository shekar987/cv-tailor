// The waiting-room games shown while a tailor runs (app/TailorGamePopup).
// Framework-free and import-free so node:test runs the simulations: each game
// keeps its physics in update() and its drawing in render(), and draws in one
// logical view the popup scales to the screen.
//
// Both games happen in the real world at the figure's real scale: he is
// 1.78 m tall and FIGURE_PX tall on the canvas, so PX_PER_M pixels make a
// metre, and every speed, height and force in the games is a real one
// converted with it — gravity is 9.81 m/s², nobody jumps higher than a
// person can, and he only flies with a jetpack on.
//
// The games carry no text about jobs, recruitment or careers — a number for
// the score is the only text drawn on the canvas.

export const VIEW_W = 480;
export const VIEW_H = 320;
// The simulation steps at a fixed 60 Hz whatever the display's refresh rate.
export const STEP = 1 / 60;

export const FIGURE_M = 1.78;
export const PX_PER_M = 36;
export const FIGURE_PX = Math.round(FIGURE_M * PX_PER_M); // 64
export const G = 9.81 * PX_PER_M; // gravity, px/s²
export const m = (metres: number) => metres * PX_PER_M;

export type GameKind = "platformer" | "flyer";

// Filled by the popup from the keyboard, the mouse and the touch buttons.
// `up` is held (the jetpack fires while it is down); `jumpPressed` is the
// press edge — one jump or one climb per press, however short the tap (a
// phone tap is ~100 ms). The popup clears the edge after each step.
export type InputState = {
  left: boolean;
  right: boolean;
  up: boolean;
  jumpPressed: boolean;
};
export const emptyInput = (): InputState => ({ left: false, right: false, up: false, jumpPressed: false });

// Read by the popup from the --game-* tokens in globals.css.
export type Palette = {
  skyTop: string;
  skyBottom: string;
  cloud: string;
  cityFar: string;
  cityNear: string;
  window: string;
  pavement: string;
  pavementTop: string;
  pavementJoint: string;
  kerb: string;
  road: string;
  roadLine: string;
  crate: string;
  crateEdge: string;
  brick: string;
  mortar: string;
  cone: string;
  coneStripe: string;
  puddle: string;
  puddleShine: string;
  stone: string;
  stoneEdge: string;
  roof: string;
  roofEdge: string;
  mast: string;
  beacon: string;
  steel: string;
  steelEdge: string;
  cable: string;
  jetpack: string;
  jetpackShade: string;
  flame: string;
  flameCore: string;
  smoke: string;
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
// the tests can hold the level generators to their reachability rules.
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

// A stable pseudo-random number in [0, 1) for an integer — scenery built from
// it stays put while the view scrolls.
export function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

// Dusk sky, drifting clouds and two layers of city skyline, scrolled by
// `offset` (world pixels) with parallax. `horizonY` is where the nearer
// buildings stand.
export function drawCityBackdrop(ctx: CanvasRenderingContext2D, pal: Palette, offset: number, horizonY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.fillStyle = pal.cloud;
  const cloudOffset = offset * 0.08;
  const first = Math.floor(cloudOffset / 170) - 1;
  for (let i = first; i < first + 5; i++) {
    const cx = i * 170 - cloudOffset + ((i * 53) % 60);
    const cy = 30 + ((i * 37) % 40);
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.arc(cx + 14, cy - 5, 15, 0, Math.PI * 2);
    ctx.arc(cx + 30, cy, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  skyline(ctx, pal, offset * 0.15, horizonY - 14, 58, 150, 90, pal.cityFar, 1, false);
  skyline(ctx, pal, offset * 0.35, horizonY, 70, 120, 60, pal.cityNear, 2, true);
}

// Office blocks side by side: widths, heights and lit windows from hash01,
// so each block keeps its look as it scrolls past.
function skyline(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  offset: number,
  baseY: number,
  width: number,
  maxH: number,
  minH: number,
  color: string,
  layer: number,
  windows: boolean
): void {
  const firstBlock = Math.floor(offset / width) - 1;
  for (let i = firstBlock; i < firstBlock + Math.ceil(VIEW_W / width) + 3; i++) {
    const seed = i * 7 + layer * 1_000_003;
    const w = width * (0.7 + 0.3 * hash01(seed));
    const h = minH + (maxH - minH) * hash01(seed + 1);
    const x = i * width - offset;
    ctx.fillStyle = color;
    ctx.fillRect(x, baseY - h, w - 3, h + 40);
    if (!windows) continue;
    ctx.fillStyle = pal.window;
    for (let wy = baseY - h + 8; wy < baseY - 10; wy += 11) {
      for (let wx = x + 5; wx < x + w - 10; wx += 9) {
        if (hash01(seed + Math.round(wy) * 31 + Math.round(wx - x) * 17) < 0.28) ctx.fillRect(wx, wy, 4, 5);
      }
    }
  }
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
