import { describe, expect, it } from 'vitest';
import { HopperCreature } from '../../src/core/creature.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.6, v: 0.4 };

describe('HopperCreature', () => {
  it('stays inside the light pool while wandering', () => {
    const c = new HopperCreature('rabbit', 0, 0, 1, 0.25, mulberry32(1));
    for (let i = 0; i < 6000; i++) {
      c.update(1 / 60, pool);
      expect((c.x / pool.u) ** 2 + (c.y / pool.v) ** 2).toBeLessThanOrEqual(1.0001);
    }
  });

  it('hops while moving, faces its direction and sometimes rests', () => {
    const c = new HopperCreature('rabbit', 0, 0, 1, 0.25, mulberry32(3));
    let hopped = false;
    let rested = false;
    for (let i = 0; i < 1200; i++) {
      c.update(1 / 60, pool);
      if (c.hop > 0.01) hopped = true;
      if (c.resting) rested = true;
    }
    expect(hopped).toBe(true);
    expect(rested).toBe(true);
    expect([1, -1]).toContain(c.facing);
  });
});
