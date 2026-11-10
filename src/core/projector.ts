import { BONES, J } from './joints.js';
import type { JointSet } from './poses.js';
import type { Vec3 } from './vec.js';

/** One projected capsule: ax, ay, ar, bx, by, br (stage meters). */
export const CAPSULE_STRIDE = 6;

/** The stage plane: origin on the wall; u right, v up, n toward the player. */
export interface StagePlane {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

const MIN_RADIUS = 0.006;

/** Projects world points from a point light onto the stage plane. Allocation-free after setup. */
export class ShadowProjector {
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private ux = 1;
  private uy = 0;
  private uz = 0;
  private vx = 0;
  private vy = 1;
  private vz = 0;
  private nx = 0;
  private ny = 0;
  private nz = 1;
  private planeDist = 0;
  /** Last projected point in stage meters and its magnification. */
  x = 0;
  y = 0;
  t = 0;

  setup(light: Vec3, stage: StagePlane): void {
    this.lx = light[0];
    this.ly = light[1];
    this.lz = light[2];
    this.ox = stage.origin[0];
    this.oy = stage.origin[1];
    this.oz = stage.origin[2];
    this.ux = stage.u[0];
    this.uy = stage.u[1];
    this.uz = stage.u[2];
    this.vx = stage.v[0];
    this.vy = stage.v[1];
    this.vz = stage.v[2];
    this.nx = stage.n[0];
    this.ny = stage.n[1];
    this.nz = stage.n[2];
    this.planeDist = (this.ox - this.lx) * this.nx + (this.oy - this.ly) * this.ny + (this.oz - this.lz) * this.nz;
  }

  /** Projects world point P. False when P is not between the light and the wall. */
  project(px: number, py: number, pz: number): boolean {
    const dx = px - this.lx;
    const dy = py - this.ly;
    const dz = pz - this.lz;
    const dn = dx * this.nx + dy * this.ny + dz * this.nz;
    if (dn > -1e-6 || this.planeDist > -1e-6) return false;
    const t = this.planeDist / dn;
    if (t < 1) return false;
    const wx = this.lx + dx * t - this.ox;
    const wy = this.ly + dy * t - this.oy;
    const wz = this.lz + dz * t - this.oz;
    this.x = wx * this.ux + wy * this.uy + wz * this.uz;
    this.y = wx * this.vx + wy * this.vy + wz * this.vz;
    this.t = t;
    return true;
  }

  /** Writes one capsule per visible bone starting at capsule index `start`. Returns the count written. */
  projectBones(joints: JointSet, out: Float32Array, start: number): number {
    const { pos, rad } = joints;
    const max = Math.floor(out.length / CAPSULE_STRIDE);
    let n = 0;
    for (let k = 0; k < BONES.length; k++) {
      if (start + n >= max) break;
      const bone = BONES[k];
      const a = bone.a * 3;
      const b = bone.b * 3;
      if (!this.project(pos[a], pos[a + 1], pos[a + 2])) continue;
      const ax = this.x;
      const ay = this.y;
      const at = this.t;
      if (!this.project(pos[b], pos[b + 1], pos[b + 2])) continue;
      const o = (start + n) * CAPSULE_STRIDE;
      out[o] = ax;
      out[o + 1] = ay;
      out[o + 2] = Math.max(MIN_RADIUS, bone.radius ?? rad[bone.a]) * at;
      out[o + 3] = this.x;
      out[o + 4] = this.y;
      out[o + 5] = Math.max(MIN_RADIUS, bone.radius ?? rad[bone.b]) * this.t;
      n++;
    }
    return n;
  }

  /** A forearm stub from the wrist away from the middle knuckle (drawn, never matched). */
  projectForearm(joints: JointSet, out: Float32Array, start: number, length = 0.16): number {
    if ((start + 1) * CAPSULE_STRIDE > out.length) return 0;
    const p = joints.pos;
    const w = J.wrist * 3;
    const m = J.middleProx * 3;
    let dx = p[w] - p[m];
    let dy = p[w + 1] - p[m + 1];
    let dz = p[w + 2] - p[m + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return 0;
    dx /= len;
    dy /= len;
    dz /= len;
    if (!this.project(p[w], p[w + 1], p[w + 2])) return 0;
    const ax = this.x;
    const ay = this.y;
    const at = this.t;
    if (!this.project(p[w] + dx * length, p[w + 1] + dy * length, p[w + 2] + dz * length)) return 0;
    const o = start * CAPSULE_STRIDE;
    out[o] = ax;
    out[o + 1] = ay;
    out[o + 2] = 0.026 * at;
    out[o + 3] = this.x;
    out[o + 4] = this.y;
    out[o + 5] = 0.033 * this.t;
    return 1;
  }
}
