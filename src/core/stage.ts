import type { StagePlane } from './projector.js';
import { add, cross, dot, length, normalize, scale, sub, UP, type Vec3 } from './vec.js';

/** A detected plane in world space. */
export interface PlaneInfo {
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly polygon: readonly Vec3[];
  readonly vertical: boolean;
}

export interface HeadPose {
  readonly position: Vec3;
  readonly forward: Vec3;
}

export interface WallHit {
  readonly plane: PlaneInfo;
  readonly hit: Vec3;
  /** Horizontal unit normal facing the player. */
  readonly normal: Vec3;
  readonly distance: number;
}

export interface Stage extends StagePlane {
  /** Point light behind the player's hands. */
  readonly lantern: Vec3;
  /** Comfortable hand point whose shadow lands on the stage center. */
  readonly hand: Vec3;
  /** Light pool half-extents (meters) along u and v. */
  readonly poolU: number;
  readonly poolV: number;
  readonly distance: number;
  readonly fallback: boolean;
}

export interface StageOptions {
  readonly narrow: boolean;
}

const MIN_DIST = 0.6;
const MAX_DIST = 4.5;
const FALLBACK_DIST = 1.6;
const EYE_DROP = 0.1;
const HAND_FORWARD = 0.4;
const HAND_DROP = 0.3;
const LANTERN_BEHIND_HAND = 0.75;
const EDGE_MARGIN = 0.1;
const DEG = Math.PI / 180;

export function horizontalForward(forward: Vec3): Vec3 {
  const f = normalize([forward[0], 0, forward[2]]);
  return length(f) > 0 ? f : [0, 0, -1];
}

function extents(polygon: readonly Vec3[], origin: Vec3, axis: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of polygon) {
    const x = dot(sub(q, origin), axis);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
}

/** The nearest vertical plane that the horizontal gaze ray hits, facing the player, 0.6–4.5 m away. */
export function chooseWall(planes: readonly PlaneInfo[], head: HeadPose): WallHit | null {
  const f = horizontalForward(head.forward);
  let best: WallHit | null = null;
  for (const plane of planes) {
    if (!plane.vertical) continue;
    let n = normalize([plane.normal[0], 0, plane.normal[2]]);
    if (length(n) === 0) continue;
    if (dot(n, sub(head.position, plane.center)) < 0) n = scale(n, -1);
    const along = dot(f, n);
    if (-along < 0.5) continue;
    const distance = dot(sub(plane.center, head.position), n) / along;
    if (!(distance >= MIN_DIST && distance <= MAX_DIST)) continue;
    const hit = add(head.position, scale(f, distance));
    const [lo, hi] = extents(plane.polygon, hit, normalize(cross(UP, n)));
    if (lo > -EDGE_MARGIN || hi < EDGE_MARGIN) continue;
    if (!best || distance < best.distance) best = { plane, hit, normal: n, distance };
  }
  return best;
}

/** Builds the stage on the chosen wall, or on a paper screen in front of the player. */
export function buildStage(head: HeadPose, wall: WallHit | null, options: StageOptions): Stage {
  const f = horizontalForward(head.forward);
  const halfU = (options.narrow ? 14 : 20) * DEG;
  const halfV = (options.narrow ? 10 : 15) * DEG;
  const n: Vec3 = wall ? wall.normal : scale(f, -1);
  const distance = wall ? wall.distance : FALLBACK_DIST;
  const u = normalize(cross(UP, n));
  const v = cross(n, u);
  let poolU = Math.min(1.2, distance * Math.tan(halfU));
  let poolV = Math.min(0.9, distance * Math.tan(halfV));
  let origin: Vec3 = wall
    ? [wall.hit[0], head.position[1] - EYE_DROP, wall.hit[2]]
    : add(head.position, add(scale(f, FALLBACK_DIST), [0, -EYE_DROP, 0]));
  if (wall) {
    const [uLo, uHi] = extents(wall.plane.polygon, origin, u);
    const [vLo, vHi] = extents(wall.plane.polygon, origin, v);
    poolU = Math.max(0.15, Math.min(poolU, (uHi - uLo) / 2));
    poolV = Math.max(0.12, Math.min(poolV, (vHi - vLo) / 2));
    const shiftU = Math.min(Math.max(0, uLo + poolU), uHi - poolU);
    const shiftV = Math.min(Math.max(0, vLo + poolV), vHi - poolV);
    origin = add(origin, add(scale(u, shiftU), scale(v, shiftV)));
  }
  const hand = add(head.position, add(scale(f, HAND_FORWARD), [0, -HAND_DROP, 0]));
  const lantern = add(hand, scale(normalize(sub(hand, origin)), LANTERN_BEHIND_HAND));
  return { origin, u, v, n, lantern, hand, poolU, poolV, distance, fallback: !wall };
}
