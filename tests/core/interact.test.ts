import { describe, expect, it } from 'vitest';
import { capsulesNear, ClapDetector, palmGap, PinchDetector } from '../../src/core/interact.js';
import { J } from '../../src/core/joints.js';
import { createJointSet } from '../../src/core/poses.js';
import { buildCreatureShapes } from '../../src/core/library.js';
import { openness, WEAR_ON, WornState } from '../../src/core/puppet.js';
import { VoiceLimiter } from '../../src/core/voices.js';

describe('PinchDetector', () => {
  it('starts below the on distance and ends above the off distance', () => {
    const p = new PinchDetector(0.02, 0.035);
    expect(p.update(0.05, true)).toBeNull();
    expect(p.update(0.015, true)).toBe('start');
    expect(p.update(0.03, true)).toBeNull();
    expect(p.update(0.04, true)).toBe('end');
  });

  it('ends a pinch when tracking is lost', () => {
    const p = new PinchDetector();
    p.update(0.01, true);
    expect(p.update(0.01, false)).toBe('end');
    expect(p.update(0.01, false)).toBeNull();
  });
});

describe('capsulesNear', () => {
  const caps = Float32Array.from([0, 0, 0.02, 0.2, 0, 0.02]);
  it('detects points near a capsule, including an extra radius', () => {
    expect(capsulesNear(caps, 0, 1, 0.1, 0.03, 0)).toBe(false);
    expect(capsulesNear(caps, 0, 1, 0.1, 0.03, 0.02)).toBe(true);
    expect(capsulesNear(caps, 0, 1, 0.5, 0, 0.1)).toBe(false);
  });
});

describe('puppet', () => {
  const shapes = buildCreatureShapes();

  it('openness is 1 in the base pose and 0 in the act pose', () => {
    for (const shape of shapes.values()) {
      expect(openness(shape.joints, shape.actuator)).toBeCloseTo(1, 5);
      expect(openness(shape.actJoints, shape.actuator)).toBeCloseTo(0, 5);
    }
  });

  it('wears a creature after a short hold and lets go after it is lost', () => {
    const w = new WornState();
    const tick = 1 / 6;
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    expect(w.species).toBeNull();
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    expect(w.species).toBe('dog');
    for (let i = 0; i < 3; i++) w.updateMatch(tick, null, 0);
    expect(w.species).toBe('dog');
    w.updateMatch(tick, null, 0);
    expect(w.species).toBeNull();
  });

  it('voices once per snap shut, with a cooldown', () => {
    const w = new WornState();
    let voices = 0;
    const hold = (open: number) => {
      for (let i = 0; i < 30; i++) if (w.updateAction(1 / 60, open)) voices++;
    };
    hold(1);
    hold(0);
    expect(voices).toBe(1);
    hold(1);
    hold(0);
    expect(voices).toBe(2);
  });
});

describe('VoiceLimiter', () => {
  it('limits rapid repeats and polyphony', () => {
    const v = new VoiceLimiter(0.08, 2);
    expect(v.allow('a', 0, 1)).toBe(true);
    expect(v.allow('a', 0.05, 1)).toBe(false);
    expect(v.allow('b', 0.05, 1)).toBe(true);
    expect(v.allow('c', 0.1, 1)).toBe(false);
    expect(v.allow('c', 1.2, 1)).toBe(true);
  });
});

describe('ClapDetector', () => {
  const feed = (d: ClapDetector, gaps: number[]) => gaps.map((gap) => d.update(1 / 60, gap));

  it('fires once when the palms meet quickly after being apart', () => {
    const d = new ClapDetector();
    expect(feed(d, [0.3, 0.25, 0.18, 0.12, 0.06, 0.04, 0.04, 0.05]).filter(Boolean)).toHaveLength(1);
  });

  it('ignores hands brought together slowly, as when hooking thumbs for the bird', () => {
    const d = new ClapDetector();
    const gaps = Array.from({ length: 120 }, (_, i) => 0.3 - (0.26 * i) / 119);
    expect(feed(d, gaps).some(Boolean)).toBe(false);
  });

  it('needs the palms apart again before the next clap, and ignores a hand that comes back already touching', () => {
    const d = new ClapDetector();
    expect(feed(d, [0.3, 0.05]).some(Boolean)).toBe(true);
    expect(feed(d, new Array(120).fill(0.05)).some(Boolean)).toBe(false);
    expect(feed(d, [Infinity, 0.05]).some(Boolean)).toBe(false);
    expect(feed(d, [0.3, 0.05]).some(Boolean)).toBe(true);
  });
});

describe('palmGap', () => {
  it('measures between the two palms', () => {
    const a = createJointSet();
    const b = createJointSet();
    b.pos.set([0.03, 0.04, 0], J.middleProx * 3);
    expect(palmGap(a, b)).toBeCloseTo(0.05, 6);
  });
});
