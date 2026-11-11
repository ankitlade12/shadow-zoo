import { handFrame, type Handedness, type JointSet } from '../core/poses.js';
import type { StagePlane } from '../core/projector.js';
import type { Stage } from '../core/stage.js';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../core/vec.js';

/** Unit quaternion x, y, z, w. */
export type Quat = readonly [number, number, number, number];

/** Where a hand's target ray sits and how it is turned; its joints are offsets from it. */
export interface RigidPose {
  readonly position: Vec3;
  readonly quaternion: Quat;
}

/** How far past the light pool's edge, as a fraction of the pool, the cursor can take the shadow. */
const POOL_MARGIN = 1.1;

const clamp = (x: number, limit: number): number => Math.max(-limit, Math.min(limit, x));

/** Where the cursor's ray meets the wall, held within the light pool; null when the ray misses the wall. */
export function cursorOnWall(origin: Vec3, direction: Vec3, stage: StagePlane & Pick<Stage, 'poolU' | 'poolV'>): Vec3 | null {
  const toward = dot(direction, stage.n);
  if (toward > -1e-6) return null;
  const t = dot(sub(stage.origin, origin), stage.n) / toward;
  if (t <= 0) return null;
  const offset = sub(add(origin, scale(direction, t)), stage.origin);
  const x = clamp(dot(offset, stage.u), stage.poolU * POOL_MARGIN);
  const y = clamp(dot(offset, stage.v), stage.poolV * POOL_MARGIN);
  return add(stage.origin, add(scale(stage.u, x), scale(stage.v, y)));
}

/**
 * The point between the lantern and `wall` whose shadow lands on `wall`. At reach 1 it is as far from
 * the lantern as the stage's comfortable hand point; nearer the lantern casts a bigger shadow.
 */
export function handPoint(stage: Pick<Stage, 'hand' | 'lantern'>, wall: Vec3, reach: number): Vec3 {
  const distance = length(sub(stage.hand, stage.lantern)) * reach;
  return add(stage.lantern, scale(normalize(sub(wall, stage.lantern)), distance));
}

/** Mean position of a joint set. */
export function centroid(js: JointSet): Vec3 {
  const n = js.rad.length;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += js.pos[i * 3];
    y += js.pos[i * 3 + 1];
    z += js.pos[i * 3 + 2];
  }
  return [x / n, y / n, z / n];
}

/** Rotates `v` by the unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const u: Vec3 = [x, y, z];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}

/** The unit quaternion of a rotation matrix given as rows. */
function quatFromRows(r: readonly (readonly number[])[]): Quat {
  const trace = r[0][0] + r[1][1] + r[2][2];
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, s / 4];
  } else if (r[0][0] > r[1][1] && r[0][0] > r[2][2]) {
    const s = Math.sqrt(1 + r[0][0] - r[1][1] - r[2][2]) * 2;
    q = [s / 4, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s];
  } else if (r[1][1] > r[2][2]) {
    const s = Math.sqrt(1 + r[1][1] - r[0][0] - r[2][2]) * 2;
    q = [(r[0][1] + r[1][0]) / s, s / 4, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + r[2][2] - r[0][0] - r[1][1]) * 2;
    q = [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, s / 4, (r[1][0] - r[0][1]) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/**
 * The target-ray pose that turns a hand pose (`local`: joints relative to its target ray) so its
 * fingers and palm point along `target`, with the joints' centroid at `center`. It is the same rigid
 * turn as orientJointSet, so the shadow keeps the creature's canonical shape.
 */
export function placeHand(local: JointSet, side: Handedness, target: { readonly fingers: Vec3; readonly palm: Vec3 }, center: Vec3): RigidPose {
  const from = handFrame(local, side);
  const f = normalize(target.fingers);
  const s = normalize(cross(normalize(target.palm), f));
  const p = cross(f, s);
  // Maps the pose's fingers, side and palm axes onto the target's.
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => f[i] * from.fingers[j] + s[i] * from.side[j] + p[i] * from.palm[j]));
  const quaternion = quatFromRows(rows);
  return { position: sub(center, rotate(quaternion, centroid(local))), quaternion };
}
