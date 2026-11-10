import { describe, expect, it } from 'vitest';
import { groundY } from '../../src/core/creature.js';
import { Fireflies } from '../../src/core/fireflies.js';
import { HEART, Particles, SPARK } from '../../src/core/particles.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };

describe('Fireflies', () => {
  it('spawns inside the pool, at most six at a time', () => {
    const ff = new Fireflies();
    const rng = mulberry32(1);
    for (let i = 0; i < 8; i++) ff.spawn(5, 5, pool, rng);
    expect(ff.list).toHaveLength(6);
    for (const f of ff.list) expect((f.x / pool.u) ** 2 + (f.y / pool.v) ** 2).toBeLessThanOrEqual(1);
  });

  it('drifts down toward the creatures and expires', () => {
    const ff = new Fireflies();
    const f = ff.spawn(0, 0.3, pool, mulberry32(2))!;
    for (let i = 0; i < 60 * 5; i++) ff.update(1 / 60, pool);
    expect(f.y).toBeLessThan(0.3);
    expect(f.y).toBeGreaterThan(groundY(pool));
    for (let i = 0; i < 60 * 25; i++) ff.update(1 / 60, pool);
    expect(ff.list).toHaveLength(0);
  });

  it('finds the nearest firefly, optionally only free ones, and removes by id', () => {
    const ff = new Fireflies();
    const rng = mulberry32(3);
    const a = ff.spawn(-0.3, 0, pool, rng)!;
    const b = ff.spawn(0.3, 0, pool, rng)!;
    expect(ff.nearest(0.25, 0)!.id).toBe(b.id);
    b.claimed = true;
    expect(ff.nearest(0.25, 0, Infinity, true)!.id).toBe(a.id);
    ff.remove(a.id);
    expect(ff.get(a.id)).toBeNull();
    expect(ff.nearest(0.25, 0, 0.01)).toBeNull();
  });
});

describe('Particles', () => {
  it('emits, lets hearts rise and expires everything', () => {
    const p = new Particles();
    const rng = mulberry32(4);
    p.emit(HEART, 0, 0, 3, 0.2, rng);
    p.emit(SPARK, 0, 0, 5, 0.2, rng);
    expect(p.count).toBe(8);
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    for (let i = 0; i < p.count; i++) if (p.kind[i] === HEART) expect(p.y[i]).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) p.update(1 / 60);
    expect(p.count).toBe(0);
  });
});
