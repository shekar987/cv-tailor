// The player in both games: a figure in a dark business suit and a tie,
// drawn from canvas primitives. Arms and legs are two-segment limbs
// (shoulder → elbow → hand, hip → knee → shoe) whose joint angles come from
// limbPose(): the run cycle, the jump tuck and the flap are rotations of
// those joints, so the figure never slides along as a rigid block.
//
// Import-free apart from the shared types (node:test).
import { clamp, type Palette } from "./core.ts";

export type EmployerPose = {
  mode: "run" | "fly";
  // Run-cycle phase in radians, advanced by speed (or by time when flying).
  phase: number;
  // 0 standing still … 1 full running speed.
  stride: number;
  airborne: boolean;
  // Vertical speed in px/s: rising and falling hold different poses.
  vy: number;
  // 0 … 1: how far the latest flap has raised the arms (fly mode).
  flap: number;
  facing: 1 | -1;
};

// Joint angles in radians. 0 hangs straight down; positive swings forward
// (towards the way the figure faces). `lower` is the forearm's or shin's own
// angle, not relative to the upper segment.
export type Limb = { upper: number; lower: number };
export type LimbPose = { armNear: Limb; armFar: Limb; legNear: Limb; legFar: Limb; bob: number };

export function limbPose(p: EmployerPose): LimbPose {
  if (p.mode === "fly") {
    // Arms sweep up with each flap and fall back as it fades; the legs kick.
    const raise = 0.35 + 2.3 * clamp(p.flap, 0, 1);
    const kick = Math.sin(p.phase * 2) * 0.35;
    return {
      armNear: { upper: raise, lower: raise + 0.3 },
      armFar: { upper: raise - 0.3, lower: raise },
      legNear: { upper: 0.3 + kick, lower: -0.3 + kick },
      legFar: { upper: -0.15 - kick, lower: -0.6 - kick },
      bob: 0,
    };
  }
  if (p.airborne) {
    // A jump: the leading leg tucks, the arms reach — up while rising, out
    // while falling.
    const rising = p.vy < 0;
    return {
      armNear: { upper: rising ? 2.5 : 1.9, lower: rising ? 2.8 : 2.2 },
      armFar: { upper: rising ? -0.7 : -0.4, lower: rising ? -0.2 : 0.1 },
      legNear: { upper: 0.9, lower: -0.3 },
      legFar: { upper: -0.35, lower: -1.05 },
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
  const foot = limb(ctx, hip, l, 22 * u, 21 * u, 8 * u, trousers);
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
  const hand = limb(ctx, shoulder, l, 16 * u, 14 * u, 6.5 * u, sleeve);
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

// Draws the figure with its feet at (x, y), `height` px tall. The far arm
// and leg are drawn first in the suit's shade, the near ones last, so the
// limbs read as a pair on each side.
export function drawEmployer(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, pose: EmployerPose, pal: Palette, tilt = 0): void {
  const lp = limbPose(pose);
  const u = height / 100;
  ctx.save();
  ctx.translate(x, y - lp.bob * u);
  if (tilt) {
    ctx.translate(0, -50 * u);
    ctx.rotate(tilt);
    ctx.translate(0, 50 * u);
  }
  ctx.scale(pose.facing, 1);
  const hipNear = { x: 3 * u, y: -46 * u };
  const hipFar = { x: -3 * u, y: -46 * u };
  const shoulderNear = { x: 4 * u, y: -73 * u };
  const shoulderFar = { x: -4 * u, y: -73 * u };
  leg(ctx, hipFar, lp.legFar, u, pal.suitShade, pal.shoe);
  arm(ctx, shoulderFar, lp.armFar, u, pal.suitShade, pal.skin, pal.shirt);
  leg(ctx, hipNear, lp.legNear, u, pal.suit, pal.shoe);
  torso(ctx, u, pal);
  head(ctx, u, pal);
  arm(ctx, shoulderNear, lp.armNear, u, pal.suit, pal.skin, pal.shirt);
  ctx.restore();
}
