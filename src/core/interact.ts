import { J } from './joints.js';
import type { JointSet } from './poses.js';
import { CAPSULE_STRIDE } from './projector.js';

/** Distance between the two palms (the middle finger's knuckles), in meters. */
export function palmGap(a: JointSet, b: JointSet): number {
  const i = J.middleProx * 3;
  return Math.hypot(a.pos[i] - b.pos[i], a.pos[i + 1] - b.pos[i + 1], a.pos[i + 2] - b.pos[i + 2]);
}

/**
 * A clap: the palms meet within a moment of being well apart. Bringing the hands together slowly
 * (to hook thumbs for the bird, say) never counts, and one clap can't fire twice.
 */
export class ClapDetector {
  private sinceApart = Infinity;
  private cooldown = 0;

  constructor(
    /** Palms closer than this (meters) have met. */
    private readonly touch = 0.07,
    /** Palms farther than this (meters) are apart. */
    private readonly apart = 0.16,
    /** The palms must meet within this many seconds of being apart. */
    private readonly within = 0.35,
    private readonly rest = 0.8,
  ) {}

  /** `gap` is palmGap, or Infinity while a hand is untracked. True on the frame a clap lands. */
  update(dt: number, gap: number): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!Number.isFinite(gap)) {
      this.sinceApart = Infinity;
      return false;
    }
    if (gap > this.apart) {
      this.sinceApart = 0;
      return false;
    }
    this.sinceApart += dt;
    if (gap < this.touch && this.sinceApart <= this.within && this.cooldown === 0) {
      this.cooldown = this.rest;
      this.sinceApart = Infinity;
      return true;
    }
    return false;
  }
}

/** Thumb–index pinch with hysteresis so it doesn't flicker at the threshold. */
export class PinchDetector {
  pinched = false;

  constructor(
    private readonly on = 0.022,
    private readonly off = 0.035,
  ) {}

  update(distance: number, tracked: boolean): 'start' | 'end' | null {
    if (!tracked) {
      if (this.pinched) {
        this.pinched = false;
        return 'end';
      }
      return null;
    }
    if (!this.pinched && distance < this.on) {
      this.pinched = true;
      return 'start';
    }
    if (this.pinched && distance > this.off) {
      this.pinched = false;
      return 'end';
    }
    return null;
  }
}

/** True when (x, y) lies within `radius` of the edge of any capsule (or inside one). */
export function capsulesNear(caps: Float32Array, start: number, count: number, x: number, y: number, radius: number): boolean {
  for (let i = 0; i < count; i++) {
    const o = (start + i) * CAPSULE_STRIDE;
    const ax = caps[o];
    const ay = caps[o + 1];
    const ex = caps[o + 3] - ax;
    const ey = caps[o + 4] - ay;
    const ee = ex * ex + ey * ey;
    let h = ee > 1e-12 ? ((x - ax) * ex + (y - ay) * ey) / ee : 0;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = x - ax - ex * h;
    const dy = y - ay - ey * h;
    const r = caps[o + 2] + (caps[o + 5] - caps[o + 2]) * h + radius;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}
