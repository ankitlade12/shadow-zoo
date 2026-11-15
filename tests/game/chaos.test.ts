import { describe, expect, it } from 'vitest';
import { J } from '../../src/core/joints.js';
import { buildCreatureShapes, type CreatureId } from '../../src/core/library.js';
import { createJointSet } from '../../src/core/poses.js';
import { mulberry32 } from '../../src/core/rng.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { placeOf } from '../../src/core/world.js';
import { Zoo } from '../../src/game/Zoo.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const pool = { u: 0.8, v: 0.6 };

/** A zoo in free play (the tutorial is done), its creatures appeared and settled. */
const playing = (...species: CreatureId[]) => {
  const zoo = new Zoo(shapes, mulberry32(11));
  zoo.chaos = true;
  const events: GameEvent[] = [];
  const creatures = species.map((s, i) => zoo.add({ species: s, x: (i - (species.length - 1) / 2) * 0.3, y: 0, size: 0.2, scale: 1 }, events));
  step(zoo, 1.5, [], events);
  events.length = 0;
  return { zoo, events, creatures };
};
const step = (zoo: Zoo, seconds: number, hands: HandShadow[], events: GameEvent[]) => {
  for (let t = 0; t < seconds; t += 1 / 60) zoo.update(1 / 60, pool, hands, null, events);
};
const trackedHand = (side: 'left' | 'right' = 'right') => {
  const hand = createHandShadow(side);
  hand.tracked = true;
  return hand;
};
/** A one-capsule hand shadow over (x, y), moving at (vx, vy). */
const sweep = (x: number, y: number, vx: number, vy = 0) => {
  const hand = trackedHand('left');
  hand.count = 1;
  hand.caps.set([x - 0.01, y, 0.02, x + 0.01, y, 0.02]);
  hand.vx = vx;
  hand.vy = vy;
  return hand;
};
const bonks = (events: GameEvent[]) => events.flatMap((e) => (e.type === 'bonk' ? [e.combo] : []));

describe('Zoo chaos', () => {
  it('a pinch on a creature picks it up; it dangles from the pinch, and letting go throws it', () => {
    const { zoo, events, creatures } = playing('dog');
    const dog = creatures[0];
    const hand = trackedHand();
    hand.tipX = dog.x;
    hand.tipY = dog.y + dog.lift;
    hand.pinch = 'start';
    hand.detector.pinched = true;
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(dog.mode).toBe('held');
    expect(zoo.holding('right')).toBe(dog);
    expect(events.some((e) => e.type === 'grab' && e.species === 'dog')).toBe(true);
    expect(zoo.fireflies.list).toHaveLength(0);
    hand.pinch = null;
    for (let t = 0; t < 0.5; t += 1 / 60) {
      hand.tipX -= 0.004;
      hand.tipY += 0.003;
      zoo.update(1 / 60, pool, [hand], null, events);
    }
    expect(Math.abs(dog.x - hand.tipX)).toBeLessThan(0.03);
    expect(dog.y).toBeLessThan(hand.tipY);
    hand.detector.pinched = false;
    hand.pinch = 'end';
    hand.tipVX = 1.5;
    hand.tipVY = 1.2;
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(dog.mode).toBe('tumble');
    expect(zoo.holding('right')).toBeNull();
    expect(events.some((e) => e.type === 'fling')).toBe(true);
    hand.pinch = null;
    step(zoo, 3, [hand], events);
    expect(events.some((e) => e.type === 'land' && e.species === 'dog')).toBe(true);
  });

  it('during the tutorial a pinch on a creature still releases a firefly', () => {
    const { zoo, events, creatures } = playing('rabbit');
    zoo.chaos = false;
    const hand = trackedHand();
    hand.tipX = creatures[0].x;
    hand.tipY = creatures[0].y;
    hand.pinch = 'start';
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(creatures[0].mode).not.toBe('held');
    expect(events.some((e) => e.type === 'firefly')).toBe(true);
  });

  it('a pinch away from every creature still releases a firefly', () => {
    const { zoo, events, creatures } = playing('rabbit');
    const hand = trackedHand();
    hand.tipX = creatures[0].x > 0 ? -0.4 : 0.4;
    hand.tipY = 0.3;
    hand.pinch = 'start';
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(creatures[0].mode).not.toBe('held');
    expect(events.some((e) => e.type === 'firefly')).toBe(true);
  });

  it('a fast swipe knocks a creature flying; a slow touch does not', () => {
    const { zoo, events, creatures } = playing('rabbit');
    const rabbit = creatures[0];
    const hand = sweep(rabbit.x, rabbit.y + rabbit.lift, 0.3);
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(rabbit.mode).not.toBe('tumble');
    hand.vx = 2.5;
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(rabbit.mode).toBe('tumble');
    expect(rabbit.vx).toBeGreaterThan(0);
    expect(bonks(events)).toEqual([1]);
  });

  it('a creature knocked into another knocks it too, and the hits build a combo', () => {
    const { zoo, events, creatures } = playing('rabbit', 'turtle');
    const [rabbit, turtle] = creatures;
    rabbit.x = turtle.x - 0.14;
    rabbit.y = turtle.y;
    zoo.update(1 / 60, pool, [sweep(rabbit.x, rabbit.y, 2.5)], null, events);
    step(zoo, 0.4, [], events);
    expect(bonks(events)).toEqual([1, 2]);
    expect(['tumble', 'dizzy']).toContain(turtle.mode);
  });

  it('a crowded zoo calms down after a big hit: chain reactions die out', () => {
    const { zoo, events, creatures } = playing('rabbit', 'dog', 'crocodile', 'peacock', 'turtle', 'bird', 'spider');
    creatures.forEach((c, i) => {
      c.x = (i - 3) * 0.05;
    });
    const middle = creatures[3];
    zoo.update(1 / 60, pool, [sweep(middle.x, middle.y + middle.lift, 3)], null, events);
    step(zoo, 4, [], events);
    const later: GameEvent[] = [];
    step(zoo, 4, [], later);
    expect(bonks(events).length).toBeGreaterThan(1);
    expect(Math.max(...bonks(events))).toBeLessThan(15);
    expect(bonks(later)).toEqual([]);
    expect(zoo.creatures.some((c) => c.mode === 'tumble')).toBe(false);
  });

  it('the combo starts over after a quiet moment', () => {
    const { zoo, events, creatures } = playing('rabbit');
    const rabbit = creatures[0];
    zoo.update(1 / 60, pool, [sweep(rabbit.x, rabbit.y + rabbit.lift, 2.5)], null, events);
    step(zoo, 2.5, [], events);
    zoo.update(1 / 60, pool, [sweep(rabbit.x, rabbit.y + rabbit.lift, -2.5)], null, events);
    expect(bonks(events)).toEqual([1, 1]);
  });

  it('a creature knocked mid-chase lets its firefly go, so it can still be caught', () => {
    const { zoo, events, creatures } = playing('rabbit');
    const rabbit = creatures[0];
    const pinch = trackedHand();
    pinch.tipX = rabbit.x > 0 ? -0.4 : 0.4;
    pinch.tipY = 0.2;
    pinch.pinch = 'start';
    zoo.update(1 / 60, pool, [pinch], null, events);
    step(zoo, 0.2, [], events);
    expect(rabbit.mode).toBe('chase');
    zoo.update(1 / 60, pool, [sweep(rabbit.x, rabbit.y + rabbit.lift, 0, 2.5)], null, events);
    expect(rabbit.mode).toBe('tumble');
    expect(zoo.fireflies.list[0].claimed).toBe(false);
    step(zoo, 10, [], events);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
  });

  it('a clap makes the whole zoo jump, but not while a two-handed shape is being made', () => {
    const { zoo, events } = playing('rabbit', 'bird');
    const left = trackedHand('left');
    const right = trackedHand('right');
    left.joints = createJointSet();
    right.joints = createJointSet();
    const clap = (gaps: number[]) => {
      for (const gap of gaps) {
        left.joints!.pos[J.middleProx * 3] = -gap / 2;
        right.joints!.pos[J.middleProx * 3] = gap / 2;
        zoo.update(1 / 60, pool, [left, right], null, events);
      }
    };
    zoo.clapReady = false;
    clap([0.3, 0.05]);
    expect(events.some((e) => e.type === 'clap')).toBe(false);
    zoo.clapReady = true;
    clap(new Array(60).fill(0.05));
    clap([0.3, 0.05]);
    expect(events.filter((e) => e.type === 'clap')).toHaveLength(1);
    expect(zoo.creatures.every((c) => c.mode === 'tumble')).toBe(true);
  });
});

describe('Zoo around the world', () => {
  it('in the Amazon one pinch releases a swarm of fireflies', () => {
    const { zoo, events, creatures } = playing('rabbit');
    zoo.rules = placeOf('amazon').rules;
    const hand = trackedHand();
    hand.tipX = creatures[0].x > 0 ? -0.4 : 0.4;
    hand.tipY = 0.3;
    hand.pinch = 'start';
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(zoo.fireflies.list).toHaveLength(3);
    expect(events.filter((e) => e.type === 'firefly')).toHaveLength(1);
  });
});
