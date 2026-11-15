import { BONES, J } from '../core/joints.js';
import { PinchDetector } from '../core/interact.js';
import { jointDistance, type Handedness, type JointSet } from '../core/poses.js';
import { CAPSULE_STRIDE, type ShadowProjector } from '../core/projector.js';

/** One hand's shadow on the stage this frame. */
export interface HandShadow {
  readonly side: Handedness;
  tracked: boolean;
  /** Bone capsules followed by the forearm capsule. */
  readonly caps: Float32Array;
  /** Bone capsules only (matching and touch). */
  count: number;
  /** Bones plus forearm (drawing). */
  drawCount: number;
  tipX: number;
  tipY: number;
  /**
   * Where a pinch lands: the shadow of the point between the thumb and index tips. Unlike the fingertip,
   * it barely moves as the fingers close, so what the hand hovers over is what it pinches.
   */
  pinchX: number;
  pinchY: number;
  palmX: number;
  palmY: number;
  /** Palm shadow speed on the stage (m/s). */
  speed: number;
  /** Smoothed palm and fingertip shadow velocities on the stage (m/s): a swipe's direction, a throw's. */
  vx: number;
  vy: number;
  tipVX: number;
  tipVY: number;
  /** How much the lantern magnifies the palm's shadow (1 on the wall); its edge softens with it. */
  magnification: number;
  pinch: 'start' | 'end' | null;
  joints: JointSet | null;
  readonly detector: PinchDetector;
}

export const createHandShadow = (side: Handedness): HandShadow => ({
  side,
  tracked: false,
  caps: new Float32Array((BONES.length + 1) * CAPSULE_STRIDE),
  count: 0,
  drawCount: 0,
  tipX: 0,
  tipY: 0,
  pinchX: 0,
  pinchY: 0,
  palmX: 0,
  palmY: 0,
  speed: 0,
  vx: 0,
  vy: 0,
  tipVX: 0,
  tipVY: 0,
  magnification: 1,
  pinch: null,
  joints: null,
  detector: new PinchDetector(),
});

/** Time constant (seconds) smoothing shadow velocities: hand tracking updates in steps, not every frame. */
const VELOCITY_SMOOTHING = 0.06;

/** Projects a tracked hand (or clears it when `joints` is null) and updates its stage features. */
export function updateHandShadow(hand: HandShadow, joints: JointSet | null, projector: ShadowProjector, dt: number): void {
  const wasTracked = hand.tracked;
  const prevX = hand.palmX;
  const prevY = hand.palmY;
  const prevTipX = hand.tipX;
  const prevTipY = hand.tipY;
  hand.count = joints ? projector.projectBones(joints, hand.caps, 0) : 0;
  hand.tracked = hand.count > 0;
  hand.joints = hand.tracked ? joints : null;
  if (!hand.tracked || !joints) {
    hand.drawCount = 0;
    hand.speed = 0;
    hand.vx = hand.vy = hand.tipVX = hand.tipVY = 0;
    hand.pinch = hand.detector.update(1, false);
    return;
  }
  hand.drawCount = hand.count + projector.projectForearm(joints, hand.caps, hand.count);
  const p = joints.pos;
  const t = J.indexTip * 3;
  const m = J.middleProx * 3;
  if (projector.project(p[t], p[t + 1], p[t + 2])) {
    hand.tipX = projector.x;
    hand.tipY = projector.y;
  }
  const a = J.thumbTip * 3;
  if (projector.project((p[a] + p[t]) / 2, (p[a + 1] + p[t + 1]) / 2, (p[a + 2] + p[t + 2]) / 2)) {
    hand.pinchX = projector.x;
    hand.pinchY = projector.y;
  }
  if (projector.project(p[m], p[m + 1], p[m + 2])) {
    hand.palmX = projector.x;
    hand.palmY = projector.y;
    hand.magnification = projector.t;
  }
  hand.speed = wasTracked && dt > 0 ? Math.hypot(hand.palmX - prevX, hand.palmY - prevY) / dt : 0;
  if (wasTracked && dt > 0) {
    const k = 1 - Math.exp(-dt / VELOCITY_SMOOTHING);
    hand.vx += ((hand.palmX - prevX) / dt - hand.vx) * k;
    hand.vy += ((hand.palmY - prevY) / dt - hand.vy) * k;
    hand.tipVX += ((hand.tipX - prevTipX) / dt - hand.tipVX) * k;
    hand.tipVY += ((hand.tipY - prevTipY) / dt - hand.tipVY) * k;
  } else hand.vx = hand.vy = hand.tipVX = hand.tipVY = 0;
  hand.pinch = hand.detector.update(jointDistance(joints, J.thumbTip, J.indexTip), true);
}
