import { BONES, J } from './joints.js';
import { buildJointSet, builtinAngles, orientJointSet, type HandPoseAngles, type JointSet } from './poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from './projector.js';
import { Silhouettes, TargetShape } from './silhouette.js';
import type { Vec3 } from './vec.js';

export type CreatureId = 'rabbit' | 'dog' | 'crocodile' | 'peacock' | 'spider' | 'turtle';

export interface CreatureDef {
  readonly id: CreatureId;
  readonly name: string;
  /** IWER joint angles, left-hand convention. */
  readonly angles: HandPoseAngles;
  /** Canonical hand orientation in stage axes: x = right (u), y = up (v), z = toward the player (n). */
  readonly facing: { readonly fingers: Vec3; readonly palm: Vec3 };
  /** Eye glint: a joint plus an offset in silhouette-size units (x right, y up). */
  readonly eye: { readonly joint: number; readonly dx: number; readonly dy: number };
}

const B = builtinAngles;

export const CREATURES: readonly CreatureDef[] = [
  {
    // Sideways V: two tall ears leaning back; folded fingers and thumb form the head.
    id: 'rabbit',
    name: 'Rabbit',
    angles: { ...B.peace, index: { mcp: 0, pip: 6, dip: 4, yaw: -12 }, middle: { mcp: 0, pip: 6, dip: 4, yaw: 12 } },
    facing: { fingers: [-0.45, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbTip, dx: 0.1, dy: 0.12 },
  },
  {
    // Flat snout forward, thumb up as the ear, pinky spread down as the open jaw.
    id: 'dog',
    name: 'Dog',
    angles: { ...B.flat, thumb: B['thumbs-up'].thumb, pinky: { mcp: 15, pip: 8, dip: 4, yaw: 32 } },
    facing: { fingers: [1, 0.1, 0], palm: [0, 0, 1] },
    eye: { joint: J.indexProx, dx: 0.05, dy: 0.1 },
  },
  {
    // Fingers together as the upper jaw, straight thumb swung down as the wide-open lower jaw.
    id: 'crocodile',
    name: 'Crocodile',
    angles: { ...B.flat, thumb: { ...B.flat.thumb, cmc: [-58, -4.8, -67.7], mcp: 0, ip: 0 } },
    facing: { fingers: [1, 0.05, 0], palm: [0, 0, -1] },
    eye: { joint: J.indexProx, dx: 0, dy: 0.12 },
  },
  {
    // Open hand: fingers fanned up as the tail, thumb out front as the head and beak.
    id: 'peacock',
    name: 'Peacock',
    angles: B.open,
    facing: { fingers: [-0.2, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbProx, dx: 0.02, dy: 0.06 },
  },
  {
    // Back of the hand to the light, fingers spread and curled down as legs.
    id: 'spider',
    name: 'Spider',
    angles: {
      ...B.claw,
      thumb: B.open.thumb,
      index: { mcp: 12, pip: 30, dip: 20, yaw: -32 },
      middle: { mcp: 12, pip: 30, dip: 20, yaw: -10 },
      ring: { mcp: 14, pip: 30, dip: 20, yaw: 12 },
      pinky: { mcp: 18, pip: 32, dip: 20, yaw: 34 },
    },
    facing: { fingers: [0, -1, 0], palm: [0, 0, -1] },
    eye: { joint: J.middleMeta, dx: 0, dy: 0.05 },
  },
  {
    // Fist as the shell seen end-on, short bent thumb as the head.
    id: 'turtle',
    name: 'Turtle',
    angles: { ...B['thumbs-up'], thumb: { ...B['thumbs-up'].thumb, mcp: 25, ip: 20 } },
    facing: { fingers: [0, -0.3, -1], palm: [0, -1, 0] },
    eye: { joint: J.thumbTip, dx: -0.03, dy: 0.06 },
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
export function canonicalJoints(def: CreatureDef): JointSet {
  return orientJointSet(buildJointSet(def.angles), 'left', def.facing, CANON_WRIST);
}

export function canonicalCapsules(joints: JointSet, out = new Float32Array(BONES.length * CAPSULE_STRIDE)): { caps: Float32Array; count: number } {
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  return { caps: out, count: projector.projectBones(joints, out, 0) };
}

export interface CreatureShape {
  readonly def: CreatureDef;
  readonly joints: JointSet;
  readonly caps: Float32Array;
  readonly count: number;
  readonly target: TargetShape;
  /** Eye position in canonical stage space. */
  readonly eye: readonly [number, number];
}

export function buildCreatureShapes(sil = new Silhouettes()): Map<CreatureId, CreatureShape> {
  const shapes = new Map<CreatureId, CreatureShape>();
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  for (const def of CREATURES) {
    const joints = canonicalJoints(def);
    const { caps, count } = canonicalCapsules(joints);
    const target = new TargetShape(caps, count, sil);
    const e = def.eye.joint * 3;
    projector.project(joints.pos[e], joints.pos[e + 1], joints.pos[e + 2]);
    const eye: [number, number] = [projector.x + def.eye.dx * target.frame.size, projector.y + def.eye.dy * target.frame.size];
    shapes.set(def.id, { def, joints, caps, count, target, eye });
  }
  return shapes;
}
