import { BONES, J } from '../../core/joints.js';
import { buildJointSet, builtinAngles, orientJointSet, type Handedness } from '../../core/poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from '../../core/projector.js';
import type { Vec3 } from '../../core/vec.js';
import { createHandShadow, type HandShadow } from '../../game/hands.js';

/** An open hand held up to the lantern: fingers up, palm to the wall. */
const OPEN_FACING: { readonly fingers: Vec3; readonly palm: Vec3 } = { fingers: [0.15, 1, 0], palm: [0, 0, -1] };
const WRIST: Vec3 = [0, 0, 0.45];
/** A distant light, so the cast is close to the hand's own outline (as the creatures are cast). */
const LIGHT: Vec3 = [0, 0, 40];
const WALL: StagePlane = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
/** How far the forearm's shadow reaches below the wrist (meters, before scaling). */
const FOREARM = 0.3;
/** Time constant (seconds) smoothing the shadow's velocity, as for tracked hands. */
const VELOCITY_SMOOTHING = 0.06;

/**
 * A hand shadow on the zoo walk's wall, driven by a mouse or a finger instead of hand tracking: an open
 * hand's shadow with its index fingertip on the pointer, and a press as a pinch. It fills the same
 * `HandShadow` the game's hands do, so the game's own zoo logic feeds, pets, grabs, throws and bonks.
 */
export class PointerHand {
  readonly shadow: HandShadow;
  /** The hand's capsules, scaled, with the index fingertip at the origin: bones, then the forearm. */
  private readonly base = new Float32Array((BONES.length + 1) * CAPSULE_STRIDE);
  private readonly bones: number;
  private readonly all: number;
  private readonly palm: readonly [number, number];
  private down = false;
  private pressed = false;
  private released = false;
  private last: { x: number; y: number } | null = null;

  /** `size`: the hand's shadow from wrist to fingertips (meters on the wall). */
  constructor(size: number, side: Handedness = 'right') {
    this.shadow = createHandShadow(side);
    const joints = orientJointSet(buildJointSet(builtinAngles.open), 'left', OPEN_FACING, WRIST);
    const projector = new ShadowProjector();
    projector.setup(LIGHT, WALL);
    const raw = new Float32Array(this.base.length);
    this.bones = projector.projectBones(joints, raw, 0);
    this.all = this.bones + projector.projectForearm(joints, raw, this.bones, FOREARM);
    const p = joints.pos;
    const at = (joint: number): [number, number] => {
      const k = joint * 3;
      projector.project(p[k], p[k + 1], p[k + 2]);
      return [projector.x, projector.y];
    };
    const [tipX, tipY] = at(J.indexTip);
    const [palmX, palmY] = at(J.middleProx);
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 0; i < this.bones; i++) {
      const o = i * CAPSULE_STRIDE;
      top = Math.max(top, raw[o + 1], raw[o + 4]);
      bottom = Math.min(bottom, raw[o + 1], raw[o + 4]);
    }
    const scale = size / (top - bottom);
    for (let i = 0; i < this.all; i++) {
      const o = i * CAPSULE_STRIDE;
      for (const e of [o, o + 3]) {
        this.base[e] = (raw[e] - tipX) * scale;
        this.base[e + 1] = (raw[e + 1] - tipY) * scale;
        this.base[e + 2] = raw[e + 2] * scale;
      }
    }
    this.palm = [(palmX - tipX) * scale, (palmY - tipY) * scale];
  }

  /** A press: the hand pinches (a mouse button or a finger going down). */
  press(): void {
    this.down = true;
    this.pressed = true;
  }

  /** The press ends. */
  release(): void {
    if (!this.down) return;
    this.down = false;
    this.released = true;
  }

  /**
   * Places the shadow for this frame at a point in the current enclosure's pool, or takes it off the
   * wall (null). `jump` says the point is in a different enclosure than last frame, so it has no speed.
   */
  update(at: { readonly x: number; readonly y: number } | null, dt: number, jump = false): void {
    const s = this.shadow;
    s.detector.pinched = this.down && at !== null;
    if (!at) {
      s.tracked = false;
      s.count = s.drawCount = 0;
      s.speed = s.vx = s.vy = s.tipVX = s.tipVY = 0;
      s.pinch = this.released ? 'end' : null;
      // A press that starts off the wall is not a pinch, even if it slides onto the wall.
      this.pressed = this.released = false;
      this.last = null;
      return;
    }
    s.tracked = true;
    s.count = this.bones;
    s.drawCount = this.all;
    for (let i = 0; i < this.all * CAPSULE_STRIDE; i += 3) {
      s.caps[i] = this.base[i] + at.x;
      s.caps[i + 1] = this.base[i + 1] + at.y;
      s.caps[i + 2] = this.base[i + 2];
    }
    s.tipX = s.pinchX = at.x;
    s.tipY = s.pinchY = at.y;
    s.palmX = at.x + this.palm[0];
    s.palmY = at.y + this.palm[1];
    s.magnification = 1;
    if (this.last && !jump && dt > 0) {
      const vx = (at.x - this.last.x) / dt;
      const vy = (at.y - this.last.y) / dt;
      const k = 1 - Math.exp(-dt / VELOCITY_SMOOTHING);
      s.speed = Math.hypot(vx, vy);
      s.vx += (vx - s.vx) * k;
      s.vy += (vy - s.vy) * k;
    } else {
      s.speed = s.vx = s.vy = 0;
    }
    // The hand is rigid: its fingertip moves with its palm.
    s.tipVX = s.vx;
    s.tipVY = s.vy;
    s.pinch = this.pressed ? 'start' : this.released ? 'end' : null;
    this.pressed = this.released = false;
    this.last = { x: at.x, y: at.y };
  }
}
