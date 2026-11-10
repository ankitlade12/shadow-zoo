import { buildHandPose, type HandPoseAngles } from 'iwer/lib/device/configs/hand/builder.js';
import { handPoseAngles } from 'iwer/lib/device/configs/hand/library.js';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import type { HandPose } from 'iwer/lib/device/XRHandInput.js';
import { J, JOINT_COUNT, JOINT_NAMES } from './joints.js';
import { cross, dot, normalize, sub, type Vec3 } from './vec.js';

export type { HandPoseAngles };
export type Handedness = 'left' | 'right';

/** 25 joint positions (xyz, meters) and radii, all in one coordinate space. */
export interface JointSet {
  readonly pos: Float32Array;
  readonly rad: Float32Array;
}

export const createJointSet = (): JointSet => ({
  pos: new Float32Array(JOINT_COUNT * 3),
  rad: new Float32Array(JOINT_COUNT),
});

/** IWER's built-in pose angles (open, flat, fist, thumbs-up, peace, claw, ...). */
export const builtinAngles = handPoseAngles as Readonly<Record<string, HandPoseAngles>>;

type JointTransforms = Record<string, { offsetMatrix: ArrayLike<number>; radius: number }>;

export function jointSetFromHandPose(pose: HandPose, out: JointSet = createJointSet()): JointSet {
  const transforms = pose.jointTransforms as unknown as JointTransforms;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const t = transforms[JOINT_NAMES[i]];
    out.pos[i * 3] = t.offsetMatrix[12];
    out.pos[i * 3 + 1] = t.offsetMatrix[13];
    out.pos[i * 3 + 2] = t.offsetMatrix[14];
    out.rad[i] = t.radius;
  }
  return out;
}

/** Builds a left-hand joint set from joint angles on IWER's captured skeleton. */
export function buildJointSet(angles: HandPoseAngles): JointSet {
  return jointSetFromHandPose(buildHandPose(angles, relaxedHandPose, pinchHandPose));
}

export const jointPos = (js: JointSet, i: number): Vec3 => [js.pos[i * 3], js.pos[i * 3 + 1], js.pos[i * 3 + 2]];

export function copyJointSet(src: JointSet, out: JointSet = createJointSet()): JointSet {
  out.pos.set(src.pos);
  out.rad.set(src.rad);
  return out;
}

/** Mirrors across x (left-hand data to right hand and back). */
export function mirrorJointSet(src: JointSet, out: JointSet = createJointSet()): JointSet {
  for (let i = 0; i < JOINT_COUNT; i++) {
    out.pos[i * 3] = -src.pos[i * 3];
    out.pos[i * 3 + 1] = src.pos[i * 3 + 1];
    out.pos[i * 3 + 2] = src.pos[i * 3 + 2];
    out.rad[i] = src.rad[i];
  }
  return out;
}

/** Orthonormal hand axes. fingers: along the middle metacarpal. palm: out of the palm. side: palm × fingers. */
export interface HandFrame {
  readonly wrist: Vec3;
  readonly fingers: Vec3;
  readonly palm: Vec3;
  readonly side: Vec3;
}

export function handFrame(js: JointSet, handedness: Handedness): HandFrame {
  const wrist = jointPos(js, J.wrist);
  const fingers = normalize(sub(jointPos(js, J.middleProx), jointPos(js, J.middleMeta)));
  const across = sub(jointPos(js, J.indexProx), jointPos(js, J.pinkyProx));
  const rawPalm = normalize(handedness === 'left' ? cross(fingers, across) : cross(across, fingers));
  const side = normalize(cross(rawPalm, fingers));
  const palm = cross(fingers, side);
  return { wrist, fingers, palm, side };
}

/** Rigidly rotates a hand so its frame matches `target`, with the wrist moved to `anchor`. */
export function orientJointSet(
  src: JointSet,
  handedness: Handedness,
  target: { readonly fingers: Vec3; readonly palm: Vec3 },
  anchor: Vec3,
  out: JointSet = createJointSet(),
): JointSet {
  const from = handFrame(src, handedness);
  const f = normalize(target.fingers);
  const s = normalize(cross(normalize(target.palm), f));
  const p = cross(f, s);
  for (let i = 0; i < JOINT_COUNT; i++) {
    const d = sub(jointPos(src, i), from.wrist);
    const cf = dot(d, from.fingers);
    const cs = dot(d, from.side);
    const cp = dot(d, from.palm);
    for (let k = 0; k < 3; k++) out.pos[i * 3 + k] = anchor[k] + f[k] * cf + s[k] * cs + p[k] * cp;
    out.rad[i] = src.rad[i];
  }
  return out;
}

/** Distance in meters between two joints of a set. */
export function jointDistance(js: JointSet, a: number, b: number): number {
  const p = js.pos;
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}
