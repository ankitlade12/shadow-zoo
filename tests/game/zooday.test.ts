import { describe, expect, it } from 'vitest';
import { buildCreatureShapes } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { BETWEEN_MOMENTS, FIRST_MOMENT, ZooDay } from '../../src/game/ZooDay.js';
import { Zoo } from '../../src/game/Zoo.js';

const shapes = buildCreatureShapes(new Silhouettes());
const pool = { u: 0.8, v: 0.6 };

describe('the zoo day', () => {
  it('waits for a stretch of play before the first feeding time', () => {
    const day = new ZooDay();
    expect(day.update(FIRST_MOMENT - 1, true)).toBeNull();
    expect(day.update(1.01, true)).toBe('feeding');
  });

  it('only counts down while the zoo is ready for it', () => {
    const day = new ZooDay();
    expect(day.update(FIRST_MOMENT * 3, false)).toBeNull();
    expect(day.update(FIRST_MOMENT - 1, true)).toBeNull();
  });

  it('alternates feeding time and show time', () => {
    const day = new ZooDay();
    expect(day.update(FIRST_MOMENT + 0.1, true)).toBe('feeding');
    expect(day.update(BETWEEN_MOMENTS - 1, true)).toBeNull();
    expect(day.update(1.1, true)).toBe('show');
    expect(day.update(BETWEEN_MOMENTS + 0.1, true)).toBe('feeding');
  });
});

describe('zoo moments', () => {
  const zooWith = (n: number) => {
    const zoo = new Zoo(shapes, mulberry32(3));
    const events: GameEvent[] = [];
    for (let i = 0; i < n; i++) zoo.add({ species: i % 2 ? 'dog' : 'rabbit', x: (i / n - 0.5) * 0.8, y: 0, size: 0.25, scale: 1 }, events, { silent: true });
    for (let t = 0; t < 1.5; t += 1 / 60) zoo.update(1 / 60, pool, [], null, events);
    events.length = 0;
    return { zoo, events };
  };

  it('feeding time showers fireflies across the light for every creature', () => {
    const { zoo, events } = zooWith(3);
    zoo.feedingTime(pool, events);
    expect(events.filter((e) => e.type === 'feeding')).toHaveLength(1);
    expect(zoo.fireflies.list.length).toBeGreaterThanOrEqual(3);
    const xs = zoo.fireflies.list.map((f) => f.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(pool.u * 0.5);
    for (const f of zoo.fireflies.list) expect(f.y).toBeGreaterThan(0);
  });

  it('show time: every creature does its trick', () => {
    const { zoo, events } = zooWith(2);
    zoo.showTime(pool, events);
    expect(events.filter((e) => e.type === 'show')).toHaveLength(1);
    for (const c of zoo.creatures) expect(c.mode).toBe('happy');
  });
});
