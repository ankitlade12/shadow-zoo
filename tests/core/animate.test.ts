import { describe, expect, it } from 'vitest';
import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint } from '../../src/core/animate.js';

describe('animate', () => {
  it('blends capsules between the base and act poses', () => {
    const base = Float32Array.from([0, 0, 1, 2, 2, 1]);
    const act = Float32Array.from([2, 2, 3, 4, 4, 3]);
    const out = new Float32Array(6);
    blendCapsules(base, act, 0.5, 1, out);
    expect(Array.from(out)).toEqual([1, 1, 2, 3, 3, 2]);
    blendCapsules(base, act, 0, 1, out);
    expect(Array.from(out)).toEqual(Array.from(base));
  });

  it('places capsules and points with scale, offset and mirroring', () => {
    const src = Float32Array.from([1, 0, 0.1, 2, 1, 0.2]);
    const out = new Float32Array(6);
    placeCapsules(src, 1, 1, 0, 10, 20, 2, -1, out);
    expect(Array.from(out).map((v) => +v.toFixed(5))).toEqual([10, 20, 0.2, 8, 22, 0.4]);
    const p = { x: 0, y: 0 };
    placePoint(2, 1, 1, 0, 10, 20, 2, -1, p);
    expect(p).toEqual({ x: 8, y: 22 });
  });

  it('rotates capsules and points around a center', () => {
    const caps = Float32Array.from([2, 1, 0.1, 1, 1, 0.1]);
    rotateCapsules(caps, 1, Math.PI / 2, 1, 1);
    expect(Array.from(caps).map((v) => +v.toFixed(5))).toEqual([1, 2, 0.1, 1, 1, 0.1]);
    const p = { x: 2, y: 1 };
    rotatePoint(p, Math.PI, 1, 1);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });
});
