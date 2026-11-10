import { CAPSULE_STRIDE } from './projector.js';

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
