// Unit tests for the waiting-room games (lib/games): which game a tailor
// gets, the progress curve, the real-world physics of both games, their level
// rules — proved by a scripted walker and a scripted pilot getting through —
// and the figure's jointed limbs. node:test, no DOM: the simulations never draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP, G, PX_PER_M, FIGURE_PX, FIGURE_M, m, emptyInput, runLoop, type InputState } from "../src/lib/games/core.ts";
import { gameForTailorCount, nextTailorCount, progressAt, EXPECTED_TAILOR_MS } from "../src/lib/games/pick.ts";
import { limbPose, pose, squat, reach, THIGH, SHIN, LEG, ARM_UPPER, ARM_LOWER, SHOULDER_NEAR } from "../src/lib/games/employer.ts";
import {
  Platformer,
  StreetWorld,
  STREET_Y,
  RUN_SPEED,
  JUMP_V,
  TUCK,
  STEP_UP,
  CLIMB_MAX,
  CLIMB_TIME,
  WADE_SPEED,
  STUMBLE_TIME,
  PLAYER_W,
  CONE_W,
  PUDDLE_W,
  RUN_UP,
  RISER,
  START_X,
  type Solid,
} from "../src/lib/games/platformer.ts";
import { Flyer, ROOF_Y, THRUST, MAX_CLIMB, MAX_DROP, OBSTACLE_W, EDGE, MAX_SHIFT, GAP_MIN, GAP_START, CRASH_TIME, PLAYER_X, HALF_W, BODY_H } from "../src/lib/games/flyer.ts";

const input = (p: Partial<InputState> = {}): InputState => ({ ...emptyInput(), ...p });
const run = (game: { update: (dt: number, i: InputState) => void }, seconds: number, p: Partial<InputState> = {}) => {
  for (let t = 0; t < seconds - 1e-9; t += STEP) game.update(STEP, input(p));
};
// A street with nothing on it, or only what a test puts there.
const emptyStreet = (seed = 1) => {
  const g = new Platformer(seed);
  g.world.solids = [];
  g.world.cones = [];
  g.world.puddles = [];
  g.world.end = Infinity;
  return g;
};
const solid = (x: number, h: number, w: number, kind: Solid["kind"] = "crate"): Solid => ({ x, y: STREET_Y - h, w, h, kind });

test("the 1st tailor plays the street game, the 2nd the jetpack, then they alternate", () => {
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

test("one real-world scale: a 1.78 m man is 64 px, gravity is 9.81 m/s²", () => {
  assert.equal(FIGURE_PX, 64);
  assert.ok(Math.abs(FIGURE_M * PX_PER_M - FIGURE_PX) < 0.5);
  assert.equal(G, 9.81 * PX_PER_M);
});

test("limbs: the run cycle swings arms and legs in opposition and bends the knees", () => {
  const a = limbPose(pose({ phase: Math.PI / 2, stride: 1 }));
  const b = limbPose(pose({ phase: -Math.PI / 2, stride: 1 }));
  assert.ok(a.legNear.upper > 0.5 && b.legNear.upper < -0.5, "the near leg swings forward, then back");
  assert.ok(a.legNear.upper * a.legFar.upper < 0, "legs swing in opposition");
  assert.ok(a.armNear.upper * a.legNear.upper < 0, "each arm swings against the leg on its side");
  const zero = limbPose(pose({ phase: 0, stride: 1 }));
  assert.ok(zero.legNear.upper - zero.legNear.lower > 0.9, "a knee bends as its leg swings forward");
  const still = limbPose(pose({ phase: 1.3, stride: 0 }));
  assert.ok(Math.abs(still.legNear.upper) < 0.01 && Math.abs(still.legFar.upper) < 0.01, "standing still, the legs are straight down");
  const jump = limbPose(pose({ airborne: true, vy: -100 }));
  assert.ok(jump.legNear.upper - jump.legNear.lower > 1, "a jump tucks the knee");
});

test("limbs: a landing crouch bends the knees with the feet kept under the hips", () => {
  for (const drop of [2, 6, 10]) {
    const l = squat(drop);
    const height = THIGH * Math.cos(l.upper) + SHIN * Math.cos(-l.lower);
    const across = THIGH * Math.sin(l.upper) + SHIN * Math.sin(l.lower);
    assert.ok(Math.abs(height - (LEG - drop)) < 0.05, `drop ${drop}: leg height ${height}`);
    assert.ok(Math.abs(across) < 0.05, `drop ${drop}: foot ${across} from under the hip`);
  }
  const crouched = limbPose(pose({ crouch: 0.2 }));
  assert.deepEqual(crouched.legNear, crouched.legFar, "both knees bend alike");
});

test("limbs: a climb puts the hands on the edge, then the knee up, then stands", () => {
  const start = limbPose(pose({ mode: "climb", climb: 0 }));
  const mid = limbPose(pose({ mode: "climb", climb: 0.45 }));
  const end = limbPose(pose({ mode: "climb", climb: 1 }));
  assert.ok(start.armNear.upper > 2.4 && start.armFar.upper > 2.2, "arms up to the edge");
  assert.ok(mid.legNear.upper > 1.2, "the knee comes up onto the top");
  assert.ok(Math.abs(end.legNear.upper) < 0.01 && Math.abs(end.legFar.upper) < 0.01, "standing on top");
});

test("limbs: climbing, the arms are solved so the hands hold the edge as the body rises", () => {
  const end = (root: { x: number; y: number }, l: { upper: number; lower: number }) => ({
    x: root.x + ARM_UPPER * Math.sin(l.upper) + ARM_LOWER * Math.sin(l.lower),
    y: root.y + ARM_UPPER * Math.cos(l.upper) + ARM_LOWER * Math.cos(l.lower),
  });
  for (const target of [{ x: 22, y: 20 }, { x: 18, y: 5 }, { x: 10, y: 26 }]) {
    const l = reach(target, ARM_UPPER, ARM_LOWER, -1);
    const hand = end({ x: 0, y: 0 }, l);
    assert.ok(Math.hypot(hand.x - target.x, hand.y - target.y) < 0.01, JSON.stringify({ target, hand }));
  }
  // A 0.9 m pallet's corner, a little in front: the near hand is on it.
  const edge = { x: 20, y: -50 };
  const p = limbPose(pose({ mode: "climb", climb: 0.2, hands: edge }));
  const hand = end(SHOULDER_NEAR, p.armNear);
  assert.ok(Math.hypot(hand.x - edge.x, hand.y - edge.y) < 0.5, JSON.stringify(hand));
});

test("limbs: with the jetpack the hands stay on the grips — nothing flaps; the legs hang with the motion", () => {
  const poses = [
    pose({ mode: "jetpack", thrust: 0, vy: 0 }),
    pose({ mode: "jetpack", thrust: 1, vy: -140 }),
    pose({ mode: "jetpack", thrust: 0, vy: 280, phase: 2 }),
  ].map(limbPose);
  for (const p of poses) {
    assert.deepEqual(p.armNear, poses[0].armNear);
    assert.deepEqual(p.armFar, poses[0].armFar);
  }
  const rising = limbPose(pose({ mode: "jetpack", vy: -140 }));
  const falling = limbPose(pose({ mode: "jetpack", vy: 280 }));
  assert.ok(falling.legNear.upper > rising.legNear.upper, "the legs trail on the climb and swing forward on the drop");
});

test("street: he runs up to 5 m/s, taking about a second to get there", () => {
  const g = emptyStreet();
  run(g, 0.5, { right: true });
  assert.ok(g.vx > m(2) && g.vx < RUN_SPEED);
  run(g, 1, { right: true });
  assert.equal(g.vx, RUN_SPEED);
  assert.equal(RUN_SPEED, m(5));
  assert.ok(g.phase > 0, "the run cycle advances with speed");
  assert.ok(g.camX > 0, "the camera follows");
});

test("street: a jump is a person's jump — 0.59 m up, 0.8 m of foot clearance, about 3.5 m at full speed, no steering in the air", () => {
  const g = emptyStreet();
  run(g, 0.2);
  g.update(STEP, input({ jumpPressed: true }));
  let top = STREET_Y;
  let feetTop = STREET_Y;
  while (!g.grounded) {
    g.update(STEP, input());
    top = Math.min(top, g.y);
    feetTop = Math.min(feetTop, g.feet);
  }
  const rise = (STREET_Y - top) / PX_PER_M;
  const clearance = (STREET_Y - feetTop) / PX_PER_M;
  assert.ok(rise > 0.55 && rise < 0.61, `body rose ${rise.toFixed(2)} m`);
  assert.ok(clearance > 0.72 && clearance < 0.82, `feet cleared ${clearance.toFixed(2)} m`);
  assert.equal(JUMP_V, m(3.4));

  const r = emptyStreet();
  run(r, 2, { right: true });
  const x0 = r.x;
  r.update(STEP, input({ right: true, jumpPressed: true }));
  let steered = false;
  while (!r.grounded) {
    const before = r.vx;
    r.update(STEP, input({ left: true }));
    if (!r.grounded && r.vx !== before) steered = true;
  }
  const span = (r.x - x0) / PX_PER_M;
  assert.ok(span > 3.2 && span < 3.7, `a running jump carried ${span.toFixed(2)} m`);
  assert.equal(steered, false, "holding the other way in the air changes nothing");
  assert.ok(r.crouch > 0, "he lands into a crouch");
  run(r, 0.4);
  assert.equal(r.crouch, 0, "and stands up again");

  const s = emptyStreet();
  run(s, 0.2);
  const sx = s.x;
  s.update(STEP, input({ right: true, jumpPressed: true }));
  while (!s.grounded) s.update(STEP, input({ right: true }));
  const standing = (s.x - sx) / PX_PER_M;
  assert.ok(standing > 1.5 && standing < 1.9, `a standing jump went ${standing.toFixed(2)} m forward`);
});

test("street: kerbs and stairs are walked up and down, never jumped", () => {
  const g = emptyStreet();
  const n = 5;
  for (let i = 1; i <= n; i++) g.world.solids.push(solid(200 + (i - 1) * m(0.3), i * RISER, m(0.3), "step"));
  g.world.solids.push(solid(200 + n * m(0.3), n * RISER, m(4), "plaza"));
  let highest = STREET_Y;
  for (let t = 0; t < 4; t += STEP) {
    g.update(STEP, input({ right: true }));
    highest = Math.min(highest, g.y);
    assert.equal(g.climb, null, "no climbing on stairs");
  }
  assert.ok(Math.abs(STREET_Y - highest - n * RISER) < 0.01, "he walked up onto the plaza");
  assert.ok(RISER <= STEP_UP);
});

test("street: a crate stops him; jump against it climbs onto it; a jump clears a crate from a run", () => {
  const g = emptyStreet();
  const crate = solid(200, m(0.6), m(0.6));
  g.world.solids.push(crate);
  run(g, 3, { right: true });
  assert.equal(g.x, crate.x - PLAYER_W / 2, "stopped against the crate");
  g.update(STEP, input({ right: true, jumpPressed: true }));
  assert.ok(g.climb, "jump against it climbs");
  run(g, CLIMB_TIME + 0.05, { right: true });
  assert.equal(g.y, crate.y, "standing on top");
  assert.equal(g.climbs, 1);

  const r = emptyStreet();
  const c2 = solid(260, m(0.55), m(0.6));
  r.world.solids.push(c2);
  // At full speed, take off about a metre before it.
  while (r.x + PLAYER_W / 2 < c2.x - 30) r.update(STEP, input({ right: true }));
  r.update(STEP, input({ right: true, jumpPressed: true }));
  run(r, 1.2, { right: true });
  assert.ok(r.x > c2.x + c2.w, "cleared it (or landed on it and walked off)");
  assert.equal(r.climbs, 0, "no climb was needed");
});

test("street: a 1.1 m wall can't be jumped — a jump that falls short grabs the edge and climbs", () => {
  const g = emptyStreet();
  const wall = solid(260, m(1.1), m(0.3), "wall");
  g.world.solids.push(wall);
  while (g.x + PLAYER_W / 2 < wall.x - 25) g.update(STEP, input({ right: true }));
  g.update(STEP, input({ right: true, jumpPressed: true }));
  let grabbed = false;
  for (let t = 0; t < 3; t += STEP) {
    g.update(STEP, input({ right: true }));
    if (g.climb) grabbed = true;
  }
  assert.ok(grabbed, "he grabbed the edge");
  assert.ok(g.x > wall.x + wall.w, "and went over, down the far side");
  assert.equal(g.y, STREET_Y);
  assert.ok(m(1.1) <= CLIMB_MAX);
});

test("street: a puddle slows him to a wade; a cone he runs into falls over and costs a stumble", () => {
  const g = emptyStreet();
  g.world.puddles.push({ x: 300, w: m(2) });
  let slowest = Infinity;
  for (let t = 0; t < 4; t += STEP) {
    g.update(STEP, input({ right: true }));
    if (g.wading) slowest = Math.min(slowest, g.vx);
  }
  assert.ok(slowest <= WADE_SPEED + 0.01, `waded at ${slowest}`);
  assert.ok(g.splashes.length > 0 || g.x > 300 + m(2), "it splashed");

  const c = emptyStreet();
  c.world.cones.push({ x: 300, hitAt: null, dir: 1 });
  run(c, 4, { right: true });
  assert.equal(c.conesHit, 1);
  assert.notEqual(c.world.cones[0].hitAt, null, "the cone was knocked over");
  assert.ok(c.x > 300 + CONE_W, "he walked on");
  assert.ok(STUMBLE_TIME > 0);
});

test("street: every obstacle is one a person can get past, with room to take a run-up", () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const w = new StreetWorld(seed);
    w.extendTo(30_000);
    const tall = w.solids.filter((s) => s.kind === "crate" || s.kind === "pallet" || s.kind === "wall");
    for (const s of tall) {
      assert.ok(s.h > STEP_UP && s.h <= CLIMB_MAX, `seed ${seed}: a ${s.kind} ${(s.h / PX_PER_M).toFixed(2)} m tall`);
    }
    for (const s of w.solids.filter((s) => s.kind === "step")) assert.ok(s.h % RISER < 0.01 || Math.abs((s.h % RISER) - RISER) < 0.01);
    for (const p of w.puddles) assert.ok(p.w >= PUDDLE_W[0] - 0.01 && p.w <= PUDDLE_W[1] + 0.01, `seed ${seed}: a ${p.w}px puddle`);
    // Obstacles are apart by at least a run-up.
    const spans = [
      ...tall.map((s) => [s.x, s.x + s.w]),
      ...w.puddles.map((p) => [p.x, p.x + p.w]),
    ].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] - spans[i - 1][1] >= RUN_UP[0] - 0.01, `seed ${seed}: obstacles ${Math.round(spans[i][0] - spans[i - 1][1])}px apart`);
  }
});

test("street: a scripted walker gets through a minute of street on every seed and never gets stuck", () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const g = new Platformer(seed);
    let lastCheck = g.x;
    for (let t = 0; t < 60; t += STEP) {
      const front = g.x + PLAYER_W / 2;
      const ahead = (a: number, b: number) => b > front && a < front + 34;
      const obstacle =
        g.world.solids.some((s) => s.kind !== "step" && s.kind !== "plaza" && ahead(s.x, s.x + s.w)) ||
        g.world.cones.some((c) => c.hitAt === null && ahead(c.x, c.x + CONE_W)) ||
        g.world.puddles.some((p) => ahead(p.x, p.x + p.w));
      g.update(STEP, input({ right: true, jumpPressed: obstacle && g.grounded }));
      if (Math.abs(t % 5) < STEP / 2 && t > 1) {
        assert.ok(g.x - lastCheck > m(5), `seed ${seed}: stuck around ${Math.round(g.x)} at ${t.toFixed(1)} s`);
        lastCheck = g.x;
      }
    }
    const metres = (g.best - START_X) / PX_PER_M;
    assert.ok(metres > 150, `seed ${seed}: only ${metres.toFixed(0)} m in a minute`);
    assert.ok(g.climbs > 0, `seed ${seed}: the street asked for no climb`);
  }
});

test("jetpack: he stands on the roof until the first thrust; holding it climbs at up to 4 m/s, letting go drops under gravity", () => {
  const f = new Flyer(7);
  run(f, 1);
  assert.equal(f.state, "ready");
  assert.equal(f.y, ROOF_Y, "standing on the roof");
  assert.equal(f.obstacles.length, 0, "nothing moves while he stands");
  run(f, 1.5, { up: true });
  assert.equal(f.state, "flying");
  assert.ok(f.y < ROOF_Y - m(2), "he climbed");
  assert.equal(f.vy, -MAX_CLIMB, "drag caps the climb at 4 m/s");
  assert.equal(THRUST, 2 * G);
  const vy0 = f.vy;
  run(f, 0.3);
  assert.ok(f.vy - vy0 > 0.8 * G * (0.3 - 0.12) && f.vy <= MAX_DROP, "let go, gravity takes over");
  assert.ok(f.thrust < 0.01, "the engine spools down");
});

test("jetpack: touching the roof is a landing, not a crash; flying into an obstacle is, and he tumbles down", () => {
  const f = new Flyer(8);
  run(f, 0.3, { up: true });
  // Back down on the roof before the first chimney arrives (~1.9 s).
  run(f, 1.2);
  assert.equal(f.state, "flying");
  assert.equal(f.onRoof, true);
  assert.equal(f.crashes, 0, "a landing on the roof");
  run(f, 6);
  assert.ok(f.crashes >= 1, "running along the roof, a chimney or mast stops him");
  run(f, CRASH_TIME + 0.1);
  assert.equal(f.state, "ready");
  assert.equal(f.score, 0);
});

test("jetpack: the gaps are ones the thrust can reach — a scripted pilot flies through hundreds", () => {
  // The pilot brakes by its stopping distance (firing lifts at THRUST - G,
  // coasting slows a climb at G), allowing for the engine's spool time.
  const aUp = THRUST - G;
  for (const seed of [1, 2, 3, 42, 99]) {
    const f = new Flyer(seed);
    let prevGap: number | null = null;
    for (let t = 0; t < 180; t += STEP) {
      const next = f.obstacles.find((o) => o.x + OBSTACLE_W >= PLAYER_X - HALF_W);
      const target = next ? next.gapY + BODY_H / 2 : ROOF_Y - m(2.5);
      const y = f.y + f.vy * 0.12;
      const fire = f.vy > 0 ? y + (f.vy * f.vy) / (2 * aUp) > target - 2 : y - (f.vy * f.vy) / (2 * G) > target;
      f.update(STEP, input({ up: fire }));
      assert.equal(f.crashes, 0, `seed ${seed}: crashed at ${t.toFixed(1)} s (score ${f.score})`);
    }
    assert.ok(f.score >= 120, `seed ${seed}: score ${f.score}`);
    for (const o of f.obstacles) {
      assert.ok(o.gap >= GAP_MIN - 0.01 && o.gap <= GAP_START + 0.01);
      assert.ok(o.gapY - o.gap / 2 >= EDGE - 0.01 && o.gapY + o.gap / 2 <= ROOF_Y - EDGE + 0.01);
      if (prevGap !== null) assert.ok(Math.abs(o.gapY - prevGap) <= MAX_SHIFT + 0.01);
      prevGap = o.gapY;
    }
  }
});

test("jetpack: a gap is always taller than he is, with room to spare", () => {
  assert.ok(GAP_MIN - BODY_H > m(1.2), `${((GAP_MIN - BODY_H) / PX_PER_M).toFixed(2)} m to spare`);
  assert.ok(TUCK < STEP_UP + m(0.01));
});
