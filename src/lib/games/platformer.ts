// Game 1: the walk to the interview along a city street, with a person's real
// abilities, at the figure's real scale (lib/games/core: 36 px to the metre,
// the figure 1.78 m tall, gravity 9.81 m/s²).
// - He runs at up to 5 m/s and takes about a second to get there.
// - A running jump lifts his body 0.59 m and, knees tucked, his feet a further
//   0.2 m: about 0.8 m of clearance, 3.5 m long at full speed. There is no
//   steering in the air; a standing jump with a direction held goes about
//   1.7 m forward.
// - Kerbs and stairs, up to 0.2 m a step, are walked up and down.
// - Anything up to 1.15 m — a pallet of crates, a garden wall — is climbed:
//   press jump against it, or grab its edge when a jump falls short, then
//   drop down the far side.
// - Nothing floats and nothing kills: a puddle slows him to a wade, a cone he
//   runs into is knocked over and costs a stumble. The score is the distance
//   walked, in metres.
import { VIEW_W, VIEW_H, FIGURE_PX, PX_PER_M, G, m, clamp, makeRng, drawCityBackdrop, drawScore, type Game, type InputState, type Palette } from "./core.ts";
import { drawEmployer, pose, LEG } from "./employer.ts";

export const STREET_Y = 262;
export const RUN_SPEED = m(5);
export const RUN_ACCEL = m(6);
export const STOP_DECEL = m(9);
export const JUMP_V = m(3.4);
export const STANDING_JUMP_V = m(2.5);
export const TUCK = m(0.2);
export const STEP_UP = m(0.2);
export const CLIMB_MAX = m(1.15);
export const CLIMB_TIME = 0.55;
export const WADE_SPEED = m(1.5);
export const STUMBLE_SPEED = m(1);
export const STUMBLE_TIME = 0.6;
// The body's box: shoulders and arms wide, feet to the top of the shoulders
// (the head passes under nothing here).
export const PLAYER_W = 22;
export const PLAYER_H = m(1.5);
export const MAX_FALL = m(15);
export const START_X = 80;
export const CONE_H = m(0.5);
export const CONE_W = m(0.32);
// What the street may ask: sizes of every obstacle, all within the above.
export const CRATE_H: [number, number] = [m(0.45), m(0.6)];
export const PALLET_H: [number, number] = [m(0.85), m(0.95)];
export const WALL_H: [number, number] = [m(1.0), m(1.1)];
export const PUDDLE_W: [number, number] = [m(0.8), m(2.0)];
export const RISER = m(0.17);
export const TREAD = m(0.3);
// Free pavement before every obstacle: room to get back up to speed.
export const RUN_UP: [number, number] = [m(3), m(6)];
const WADE_DECEL = m(12);
const COYOTE = 0.07;
const BUFFER = 0.12;
// A landing crouch straightens out over about a sixth of a second.
const CROUCH_RECOVER = 1.4;
const LEG_PX = (LEG / 100) * FIGURE_PX;

export type Solid = { x: number; y: number; w: number; h: number; kind: "crate" | "pallet" | "wall" | "step" | "plaza" };
// A traffic cone standing on the pavement; hitAt is when it was knocked over.
export type Cone = { x: number; hitAt: number | null; dir: 1 | -1 };
export type Puddle = { x: number; w: number };

// The street, generated ahead of the camera one obstacle at a time, each
// after a run of clear pavement. The pavement itself runs unbroken.
export class StreetWorld {
  solids: Solid[] = [];
  cones: Cone[] = [];
  puddles: Puddle[] = [];
  end = 400;
  private rng: () => number;
  private count = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  private between(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  extendTo(x: number): void {
    while (this.end < x) this.feature();
  }

  prune(before: number): void {
    this.solids = this.solids.filter((s) => s.x + s.w >= before);
    this.cones = this.cones.filter((c) => c.x + CONE_W + 40 >= before);
    this.puddles = this.puddles.filter((p) => p.x + p.w >= before);
  }

  private block(x: number, h: number, w: number, kind: Solid["kind"]): void {
    this.solids.push({ x, y: STREET_Y - h, w, h, kind });
  }

  private feature(): void {
    this.count++;
    const hard = Math.min(1, this.count / 12);
    const x = this.end + this.between(RUN_UP[0], RUN_UP[1]);
    const pick = this.rng();
    if (pick < 0.22) {
      const w = m(0.6);
      this.block(x, this.between(CRATE_H[0], CRATE_H[1]), w, "crate");
      this.end = x + w;
    } else if (pick < 0.36) {
      const w = m(1.2);
      this.block(x, this.between(PALLET_H[0], PALLET_H[1]), w, "pallet");
      this.end = x + w;
    } else if (pick < 0.48) {
      const w = m(0.3);
      this.block(x, this.between(WALL_H[0], WALL_H[1]), w, "wall");
      this.end = x + w;
    } else if (pick < 0.64) {
      const n = 1 + (this.rng() < 0.4 + 0.3 * hard ? 1 : 0) + (this.rng() < 0.2 * hard ? 1 : 0);
      const spacing = m(1.4);
      for (let i = 0; i < n; i++) this.cones.push({ x: x + i * spacing, hitAt: null, dir: 1 });
      this.end = x + (n - 1) * spacing + CONE_W;
    } else if (pick < 0.84) {
      const w = this.between(PUDDLE_W[0], PUDDLE_W[0] + (PUDDLE_W[1] - PUDDLE_W[0]) * (0.4 + 0.6 * hard));
      this.puddles.push({ x, w });
      this.end = x + w;
    } else {
      // Stairs up to a raised plaza, across it, and down the far side.
      const n = 4 + Math.floor(this.rng() * 3);
      for (let i = 1; i <= n; i++) this.block(x + (i - 1) * TREAD, i * RISER, TREAD, "step");
      const deckX = x + n * TREAD;
      const deckW = this.between(m(3), m(6));
      this.block(deckX, n * RISER, deckW, "plaza");
      for (let i = n - 1; i >= 1; i--) this.block(deckX + deckW + (n - 1 - i) * TREAD, i * RISER, TREAD, "step");
      this.end = deckX + deckW + (n - 1) * TREAD;
    }
  }
}

// A climb: from where he took hold to standing on top; `edgeX` is the face he
// climbs (its top corner is where the hands go).
type Climb = { fromX: number; fromY: number; toX: number; toY: number; edgeX: number; t: number; dur: number };

const smooth = (k: number) => k * k * (3 - 2 * k);

export class Platformer implements Game {
  readonly kind = "platformer" as const;
  readonly world: StreetWorld;
  // x: the middle of the body; y: the feet with the legs straight.
  x = START_X;
  y = STREET_Y;
  vx = 0;
  vy = 0;
  grounded = true;
  facing: 1 | -1 = 1;
  // How far the feet are drawn up under him in the air (the knee tuck).
  lift = 0;
  // Landing crouch, as a fraction of the leg's length.
  crouch = 0;
  stumble = 0;
  wading = false;
  climb: Climb | null = null;
  climbs = 0;
  conesHit = 0;
  phase = 0;
  camX = 0;
  best = START_X;
  t = 0;
  splashes: { x: number; t: number }[] = [];
  private coyote = 0;
  private buffer = 0;

  constructor(seed: number = Date.now()) {
    this.world = new StreetWorld(seed);
    this.world.extendTo(VIEW_W * 2);
  }

  get feet(): number {
    return this.y - this.lift;
  }

  // The highest surface under the body's width: the pavement, or a solid's top.
  private supportAt(x: number): number {
    let top = STREET_Y;
    for (const s of this.world.solids) {
      if (x + PLAYER_W / 2 > s.x && x - PLAYER_W / 2 < s.x + s.w) top = Math.min(top, s.y);
    }
    return top;
  }

  private overlapsBody(s: Solid): boolean {
    return this.x + PLAYER_W / 2 > s.x && this.x - PLAYER_W / 2 < s.x + s.w && this.feet > s.y + 0.01 && this.y - PLAYER_H < s.y + s.h;
  }

  // A solid face right in front of him, within reach to climb.
  private climbable(): Solid | null {
    const front = this.x + (this.facing * PLAYER_W) / 2;
    for (const s of this.world.solids) {
      const face = this.facing > 0 ? s.x : s.x + s.w;
      if (Math.abs(face - front) > 3) continue;
      const rise = this.feet - s.y;
      if (rise > STEP_UP && rise <= CLIMB_MAX + 0.01) return s;
    }
    return null;
  }

  private startClimb(s: Solid): void {
    const toX = s.w < PLAYER_W ? s.x + s.w / 2 : this.facing > 0 ? s.x + PLAYER_W / 2 + 1 : s.x + s.w - PLAYER_W / 2 - 1;
    const height = this.feet - s.y;
    const edgeX = this.facing > 0 ? s.x : s.x + s.w;
    this.climb = { fromX: this.x, fromY: this.feet, toX, toY: s.y, edgeX, t: 0, dur: CLIMB_TIME * clamp(height / CLIMB_MAX, 0.5, 1) };
    this.y = this.feet;
    this.lift = 0;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.buffer = 0;
    this.climbs++;
  }

  private splash(): void {
    this.splashes.push({ x: this.x, t: this.t });
  }

  private inPuddle(): boolean {
    return this.y >= STREET_Y - 0.01 && this.world.puddles.some((p) => this.x > p.x && this.x < p.x + p.w);
  }

  update(dt: number, input: InputState): void {
    this.t += dt;
    this.splashes = this.splashes.filter((s) => this.t - s.t < 0.6);
    if (this.climb) {
      // Hands on the edge, the body rises, then moves over the top.
      const c = this.climb;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      this.y = c.fromY + (c.toY - c.fromY) * smooth(clamp(k / 0.75, 0, 1));
      this.x = c.fromX + (c.toX - c.fromX) * smooth(clamp((k - 0.35) / 0.65, 0, 1));
      if (k >= 1) {
        this.climb = null;
        this.grounded = true;
        this.y = c.toY;
        this.x = c.toX;
      }
      this.follow(dt);
      return;
    }
    this.stumble = Math.max(0, this.stumble - dt);
    this.crouch = Math.max(0, this.crouch - CROUCH_RECOVER * dt);

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0 && this.grounded) this.facing = dir > 0 ? 1 : -1;
    const wadingBefore = this.wading;
    this.wading = this.grounded && this.inPuddle();
    if (this.wading && !wadingBefore && Math.abs(this.vx) > m(1)) this.splash();
    const cap = this.stumble > 0 ? STUMBLE_SPEED : this.wading ? WADE_SPEED : RUN_SPEED;
    if (this.grounded) {
      const brake = this.wading ? WADE_DECEL : STOP_DECEL;
      if (dir !== 0) {
        if (Math.abs(this.vx) > cap && Math.sign(this.vx) === dir) this.vx = approach(this.vx, dir * cap, brake * dt);
        else this.vx = approach(this.vx, dir * cap, (this.vx * dir < 0 ? brake : RUN_ACCEL) * dt);
      } else {
        this.vx = approach(this.vx, 0, brake * dt);
      }
    }

    // A press just before landing (buffer) or just after stepping off an edge
    // (coyote time) still counts. Against a climbable face it climbs.
    this.buffer = input.jumpPressed ? BUFFER : Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      const face = this.grounded ? this.climbable() : null;
      if (face) {
        this.startClimb(face);
        this.follow(dt);
        return;
      }
      this.vy = -JUMP_V;
      if (dir !== 0 && Math.abs(this.vx) < STANDING_JUMP_V) this.vx = dir * STANDING_JUMP_V;
      if (this.wading) this.splash();
      this.grounded = false;
      this.buffer = 0;
      this.coyote = 0;
    }
    if (!this.grounded) this.vy = Math.min(this.vy + G * dt, MAX_FALL);
    // Knees tucked on the way up (in about a tenth of a second), legs reaching
    // for the ground on the way down.
    const prevFeet = this.feet;
    this.lift = this.grounded
      ? 0
      : this.vy < 0
        ? Math.min(TUCK, this.lift + (TUCK * dt) / 0.12)
        : Math.min(this.lift, TUCK * clamp(1 - this.vy / JUMP_V, 0, 1));

    // Across: step up a kerb or a stair, grab an edge in the air, or stop.
    this.x = Math.max(this.x + this.vx * dt, this.camX + PLAYER_W / 2);
    for (const s of [...this.world.solids].sort((a, b) => (this.vx >= 0 ? a.x - b.x : b.x - a.x))) {
      if (!this.overlapsBody(s)) continue;
      const rise = this.feet - s.y;
      if (this.grounded && rise <= STEP_UP + 0.01) {
        this.y = s.y;
        continue;
      }
      const towards = this.vx > 0 ? s.x >= this.x - 1 : this.vx < 0 ? s.x + s.w <= this.x + 1 : false;
      if (!this.grounded && towards && rise <= CLIMB_MAX + 0.01) {
        this.x = this.vx > 0 ? s.x - PLAYER_W / 2 : s.x + s.w + PLAYER_W / 2;
        this.facing = this.vx > 0 ? 1 : -1;
        this.startClimb(s);
        this.follow(dt);
        return;
      }
      this.x = this.x < s.x + s.w / 2 ? s.x - PLAYER_W / 2 : s.x + s.w + PLAYER_W / 2;
      this.vx = 0;
    }

    // Down: land on the highest surface the feet reach.
    if (!this.grounded) {
      this.y += this.vy * dt;
      if (this.vy >= 0) {
        const top = this.supportAt(this.x);
        if (prevFeet <= top + 0.5 && this.feet >= top) {
          // The feet land where they are; the knees take the rest, deeper the
          // faster he comes down (a 1.1 m drop lands at about 4.6 m/s).
          this.crouch = clamp(this.lift / LEG_PX + this.vy / m(20), 0, 0.3);
          this.y = top;
          this.lift = 0;
          this.vy = 0;
          this.grounded = true;
          if (this.inPuddle()) this.splash();
        }
      }
    } else {
      // Walking off an edge: a stair or a kerb is stepped down, a drop falls.
      const top = this.supportAt(this.x);
      if (top > this.y + 0.5) {
        if (top - this.y <= STEP_UP + 0.01) this.y = top;
        else {
          this.grounded = false;
          this.vy = 0;
          this.coyote = COYOTE;
        }
      }
    }

    // Cones: a light one is knocked over, and he stumbles.
    for (const c of this.world.cones) {
      if (c.hitAt !== null) continue;
      if (this.x + PLAYER_W / 2 > c.x && this.x - PLAYER_W / 2 < c.x + CONE_W && this.feet > STREET_Y - CONE_H + 1) {
        c.hitAt = this.t;
        c.dir = this.vx < 0 ? -1 : 1;
        this.conesHit++;
        this.stumble = STUMBLE_TIME;
        this.vx = Math.sign(this.vx) * Math.min(Math.abs(this.vx), STUMBLE_SPEED);
      }
    }

    this.phase += Math.abs(this.vx) * dt * 0.085;
    this.follow(dt);
  }

  private follow(dt: number): void {
    const target = this.x - VIEW_W * 0.35;
    if (target > this.camX) this.camX += (target - this.camX) * Math.min(1, dt * 10);
    this.best = Math.max(this.best, this.x);
    this.world.extendTo(this.camX + VIEW_W + 360);
    this.world.prune(this.camX - 240);
  }

  render(ctx: CanvasRenderingContext2D, pal: Palette): void {
    drawCityBackdrop(ctx, pal, this.camX, STREET_Y - 30);
    drawStreet(ctx, pal, this.camX);
    ctx.save();
    ctx.translate(-Math.round(this.camX), 0);
    const left = this.camX - 60;
    const right = this.camX + VIEW_W + 60;
    for (const p of this.world.puddles) if (p.x + p.w >= left && p.x <= right) drawPuddle(ctx, p, pal);
    for (const s of this.world.solids) if (s.x + s.w >= left && s.x <= right) drawSolid(ctx, s, pal);
    for (const c of this.world.cones) if (c.x + CONE_W + 30 >= left && c.x - 30 <= right) drawCone(ctx, c, pal, this.t);
    const climbing = this.climb;
    // The hands hold the top corner of the face, a hand's width in.
    const unit = FIGURE_PX / 100;
    const hands = climbing
      ? { x: ((climbing.edgeX + this.facing * 3 - this.x) * this.facing) / unit, y: (climbing.toY - 1 - this.y) / unit }
      : null;
    drawEmployer(
      ctx,
      this.x,
      this.y,
      FIGURE_PX,
      pose({
        mode: climbing ? "climb" : "run",
        climb: climbing ? Math.min(1, climbing.t / climbing.dur) : 0,
        hands,
        phase: this.phase,
        stride: this.grounded ? Math.abs(this.vx) / RUN_SPEED : 0,
        airborne: !this.grounded && !climbing,
        vy: this.vy,
        crouch: this.grounded ? this.crouch : 0,
        facing: this.facing,
      }),
      pal,
      this.stumble > 0 ? 0.28 * (this.stumble / STUMBLE_TIME) : 0,
      this.t
    );
    for (const sp of this.splashes) drawSplash(ctx, sp.x, this.t - sp.t, pal);
    ctx.restore();
    drawScore(ctx, pal, `${Math.max(0, Math.floor((this.best - START_X) / PX_PER_M))} m`, "right");
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

// The pavement (slabs a metre apart), the kerb, and the road below it.
function drawStreet(ctx: CanvasRenderingContext2D, pal: Palette, camX: number): void {
  const kerbY = STREET_Y + 14;
  ctx.fillStyle = pal.pavement;
  ctx.fillRect(0, STREET_Y, VIEW_W, kerbY - STREET_Y);
  ctx.fillStyle = pal.pavementTop;
  ctx.fillRect(0, STREET_Y, VIEW_W, 3);
  ctx.fillStyle = pal.pavementJoint;
  for (let x = -((camX % PX_PER_M) + PX_PER_M) % PX_PER_M; x < VIEW_W; x += PX_PER_M) ctx.fillRect(Math.round(x), STREET_Y + 3, 1, kerbY - STREET_Y - 3);
  ctx.fillStyle = pal.kerb;
  ctx.fillRect(0, kerbY, VIEW_W, 5);
  ctx.fillStyle = pal.road;
  ctx.fillRect(0, kerbY + 5, VIEW_W, VIEW_H - kerbY - 5);
  ctx.fillStyle = pal.roadLine;
  const dash = m(3);
  for (let x = -(camX % (dash * 2)); x < VIEW_W; x += dash * 2) ctx.fillRect(Math.round(x), VIEW_H - 16, dash, 3);
}

function drawSolid(ctx: CanvasRenderingContext2D, s: Solid, pal: Palette): void {
  if (s.kind === "step" || s.kind === "plaza") {
    ctx.fillStyle = pal.stone;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = pal.stoneEdge;
    ctx.fillRect(s.x, s.y, s.w, 2);
    if (s.kind === "plaza") for (let x = s.x + PX_PER_M; x < s.x + s.w - 2; x += PX_PER_M) ctx.fillRect(Math.round(x), s.y + 2, 1, s.h - 2);
    return;
  }
  if (s.kind === "wall") {
    // Brick courses, a coping stone on top.
    ctx.fillStyle = pal.brick;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = pal.mortar;
    for (let y = s.y + 6, row = 0; y < s.y + s.h; y += 5, row++) {
      ctx.fillRect(s.x, y, s.w, 1);
      ctx.fillRect(s.x + (row % 2 ? 3 : 7), y - 5, 1, 5);
    }
    ctx.fillStyle = pal.stone;
    ctx.fillRect(s.x - 2, s.y - 3, s.w + 4, 4);
    return;
  }
  // Crates: one on its own, or a pallet stacked two by two.
  const cols = s.kind === "pallet" ? 2 : 1;
  const rows = s.kind === "pallet" ? 2 : 1;
  const base = s.kind === "pallet" ? 4 : 0;
  if (base) {
    ctx.fillStyle = pal.crateEdge;
    ctx.fillRect(s.x, s.y + s.h - base, s.w, base);
  }
  const cw = s.w / cols;
  const ch = (s.h - base) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = s.x + c * cw;
      const y = s.y + r * ch;
      ctx.fillStyle = pal.crate;
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = pal.crateEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, cw - 1.5, ch - 1.5);
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + cw - 3, y + ch - 3);
      ctx.stroke();
    }
  }
}

// An orange cone with a reflective band; a knocked one tips over and lies.
function drawCone(ctx: CanvasRenderingContext2D, c: Cone, pal: Palette, t: number): void {
  const fall = c.hitAt === null ? 0 : clamp((t - c.hitAt) / 0.25, 0, 1);
  const pivotX = c.dir > 0 ? c.x + CONE_W : c.x;
  ctx.save();
  ctx.translate(pivotX, STREET_Y);
  ctx.rotate(c.dir * fall * (Math.PI / 2));
  ctx.translate(-pivotX, -STREET_Y);
  ctx.fillStyle = pal.cone;
  ctx.fillRect(c.x - 2, STREET_Y - 2, CONE_W + 4, 2);
  ctx.beginPath();
  ctx.moveTo(c.x, STREET_Y - 2);
  ctx.lineTo(c.x + CONE_W / 2 - 1.5, STREET_Y - CONE_H);
  ctx.lineTo(c.x + CONE_W / 2 + 1.5, STREET_Y - CONE_H);
  ctx.lineTo(c.x + CONE_W, STREET_Y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.coneStripe;
  ctx.fillRect(c.x + CONE_W * 0.22, STREET_Y - CONE_H * 0.55, CONE_W * 0.56, 3);
  ctx.restore();
}

// Still water: a flat pool at pavement level with the sky's glint on it (it
// doesn't shimmer — a standing scene stays still).
function drawPuddle(ctx: CanvasRenderingContext2D, p: Puddle, pal: Palette): void {
  ctx.fillStyle = pal.puddle;
  ctx.beginPath();
  ctx.ellipse(p.x + p.w / 2, STREET_Y + 1.5, p.w / 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.puddleShine;
  ctx.fillRect(p.x + p.w * 0.3, STREET_Y, p.w * 0.25, 1);
}

// Droplets thrown up where a foot met water, falling back over `age` seconds.
function drawSplash(ctx: CanvasRenderingContext2D, x: number, age: number, pal: Palette): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - age / 0.6);
  ctx.fillStyle = pal.puddleShine;
  for (let i = 0; i < 7; i++) {
    const vx = (i - 3) * 16;
    const vy = -70 - (i % 3) * 18;
    ctx.beginPath();
    ctx.arc(x + vx * age, STREET_Y + vy * age + 0.5 * G * age * age, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
