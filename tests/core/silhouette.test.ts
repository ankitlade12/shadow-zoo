import { describe, expect, it } from 'vitest';
import { bestShift, createFrame, iou, matchScore, SIG_BINS, Silhouettes, TargetShape } from '../../src/core/silhouette.js';

const caps = (list: number[][]) => Float32Array.from(list.flat());
const transform = (src: Float32Array, k: number, dx: number, dy: number, deg: number) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 6) {
    for (const [x, y, r] of [[i, i + 1, i + 2], [i + 3, i + 4, i + 5]]) {
      out[x] = (src[x] * c - src[y] * s) * k + dx;
      out[y] = (src[x] * s + src[y] * c) * k + dy;
      out[r] = src[r] * k;
    }
  }
  return out;
};
// An "L": long horizontal bar plus a short vertical bar at its right end.
const ell = caps([[-0.1, 0, 0.018, 0.1, 0, 0.018], [0.1, 0, 0.018, 0.1, 0.09, 0.016]]);
const bar = caps([[-0.15, 0, 0.012, 0.15, 0, 0.012]]);
const ring = caps(
  Array.from({ length: 8 }, (_, i) => {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    return [Math.cos(a0) * 0.1, Math.sin(a0) * 0.1, 0.01, Math.cos(a1) * 0.1, Math.sin(a1) * 0.1, 0.01];
  }),
);

describe('silhouettes', () => {
  const sil = new Silhouettes();

  it('iou is 1 for identical masks and 0 for disjoint ones', () => {
    const a = new Uint8Array([1, 1, 0, 0]);
    expect(iou(a, a)).toBe(1);
    expect(iou(a, new Uint8Array([0, 0, 1, 1]))).toBe(0);
  });

  it('measures the centroid and area of a capsule', () => {
    const f = createFrame();
    const single = caps([[-0.1, 0, 0.02, 0.1, 0, 0.02]]);
    expect(sil.measure(single, 0, 1, f)).toBe(true);
    expect(Math.abs(f.cx)).toBeLessThan(0.005);
    expect(Math.abs(f.cy)).toBeLessThan(0.005);
    const expected = Math.sqrt(0.2 * 0.04 + Math.PI * 0.02 * 0.02);
    expect(Math.abs(f.size - expected) / expected).toBeLessThan(0.08);
  });

  it('is invariant to translation and scale', () => {
    const target = new TargetShape(ell, 2, sil);
    expect(matchScore(sil, transform(ell, 1.7, 0.3, -0.2, 0), 0, 2, target, createFrame())).toBeGreaterThan(0.9);
  });

  it('tolerates rotations up to about 24 degrees at any angle in between', () => {
    const target = new TargetShape(ell, 2, sil);
    for (const deg of [-20, -9, -3, 3, 6, 10, 15, 20, 24]) {
      expect(matchScore(sil, transform(ell, 1, 0, 0, deg), 0, 2, target, createFrame())).toBeGreaterThan(0.8);
    }
  });

  it('bestShift recovers a circular rotation of a signature', () => {
    const sig = new Float32Array(SIG_BINS);
    sig[10] = 1;
    sig[11] = 0.5;
    const rotated = new Float32Array(SIG_BINS);
    for (let b = 0; b < SIG_BINS; b++) rotated[(b + 3) % SIG_BINS] = sig[b];
    const out = bestShift(sig, rotated, { k: 0, d: 0 });
    expect(out.k).toBe(3);
    expect(out.d).toBe(0);
  });

  it('accepts the mirrored silhouette', () => {
    const target = new TargetShape(ell, 2, sil);
    const mirrored = caps([[0.1, 0, 0.018, -0.1, 0, 0.018], [-0.1, 0, 0.018, -0.1, 0.09, 0.016]]);
    expect(matchScore(sil, mirrored, 0, 2, target, createFrame())).toBeGreaterThan(0.95);
  });

  it('rejects clearly different shapes', () => {
    const target = new TargetShape(ring, 8, sil);
    expect(matchScore(sil, bar, 0, 1, target, createFrame())).toBeLessThan(0.35);
  });

  it('scores zero when there is nothing to match', () => {
    const target = new TargetShape(ell, 2, sil);
    expect(matchScore(sil, ell, 0, 0, target, createFrame())).toBe(0);
  });
});
