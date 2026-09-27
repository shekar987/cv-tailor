// The player in both games: a man in a dark business suit and a tie, drawn
// from canvas primitives. Arms and legs are two-segment limbs (shoulder →
// elbow → hand, hip → knee → shoe) whose joint angles come from limbPose(),
// so every movement is a rotation of real joints:
// - run: the run cycle (arms against legs, knees bending on the swing), the
//   jump tuck, and the landing crouch — knees bent, hips lowered, feet planted;
// - climb: hands on the edge, pull and push down, knee up, stand;
// - jetpack: hands on the rocket belt's two grips at the waist (the real
//   kind, like the Bell Rocket Belt), legs hanging and swinging with the
//   climb or the drop. The arms never flap: a person can't fly by flapping,
//   so the thrust comes only from the pack's nozzles.
//
// Import-free apart from the shared helpers (node:test).
import { clamp, type Palette } from "./core.ts";

export type EmployerPose = {
  mode: "run" | "climb" | "jetpack";
  // Run-cycle phase in radians, advanced by speed.
  phase: number;
  // 0 standing still … 1 full running speed.
  stride: number;
  airborne: boolean;
  // Vertical speed in px/s (down is positive).
  vy: number;
  // 0 … 1 through a climb.
  climb: number;
  // Landing crouch: how far the hips drop, as a fraction of the leg's length.
  crouch: number;
  // 0 … 1: how hard the jetpack is firing.
  thrust: number;
  // Wearing the rocket belt (always in the flying game, whatever the pose).
  pack: boolean;
  // Climbing: where the hands hold the edge, in figure units from the feet
  // (x forward, y up negative) — the arms are solved to reach it.
  hands: { x: number; y: number } | null;
  facing: 1 | -1;
};

export const pose = (p: Partial<EmployerPose> = {}): EmployerPose => ({
  mode: "run",
  phase: 0,
  stride: 0,
  airborne: false,
  vy: 0,
  climb: 0,
  crouch: 0,
  thrust: 0,
  pack: false,
  hands: null,
  facing: 1,
  ...p,
});

// Joint angles in radians. 0 hangs straight down; positive swings forward
// (towards the way the figure faces). `lower` is the forearm's or shin's own
// angle, not relative to the upper segment.
export type Limb = { upper: number; lower: number };
export type LimbPose = { armNear: Limb; armFar: Limb; legNear: Limb; legFar: Limb; bob: number };

// Limb lengths in figure units (the figure is 100 units tall).
export const THIGH = 22;
export const SHIN = 21;
export const LEG = THIGH + SHIN;

// Knee angles that lower the hip by `drop` units with the foot still under it:
// the thigh leans forward by a, the shin back by b, THIGH·sin a = SHIN·sin b.
export function squat(drop: number): Limb {
  const target = Math.max(LEG - Math.max(0, drop), 12);
  let lo = 0;
  let hi = 1.45;
  for (let i = 0; i < 28; i++) {
    const a = (lo + hi) / 2;
    const b = Math.asin(clamp((THIGH / SHIN) * Math.sin(a), -1, 1));
    if (THIGH * Math.cos(a) + SHIN * Math.cos(b) > target) lo = a;
    else hi = a;
  }
  const a = (lo + hi) / 2;
  return { upper: a, lower: -Math.asin(clamp((THIGH / SHIN) * Math.sin(a), -1, 1)) };
}

// Two-joint reach: the angles that put the end of a limb (segments a then b)
// at `target`, relative to its root, in figure units. `bend` sets which way
// the middle joint points: -1 back (an elbow), +1 forward (a knee).
export function reach(target: { x: number; y: number }, a: number, b: number, bend: 1 | -1): Limb {
  const d = clamp(Math.hypot(target.x, target.y), Math.abs(a - b) + 0.01, a + b - 0.01);
  const theta = Math.atan2(target.x, target.y);
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const upper = theta + bend * alpha;
  const joint = { x: a * Math.sin(upper), y: a * Math.cos(upper) };
  const k = d / Math.max(1e-6, Math.hypot(target.x, target.y));
  return { upper, lower: Math.atan2(target.x * k - joint.x, target.y * k - joint.y) };
}

export const SHOULDER_NEAR = { x: 4, y: -73 };
export const SHOULDER_FAR = { x: -4, y: -73 };
export const ARM_UPPER = 16;
export const ARM_LOWER = 14;

const STAND: LimbPose = { armNear: { upper: 0.08, lower: 0.33 }, armFar: { upper: -0.08, lower: 0.17 }, legNear: { upper: 0, lower: 0 }, legFar: { upper: 0, lower: 0 }, bob: 0 };

// The climb as four key poses: hands on the edge, pushing down with the knee
// up, the foot on top, standing.
const CLIMB_KEYS: [number, LimbPose][] = [
  [0, { armNear: { upper: 2.7, lower: 2.9 }, armFar: { upper: 2.5, lower: 2.8 }, legNear: { upper: 0.2, lower: -0.2 }, legFar: { upper: -0.1, lower: -0.4 }, bob: 0 }],
  [0.45, { armNear: { upper: 1.6, lower: 0.5 }, armFar: { upper: 1.4, lower: 0.4 }, legNear: { upper: 1.5, lower: 0.2 }, legFar: { upper: -0.2, lower: -0.6 }, bob: 0 }],
  [0.8, { armNear: { upper: 0.3, lower: 0.2 }, armFar: { upper: 0.2, lower: 0.1 }, legNear: { upper: 0.9, lower: -0.3 }, legFar: { upper: 0.1, lower: -0.2 }, bob: 0 }],
  [1, STAND],
];

const mixLimb = (a: Limb, b: Limb, k: number): Limb => ({ upper: a.upper + (b.upper - a.upper) * k, lower: a.lower + (b.lower - a.lower) * k });

function climbPose(c: number): LimbPose {
  const t = clamp(c, 0, 1);
  let i = 0;
  while (i < CLIMB_KEYS.length - 2 && t > CLIMB_KEYS[i + 1][0]) i++;
  const [t0, a] = CLIMB_KEYS[i];
  const [t1, b] = CLIMB_KEYS[i + 1];
  const k = (t - t0) / (t1 - t0);
  return {
    armNear: mixLimb(a.armNear, b.armNear, k),
    armFar: mixLimb(a.armFar, b.armFar, k),
    legNear: mixLimb(a.legNear, b.legNear, k),
    legFar: mixLimb(a.legFar, b.legFar, k),
    bob: 0,
  };
}

export function limbPose(p: EmployerPose): LimbPose {
  if (p.mode === "jetpack") {
    // Hands on the grips at the waist whatever the thrust; the legs hang,
    // trailing when he climbs and swinging forward as he drops.
    const k = clamp(p.vy / 420, -1, 1);
    const sway = Math.sin(p.phase) * 0.05;
    return {
      armNear: { upper: 0.3, lower: 1.25 },
      armFar: { upper: 0.25, lower: 1.2 },
      legNear: { upper: 0.12 + 0.18 * k + sway, lower: -0.1 + 0.1 * k + sway },
      legFar: { upper: -0.08 + 0.15 * k - sway, lower: -0.35 + 0.1 * k - sway },
      bob: 0,
    };
  }
  if (p.mode === "climb") {
    const base = climbPose(p.climb);
    if (!p.hands) return base;
    // Hands on the edge until he stands over it, then let go.
    const hold = 1 - clamp((p.climb - 0.7) / 0.2, 0, 1);
    if (hold <= 0) return base;
    const near = reach({ x: p.hands.x - SHOULDER_NEAR.x, y: p.hands.y - SHOULDER_NEAR.y }, ARM_UPPER, ARM_LOWER, -1);
    const far = reach({ x: p.hands.x - 3 - SHOULDER_FAR.x, y: p.hands.y - SHOULDER_FAR.y }, ARM_UPPER, ARM_LOWER, -1);
    return { ...base, armNear: mixLimb(base.armNear, near, hold), armFar: mixLimb(base.armFar, far, hold) };
  }
  if (p.airborne) {
    // A jump: knees tucked up, arms reaching forward — up while rising, out
    // and lower while falling towards the landing.
    const rising = p.vy < 0;
    return {
      armNear: { upper: rising ? 2.2 : 1.6, lower: rising ? 2.5 : 1.9 },
      armFar: { upper: rising ? -0.7 : -0.4, lower: rising ? -0.2 : 0.1 },
      legNear: { upper: 0.9, lower: -0.3 },
      legFar: { upper: -0.35, lower: -1.05 },
      bob: 0,
    };
  }
  if (p.crouch > 0.01) {
    // Landing: both knees bend the same way, the feet stay where they landed.
    const legs = squat(p.crouch * LEG);
    const reach = clamp(p.crouch * 3, 0, 1);
    return {
      armNear: { upper: 0.2 + 0.6 * reach, lower: 0.5 + 0.8 * reach },
      armFar: { upper: 0.1 + 0.5 * reach, lower: 0.4 + 0.7 * reach },
      legNear: legs,
      legFar: legs,
      bob: 0,
    };
  }
  const s = clamp(p.stride, 0, 1);
  const swing = Math.sin(p.phase) * 0.75 * s;
  const forward = Math.cos(p.phase);
  // A knee bends while its leg swings forward, so the shin trails the thigh;
  // arms swing opposite to the leg on the same side, elbows bent more as the
  // pace rises. Standing still, the arms hang with a slight bend.
  const kneeNear = (0.1 + 1.1 * Math.max(0, forward)) * s;
  const kneeFar = (0.1 + 1.1 * Math.max(0, -forward)) * s;
  const elbow = 0.25 + 0.6 * s;
  const idle = 0.08 * (1 - s);
  return {
    armNear: { upper: -swing * 0.9 + idle, lower: -swing * 0.9 + idle + elbow },
    armFar: { upper: swing * 0.9 - idle, lower: swing * 0.9 - idle + elbow },
    legNear: { upper: swing, lower: swing - kneeNear },
    legFar: { upper: -swing, lower: -swing - kneeFar },
    bob: Math.abs(Math.sin(p.phase)) * 1.6 * s,
  };
}

type Pt = { x: number; y: number };
const along = (from: Pt, angle: number, len: number): Pt => ({ x: from.x + Math.sin(angle) * len, y: from.y + Math.cos(angle) * len });

// One limb as two joined segments; returns the end point (hand or foot).
function limb(ctx: CanvasRenderingContext2D, root: Pt, l: Limb, upperLen: number, lowerLen: number, width: number, color: string): Pt {
  const joint = along(root, l.upper, upperLen);
  const end = along(joint, l.lower, lowerLen);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(joint.x, joint.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  return end;
}

function leg(ctx: CanvasRenderingContext2D, hip: Pt, l: Limb, u: number, trousers: string, shoe: string): void {
  const foot = limb(ctx, hip, l, THIGH * u, SHIN * u, 8 * u, trousers);
  // The shoe points the way the shin's foot points: forward of the ankle.
  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.rotate(-l.lower * 0.6);
  ctx.fillStyle = shoe;
  ctx.beginPath();
  ctx.ellipse(3 * u, 1 * u, 6 * u, 3 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function arm(ctx: CanvasRenderingContext2D, shoulder: Pt, l: Limb, u: number, sleeve: string, skin: string, shirt: string): void {
  const hand = limb(ctx, shoulder, l, ARM_UPPER * u, ARM_LOWER * u, 6.5 * u, sleeve);
  // A white cuff, then the hand.
  const cuff = along(hand, l.lower + Math.PI, 2 * u);
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.arc(cuff.x, cuff.y, 3.2 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, 3.1 * u, 0, Math.PI * 2);
  ctx.fill();
}

function torso(ctx: CanvasRenderingContext2D, u: number, pal: Palette): void {
  // Jacket: broad at the shoulders, tapering to the hem.
  ctx.fillStyle = pal.suit;
  ctx.beginPath();
  ctx.moveTo(-13 * u, -76 * u);
  ctx.quadraticCurveTo(0, -80 * u, 13 * u, -76 * u);
  ctx.lineTo(11 * u, -43 * u);
  ctx.quadraticCurveTo(0, -40 * u, -11 * u, -43 * u);
  ctx.closePath();
  ctx.fill();
  // Shirt showing in the V of the jacket.
  ctx.fillStyle = pal.shirt;
  ctx.beginPath();
  ctx.moveTo(-5.5 * u, -77 * u);
  ctx.lineTo(5.5 * u, -77 * u);
  ctx.lineTo(0, -60 * u);
  ctx.closePath();
  ctx.fill();
  // Lapels along the V.
  ctx.fillStyle = pal.suitShade;
  ctx.beginPath();
  ctx.moveTo(-5.5 * u, -77 * u);
  ctx.lineTo(-1.5 * u, -64 * u);
  ctx.lineTo(-7.5 * u, -70 * u);
  ctx.closePath();
  ctx.moveTo(5.5 * u, -77 * u);
  ctx.lineTo(1.5 * u, -64 * u);
  ctx.lineTo(7.5 * u, -70 * u);
  ctx.closePath();
  ctx.fill();
  // The tie: a knot, then the blade down the shirt front.
  ctx.fillStyle = pal.tie;
  ctx.beginPath();
  ctx.moveTo(-2.2 * u, -77 * u);
  ctx.lineTo(2.2 * u, -77 * u);
  ctx.lineTo(1.4 * u, -73.5 * u);
  ctx.lineTo(-1.4 * u, -73.5 * u);
  ctx.closePath();
  ctx.moveTo(-1.4 * u, -73.5 * u);
  ctx.lineTo(1.4 * u, -73.5 * u);
  ctx.lineTo(3 * u, -55 * u);
  ctx.lineTo(0, -51 * u);
  ctx.lineTo(-3 * u, -55 * u);
  ctx.closePath();
  ctx.fill();
  // One jacket button below the tie.
  ctx.fillStyle = pal.suitShade;
  ctx.beginPath();
  ctx.arc(0, -47.5 * u, 1.3 * u, 0, Math.PI * 2);
  ctx.fill();
}

function head(ctx: CanvasRenderingContext2D, u: number, pal: Palette): void {
  // Neck, face, then hair swept back over the top.
  ctx.fillStyle = pal.skin;
  ctx.fillRect(-3 * u, -81 * u, 6 * u, 5 * u);
  ctx.beginPath();
  ctx.arc(0, -88 * u, 10 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.hair;
  ctx.beginPath();
  ctx.arc(-1 * u, -90 * u, 10.5 * u, Math.PI * 0.95, Math.PI * 2.08);
  ctx.quadraticCurveTo(4 * u, -94 * u, -9 * u, -86 * u);
  ctx.closePath();
  ctx.fill();
  // Eye and a small smile, on the side the figure faces.
  ctx.fillStyle = pal.hair;
  ctx.beginPath();
  ctx.arc(5 * u, -88.5 * u, 1.4 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.hair;
  ctx.lineWidth = 1.1 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(4.5 * u, -83.5 * u, 2.4 * u, 0.2, Math.PI * 0.7);
  ctx.stroke();
}

// The rocket belt's nozzles sit at the small of the back; a flame per nozzle
// grows with the thrust and flickers with `t`.
const NOZZLES = [-18, -11.5];
function flames(ctx: CanvasRenderingContext2D, u: number, pal: Palette, thrust: number, t: number): void {
  if (thrust <= 0.02) return;
  NOZZLES.forEach((nx, i) => {
    const flicker = 0.85 + 0.3 * Math.abs(Math.sin(t * 37 + i * 1.9));
    // Length and width both follow the thrust: a spooling-down engine's
    // flame shrinks to nothing rather than to a stub.
    const len = (3 + 25 * thrust) * flicker * u;
    const girth = 0.45 + 0.55 * thrust;
    const top = -46 * u;
    for (const [color, width, share] of [
      [pal.flame, 4.6 * girth, 1],
      [pal.flameCore, 2.4 * girth, 0.6],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(nx * u - width * u, top);
      ctx.quadraticCurveTo(nx * u - width * u, top + len * share * 0.6, nx * u, top + len * share);
      ctx.quadraticCurveTo(nx * u + width * u, top + len * share * 0.6, nx * u + width * u, top);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function jetpack(ctx: CanvasRenderingContext2D, u: number, pal: Palette): void {
  // Two tanks side by side on a back plate, nozzles below.
  ctx.fillStyle = pal.jetpackShade;
  ctx.beginPath();
  ctx.roundRect(-22 * u, -79 * u, 15 * u, 31 * u, 3 * u);
  ctx.fill();
  ctx.fillStyle = pal.jetpack;
  for (const tx of [-22, -15]) {
    ctx.beginPath();
    ctx.roundRect(tx * u, -80 * u, 6.5 * u, 30 * u, 3.2 * u);
    ctx.fill();
  }
  ctx.fillStyle = pal.jetpackShade;
  for (const nx of NOZZLES) {
    ctx.beginPath();
    ctx.moveTo((nx - 2) * u, -50 * u);
    ctx.lineTo((nx + 2) * u, -50 * u);
    ctx.lineTo((nx + 3) * u, -46 * u);
    ctx.lineTo((nx - 3) * u, -46 * u);
    ctx.closePath();
    ctx.fill();
  }
}

// The near grip: an arm of the belt reaching forward at the waist to where the
// near hand holds it (the pose's hand position).
function grip(ctx: CanvasRenderingContext2D, u: number, pal: Palette): void {
  ctx.strokeStyle = pal.jetpackShade;
  ctx.lineWidth = 2.4 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8 * u, -53 * u);
  ctx.lineTo(20 * u, -53.5 * u);
  ctx.stroke();
  ctx.fillStyle = pal.jetpack;
  ctx.beginPath();
  ctx.roundRect(18 * u, -57 * u, 5 * u, 7 * u, 1.5 * u);
  ctx.fill();
}

// Draws the figure with its feet at (x, y), `height` px tall. The far arm
// and leg are drawn first in the suit's shade, the near ones last, so the
// limbs read as a pair on each side. `tilt` leans the whole figure about its
// middle (a stumble, a flight posture, a tumble); `t` is the time in seconds
// for the flames' flicker.
export function drawEmployer(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, p: EmployerPose, pal: Palette, tilt = 0, t = 0): void {
  const lp = limbPose(p);
  const u = height / 100;
  // A landing crouch lowers the hips; the squat keeps the feet on the ground.
  const drop = p.mode === "run" && !p.airborne && p.crouch > 0.01 ? p.crouch * LEG : 0;
  ctx.save();
  ctx.translate(x, y - lp.bob * u + drop * u);
  if (tilt) {
    ctx.translate(0, -50 * u);
    ctx.rotate(tilt * p.facing);
    ctx.translate(0, 50 * u);
  }
  ctx.scale(p.facing, 1);
  const hipNear = { x: 3 * u, y: -46 * u };
  const hipFar = { x: -3 * u, y: -46 * u };
  const shoulderNear = { x: SHOULDER_NEAR.x * u, y: SHOULDER_NEAR.y * u };
  const shoulderFar = { x: SHOULDER_FAR.x * u, y: SHOULDER_FAR.y * u };
  const jet = p.mode === "jetpack";
  const pack = jet || p.pack;
  if (pack) flames(ctx, u, pal, p.thrust, t);
  leg(ctx, hipFar, lp.legFar, u, pal.suitShade, pal.shoe);
  arm(ctx, shoulderFar, lp.armFar, u, pal.suitShade, pal.skin, pal.shirt);
  if (pack) jetpack(ctx, u, pal);
  leg(ctx, hipNear, lp.legNear, u, pal.suit, pal.shoe);
  torso(ctx, u, pal);
  head(ctx, u, pal);
  if (jet) grip(ctx, u, pal);
  arm(ctx, shoulderNear, lp.armNear, u, pal.suit, pal.skin, pal.shirt);
  ctx.restore();
}
