import { CAPSULE_STRIDE } from './projector.js';

export interface Point {
  x: number;
  y: number;
}

/** out = base + (act − base) · w for `count` capsules with identical layout. */
export function blendCapsules(base: Float32Array, act: Float32Array, w: number, count: number, out: Float32Array): void {
  const n = count * CAPSULE_STRIDE;
  for (let i = 0; i < n; i++) out[i] = base[i] + (act[i] - base[i]) * w;
}

/** Moves capsules from canonical space (centered on cx, cy) to (x, y) on the stage; facing −1 mirrors. */
export function placeCapsules(
  src: Float32Array,
  count: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  scale: number,
  facing: number,
  out: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const o = i * CAPSULE_STRIDE;
    out[o] = (src[o] - cx) * scale * facing + x;
    out[o + 1] = (src[o + 1] - cy) * scale + y;
    out[o + 2] = src[o + 2] * scale;
    out[o + 3] = (src[o + 3] - cx) * scale * facing + x;
    out[o + 4] = (src[o + 4] - cy) * scale + y;
    out[o + 5] = src[o + 5] * scale;
  }
}

/** Transforms one canonical point the same way as `placeCapsules`. */
export function placePoint(px: number, py: number, cx: number, cy: number, x: number, y: number, scale: number, facing: number, out: Point): void {
  out.x = (px - cx) * scale * facing + x;
  out.y = (py - cy) * scale + y;
}

/** Rotates capsule endpoints in place by `angle` around (ox, oy); radii are unchanged. */
export function rotateCapsules(caps: Float32Array, count: number, angle: number, ox: number, oy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < count; i++) {
    const o = i * CAPSULE_STRIDE;
    let x = caps[o] - ox;
    let y = caps[o + 1] - oy;
    caps[o] = x * c - y * s + ox;
    caps[o + 1] = x * s + y * c + oy;
    x = caps[o + 3] - ox;
    y = caps[o + 4] - oy;
    caps[o + 3] = x * c - y * s + ox;
    caps[o + 4] = x * s + y * c + oy;
  }
}

/** Rotates a point in place by `angle` around (ox, oy). */
export function rotatePoint(p: Point, angle: number, ox: number, oy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p.x - ox;
  const y = p.y - oy;
  p.x = x * c - y * s + ox;
  p.y = x * s + y * c + oy;
}
