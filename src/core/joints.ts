/** WebXR hand joints, in the order defined by the WebXR Hand Input spec. */
export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_COUNT = JOINT_NAMES.length;
export const JOINT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  JOINT_NAMES.map((name, i) => [name, i]),
);

export const J = {
  wrist: 0,
  thumbMeta: 1,
  thumbProx: 2,
  thumbDist: 3,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexInter: 7,
  indexDist: 8,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleInter: 12,
  middleDist: 13,
  middleTip: 14,
  ringMeta: 15,
  ringProx: 16,
  ringInter: 17,
  ringDist: 18,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyInter: 22,
  pinkyDist: 23,
  pinkyTip: 24,
} as const;

/** A tapered capsule between two joints. `radius` (meters) overrides the joint radii. */
export interface Bone {
  readonly a: number;
  readonly b: number;
  readonly radius?: number;
}

const chain = (...idx: number[]): Bone[] => idx.slice(1).map((b, i) => ({ a: idx[i], b }));

/** Capsules that together cover a hand: four bones per digit plus a filled palm. */
export const BONES: readonly Bone[] = [
  ...chain(J.thumbMeta, J.thumbProx, J.thumbDist, J.thumbTip),
  ...chain(J.indexProx, J.indexInter, J.indexDist, J.indexTip),
  ...chain(J.middleProx, J.middleInter, J.middleDist, J.middleTip),
  ...chain(J.ringProx, J.ringInter, J.ringDist, J.ringTip),
  ...chain(J.pinkyProx, J.pinkyInter, J.pinkyDist, J.pinkyTip),
  { a: J.wrist, b: J.thumbMeta, radius: 0.02 },
  { a: J.wrist, b: J.indexProx, radius: 0.017 },
  { a: J.wrist, b: J.middleProx, radius: 0.022 },
  { a: J.wrist, b: J.ringProx, radius: 0.02 },
  { a: J.wrist, b: J.pinkyProx, radius: 0.017 },
  { a: J.indexProx, b: J.middleProx, radius: 0.012 },
  { a: J.middleProx, b: J.ringProx, radius: 0.012 },
  { a: J.ringProx, b: J.pinkyProx, radius: 0.011 },
  { a: J.thumbMeta, b: J.indexProx, radius: 0.012 },
];
