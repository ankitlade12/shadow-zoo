import { describe, expect, it } from 'vitest';
import { Creature, groundY, type CreatureEvent } from '../../src/core/creature.js';
import type { Motion } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };
const make = (motion: Motion = 'hop', x = 0, y = 0.2, seed = 1) => new Creature(1, 'rabbit', motion, x, y, 1, 0.3, mulberry32(seed));
const run = (c: Creature, seconds: number, events: CreatureEvent[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, pool, events);
  return events;
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
});
