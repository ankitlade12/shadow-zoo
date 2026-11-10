import { describe, expect, it } from 'vitest';
import { BONES } from '../../src/core/joints.js';
import { buildJointSet, builtinAngles, orientJointSet } from '../../src/core/poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from '../../src/core/projector.js';

const stage: StagePlane = { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };

describe('ShadowProjector', () => {
  it('projects a point through the light onto the stage', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    expect(p.project(0.1, 0.05, 0)).toBe(true);
    expect(p.x).toBeCloseTo(0.2);
    expect(p.y).toBeCloseTo(0.1);
    expect(p.t).toBeCloseTo(2);
  });

  it('rejects points behind the light or beyond the wall', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    expect(p.project(0, 0, 2)).toBe(false);
    expect(p.project(0, 0, -1.5)).toBe(false);
  });

  it('projects every bone of a hand held between light and wall', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    const hand = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [0, 0, 0]);
    const out = new Float32Array((BONES.length + 1) * CAPSULE_STRIDE);
    const n = p.projectBones(hand, out, 0);
    expect(n).toBe(BONES.length);
    for (let i = 0; i < n; i++) {
      expect(out[i * CAPSULE_STRIDE + 2]).toBeGreaterThan(0.01);
      expect(out[i * CAPSULE_STRIDE + 5]).toBeGreaterThan(0.01);
    }
    expect(p.projectForearm(hand, out, n)).toBe(1);
    const fy = out[n * CAPSULE_STRIDE + 4];
    expect(fy).toBeLessThan(out[n * CAPSULE_STRIDE + 1]);
  });
});
