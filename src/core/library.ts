import { BONES, J, JOINT_COUNT } from './joints.js';
import {
  buildJointSet,
  builtinAngles,
  jointDistance,
  mirrorJointSet,
  orientJointSet,
  type HandPoseAngles,
  type JointSet,
} from './poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from './projector.js';
import { Silhouettes, TargetShape } from './silhouette.js';
import type { Vec3 } from './vec.js';

export type CreatureId = 'rabbit' | 'dog' | 'crocodile' | 'peacock' | 'spider' | 'turtle' | 'bird';
/** How a living creature moves around the light pool. */
export type Motion = 'hop' | 'trot' | 'slither' | 'strut' | 'dangle' | 'creep' | 'fly';

export interface CreatureDef {
  readonly id: CreatureId;
  readonly name: string;
  /** Base hand pose (IWER joint angles, left-hand convention): the shape players match. */
  readonly angles: HandPoseAngles;
  /** Signature action pose: ears fold, jaw snaps shut, tail folds, legs curl, head tucks. */
  readonly act: HandPoseAngles;
  readonly motion: Motion;
  /** Canonical hand orientation in stage axes: x = right (u), y = up (v), z = toward the player (n). */
  readonly facing: { readonly fingers: Vec3; readonly palm: Vec3 };
  /** Eye glint: a joint plus an offset in silhouette-size units (x right, y up). */
  readonly eye: { readonly joint: number; readonly dx: number; readonly dy: number };
  /** Joints whose distance is "open" in the base pose and "closed" in the act pose. */
  readonly actuator: { readonly a: number; readonly b: number };
  /**
   * Cast with both hands: this hand (left-hand data, as defined) and its mirror image, thumbs together
   * at the center. Matched against both hands' shadows at once, and never worn.
   */
  readonly pair?: boolean;
}

const B = builtinAngles;

// Sideways V: two tall ears leaning back; folded fingers and thumb form the head.
const RABBIT: HandPoseAngles = {
  ...B.peace,
  index: { mcp: 0, pip: 6, dip: 4, yaw: -12 },
  middle: { mcp: 0, pip: 6, dip: 4, yaw: 12 },
};
// Flat snout forward, thumb up as the ear, pinky spread down as the open jaw.
const DOG: HandPoseAngles = { ...B.flat, thumb: B['thumbs-up'].thumb, pinky: { mcp: 15, pip: 8, dip: 4, yaw: 32 } };
// Fingers together as the upper jaw, straight thumb swung down as the wide-open lower jaw.
const CROCODILE: HandPoseAngles = { ...B.flat, thumb: { ...B.flat.thumb, cmc: [-58, -4.8, -67.7], mcp: 0, ip: 0 } };
// Back of the hand to the light, fingers spread and curled down as legs.
const SPIDER: HandPoseAngles = {
  ...B.claw,
  thumb: B.open.thumb,
  index: { mcp: 12, pip: 30, dip: 20, yaw: -32 },
  middle: { mcp: 12, pip: 30, dip: 20, yaw: -10 },
  ring: { mcp: 14, pip: 30, dip: 20, yaw: 12 },
  pinky: { mcp: 18, pip: 32, dip: 20, yaw: 34 },
};
// Fist as the shell seen end-on, short bent thumb as the head.
const TURTLE: HandPoseAngles = { ...B['thumbs-up'], thumb: { ...B['thumbs-up'].thumb, mcp: 25, ip: 20 } };
// Two open hands with hooked thumbs: the thumbs are the head, the spread fingers the wings.
const BIRD: HandPoseAngles = { ...B.open };
/** A finger of the open hand, folded down: a wing beat. */
const folded = (f: HandPoseAngles['index']) => ({ ...f, mcp: 48, pip: 32, dip: 14 });
const BIRD_FLAP: HandPoseAngles = {
  ...B.open,
  index: folded(B.open.index),
  middle: folded(B.open.middle),
  ring: folded(B.open.ring),
  pinky: folded(B.open.pinky),
};

export const CREATURES: readonly CreatureDef[] = [
  {
    id: 'rabbit',
    name: 'Rabbit',
    angles: RABBIT,
    act: { ...RABBIT, index: { mcp: 24, pip: 40, dip: 20, yaw: -14 }, middle: { mcp: 24, pip: 40, dip: 20, yaw: 14 } },
    motion: 'hop',
    facing: { fingers: [-0.45, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbTip, dx: 0.1, dy: 0.12 },
    actuator: { a: J.indexTip, b: J.thumbTip },
  },
  {
    id: 'dog',
    name: 'Dog',
    angles: DOG,
    act: { ...DOG, pinky: { mcp: 6, pip: 4, dip: 2, yaw: -4 } },
    motion: 'trot',
    facing: { fingers: [1, 0.1, 0], palm: [0, 0, 1] },
    eye: { joint: J.indexProx, dx: 0.05, dy: 0.1 },
    actuator: { a: J.pinkyTip, b: J.ringTip },
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    angles: CROCODILE,
    act: { ...CROCODILE, thumb: { ...B.flat.thumb, cmc: [-20, -4.8, -67.7], mcp: 0, ip: 0 } },
    motion: 'slither',
    facing: { fingers: [1, 0.05, 0], palm: [0, 0, -1] },
    eye: { joint: J.indexProx, dx: 0, dy: 0.12 },
    actuator: { a: J.thumbTip, b: J.indexTip },
  },
  {
    // Open hand: fingers fanned up as the tail, thumb out front as the head and beak.
    id: 'peacock',
    name: 'Peacock',
    angles: B.open,
    act: {
      ...B.open,
      index: { ...B.open.index, yaw: -4 },
      middle: { ...B.open.middle, yaw: 0 },
      ring: { ...B.open.ring, yaw: 6 },
      pinky: { ...B.open.pinky, yaw: 8 },
    },
    motion: 'strut',
    facing: { fingers: [-0.2, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbProx, dx: 0.02, dy: 0.06 },
    actuator: { a: J.indexTip, b: J.pinkyTip },
  },
  {
    id: 'spider',
    name: 'Spider',
    angles: SPIDER,
    act: {
      ...SPIDER,
      index: { mcp: 35, pip: 70, dip: 40, yaw: -28 },
      middle: { mcp: 35, pip: 70, dip: 40, yaw: -8 },
      ring: { mcp: 35, pip: 70, dip: 40, yaw: 10 },
      pinky: { mcp: 38, pip: 70, dip: 40, yaw: 30 },
    },
    motion: 'dangle',
    facing: { fingers: [0, -1, 0], palm: [0, 0, -1] },
    eye: { joint: J.middleMeta, dx: 0, dy: 0.05 },
    actuator: { a: J.middleTip, b: J.wrist },
  },
  {
    id: 'turtle',
    name: 'Turtle',
    angles: TURTLE,
    act: { ...TURTLE, thumb: B.fist.thumb },
    motion: 'creep',
    facing: { fingers: [0, -0.3, -1], palm: [0, -1, 0] },
    eye: { joint: J.thumbTip, dx: -0.03, dy: 0.06 },
    actuator: { a: J.thumbTip, b: J.indexProx },
  },
  {
    // Two hands, backs to the light: fingers fanned out and up as wings, thumbs hooked as the head.
    id: 'bird',
    name: 'Bird',
    angles: BIRD,
    act: BIRD_FLAP,
    motion: 'fly',
    facing: { fingers: [-1, 0.45, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbTip, dx: 0.02, dy: 0.03 },
    actuator: { a: J.middleTip, b: J.wrist },
    pair: true,
  },
];

export const creatureDef = (id: CreatureId): CreatureDef => {
  const def = CREATURES.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown creature ${id}`);
  return def;
};

const CANON_STAGE: StagePlane = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
const CANON_LIGHT: Vec3 = [0, 0, 40];
const CANON_WRIST: Vec3 = [0, 0, 0.45];

/** The creature's left hand in canonical stage space (a distant light makes the view almost orthographic). */
export function canonicalJoints(def: CreatureDef, angles: HandPoseAngles = def.angles): JointSet {
  return orientJointSet(buildJointSet(angles), 'left', def.facing, CANON_WRIST);
}

/** Gap between a pair's two thumb tips (meters): just touching. */
const PAIR_GAP = 0.004;

/**
 * A two-handed creature's hands in canonical stage space: the left hand as defined, moved so its thumb
 * tip meets the center line, and the right hand its mirror image. The act pose keeps the base pose's
 * offset, so the hands don't jump as it moves.
 */
export function canonicalPair(def: CreatureDef, angles: HandPoseAngles = def.angles): { left: JointSet; right: JointSet } {
  const dx = -PAIR_GAP / 2 - canonicalJoints(def).pos[J.thumbTip * 3];
  const left = canonicalJoints(def, angles);
  for (let i = 0; i < JOINT_COUNT; i++) left.pos[i * 3] += dx;
  return { left, right: mirrorJointSet(left) };
}

export function canonicalCapsules(joints: JointSet, out = new Float32Array(BONES.length * CAPSULE_STRIDE)): { caps: Float32Array; count: number } {
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  return { caps: out, count: projector.projectBones(joints, out, 0) };
}

/** Both hands of a pair as one shadow: the left hand's capsules, then the right hand's. */
export function canonicalPairCapsules(pair: { left: JointSet; right: JointSet }): { caps: Float32Array; count: number } {
  const out = new Float32Array(2 * BONES.length * CAPSULE_STRIDE);
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  const count = projector.projectBones(pair.left, out, 0);
  return { caps: out, count: count + projector.projectBones(pair.right, out, count) };
}

export interface CreatureShape {
  readonly def: CreatureDef;
  readonly joints: JointSet;
  readonly actJoints: JointSet;
  readonly caps: Float32Array;
  /** Capsules of the act pose, same layout as `caps`. */
  readonly actCaps: Float32Array;
  readonly count: number;
  readonly target: TargetShape;
  /** Eye position in canonical stage space. */
  readonly eye: readonly [number, number];
  /** Actuator joints and their distances (meters) in the base (open) and act (closed) poses. */
  readonly actuator: { readonly a: number; readonly b: number; readonly open: number; readonly closed: number };
}

export function buildCreatureShapes(sil = new Silhouettes()): Map<CreatureId, CreatureShape> {
  const shapes = new Map<CreatureId, CreatureShape>();
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  for (const def of CREATURES) {
    // A pair's eye and actuator are on its left hand; its shadow is both hands.
    const pair = def.pair ? canonicalPair(def) : null;
    const actPair = def.pair ? canonicalPair(def, def.act) : null;
    const joints = pair ? pair.left : canonicalJoints(def);
    const actJoints = actPair ? actPair.left : canonicalJoints(def, def.act);
    const { caps, count } = pair ? canonicalPairCapsules(pair) : canonicalCapsules(joints);
    const act = actPair ? canonicalPairCapsules(actPair) : canonicalCapsules(actJoints);
    if (act.count !== count) throw new Error(`${def.id}: the action pose lost bones`);
    const target = new TargetShape(caps, count, sil);
    const e = def.eye.joint * 3;
    projector.project(joints.pos[e], joints.pos[e + 1], joints.pos[e + 2]);
    const eye: [number, number] = [projector.x + def.eye.dx * target.frame.size, projector.y + def.eye.dy * target.frame.size];
    const { a, b } = def.actuator;
    const actuator = { a, b, open: jointDistance(joints, a, b), closed: jointDistance(actJoints, a, b) };
    shapes.set(def.id, { def, joints, actJoints, caps, actCaps: act.caps, count, target, eye, actuator });
  }
  return shapes;
}
