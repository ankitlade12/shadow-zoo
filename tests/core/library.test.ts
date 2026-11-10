import { describe, expect, it } from 'vitest';
import { J, JOINT_COUNT } from '../../src/core/joints.js';
import { buildCreatureShapes, canonicalCapsules, CREATURES } from '../../src/core/library.js';
import { TUNING } from '../../src/core/matcher.js';
import { createJointSet, type JointSet } from '../../src/core/poses.js';
import { mulberry32 } from '../../src/core/rng.js';
import { createFrame, matchScore, Silhouettes, type TargetShape } from '../../src/core/silhouette.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const frame = createFrame();
const score = (caps: Float32Array, count: number, target: TargetShape) => matchScore(sil, caps, 0, count, target, frame);

const mapJoints = (src: JointSet, fn: (x: number, y: number, z: number) => [number, number, number]): JointSet => {
  const out = createJointSet();
  const wx = src.pos[J.wrist * 3];
  const wy = src.pos[J.wrist * 3 + 1];
  const wz = src.pos[J.wrist * 3 + 2];
  for (let i = 0; i < JOINT_COUNT; i++) {
    const [x, y, z] = fn(src.pos[i * 3] - wx, src.pos[i * 3 + 1] - wy, src.pos[i * 3 + 2] - wz);
    out.pos[i * 3] = x + wx;
    out.pos[i * 3 + 1] = y + wy;
    out.pos[i * 3 + 2] = z + wz;
    out.rad[i] = src.rad[i];
  }
  return out;
};
const rotZ = (deg: number) => (x: number, y: number, z: number): [number, number, number] => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [x * c - y * s, x * s + y * c, z];
};
const rotY = (deg: number) => (x: number, y: number, z: number): [number, number, number] => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [x * c + z * s, y, -x * s + z * c];
};

const ids = CREATURES.map((c) => c.id);
const normal = TUNING.normal;

describe('creature library', () => {
  it('defines six one-handed creatures', () => {
    expect(ids).toEqual(['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle']);
  });

  it.each(ids)('%s matches its own silhouette', (id) => {
    const s = shapes.get(id)!;
    expect(score(s.caps, s.count, s.target)).toBeGreaterThan(0.95);
  });

  it.each(ids)('%s survives hand size, in-plane rotation and joint noise', (id) => {
    const s = shapes.get(id)!;
    for (const k of [0.85, 1.15]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, (x, y, z) => [x * k, y * k, z * k]));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
    }
    for (const deg of [-12, 12]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, rotZ(deg)));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
    }
    const rng = mulberry32(42);
    const noisy = mapJoints(s.joints, (x, y, z) => [x + (rng() - 0.5) * 0.008, y + (rng() - 0.5) * 0.008, z + (rng() - 0.5) * 0.008]);
    const { caps, count } = canonicalCapsules(noisy);
    expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
  });

  it.each(ids)('%s still reads after a 10 degree turn toward the wall', (id) => {
    const s = shapes.get(id)!;
    for (const deg of [-10, 10]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, rotY(deg)));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.floor);
    }
  });

  it('different creatures do not match each other', () => {
    const report: string[] = [];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const sa = shapes.get(a)!;
        const value = score(sa.caps, sa.count, shapes.get(b)!.target);
        if (value >= normal.threshold - 0.05) report.push(`${a} vs ${b}: ${value.toFixed(3)}`);
      }
    }
    expect(report).toEqual([]);
  });
});
