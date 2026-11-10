import { CAPSULE_STRIDE } from './projector.js';

export const GRID = 48;
/** Fraction of the grid spanned by one sqrt(area) of the normalized shape. */
const SPAN = 0.28;
export const ROTATION_SEARCH: readonly number[] = [-24, -12, 0, 12, 24].map((d) => (d * Math.PI) / 180);

/** Centroid (stage meters) and sqrt(area) of a shape. */
export interface ShapeFrame {
  cx: number;
  cy: number;
  size: number;
}
export const createFrame = (): ShapeFrame => ({ cx: 0, cy: 0, size: 0 });

export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += a[i] & b[i];
    union += a[i] | b[i];
  }
  return union > 0 ? inter / union : 0;
}

/** Rasterizes unions of tapered capsules into square binary masks. */
export class Silhouettes {
  readonly grid: number;
  readonly scratch: Uint8Array;
  private readonly coarse: Uint8Array;

  constructor(grid = GRID) {
    this.grid = grid;
    this.scratch = new Uint8Array(grid * grid);
    this.coarse = new Uint8Array(grid * grid);
  }

  /** Centroid and sqrt(area) of the capsule union, from a raster over its bounding square. */
  measure(caps: Float32Array, start: number, count: number, out: ShapeFrame): boolean {
    if (count <= 0) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      minX = Math.min(minX, caps[o] - caps[o + 2], caps[o + 3] - caps[o + 5]);
      maxX = Math.max(maxX, caps[o] + caps[o + 2], caps[o + 3] + caps[o + 5]);
      minY = Math.min(minY, caps[o + 1] - caps[o + 2], caps[o + 4] - caps[o + 5]);
      maxY = Math.max(maxY, caps[o + 1] + caps[o + 2], caps[o + 4] + caps[o + 5]);
    }
    const side = Math.max(maxX - minX, maxY - minY) * 1.04;
    if (!(side > 1e-6)) return false;
    const s = this.grid / side;
    const bx = (minX + maxX) / 2;
    const by = (minY + maxY) / 2;
    const g0 = this.grid / 2;
    const filled = this.fill(caps, start, count, bx, by, s, 0, false, this.coarse);
    if (filled === 0) return false;
    let sx = 0;
    let sy = 0;
    for (let py = 0; py < this.grid; py++) {
      for (let px = 0; px < this.grid; px++) {
        if (this.coarse[py * this.grid + px]) {
          sx += px + 0.5;
          sy += py + 0.5;
        }
      }
    }
    out.cx = (sx / filled - g0) / s + bx;
    out.cy = (sy / filled - g0) / s + by;
    out.size = Math.sqrt(filled) / s;
    return true;
  }

  /** Normalized raster: centered on the frame, scaled by its size, rotated by theta, optionally mirrored in x. */
  rasterize(caps: Float32Array, start: number, count: number, frame: ShapeFrame, theta: number, mirror: boolean, out: Uint8Array): number {
    const s = (this.grid * SPAN) / Math.max(frame.size, 1e-6);
    return this.fill(caps, start, count, frame.cx, frame.cy, s, theta, mirror, out);
  }

  /** grid = R(theta) * (mirror ? flipX : I) * (p - c) * s + grid / 2. Returns filled pixels. */
  private fill(caps: Float32Array, start: number, count: number, cx: number, cy: number, s: number, theta: number, mirror: boolean, out: Uint8Array): number {
    out.fill(0);
    const g = this.grid;
    const g0 = g / 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const mx = mirror ? -1 : 1;
    let filled = 0;
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      const ax0 = (caps[o] - cx) * mx;
      const ay0 = caps[o + 1] - cy;
      const bx0 = (caps[o + 3] - cx) * mx;
      const by0 = caps[o + 4] - cy;
      const ax = (ax0 * cos - ay0 * sin) * s + g0;
      const ay = (ax0 * sin + ay0 * cos) * s + g0;
      const bx = (bx0 * cos - by0 * sin) * s + g0;
      const by = (bx0 * sin + by0 * cos) * s + g0;
      const ra = caps[o + 2] * s;
      const rb = caps[o + 5] * s;
      const r = Math.max(ra, rb);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
      const x1 = Math.min(g - 1, Math.ceil(Math.max(ax, bx) + r));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
      const y1 = Math.min(g - 1, Math.ceil(Math.max(ay, by) + r));
      const ex = bx - ax;
      const ey = by - ay;
      const ee = ex * ex + ey * ey;
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const idx = py * g + px;
          if (out[idx]) continue;
          const qx = px + 0.5 - ax;
          const qy = py + 0.5 - ay;
          let h = ee > 1e-12 ? (qx * ex + qy * ey) / ee : 0;
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          const dx = qx - ex * h;
          const dy = qy - ey * h;
          const rr = ra + (rb - ra) * h;
          if (dx * dx + dy * dy <= rr * rr) {
            out[idx] = 1;
            filled++;
          }
        }
      }
    }
    return filled;
  }
}

/** A target silhouette rasterized once, in both facings. */
export class TargetShape {
  readonly mask: Uint8Array;
  readonly mirrored: Uint8Array;
  readonly frame: ShapeFrame = createFrame();

  constructor(caps: Float32Array, count: number, sil: Silhouettes) {
    this.mask = new Uint8Array(sil.grid * sil.grid);
    this.mirrored = new Uint8Array(sil.grid * sil.grid);
    if (!sil.measure(caps, 0, count, this.frame)) throw new Error('TargetShape: empty silhouette');
    sil.rasterize(caps, 0, count, this.frame, 0, false, this.mask);
    sil.rasterize(caps, 0, count, this.frame, 0, true, this.mirrored);
  }
}

/** Best IoU of the player's capsules against either facing of the target over the rotation search. */
export function matchScore(sil: Silhouettes, caps: Float32Array, start: number, count: number, target: TargetShape, frame: ShapeFrame): number {
  if (!sil.measure(caps, start, count, frame)) return 0;
  let best = 0;
  for (let k = 0; k < ROTATION_SEARCH.length; k++) {
    sil.rasterize(caps, start, count, frame, ROTATION_SEARCH[k], false, sil.scratch);
    const a = iou(sil.scratch, target.mask);
    const b = iou(sil.scratch, target.mirrored);
    if (a > best) best = a;
    if (b > best) best = b;
  }
  return best;
}
