import { CAPSULE_STRIDE } from './projector.js';

export const GRID = 48;
/** Fraction of the grid spanned by one sqrt(area) of the normalized shape. */
const SPAN = 0.28;

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

/** Directions in a radial signature (5.625° each). */
export const SIG_BINS = 64;
const SIG_STEP = (Math.PI * 2) / SIG_BINS;

/** Rasterizes unions of tapered capsules into square binary masks. */
export class Silhouettes {
  readonly grid: number;
  readonly scratch: Uint8Array;
  private readonly coarse: Uint8Array;
  /** Per-pixel signature bin and normalized radius for a mask centered on the grid. */
  private readonly pixelBin: Uint8Array;
  private readonly pixelRadius: Float32Array;

  constructor(grid = GRID) {
    this.grid = grid;
    this.scratch = new Uint8Array(grid * grid);
    this.coarse = new Uint8Array(grid * grid);
    this.pixelBin = new Uint8Array(grid * grid);
    this.pixelRadius = new Float32Array(grid * grid);
    const c = grid / 2;
    for (let py = 0; py < grid; py++) {
      for (let px = 0; px < grid; px++) {
        const dx = px + 0.5 - c;
        const dy = py + 0.5 - c;
        const bin = Math.floor((Math.atan2(dy, dx) + Math.PI) / SIG_STEP);
        this.pixelBin[py * grid + px] = bin >= SIG_BINS ? SIG_BINS - 1 : bin;
        this.pixelRadius[py * grid + px] = Math.hypot(dx, dy) / (grid * SPAN);
      }
    }
  }

  /** Outer reach of a normalized mask in each direction, in units of sqrt(area). */
  signature(mask: Uint8Array, out: Float32Array): Float32Array {
    out.fill(0);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const b = this.pixelBin[i];
      const r = this.pixelRadius[i];
      if (r > out[b]) out[b] = r;
    }
    return out;
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

/** A target silhouette rasterized once, in both facings, with radial signatures. */
export class TargetShape {
  readonly mask: Uint8Array;
  readonly mirrored: Uint8Array;
  readonly sig = new Float32Array(SIG_BINS);
  readonly sigMirrored = new Float32Array(SIG_BINS);
  readonly frame: ShapeFrame = createFrame();

  constructor(caps: Float32Array, count: number, sil: Silhouettes) {
    this.mask = new Uint8Array(sil.grid * sil.grid);
    this.mirrored = new Uint8Array(sil.grid * sil.grid);
    if (!sil.measure(caps, 0, count, this.frame)) throw new Error('TargetShape: empty silhouette');
    sil.rasterize(caps, 0, count, this.frame, 0, false, this.mask);
    sil.rasterize(caps, 0, count, this.frame, 0, true, this.mirrored);
    smoothSignature(sil.signature(this.mask, this.sig));
    smoothSignature(sil.signature(this.mirrored, this.sigMirrored));
  }
}

/** Largest rotation tolerated, in signature bins (5 × 5.625° ≈ 28°). */
const SIG_SHIFT = 5;
/** Signature distance treated as noise. */
export const SIG_TOLERANCE = 0.05;
/** Score lost per unit of signature distance beyond the tolerance. */
export const SIG_WEIGHT = 3;
/** Half-bin refinements tried around the best signature shift. */
const REFINE: readonly number[] = [-0.5, 0, 0.5];

const smoothScratch = new Float32Array(SIG_BINS);

/** Circular [1/4, 1/2, 1/4] blur so features that straddle two bins compare smoothly. */
export function smoothSignature(sig: Float32Array): Float32Array {
  smoothScratch.set(sig);
  for (let b = 0; b < SIG_BINS; b++) {
    const prev = smoothScratch[(b + SIG_BINS - 1) % SIG_BINS];
    const next = smoothScratch[(b + 1) % SIG_BINS];
    sig[b] = 0.25 * prev + 0.5 * smoothScratch[b] + 0.25 * next;
  }
  return sig;
}

/** Best circular shift k (player rotated counterclockwise by k bins) and its mean absolute difference. */
export function bestShift(player: Float32Array, target: Float32Array, out: { k: number; d: number }): { k: number; d: number } {
  out.k = 0;
  out.d = Infinity;
  for (let k = -SIG_SHIFT; k <= SIG_SHIFT; k++) {
    let sum = 0;
    for (let b = 0; b < SIG_BINS; b++) {
      let src = b - k;
      if (src < 0) src += SIG_BINS;
      else if (src >= SIG_BINS) src -= SIG_BINS;
      sum += Math.abs(player[src] - target[b]);
    }
    if (sum < out.d) {
      out.d = sum;
      out.k = k;
    }
  }
  out.d /= SIG_BINS;
  return out;
}

const playerSig = new Float32Array(SIG_BINS);
const shift = { k: 0, d: 0 };

/**
 * Shape similarity in [0, 1] against either facing of the target. The radial signature finds the best
 * rotation (within ±28°) and penalizes misplaced protrusions such as ears, jaws and legs. The normalized
 * IoU at that rotation, refined by half a bin, scores the overall form.
 */
export function matchScore(sil: Silhouettes, caps: Float32Array, start: number, count: number, target: TargetShape, frame: ShapeFrame): number {
  if (!sil.measure(caps, start, count, frame)) return 0;
  sil.rasterize(caps, start, count, frame, 0, false, sil.scratch);
  smoothSignature(sil.signature(sil.scratch, playerSig));
  let best = 0;
  for (let facing = 0; facing < 2; facing++) {
    const sig = facing === 0 ? target.sig : target.sigMirrored;
    const mask = facing === 0 ? target.mask : target.mirrored;
    bestShift(playerSig, sig, shift);
    let bestIou = 0;
    for (let j = 0; j < REFINE.length; j++) {
      sil.rasterize(caps, start, count, frame, (shift.k + REFINE[j]) * SIG_STEP, false, sil.scratch);
      const value = iou(sil.scratch, mask);
      if (value > bestIou) bestIou = value;
    }
    const score = bestIou - SIG_WEIGHT * Math.max(0, shift.d - SIG_TOLERANCE);
    if (score > best) best = score;
  }
  return best;
}
