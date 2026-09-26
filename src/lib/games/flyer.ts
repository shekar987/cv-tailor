// Game 2: a flying game. The figure falls under gravity; each tap, click or
// Space flaps it upward, through narrow gaps in walls that scroll in from
// the right. A crash flashes, then the game waits for the next flap.
import { VIEW_W, VIEW_H, clamp, makeRng, drawBackdrop, drawScore, type Game, type InputState, type Palette } from "./core.ts";
import { drawEmployer } from "./employer.ts";

export const FLY_GRAVITY = 1500;
export const FLAP_V = 430;
export const MAX_FALL = 560;
export const WALL_W = 46;
export const WALL_SPACING = 210;
export const FLOOR_Y = VIEW_H - 26;
export const PLAYER_X = 130;
// The collision box around the figure's centre; FIGURE_H is the drawing.
export const HALF_W = 12;
export const HALF_H = 20;
export const FIGURE_H = 54;
// Gaps start at GAP_START and narrow to GAP_MIN as the score rises.
export const GAP_START = 132;
export const GAP_MIN = 110;
// A gap never sits closer than EDGE to the ceiling or the floor, and its
// centre moves at most MAX_SHIFT from the previous wall's.
export const EDGE = 26;
export const MAX_SHIFT = 110;
export const CRASH_TIME = 0.8;
const SPEED = 140;
const READY_Y = VIEW_H * 0.45;

export type Wall = { x: number; gapY: number; gap: number; passed: boolean };

export class Flyer implements Game {
  readonly kind = "flyer" as const;
  state: "ready" | "playing" | "crashed" = "ready";
  y = READY_Y;
  vy = 0;
  flap = 0;
  phase = 0;
  score = 0;
  best = 0;
  crashes = 0;
  walls: Wall[] = [];
  private t = 0;
  private scroll = 0;
  private crashFor = 0;
  private rng: () => number;

  constructor(seed: number = Date.now()) {
    this.rng = makeRng(seed);
  }

  update(dt: number, input: InputState): void {
    this.t += dt;
    this.phase += dt * 7;
    this.flap = Math.max(0, this.flap - dt * 3);

    if (this.state === "crashed") {
      this.crashFor -= dt;
      this.vy = Math.min(this.vy + FLY_GRAVITY * dt, MAX_FALL);
      this.y = Math.min(this.y + this.vy * dt, FLOOR_Y - HALF_H);
      if (this.crashFor <= 0) this.reset();
      return;
    }
    if (this.state === "ready") {
      // Hovering until the first flap; the scenery keeps drifting.
      this.y = READY_Y + Math.sin(this.t * 3) * 6;
      this.scroll += SPEED * 0.5 * dt;
      if (input.jumpPressed) {
        this.state = "playing";
        this.flapNow();
      }
      return;
    }

    if (input.jumpPressed) this.flapNow();
    this.vy = Math.min(this.vy + FLY_GRAVITY * dt, MAX_FALL);
    this.y += this.vy * dt;
    // The ceiling stops the figure; only walls and the floor end a run.
    if (this.y - HALF_H < 0) {
      this.y = HALF_H;
      this.vy = Math.max(0, this.vy);
    }

    const speed = SPEED + Math.min(40, this.score * 2);
    this.scroll += speed * dt;
    for (const w of this.walls) w.x -= speed * dt;
    const last = this.walls[this.walls.length - 1];
    if (!last || last.x < VIEW_W - WALL_SPACING) this.walls.push(this.nextWall(last));
    this.walls = this.walls.filter((w) => w.x + WALL_W > -8);
    for (const w of this.walls) {
      if (!w.passed && w.x + WALL_W < PLAYER_X - HALF_W) {
        w.passed = true;
        this.score++;
        this.best = Math.max(this.best, this.score);
      }
    }
    if (this.y + HALF_H >= FLOOR_Y || this.walls.some((w) => this.hits(w))) this.crash();
  }

  private flapNow(): void {
    this.vy = -FLAP_V;
    this.flap = 1;
  }

  private nextWall(prev: Wall | undefined): Wall {
    const gap = Math.max(GAP_MIN, GAP_START - this.score * 2);
    const from = prev ? prev.gapY : READY_Y;
    const gapY = clamp(from + (this.rng() * 2 - 1) * MAX_SHIFT, EDGE + gap / 2, FLOOR_Y - EDGE - gap / 2);
    return { x: prev ? Math.max(VIEW_W + 8, prev.x + WALL_SPACING) : VIEW_W + 8, gapY, gap, passed: false };
  }

  hits(w: Wall): boolean {
    if (PLAYER_X + HALF_W <= w.x || PLAYER_X - HALF_W >= w.x + WALL_W) return false;
    return this.y - HALF_H < w.gapY - w.gap / 2 || this.y + HALF_H > w.gapY + w.gap / 2;
  }

  private crash(): void {
    this.state = "crashed";
    this.crashFor = CRASH_TIME;
    this.vy = -180;
    this.crashes++;
  }

  private reset(): void {
    this.state = "ready";
    this.walls = [];
    this.score = 0;
    this.y = READY_Y;
    this.vy = 0;
    this.flap = 0;
  }

  render(ctx: CanvasRenderingContext2D, pal: Palette): void {
    drawBackdrop(ctx, pal, this.scroll);
    for (const w of this.walls) drawWall(ctx, w, pal);

    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, FLOOR_Y, VIEW_W, VIEW_H - FLOOR_Y);
    ctx.fillStyle = pal.groundTop;
    ctx.fillRect(0, FLOOR_Y, VIEW_W, 6);
    ctx.fillStyle = pal.platform;
    const off = this.scroll % 24;
    for (let x = -off; x < VIEW_W; x += 24) ctx.fillRect(x, FLOOR_Y + 13, 12, 4);

    const tilt = this.state === "ready" ? 0 : clamp(this.vy / 900, -0.35, 0.55);
    const flap = this.state === "ready" ? 0.35 + 0.3 * Math.sin(this.t * 6) : this.flap;
    drawEmployer(ctx, PLAYER_X, this.y + FIGURE_H / 2, FIGURE_H, { mode: "fly", phase: this.phase, stride: 0, airborne: true, vy: this.vy, flap, facing: 1 }, pal, tilt);

    if (this.state === "ready") drawUpChevron(ctx, pal, PLAYER_X, this.y - FIGURE_H * 0.9, this.t);
    if (this.state === "crashed") {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.crashFor / CRASH_TIME) * 0.35;
      ctx.fillStyle = pal.cloud;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
    if (this.state !== "ready") drawScore(ctx, pal, String(this.score), "center");
  }
}

function drawWall(ctx: CanvasRenderingContext2D, w: Wall, pal: Palette): void {
  const top = w.gapY - w.gap / 2;
  const bottom = w.gapY + w.gap / 2;
  ctx.fillStyle = pal.wall;
  ctx.fillRect(w.x, 0, WALL_W, top);
  ctx.fillRect(w.x, bottom, WALL_W, FLOOR_Y - bottom);
  // Caps at the gap's edges, a little wider than the wall.
  ctx.fillStyle = pal.wallEdge;
  ctx.fillRect(w.x - 3, top - 12, WALL_W + 6, 12);
  ctx.fillRect(w.x - 3, bottom, WALL_W + 6, 12);
  ctx.fillRect(w.x + 7, 0, 5, top - 12);
  ctx.fillRect(w.x + 7, bottom + 12, 5, FLOOR_Y - bottom - 12);
}

// "Flap to start": a chevron bobbing above the figure — no words on the canvas.
function drawUpChevron(ctx: CanvasRenderingContext2D, pal: Palette, x: number, y: number, t: number): void {
  const dy = Math.sin(t * 5) * 3;
  ctx.save();
  ctx.strokeStyle = pal.hud;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + dy + 5);
  ctx.lineTo(x, y + dy - 3);
  ctx.lineTo(x + 8, y + dy + 5);
  ctx.stroke();
  ctx.restore();
}
