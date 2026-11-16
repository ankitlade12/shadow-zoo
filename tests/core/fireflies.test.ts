import { describe, expect, it } from 'vitest';
import { groundY } from '../../src/core/creature.js';
import { Fireflies, fireflyGlow, type Firefly } from '../../src/core/fireflies.js';
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

describe('firefly flashes', () => {
  /** A swarm released at once, as at feeding time. */
  const swarm = (n = 40): Firefly[] => {
    const ff = new Fireflies();
    const rng = mulberry32(8);
    const list: Firefly[] = [];
    for (let i = 0; i < n; i++) {
      list.push(ff.spawn(0, 0, pool, rng)!);
      ff.list.length = 0;
    }
    return list;
  };
  /** Its glow, sampled at 60 Hz from its birth for `seconds`. */
  const glowOver = (f: Firefly, seconds: number, gentle = false): number[] => {
    const out: number[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      f.age = i / 60;
      out.push(fireflyGlow(f, gentle));
    }
    return out;
  };
  /** Times (s) its glow rises from its dim base into a flash. */
  const flashStarts = (glow: number[]): number[] => {
    const base = Math.min(...glow);
    const starts: number[] = [];
    for (let i = 1; i < glow.length; i++) if (glow[i - 1] <= base + 0.02 && glow[i] > base + 0.02) starts.push(i / 60);
    return starts;
  };

  it('each flashes on its own rhythm: every 4-9 s, lit for 16-28% of it, some twice', () => {
    const list = swarm();
    for (const f of list) {
      expect(f.period).toBeGreaterThanOrEqual(4);
      expect(f.period).toBeLessThanOrEqual(9);
      expect(f.lit).toBeGreaterThanOrEqual(0.16);
      expect(f.lit).toBeLessThanOrEqual(0.28);
      const glow = glowOver(f, 3 * f.period);
      const lit = glow.filter((g) => g > Math.min(...glow) + 0.02).length / glow.length;
      expect(lit).toBeGreaterThan(0.75 * f.lit);
      expect(lit).toBeLessThanOrEqual(f.lit + 0.01);
      // One rise a cycle, or two for a double flash.
      const starts = flashStarts(glow);
      expect(starts.length).toBe((f.twice ? 2 : 1) * 3);
      for (let i = (f.twice ? 2 : 1); i < starts.length; i += f.twice ? 2 : 1) expect(starts[i] - starts[i - (f.twice ? 2 : 1)]).toBeCloseTo(f.period, 1);
    }
    expect(new Set(list.map((f) => f.period.toFixed(2))).size).toBeGreaterThan(30);
    expect(list.filter((f) => f.twice).length).toBeGreaterThan(4);
    expect(list.filter((f) => !f.twice).length).toBeGreaterThan(20);
  });

  it('always glows dimly between flashes, so it can be seen and fed, and flashes bright', () => {
    for (const f of swarm(10)) {
      const glow = glowOver(f, 2 * f.period);
      expect(Math.min(...glow)).toBeGreaterThanOrEqual(0.3);
      expect(Math.max(...glow)).toBeGreaterThan(0.95);
    }
  });

  it('released together, they light up together, then soon flash out of step', () => {
    const glows = swarm(20).map((f) => glowOver(f, 40));
    const brightAt = (i: number) => glows.filter((g) => g[i] > 0.6).length;
    expect(Math.max(...Array.from({ length: 60 }, (_, i) => brightAt(i)))).toBe(20);
    let most = 0;
    for (let i = 10 * 60; i < 40 * 60; i++) most = Math.max(most, brightAt(i));
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(10);
  });

  it('keeps its flashes soft and single with reduced motion', () => {
    for (const f of swarm(10)) {
      const glow = glowOver(f, 2 * f.period, true);
      const swing = Math.max(...glow) - Math.min(...glow);
      expect(swing).toBeGreaterThan(0.1);
      expect(swing).toBeLessThan(0.4);
      expect(Math.min(...glow)).toBeGreaterThanOrEqual(0.4);
      expect(flashStarts(glow)).toHaveLength(2);
    }
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
