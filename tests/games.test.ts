// Unit tests for the waiting-room games (lib/games): which game a tailor
// gets, the progress curve, both games' physics and level rules, and the
// figure's jointed limbs. node:test, no DOM: the simulations never draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP, emptyInput, makeRng, runLoop, type InputState } from "../src/lib/games/core.ts";
import { gameForTailorCount, nextTailorCount, progressAt, EXPECTED_TAILOR_MS } from "../src/lib/games/pick.ts";
import { limbPose, type EmployerPose } from "../src/lib/games/employer.ts";
import { Platformer, PlatformerWorld, GROUND_Y, MAX_GAP, MAX_RISE, JUMP_V, GRAVITY, RUN_MAX, RESPAWN_DELAY, START_X } from "../src/lib/games/platformer.ts";
import { Flyer, FLOOR_Y, EDGE, MAX_SHIFT, GAP_MIN, GAP_START, CRASH_TIME, WALL_W, PLAYER_X } from "../src/lib/games/flyer.ts";

const run = (game: { update: (dt: number, i: InputState) => void }, seconds: number, input: Partial<InputState> = {}) => {
  for (let t = 0; t < seconds; t += STEP) game.update(STEP, { ...emptyInput(), ...input });
};

test("the 1st tailor plays the platformer, the 2nd the flyer, then they alternate", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(gameForTailorCount), ["platformer", "flyer", "platformer", "flyer", "platformer"]);
  assert.equal(gameForTailorCount(0), "platformer");
});

test("the tailor count is kept per user; blocked storage still alternates in memory", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(nextTailorCount("u1", store), 1);
  assert.equal(nextTailorCount("u1", store), 2);
  assert.equal(nextTailorCount("u2", store), 1);
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => undefined };
  const a = nextTailorCount("u1", blocked);
  assert.equal(nextTailorCount("u1", blocked), a + 1);
});

test("progress: 90% at the expected time, never full before the real result", () => {
  assert.equal(progressAt(0), 0);
  assert.ok(Math.abs(progressAt(EXPECTED_TAILOR_MS) - 0.9) < 1e-9);
  let prev = 0;
  for (let ms = 0; ms <= 10 * 60_000; ms += 1000) {
    const p = progressAt(ms);
    assert.ok(p >= prev && p <= 0.99, `${ms}ms → ${p}`);
    prev = p;
  }
});

test("runLoop steps at 60 Hz, clamps a long frame, and stops", () => {
  const frames: ((t: number) => void)[] = [];
  let steps = 0;
  let draws = 0;
  const stop = runLoop(() => steps++, () => draws++, (cb) => frames.push(cb), () => undefined);
  frames.shift()!(0);
  frames.shift()!(1000 / 60 + 0.01);
  assert.equal(steps, 1);
  frames.shift()!(5000); // a 5 s stall is clamped to 0.1 s, never replayed
  assert.ok(steps <= 7, String(steps));
  stop();
  frames.shift()?.(6000);
  assert.ok(draws <= 3);
});

test("limbs move: the run cycle swings arms and legs in opposition and bends the knees", () => {
  const pose = (phase: number, stride = 1): EmployerPose => ({ mode: "run", phase, stride, airborne: false, vy: 0, flap: 0, facing: 1 });
  const a = limbPose(pose(Math.PI / 2));
  const b = limbPose(pose(-Math.PI / 2));
  assert.ok(a.legNear.upper > 0.5 && b.legNear.upper < -0.5, "the near leg swings forward, then back");
  assert.ok(a.legNear.upper * a.legFar.upper < 0, "legs swing in opposition");
  assert.ok(a.armNear.upper * a.legNear.upper < 0, "each arm swings against the leg on its side");
  assert.ok(limbPose(pose(0)).legNear.upper - limbPose(pose(0)).legNear.lower > 0.9, "a knee bends as its leg swings forward");
  const still = limbPose(pose(1.3, 0));
  assert.ok(Math.abs(still.legNear.upper) < 0.01 && Math.abs(still.legFar.upper) < 0.01, "standing still, the legs are straight down");
  const jump = limbPose({ ...pose(0), airborne: true, vy: -300 });
  assert.ok(jump.armNear.upper > 2 && jump.legNear.upper - jump.legNear.lower > 1, "a jump raises the arm and tucks the knee");
  const fly = (flap: number) => limbPose({ ...pose(0), mode: "fly", flap });
  assert.ok(fly(1).armNear.upper - fly(0).armNear.upper > 2, "a flap sweeps the arms up");
});

test("platformer: gravity lands the figure, running moves it and the camera follows", () => {
  const g = new Platformer(1);
  run(g, 1);
  assert.equal(g.grounded, true);
  assert.equal(g.y, GROUND_Y);
  const x0 = g.x;
  run(g, 1.5, { right: true });
  assert.ok(g.x > x0 + 150, `${x0} → ${g.x}`);
  assert.ok(g.camX > 0);
  assert.ok(g.phase > 0, "the run cycle advanced with speed");
});

test("platformer: even a tap is a full jump, rising about the height the level is built around", () => {
  const g = new Platformer(2);
  run(g, 0.5);
  const floor = g.y;
  let top = floor;
  // A tap: pressed for one step, then let go.
  g.update(STEP, { ...emptyInput(), jumpPressed: true });
  for (let t = 0; t < 1.5; t += STEP) {
    g.update(STEP, emptyInput());
    top = Math.min(top, g.y);
  }
  const rise = floor - top;
  assert.ok(rise > MAX_RISE && rise < JUMP_V ** 2 / (2 * GRAVITY) + 4, `rose ${rise}px`);
  assert.equal(g.grounded, true);
});

test("platformer: spikes and falls respawn the figure at its checkpoint, grounded", () => {
  const g = new Platformer(3);
  run(g, 0.5);
  g.world.spikes.push({ x: g.x - 10, w: 28 });
  g.update(STEP, emptyInput());
  assert.ok(g.deadFor > 0 && g.deaths === 1);
  run(g, RESPAWN_DELAY + 0.1);
  assert.equal(g.deadFor <= 0, true);
  assert.equal(g.x, g.checkpointX);
  run(g, 0.2);
  assert.equal(g.grounded, true, "the respawn point is on the ground");
  g.world.spikes.length = 0;
  g.x = 5000;
  g.y = GROUND_Y + 200; // below the level
  g.update(STEP, emptyInput());
  assert.equal(g.deaths, 2, "falling out of the world is a death too");
});

test("platformer: the level only asks for jumps a full-speed jump can make", () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const w = new PlatformerWorld(seed);
    w.extendTo(20_000);
    const ground = w.solids.filter((s) => s.kind === "ground").sort((a, b) => a.x - b.x);
    assert.equal(ground[0].x, 0, "the level starts on ground");
    for (let i = 1; i < ground.length; i++) {
      const gap = ground[i].x - (ground[i - 1].x + ground[i - 1].w);
      if (gap <= 0) continue;
      const bridged = w.solids.some((s) => s.kind === "platform" && s.x > ground[i - 1].x + ground[i - 1].w && s.x + s.w < ground[i].x);
      assert.ok(gap <= MAX_GAP || (bridged && gap <= 180), `seed ${seed}: a ${Math.round(gap)}px pit at ${Math.round(ground[i].x)}`);
    }
    for (const s of w.solids) {
      if (s.kind === "ground") continue;
      assert.ok(GROUND_Y - s.y <= MAX_RISE, `seed ${seed}: a ${s.kind} top ${GROUND_Y - s.y}px up`);
    }
    for (const sp of w.spikes) {
      const home = ground.find((s) => sp.x >= s.x && sp.x + sp.w <= s.x + s.w);
      assert.ok(home && sp.x - home.x >= 60 && home.x + home.w - (sp.x + sp.w) >= 60, `seed ${seed}: spikes too close to a landing`);
    }
  }
  // The full-speed jump those limits are measured against.
  const span = RUN_MAX * ((2 * JUMP_V) / GRAVITY);
  assert.ok(span > MAX_GAP + 10, String(span));
  assert.equal(START_X, 80);
});

test("flyer: hovers until the first flap, then falls; a flap lifts it", () => {
  const f = new Flyer(7);
  run(f, 1);
  assert.equal(f.state, "ready");
  assert.equal(f.walls.length, 0);
  f.update(STEP, { ...emptyInput(), jumpPressed: true });
  assert.equal(f.state, "playing");
  const y0 = f.y;
  run(f, 0.1);
  assert.ok(f.y < y0, "the flap lifts it");
  run(f, 0.5);
  assert.ok(f.vy > 0, "then gravity pulls it down");
});

test("flyer: with no flaps it crashes, then resets to ready with the score cleared", () => {
  const f = new Flyer(8);
  f.update(STEP, { ...emptyInput(), jumpPressed: true });
  run(f, 3);
  assert.ok(f.crashes >= 1);
  run(f, CRASH_TIME + 0.1);
  assert.equal(f.state, "ready");
  assert.equal(f.score, 0);
  assert.ok(f.y < FLOOR_Y);
});

test("flyer: gaps are narrow but reachable, and passing a wall scores", () => {
  const f = new Flyer(9);
  f.update(STEP, { ...emptyInput(), jumpPressed: true });
  // Hold the figure in each gap: the walls and the scoring are what's tested.
  let prev: number | null = null;
  for (let t = 0; t < 30; t += STEP) {
    const next = f.walls.find((w) => w.x + WALL_W >= PLAYER_X - 12);
    if (next) f.y = next.gapY;
    f.vy = 0;
    f.update(STEP, emptyInput());
    assert.equal(f.state, "playing", `crashed at ${t.toFixed(2)}s`);
  }
  assert.ok(f.score >= 10, String(f.score));
  const rng = makeRng(5);
  assert.ok(rng() !== rng());
  for (const w of f.walls) {
    assert.ok(w.gap >= GAP_MIN && w.gap <= GAP_START);
    assert.ok(w.gapY - w.gap / 2 >= EDGE - 0.001 && w.gapY + w.gap / 2 <= FLOOR_Y - EDGE + 0.001);
    if (prev !== null) assert.ok(Math.abs(w.gapY - prev) <= MAX_SHIFT + 0.001);
    prev = w.gapY;
  }
});
