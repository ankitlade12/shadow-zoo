import { describe, expect, it } from 'vitest';
import { Creature, groundY, halfWidthAt, type CreatureEvent } from '../../src/core/creature.js';
import type { Motion } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };
const make = (motion: Motion = 'hop', x = 0, y = 0.2, seed = 1) => new Creature(1, 'rabbit', motion, x, y, 1, 0.3, mulberry32(seed));
const run = (c: Creature, seconds: number, events: CreatureEvent[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, pool, events);
  return events;
};
/** Steps until the creature sets off on a wander (it appears and rests first). */
const untilWandering = (c: Creature) => {
  for (let i = 0; i < 600 && c.mode !== 'wander'; i++) c.update(1 / 60, pool, []);
};
/** A rabbit hopping steadily left on a long wander, `extra` seconds after it got up to speed. */
const hoppingLeft = (extra = 0) => {
  const c = make('hop', 0, 0.2, 4);
  c.pickSpot = (_self, halfWidth) => -halfWidth;
  untilWandering(c);
  run(c, 0.6 + extra);
  return c;
};
/** How high the rabbit's hops reach at a walk. */
const hopHeight = () => {
  const c = hoppingLeft();
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    c.update(1 / 60, pool, []);
    peak = Math.max(peak, c.lift);
  }
  return peak;
};

describe('Creature', () => {
  it('appears with a bounce and settles onto the ground line', () => {
    const c = make();
    run(c, 1);
    expect(c.mode).not.toBe('appear');
    expect(Math.abs(c.y - groundY(pool))).toBeLessThan(0.01);
  });

  it.each<Motion>(['hop', 'trot', 'slither', 'strut', 'dangle', 'creep'])('%s wanders without leaving the pool', (motion) => {
    const c = make(motion, 0, 0, 7);
    for (let i = 0; i < 60 * 60; i++) {
      c.update(1 / 60, pool, []);
      expect((c.x / pool.u) ** 2 + (c.y / pool.v) ** 2).toBeLessThanOrEqual(1);
    }
  });

  it('chases a target until it is reached', () => {
    const c = make('trot');
    run(c, 1);
    c.chase(9, 0.4, groundY(pool) + 0.1);
    let reached = false;
    for (let i = 0; i < 600 && !reached; i++) {
      c.update(1 / 60, pool, []);
      reached = c.reached();
    }
    expect(reached).toBe(true);
  });

  it('the spider reaches targets above the ground', () => {
    const c = make('dangle', 0, 0.3);
    run(c, 1);
    c.chase(9, 0.2, 0.1);
    let reached = false;
    for (let i = 0; i < 900 && !reached; i++) {
      c.update(1 / 60, pool, []);
      reached = c.reached();
    }
    expect(reached).toBe(true);
  });

  it('eating emits one ate event and then cheers', () => {
    const c = make();
    run(c, 1);
    c.startEat();
    const events = run(c, 1);
    expect(events).toHaveLength(1);
    expect(events[0].creature).toBe(c);
    expect(c.mode).toBe('happy');
  });

  it('flees away from a threat and can be calmed', () => {
    const c = make('trot');
    run(c, 1);
    c.x = 0;
    c.flee(-0.1);
    run(c, 0.3);
    expect(c.x).toBeGreaterThan(0.1);
    c.calm();
    expect(c.mode).toBe('rest');
  });

  it('blinks now and then', () => {
    const c = make();
    let blinked = false;
    for (let i = 0; i < 60 * 10; i++) {
      c.update(1 / 60, pool, []);
      if (c.eyeOpen === 0) blinked = true;
    }
    expect(blinked).toBe(true);
  });

  it('does a spin trick when petted with three or more hearts', () => {
    const c = make('trot');
    run(c, 1);
    c.mode = 'rest';
    c.bond = 3;
    c.pet();
    run(c, 0.45);
    expect(c.spin).toBeGreaterThan(0.5);
    expect(c.spin).toBeLessThan(Math.PI * 2);
    run(c, 0.6);
    expect(c.spin).toBe(0);
  });

  it('keeps its cast size while appearing, then eases to its zoo fit', () => {
    const c = make();
    c.fitTarget = 0.5;
    run(c, 0.5);
    expect(c.size).toBeCloseTo(0.3, 5);
    run(c, 3);
    expect(c.size).toBeCloseTo(0.15, 3);
    expect(c.scale).toBeCloseTo(0.5, 3);
  });

  it('walks to the spot its picker chooses', () => {
    const c = make('trot', 0, 0.2, 3);
    const jitters: number[] = [];
    c.pickSpot = (self, halfWidth, jitter) => {
      expect(self).toBe(c);
      expect(halfWidth).toBeCloseTo(halfWidthAt(pool, groundY(pool)), 6);
      jitters.push(jitter);
      return 0.3;
    };
    run(c, 12);
    expect(jitters.length).toBeGreaterThan(0);
    for (const j of jitters) expect(Math.abs(j)).toBeLessThanOrEqual(1);
    expect(c.x).toBeCloseTo(0.3, 2);
  });

  it('hops lower with reduced motion', () => {
    const peak = (scale: number) => {
      const c = make('hop', 0, 0, 5);
      c.motionScale = scale;
      let max = 0;
      for (let i = 0; i < 60 * 20; i++) {
        c.update(1 / 60, pool, []);
        max = Math.max(max, c.lift);
      }
      return max;
    };
    expect(peak(0.35)).toBeLessThan(peak(1) * 0.5);
  });

  it.each(['chase', 'flee'] as const)('keeps its hop smooth when a walk turns into a %s', (next) => {
    const height = hopHeight();
    // Switch at many moments of the hop: none of them may make the shadow jump.
    let jump = 0;
    for (let k = 0; k < 12; k++) {
      const c = hoppingLeft(k * 0.05);
      const before = c.lift;
      if (next === 'chase') c.chase(9, c.x - 0.4, groundY(pool));
      else c.flee(c.x + 0.1);
      c.update(1 / 60, pool, []);
      jump = Math.max(jump, Math.abs(c.lift - before));
    }
    expect(height).toBeGreaterThan(0.05);
    expect(jump).toBeLessThan(0.25 * height);
  });

  it('lands softly when it stops in mid-hop', () => {
    const height = hopHeight();
    const c = hoppingLeft();
    for (let i = 0; i < 60 && c.lift < 0.7 * height; i++) c.update(1 / 60, pool, []);
    const high = c.lift;
    expect(high).toBeGreaterThanOrEqual(0.7 * height);
    c.stay();
    c.update(1 / 60, pool, []);
    expect(c.mode).toBe('rest');
    expect(c.lift).toBeGreaterThan(0.6 * high);
    run(c, 0.4);
    expect(c.lift).toBeLessThan(0.05 * high);
  });

  it('sets off gently and slows down before it stops', () => {
    const c = make('trot', 0, 0.2, 3);
    c.pickSpot = (_self, halfWidth) => 0.9 * halfWidth;
    untilWandering(c);
    const speeds: number[] = [];
    while (c.mode === 'wander' && speeds.length < 600) {
      const x = c.x;
      c.update(1 / 60, pool, []);
      speeds.push(Math.abs(c.x - x) * 60);
    }
    const top = Math.max(...speeds);
    expect(speeds[0]).toBeLessThan(0.2 * top);
    const upToSpeed = speeds.findIndex((s) => s > 0.95 * top) / 60;
    expect(upToSpeed).toBeGreaterThan(0.3);
    expect(upToSpeed).toBeLessThan(0.6);
    const last = speeds.slice(-12);
    expect(last.reduce((a, b) => a + b, 0) / last.length).toBeLessThan(0.6 * top);
  });

  it('turns round through side-on instead of flipping its shadow', () => {
    const c = make('trot');
    run(c, 1);
    expect(c.facing).toBe(1);
    c.chase(9, c.x - 0.4, groundY(pool));
    const seen = [c.facing];
    for (let i = 0; i < 60; i++) {
      c.update(1 / 60, pool, []);
      seen.push(c.facing);
    }
    let biggest = 0;
    for (let i = 1; i < seen.length; i++) biggest = Math.max(biggest, Math.abs(seen[i] - seen[i - 1]));
    expect(biggest).toBeLessThan(0.3);
    expect(Math.min(...seen.map(Math.abs))).toBeLessThan(0.15);
    expect(seen.filter((f) => Math.abs(f) < 0.95).length).toBeGreaterThanOrEqual(8);
    expect(seen[seen.length - 1]).toBeCloseTo(-1, 6);
  });
});
