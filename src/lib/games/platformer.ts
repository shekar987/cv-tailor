// Game 1: a side-scrolling platformer. Run right through a generated level of
// pits, spike strips, blocks, platforms and steps; a fall or a spike puts
// the figure straight back at the start of the last ground it stood on. The
// popup's progress bar runs outside the game, so a respawn never touches it.
import { VIEW_W, VIEW_H, clamp, makeRng, drawBackdrop, drawScore, type Game, type InputState, type Palette } from "./core.ts";
import { drawEmployer } from "./employer.ts";

export const GROUND_Y = 272;
export const GRAVITY = 1900;
// Apex of a full jump: JUMP_V² / (2 · GRAVITY) ≈ 108 px.
export const JUMP_V = 640;
export const RUN_MAX = 170;
// The collision box; the drawn figure is FIGURE_H tall around it.
export const PLAYER_W = 22;
export const PLAYER_H = 54;
export const FIGURE_H = 64;
export const SPIKE_H = 14;
// What the level may ask of a jump: a full-speed jump spans ~115 px and
// rises ~108 px, so these leave room to spare.
export const MAX_GAP = 96;
export const MAX_RISE = 96;
export const RESPAWN_DELAY = 0.45;
export const START_X = 80;
const ACCEL = 1300;
const AIR_ACCEL = 900;
const FRICTION = 1700;
const MAX_FALL = 900;
const COYOTE = 0.08;
const BUFFER = 0.12;
const INVULNERABLE = 1;

export type Solid = { x: number; y: number; w: number; h: number; kind: "ground" | "platform" | "block" };
// Spikes stand on the ground (GROUND_Y), SPIKE_H tall.
export type Spike = { x: number; w: number };

// The level, generated ahead of the camera one feature at a time, each
// ending on solid ground. Features get a little harder over the first thirty.
export class PlatformerWorld {
  solids: Solid[] = [];
  spikes: Spike[] = [];
  end = 0;
  private rng: () => number;
  private count = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed);
    this.ground(0, 560);
    this.end = 560;
  }

  private between(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  private ground(x: number, w: number): void {
    this.solids.push({ x, y: GROUND_Y, w, h: VIEW_H - GROUND_Y + 60, kind: "ground" });
  }

  extendTo(x: number): void {
    while (this.end < x) this.feature();
  }

  prune(before: number): void {
    this.solids = this.solids.filter((s) => s.x + s.w >= before);
    this.spikes = this.spikes.filter((s) => s.x + s.w >= before);
  }

  private feature(): void {
    this.count++;
    const hard = Math.min(1, this.count / 30);
    const x = this.end;
    const pick = this.rng();
    if (pick < 0.24) {
      // A pit, then ground.
      const gap = this.between(44, 56 + (MAX_GAP - 56) * hard);
      const run = this.between(120, 220);
      this.ground(x + gap, run);
      this.end = x + gap + run;
    } else if (pick < 0.44) {
      // Spikes in a run of ground, well clear of both ends.
      const run = this.between(220, 300);
      this.ground(x, run);
      const w = (this.rng() < 0.5 + 0.3 * hard ? 3 : 2) * 14;
      this.spikes.push({ x: x + this.between(80, run - 80 - w), w });
      this.end = x + run;
    } else if (pick < 0.62) {
      // A block to jump over or onto.
      const run = this.between(200, 280);
      this.ground(x, run);
      const h = this.rng() < 0.35 + 0.3 * hard ? 44 : 24;
      this.solids.push({ x: x + this.between(70, run - 110), y: GROUND_Y - h, w: 26, h, kind: "block" });
      this.end = x + run;
    } else if (pick < 0.8) {
      // A wide pit with a floating platform to cross on.
      const pit = this.between(150, 180);
      const w = this.between(64, 88);
      this.solids.push({ x: x + (pit - w) / 2, y: GROUND_Y - this.between(36, 64), w, h: 12, kind: "platform" });
      const run = this.between(130, 200);
      this.ground(x + pit, run);
      this.end = x + pit + run;
    } else {
      // Steps up, a platform above the top step, and down again.
      const run = 320;
      this.ground(x, run);
      const sx = x + 70;
      for (let i = 1; i <= 3; i++) this.solids.push({ x: sx + (i - 1) * 26, y: GROUND_Y - 24 * i, w: 26, h: 24 * i, kind: "block" });
      this.solids.push({ x: sx + 110, y: GROUND_Y - MAX_RISE, w: 70, h: 12, kind: "platform" });
      this.end = x + run;
    }
  }
}

export class Platformer implements Game {
  readonly kind = "platformer" as const;
  readonly world: PlatformerWorld;
  x = START_X;
  y = GROUND_Y;
  vx = 0;
  vy = 0;
  grounded = true;
  facing: 1 | -1 = 1;
  phase = 0;
  camX = 0;
  checkpointX = START_X;
  best = START_X;
  deadFor = 0;
  invulnerable = 0;
  deaths = 0;
  private coyote = 0;
  private buffer = 0;
  private deathX = 0;
  private deathY = 0;

  constructor(seed: number = Date.now()) {
    this.world = new PlatformerWorld(seed);
    this.world.extendTo(VIEW_W * 2);
  }

  private overlaps(s: Solid): boolean {
    return this.x + PLAYER_W / 2 > s.x && this.x - PLAYER_W / 2 < s.x + s.w && this.y - PLAYER_H < s.y + s.h && this.y > s.y;
  }

  update(dt: number, input: InputState): void {
    if (this.deadFor > 0) {
      this.deadFor -= dt;
      if (this.deadFor <= 0) this.respawn();
      return;
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx = clamp(this.vx + dir * (this.grounded ? ACCEL : AIR_ACCEL) * dt, -RUN_MAX, RUN_MAX);
      this.facing = dir > 0 ? 1 : -1;
    } else if (this.grounded) {
      const f = FRICTION * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }

    // A press just before landing (buffer) or just after running off an edge
    // (coyote time) still jumps. Every jump is a full one: a tap-length press
    // on a phone must clear the widest pit the level builds.
    this.buffer = input.jumpPressed ? BUFFER : Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -JUMP_V;
      this.grounded = false;
      this.buffer = 0;
      this.coyote = 0;
    }
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    // Across, then out of anything solid (a platform is solid only from above).
    this.x = Math.max(this.x + this.vx * dt, this.camX + PLAYER_W / 2);
    for (const s of this.world.solids) {
      if (s.kind === "platform" || !this.overlaps(s)) continue;
      this.x = this.x < s.x + s.w / 2 ? s.x - PLAYER_W / 2 : s.x + s.w + PLAYER_W / 2;
      this.vx = 0;
    }

    // Down (or up): land on tops, bump the head on blocks.
    const prevY = this.y;
    this.y += this.vy * dt;
    this.grounded = false;
    for (const s of this.world.solids) {
      if (this.x + PLAYER_W / 2 <= s.x || this.x - PLAYER_W / 2 >= s.x + s.w) continue;
      if (this.vy >= 0 && prevY <= s.y + 0.5 && this.y >= s.y) {
        this.y = s.y;
        this.vy = 0;
        this.grounded = true;
        if (s.kind === "ground") this.checkpointX = Math.max(this.checkpointX, s.x + 30);
      } else if (s.kind !== "platform" && this.vy < 0 && prevY - PLAYER_H >= s.y + s.h - 0.5 && this.y - PLAYER_H < s.y + s.h) {
        this.y = s.y + s.h + PLAYER_H;
        this.vy = 0;
      }
    }

    if (this.invulnerable <= 0) {
      for (const sp of this.world.spikes) {
        if (this.x + PLAYER_W / 2 - 3 > sp.x && this.x - PLAYER_W / 2 + 3 < sp.x + sp.w && this.y > GROUND_Y - SPIKE_H + 4) {
          this.die();
          return;
        }
      }
    }
    if (this.y - PLAYER_H > VIEW_H + 20) {
      this.die();
      return;
    }

    this.phase += Math.abs(this.vx) * dt * 0.085;
    const target = this.x - VIEW_W * 0.35;
    if (target > this.camX) this.camX += (target - this.camX) * Math.min(1, dt * 10);
    this.best = Math.max(this.best, this.x);
    this.world.extendTo(this.camX + VIEW_W + 360);
    this.world.prune(Math.min(this.camX, this.checkpointX) - 240);
  }

  private die(): void {
    this.deadFor = RESPAWN_DELAY;
    this.deaths++;
    this.deathX = this.x;
    this.deathY = Math.min(this.y, VIEW_H - 8);
    this.vx = 0;
    this.vy = 0;
  }

  private respawn(): void {
    this.x = this.checkpointX;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.buffer = 0;
    this.coyote = 0;
    this.deadFor = 0;
    this.invulnerable = INVULNERABLE;
    // The camera may step back, only as far as it needs to show the figure.
    this.camX = clamp(this.x - VIEW_W * 0.35, 0, this.camX);
  }

  render(ctx: CanvasRenderingContext2D, pal: Palette): void {
    drawBackdrop(ctx, pal, this.camX);
    ctx.save();
    ctx.translate(-Math.round(this.camX), 0);
    const left = this.camX - 40;
    const right = this.camX + VIEW_W + 40;
    for (const s of this.world.solids) if (s.x + s.w >= left && s.x <= right) drawSolid(ctx, s, pal);
    for (const sp of this.world.spikes) if (sp.x + sp.w >= left && sp.x <= right) drawSpikes(ctx, sp, pal);
    if (this.deadFor > 0) {
      drawPoof(ctx, this.deathX, this.deathY, 1 - this.deadFor / RESPAWN_DELAY, pal);
    } else if (this.invulnerable <= 0 || Math.floor(this.invulnerable * 12) % 2 === 0) {
      drawEmployer(
        ctx,
        this.x,
        this.y,
        FIGURE_H,
        { mode: "run", phase: this.phase, stride: this.grounded ? Math.abs(this.vx) / RUN_MAX : 0, airborne: !this.grounded, vy: this.vy, flap: 0, facing: this.facing },
        pal
      );
    }
    ctx.restore();
    drawScore(ctx, pal, `${Math.max(0, Math.floor((this.best - START_X) / 16))} m`, "right");
  }
}

function drawSolid(ctx: CanvasRenderingContext2D, s: Solid, pal: Palette): void {
  if (s.kind === "ground") {
    ctx.fillStyle = pal.ground;
    ctx.fillRect(s.x, s.y, s.w, VIEW_H - s.y);
    ctx.fillStyle = pal.groundTop;
    ctx.fillRect(s.x, s.y, s.w, 7);
    // Pebbles in the earth, placed by position so they don't flicker.
    ctx.fillStyle = pal.platform;
    for (let px = Math.ceil(s.x / 37) * 37; px < s.x + s.w - 6; px += 37) ctx.fillRect(px, s.y + 18 + ((px / 37) % 3) * 9, 5, 3);
    return;
  }
  if (s.kind === "platform") {
    ctx.fillStyle = pal.platform;
    ctx.beginPath();
    ctx.roundRect(s.x, s.y, s.w, s.h, 4);
    ctx.fill();
    ctx.fillStyle = pal.platformTop;
    ctx.fillRect(s.x + 2, s.y, s.w - 4, 4);
    return;
  }
  // A crate: face, frame and a cross brace.
  ctx.fillStyle = pal.block;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = pal.blockEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
  for (let top = s.y; top < s.y + s.h - 1; top += 24) {
    const bottom = Math.min(top + 24, s.y + s.h);
    ctx.beginPath();
    ctx.moveTo(s.x + 4, top + 4);
    ctx.lineTo(s.x + s.w - 4, bottom - 4);
    ctx.moveTo(s.x + s.w - 4, top + 4);
    ctx.lineTo(s.x + 4, bottom - 4);
    ctx.stroke();
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, sp: Spike, pal: Palette): void {
  ctx.fillStyle = pal.spike;
  ctx.strokeStyle = pal.suitShade;
  ctx.lineWidth = 1;
  for (let x = sp.x; x < sp.x + sp.w - 1; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x + 7, GROUND_Y - SPIKE_H);
    ctx.lineTo(x + 14, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// A burst of puffs where the figure was, growing and fading as t goes 0 → 1.
function drawPoof(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, pal: Palette): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t);
  ctx.fillStyle = pal.cloud;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 6 + t * 22;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r, y - 20 + Math.sin(a) * r, 6 - t * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
