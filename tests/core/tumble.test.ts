import { describe, expect, it } from 'vitest';
import { Creature, groundY, type CreatureEvent } from '../../src/core/creature.js';
import type { Motion } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };
const run = (c: Creature, seconds: number, events: CreatureEvent[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, pool, events);
  return events;
};
/** A creature that has appeared and settled. */
const settled = (motion: Motion = 'hop', y = 0.2) => {
  const c = new Creature(1, 'rabbit', motion, 0, y, 1, 0.15, mulberry32(3));
  run(c, 1);
  return c;
};
const inside = (c: Creature) => (c.x / pool.u) ** 2 + (c.y / pool.v) ** 2 <= 1;

describe('Creature tumbling', () => {
  it('a knocked walker flies up, falls, bounces and lands dizzy, then stands on the ground again', () => {
    const c = settled();
    expect(c.knock(0.3, 1.2, pool)).toBe(true);
    expect(c.mode).toBe('tumble');
    const events: CreatureEvent[] = [];
    let peak = c.y;
    for (let t = 0; t < 4 && c.mode === 'tumble'; t += 1 / 60) {
      c.update(1 / 60, pool, events);
      peak = Math.max(peak, c.y);
      expect(inside(c)).toBe(true);
    }
    expect(peak).toBeGreaterThan(groundY(pool) + 0.08);
    expect(c.mode).toBe('dizzy');
    expect(events.filter((e) => e.type === 'landed')).toHaveLength(1);
    run(c, 1.5);
    expect(['rest', 'wander']).toContain(c.mode);
    expect(c.spin).toBe(0);
    expect(Math.abs(c.y - groundY(pool))).toBeLessThan(0.01);
  });

  it('bounces off the edge of the light instead of leaving it', () => {
    const c = settled('trot');
    c.knock(3, 0.5, pool);
    let turned = false;
    for (let t = 0; t < 2 && c.mode === 'tumble'; t += 1 / 60) {
      c.update(1 / 60, pool, []);
      expect(inside(c)).toBe(true);
      if (c.vx < 0) turned = true;
    }
    expect(turned).toBe(true);
  });

  it('a flier brakes in the air and catches itself instead of crashing down', () => {
    const c = settled('fly');
    c.knock(1.5, -1.5, pool);
    const events: CreatureEvent[] = [];
    for (let t = 0; t < 3; t += 1 / 60) {
      c.update(1 / 60, pool, events);
      expect(inside(c)).toBe(true);
    }
    expect(['rest', 'wander']).toContain(c.mode);
    expect(events.some((e) => e.type === 'landed')).toBe(false);
  });

  it('dangles from a pinch and follows it, then flies off when thrown', () => {
    const c = settled();
    expect(c.grab()).toBe(true);
    expect(c.mode).toBe('held');
    expect(c.busy).toBe(true);
    c.hold(0.2, 0.1);
    run(c, 0.5);
    expect(Math.hypot(c.x - 0.2, c.y - 0.1)).toBeLessThan(0.01);
    c.knock(1, 0.5, pool);
    expect(c.mode).toBe('tumble');
  });

  it('ignores petting, fleeing and celebrating while held or tumbling', () => {
    const c = settled();
    c.grab();
    c.pet();
    c.flee(0.5);
    c.celebrate();
    expect(c.mode).toBe('held');
    c.knock(0.5, 1, pool);
    c.pet();
    c.flee(0.5);
    c.celebrate();
    expect(c.mode).toBe('tumble');
  });

  it('takes one hit at a time, but can be juggled once the moment passes', () => {
    const c = settled();
    expect(c.canBeHit).toBe(true);
    c.knock(0.5, 1, pool);
    expect(c.canBeHit).toBe(false);
    run(c, 0.4);
    expect(c.mode).toBe('tumble');
    expect(c.canBeHit).toBe(true);
  });

  it("can't be picked up or knocked while it is still appearing", () => {
    const c = new Creature(1, 'rabbit', 'hop', 0, 0.2, 1, 0.15, mulberry32(3));
    expect(c.grab()).toBe(false);
    expect(c.knock(1, 1, pool)).toBe(false);
    expect(c.mode).toBe('appear');
  });
});
