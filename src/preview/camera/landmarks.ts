import { J, JOINT_COUNT } from '../../core/joints.js';
import type { Handedness, JointSet } from '../../core/poses.js';
import type { Stage } from '../../core/stage.js';
import { add, scale } from '../../core/vec.js';
import { handPoint } from '../hand.js';

/** A tracked point: MediaPipe gives x, y, z for each of a hand's 21 landmarks. */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** MediaPipe hand landmark indices. */
export const MP = {
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexDip: 7,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleDip: 11,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringDip: 15,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyDip: 19,
  pinkyTip: 20,
} as const;

/** Each WebXR joint's MediaPipe landmark; -1 for the four finger metacarpals, which MediaPipe lacks. */
export const LANDMARK_OF_JOINT: readonly number[] = [
  MP.wrist,
  MP.thumbCmc, MP.thumbMcp, MP.thumbIp, MP.thumbTip,
  -1, MP.indexMcp, MP.indexPip, MP.indexDip, MP.indexTip,
  -1, MP.middleMcp, MP.middlePip, MP.middleDip, MP.middleTip,
  -1, MP.ringMcp, MP.ringPip, MP.ringDip, MP.ringTip,
  -1, MP.pinkyMcp, MP.pinkyPip, MP.pinkyDip, MP.pinkyTip,
];

/**
 * Finger metacarpal joints, as fractions of the way from the wrist to each knuckle (from IWER's captured
 * hand). The shadow's palm doesn't use them; they only orient the hand.
 */
const METACARPALS: readonly (readonly [joint: number, knuckle: number, fraction: number])[] = [
  [J.indexMeta, J.indexProx, 0.41],
  [J.middleMeta, J.middleProx, 0.36],
  [J.ringMeta, J.ringProx, 0.41],
  [J.pinkyMeta, J.pinkyProx, 0.48],
];

/** Joint radii (meters) of IWER's captured hand, whose palm (wrist to middle knuckle) is 96 mm long. */
const TEMPLATE_RADII = [
  0.0215, 0.0194, 0.0123, 0.0098, 0.0088, 0.0212, 0.0103, 0.0085, 0.0076, 0.0066, 0.0212, 0.0112, 0.008, 0.0076, 0.0066, 0.0191,
  0.0099, 0.0076, 0.0072, 0.0062, 0.0181, 0.0085, 0.0068, 0.0064, 0.0054,
];
const TEMPLATE_PALM = 0.096;

/** Landmarks of the palm, whose mean is the hand's center. */
const PALM = [MP.wrist, MP.indexMcp, MP.middleMcp, MP.ringMcp, MP.pinkyMcp] as const;

/** Apparent palm length (wrist to middle knuckle, in image heights) of a hand at a comfortable distance. */
export const REFERENCE_SIZE = 0.2;
/** How far across the light pool the shadow moves as the hand crosses the camera's view. */
const POSITION_GAIN = 1.25;
const REACH_MIN = 0.55;
const REACH_MAX = 1.3;

/**
 * The user's hand. MediaPipe labels handedness as if the picture were mirrored (a selfie), so on the
 * camera's own unmirrored picture its "Left" is the user's right hand.
 */
export const handFromLabel = (label: string): Handedness => (label.toLowerCase() === 'left' ? 'right' : 'left');

/** One hand as the camera sees it: metric landmarks around the hand's center, plus where it is in the picture. */
export interface CameraHand {
  /** 21 landmarks in meters, camera axes (x right in the camera's picture, y down, z away from the camera). */
  readonly world: readonly Point3[];
  /** 21 landmarks in the picture (x, y from 0 to 1). */
  readonly image: readonly Point3[];
}

/**
 * Places a hand the camera sees into the room, in front of the wall. The camera is treated as sitting
 * at the wall looking back at the player, so the hand keeps its real shape and handedness, and its
 * shadow from the lantern behind the player matches what the player sees of their own hand. Moving
 * across the picture moves the shadow across the light pool; nearer the camera (the wall) is farther
 * from the lantern, a smaller shadow. `aspect` is the picture's width over its height.
 */
export function placeCameraHand(hand: CameraHand, stage: Stage, aspect: number, out: JointSet): void {
  const { world, image } = hand;
  let cx = 0;
  let cy = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  for (const i of PALM) {
    cx += image[i].x / PALM.length;
    cy += image[i].y / PALM.length;
    wx += world[i].x / PALM.length;
    wy += world[i].y / PALM.length;
    wz += world[i].z / PALM.length;
  }
  const size = Math.hypot((image[MP.middleMcp].x - image[MP.wrist].x) * aspect, image[MP.middleMcp].y - image[MP.wrist].y);
  const reach = Math.min(REACH_MAX, Math.max(REACH_MIN, size / REFERENCE_SIZE));
  const limitU = stage.poolU * 1.1;
  const limitV = stage.poolV * 1.1;
  const su = Math.min(limitU, Math.max(-limitU, (0.5 - cx) * 2 * stage.poolU * POSITION_GAIN));
  const sv = Math.min(limitV, Math.max(-limitV, (0.5 - cy) * 2 * stage.poolV * POSITION_GAIN));
  const wall = add(stage.origin, add(scale(stage.u, su), scale(stage.v, sv)));
  const center = handPoint(stage, wall, reach);
  // Camera axes in the room: its right is the player's left (-u), its down is -v, away from it is +n.
  const { u, v, n } = stage;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const k = LANDMARK_OF_JOINT[j];
    if (k < 0) continue;
    const x = world[k].x - wx;
    const y = world[k].y - wy;
    const z = world[k].z - wz;
    for (let a = 0; a < 3; a++) out.pos[j * 3 + a] = center[a] - u[a] * x - v[a] * y + n[a] * z;
  }
  for (const [joint, knuckle, f] of METACARPALS) {
    for (let a = 0; a < 3; a++) out.pos[joint * 3 + a] = out.pos[a] + (out.pos[knuckle * 3 + a] - out.pos[a]) * f;
  }
  const palm = Math.hypot(
    world[MP.middleMcp].x - world[MP.wrist].x,
    world[MP.middleMcp].y - world[MP.wrist].y,
    world[MP.middleMcp].z - world[MP.wrist].z,
  );
  const s = palm > 0.03 && palm < 0.2 ? palm / TEMPLATE_PALM : 1;
  for (let j = 0; j < JOINT_COUNT; j++) out.rad[j] = TEMPLATE_RADII[j] * s;
}

/**
 * The One Euro filter (Casiez et al., 2012): smooths jitter while a hand rests and follows it with
 * little lag when it moves, by raising the cutoff with speed. Filters `size` values at once.
 */
export class OneEuro {
  private readonly x: Float64Array;
  private readonly dx: Float64Array;
  private last = -1;

  constructor(
    size: number,
    private readonly minCutoff = 1.2,
    private readonly beta = 8,
    private readonly dCutoff = 1,
  ) {
    this.x = new Float64Array(size);
    this.dx = new Float64Array(size);
  }

  reset(): void {
    this.last = -1;
  }

  /** Filters `values` sampled at `time` (seconds) into `out` (which may be `values`). */
  filter(values: ArrayLike<number>, time: number, out: { [i: number]: number }): void {
    const n = this.x.length;
    if (this.last < 0 || time <= this.last) {
      if (this.last < 0) {
        for (let i = 0; i < n; i++) {
          this.x[i] = values[i];
          this.dx[i] = 0;
        }
      }
      this.last = this.last < 0 ? time : this.last;
      for (let i = 0; i < n; i++) out[i] = this.x[i];
      return;
    }
    const dt = time - this.last;
    this.last = time;
    const ad = alpha(this.dCutoff, dt);
    for (let i = 0; i < n; i++) {
      const raw = (values[i] - this.x[i]) / dt;
      this.dx[i] += ad * (raw - this.dx[i]);
      const a = alpha(this.minCutoff + this.beta * Math.abs(this.dx[i]), dt);
      this.x[i] += a * (values[i] - this.x[i]);
      out[i] = this.x[i];
    }
  }
}

const alpha = (cutoff: number, dt: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
