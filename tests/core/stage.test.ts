import { describe, expect, it } from 'vitest';
import { ShadowProjector } from '../../src/core/projector.js';
import { buildStage, chooseWall, type PlaneInfo } from '../../src/core/stage.js';
import type { Vec3 } from '../../src/core/vec.js';

const head = { position: [0, 1.2, 0] as Vec3, forward: [0, 0, -1] as Vec3 };
const wall = (z: number, normal: Vec3 = [0, 0, 1], halfWidth = 2): PlaneInfo => ({
  center: [0, 1.3, z],
  normal,
  vertical: true,
  polygon: [[-halfWidth, 0, z], [halfWidth, 0, z], [halfWidth, 2.6, z], [-halfWidth, 2.6, z]],
});
const close = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5));

describe('chooseWall', () => {
  it('chooses the wall straight ahead', () => {
    const w = chooseWall([wall(-2)], head)!;
    expect(w.distance).toBeCloseTo(2);
    close(w.normal, [0, 0, 1]);
  });

  it('flips a normal that points away from the player', () => {
    close(chooseWall([wall(-2, [0, 0, -1])], head)!.normal, [0, 0, 1]);
  });

  it('ignores floors, walls behind, walls out of range and walls missed by the gaze', () => {
    const floor: PlaneInfo = { ...wall(-2), vertical: false };
    expect(chooseWall([floor], head)).toBeNull();
    expect(chooseWall([wall(2, [0, 0, -1])], head)).toBeNull();
    expect(chooseWall([wall(-6)], head)).toBeNull();
    const offToSide: PlaneInfo = { ...wall(-2), polygon: [[1, 0, -2], [3, 0, -2], [3, 2.6, -2], [1, 2.6, -2]] };
    expect(chooseWall([offToSide], head)).toBeNull();
  });

  it('prefers the nearest wall along the gaze', () => {
    expect(chooseWall([wall(-3.5), wall(-1.5)], head)!.distance).toBeCloseTo(1.5);
  });
});

describe('buildStage', () => {
  it('puts the stage on the wall just below eye height with a right-handed basis', () => {
    const s = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    expect(s.fallback).toBe(false);
    close(s.origin, [0, 1.1, -2]);
    close(s.u, [1, 0, 0]);
    close(s.v, [0, 1, 0]);
    close(s.n, [0, 0, 1]);
  });

  it('falls back to a paper screen when no wall qualifies', () => {
    const s = buildStage(head, null, { narrow: false });
    expect(s.fallback).toBe(true);
    close(s.origin, [0, 1.1, -1.6]);
    close(s.n, [0, 0, 1]);
  });

  it('places the lantern so the comfortable hand point shadows the stage center', () => {
    const s = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    const p = new ShadowProjector();
    p.setup(s.lantern, s);
    expect(p.project(s.hand[0], s.hand[1], s.hand[2])).toBe(true);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6);
    expect(p.t).toBeGreaterThan(2);
    expect(p.t).toBeLessThan(4);
  });

  it('shrinks the light pool in narrow view and keeps it on the wall', () => {
    const wide = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    const narrow = buildStage(head, chooseWall([wall(-2)], head), { narrow: true });
    expect(narrow.poolU).toBeLessThan(wide.poolU);
    expect(narrow.poolV).toBeLessThan(wide.poolV);
    const thin = buildStage(head, chooseWall([wall(-2, [0, 0, 1], 0.5)], head), { narrow: false });
    expect(thin.poolU).toBeLessThanOrEqual(0.5);
  });
});
