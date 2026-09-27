// Game 2: a jetpack flight over the rooftops. A person can't fly, so he
// wears a rocket belt — the real kind, with a hand grip each side of the
// waist (lib/games/employer) — at the figure's real scale (lib/games/core).
// - Holding Space, ↑, W or the button fires it at twice his weight — what a
//   jet suit manages — so it lifts him at 1 g and brakes a drop as fast as
//   gravity builds one; climbing tops out at 4 m/s (air drag). Letting go
//   leaves gravity, 9.81 m/s², dropping at up to 8 m/s. The thrust spools up
//   and down in about a tenth of a second, as an engine does. (At 1.6× his
//   weight every gap was still reachable, but a pilot reacting a quarter of a
//   second ahead sank through the bottom of gaps while braking.)
// - He flies forward at 5 m/s, rising to 6 m/s as the score goes up.
// - Chimney stacks and aerial masts stand on the roofs; crane loads hang from
//   above on their cables. He flies through the gap between them. The gaps'
//   spacing comes from what the thrust can do: the tests fly a simple pilot
//   through hundreds of them.
// - Touching the roof is a landing — he runs along it — but flying into a
//   chimney, a mast or a load knocks him out of the air.
import { VIEW_W, VIEW_H, FIGURE_PX, G, m, clamp, makeRng, hash01, drawCityBackdrop, drawScore, type Game, type InputState, type Palette } from "./core.ts";
import { drawEmployer, pose } from "./employer.ts";

export const ROOF_Y = VIEW_H - 30;
export const PLAYER_X = 130;
export const THRUST = 2 * G;
export const MAX_CLIMB = m(4);
export const MAX_DROP = m(8);
export const SPEED_START = m(5);
export const SPEED_MAX = m(6);
export const OBSTACLE_W = m(1.3);
export const SPACING = m(6.5);
export const GAP_START = m(3.9);
export const GAP_MIN = m(3.3);
// A gap never sits closer than EDGE to the top of the view or to the roof,
// and its centre moves at most MAX_SHIFT from the previous one's.
export const EDGE = m(0.8);
export const MAX_SHIFT = m(2.2);
// His box: feet to the crown, and half his width with the pack.
export const BODY_H = m(1.7);
export const HALF_W = m(0.3);
export const CRASH_TIME = 1.1;
const SPOOL = 0.12;
const LOAD_H = m(0.9);

export type Obstacle = { x: number; gapY: number; gap: number; base: "chimney" | "mast"; passed: boolean; seed: number };

export class Flyer implements Game {
  readonly kind = "flyer" as const;
  state: "ready" | "flying" | "crashed" = "ready";
  // y: the feet.
  y = ROOF_Y;
  vy = 0;
  thrust = 0;
  onRoof = true;
  speed = SPEED_START;
  score = 0;
  best = 0;
  crashes = 0;
  tumble = 0;
  obstacles: Obstacle[] = [];
  t = 0;
  private scroll = 0;
  private runPhase = 0;
  private crashFor = 0;
  private smoke: { x: number; y: number; t: number }[] = [];
  private smokeClock = 0;
  private rng: () => number;

  constructor(seed: number = Date.now()) {
    this.rng = makeRng(seed);
  }

  update(dt: number, input: InputState): void {
    this.t += dt;
    const firing = (input.up || input.jumpPressed) && this.state !== "crashed";
    this.thrust = approach(this.thrust, firing ? 1 : 0, dt / SPOOL);
    this.smoke = this.smoke.filter((s) => this.t - s.t < 0.7);

    if (this.state === "ready") {
      // Standing on the roof, pack on, until he fires it.
      this.y = ROOF_Y;
      this.vy = 0;
      this.onRoof = true;
      if (!firing) return;
      this.state = "flying";
    }

    if (this.state === "crashed") {
      // The engine is out: he tumbles down onto the roof and lies there.
      this.crashFor -= dt;
      this.vy = Math.min(this.vy + G * dt, MAX_DROP);
      this.y = Math.min(this.y + this.vy * dt, ROOF_Y);
      if (this.y < ROOF_Y) this.tumble += dt * 5;
      else this.tumble = approach(this.tumble, Math.PI / 2, dt * 6);
      if (this.crashFor <= 0) this.reset();
      return;
    }

    // Gravity down, thrust up; drag caps the climb and the drop.
    this.vy = clamp(this.vy + (G - THRUST * this.thrust) * dt, -MAX_CLIMB, MAX_DROP);
    this.y += this.vy * dt;
    if (this.y >= ROOF_Y) {
      this.y = ROOF_Y;
      this.vy = 0;
      this.onRoof = true;
    } else {
      this.onRoof = false;
    }
    if (this.y - BODY_H < 0) {
      this.y = BODY_H;
      this.vy = Math.max(0, this.vy);
    }

    this.speed = Math.min(SPEED_MAX, SPEED_START + this.score * m(0.1));
    this.scroll += this.speed * dt;
    this.runPhase += this.onRoof ? this.speed * dt * 0.085 : 0;
    for (const o of this.obstacles) o.x -= this.speed * dt;
    const last = this.obstacles[this.obstacles.length - 1];
    if (!last || last.x < VIEW_W - SPACING) this.obstacles.push(this.next(last));
    this.obstacles = this.obstacles.filter((o) => o.x + OBSTACLE_W > -8);
    for (const o of this.obstacles) {
      if (!o.passed && o.x + OBSTACLE_W < PLAYER_X - HALF_W) {
        o.passed = true;
        this.score++;
        this.best = Math.max(this.best, this.score);
      }
    }

    // Exhaust: a puff from the nozzles while the engine runs.
    this.smokeClock -= dt;
    if (this.thrust > 0.3 && this.smokeClock <= 0) {
      this.smoke.push({ x: this.scroll + PLAYER_X - 10, y: this.y - 26, t: this.t });
      this.smokeClock = 0.05;
    }

    if (this.obstacles.some((o) => this.hits(o))) this.crash();
  }

  private next(prev: Obstacle | undefined): Obstacle {
    const gap = Math.max(GAP_MIN, GAP_START - this.score * m(0.04));
    const from = prev ? prev.gapY : ROOF_Y - m(2.2);
    const gapY = clamp(from + (this.rng() * 2 - 1) * MAX_SHIFT, EDGE + gap / 2, ROOF_Y - EDGE - gap / 2);
    return {
      x: prev ? Math.max(VIEW_W + 8, prev.x + SPACING) : VIEW_W + 8,
      gapY,
      gap,
      base: this.rng() < 0.55 ? "chimney" : "mast",
      passed: false,
      seed: Math.floor(this.rng() * 1e6),
    };
  }

  hits(o: Obstacle): boolean {
    if (PLAYER_X + HALF_W <= o.x || PLAYER_X - HALF_W >= o.x + OBSTACLE_W) return false;
    return this.y - BODY_H < o.gapY - o.gap / 2 || this.y > o.gapY + o.gap / 2;
  }

  private crash(): void {
    this.state = "crashed";
    this.crashFor = CRASH_TIME;
    this.vy = Math.max(this.vy, -60);
    this.crashes++;
  }

  private reset(): void {
    this.state = "ready";
    this.obstacles = [];
    this.score = 0;
    this.y = ROOF_Y;
    this.vy = 0;
    this.tumble = 0;
    this.thrust = 0;
    this.speed = SPEED_START;
    this.onRoof = true;
  }

  render(ctx: CanvasRenderingContext2D, pal: Palette): void {
    drawCityBackdrop(ctx, pal, this.scroll, ROOF_Y - 8);
    drawRoofs(ctx, pal, this.scroll);
    for (const o of this.obstacles) drawObstacle(ctx, o, pal, this.t);

    ctx.fillStyle = pal.smoke;
    for (const s of this.smoke) {
      const age = this.t - s.t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 0.7);
      ctx.beginPath();
      ctx.arc(s.x - this.scroll, s.y + age * 30, 3 + age * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const inAir = this.state === "flying" && !this.onRoof;
    const onRoofRunning = this.state === "flying" && this.onRoof;
    drawEmployer(
      ctx,
      PLAYER_X,
      this.y,
      FIGURE_PX,
      pose({
        mode: inAir || this.state === "crashed" ? "jetpack" : "run",
        pack: true,
        thrust: this.thrust,
        vy: this.vy,
        phase: inAir ? this.t * 3 : this.runPhase,
        stride: onRoofRunning ? 1 : 0,
        facing: 1,
      }),
      pal,
      this.state === "crashed" ? this.tumble : inAir ? 0.1 + clamp(this.vy / 1600, -0.08, 0.1) : 0,
      this.t
    );

    if (this.state === "ready") drawUpChevron(ctx, pal, PLAYER_X, this.y - FIGURE_PX - 14, this.t);
    if (this.state === "crashed") {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.crashFor / CRASH_TIME) * 0.3;
      ctx.fillStyle = pal.cloud;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
    if (this.state !== "ready") drawScore(ctx, pal, String(this.score), "center");
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

// Flat roofs of the buildings he flies over: a parapet edge, and the seams
// between buildings at stable places as they scroll.
function drawRoofs(ctx: CanvasRenderingContext2D, pal: Palette, scroll: number): void {
  ctx.fillStyle = pal.roof;
  ctx.fillRect(0, ROOF_Y, VIEW_W, VIEW_H - ROOF_Y);
  ctx.fillStyle = pal.roofEdge;
  ctx.fillRect(0, ROOF_Y, VIEW_W, 3);
  const span = m(9);
  const first = Math.floor(scroll / span);
  for (let i = first; i < first + Math.ceil(VIEW_W / span) + 2; i++) {
    const x = i * span + hash01(i) * m(2) - scroll;
    ctx.fillRect(Math.round(x), ROOF_Y, 2, VIEW_H - ROOF_Y);
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, pal: Palette, t: number): void {
  const gapTop = o.gapY - o.gap / 2;
  const gapBottom = o.gapY + o.gap / 2;
  const cx = o.x + OBSTACLE_W / 2;

  // Above: the crane's cables down to a hook, slings to a steel load.
  const loadTop = gapTop - LOAD_H;
  const hookY = loadTop - 10;
  ctx.strokeStyle = pal.cable;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 3, 0);
  ctx.lineTo(cx - 1, hookY);
  ctx.moveTo(cx + 3, 0);
  ctx.lineTo(cx + 1, hookY);
  ctx.moveTo(cx, hookY);
  ctx.lineTo(o.x + 4, loadTop);
  ctx.moveTo(cx, hookY);
  ctx.lineTo(o.x + OBSTACLE_W - 4, loadTop);
  ctx.stroke();
  ctx.fillStyle = pal.steel;
  ctx.fillRect(cx - 3, hookY - 3, 6, 5);
  ctx.fillRect(o.x, loadTop, OBSTACLE_W, LOAD_H);
  ctx.fillStyle = pal.steelEdge;
  ctx.fillRect(o.x, loadTop, OBSTACLE_W, 3);
  ctx.fillRect(o.x, gapTop - 3, OBSTACLE_W, 3);
  for (let x = o.x + 7; x < o.x + OBSTACLE_W - 3; x += 8) ctx.fillRect(x, loadTop + 4, 2, LOAD_H - 8);

  // Below: a brick chimney stack, or an aerial mast with a beacon.
  if (o.base === "chimney") {
    ctx.fillStyle = pal.brick;
    ctx.fillRect(o.x, gapBottom, OBSTACLE_W, ROOF_Y - gapBottom);
    ctx.fillStyle = pal.mortar;
    for (let y = gapBottom + 10, row = 0; y < ROOF_Y; y += 7, row++) {
      ctx.fillRect(o.x, y, OBSTACLE_W, 1);
      for (let x = o.x + (row % 2 ? 6 : 12); x < o.x + OBSTACLE_W; x += 12) ctx.fillRect(x, y - 7, 1, 7);
    }
    ctx.fillStyle = pal.stone;
    ctx.fillRect(o.x, gapBottom, OBSTACLE_W, 6);
    return;
  }
  ctx.strokeStyle = pal.mast;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(o.x + 4, ROOF_Y);
  ctx.lineTo(o.x + 4, gapBottom + 2);
  ctx.moveTo(o.x + OBSTACLE_W - 4, ROOF_Y);
  ctx.lineTo(o.x + OBSTACLE_W - 4, gapBottom + 2);
  ctx.moveTo(o.x + 4, gapBottom + 2);
  ctx.lineTo(o.x + OBSTACLE_W - 4, gapBottom + 2);
  for (let y = ROOF_Y, k = 0; y > gapBottom + 8; y -= 14, k++) {
    ctx.moveTo(k % 2 ? o.x + 4 : o.x + OBSTACLE_W - 4, y);
    ctx.lineTo(k % 2 ? o.x + OBSTACLE_W - 4 : o.x + 4, y - 14);
  }
  ctx.stroke();
  // The aircraft-warning light blinks once a second.
  if (Math.floor(t + hash01(o.seed)) % 2 === 0) {
    ctx.fillStyle = pal.beacon;
    ctx.beginPath();
    ctx.arc(o.x + OBSTACLE_W / 2, gapBottom + 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// "Hold to fly": a chevron bobbing above the figure — no words on the canvas.
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
