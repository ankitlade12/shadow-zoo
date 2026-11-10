import { describe, expect, it } from 'vitest';
import { J } from '../../src/core/joints.js';
import { buildCreatureShapes } from '../../src/core/library.js';
import { buildJointSet, builtinAngles, copyJointSet, orientJointSet } from '../../src/core/poses.js';
import { ShadowProjector, type StagePlane } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../../src/game/hands.js';
import type { Worn } from '../../src/game/Puppeteer.js';
import { Visitors } from '../../src/game/Visitors.js';
import { Zoo } from '../../src/game/Zoo.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const pool = { u: 0.8, v: 0.6 };
const stage: StagePlane = { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };

const shaped = (id: 'rabbit' | 'dog'): HandShadow => {
  const hand = createHandShadow('right');
  const shape = shapes.get(id)!;
  hand.caps.set(shape.caps);
  hand.count = shape.count;
  hand.drawCount = shape.count;
  hand.tracked = true;
  return hand;
};
const pinchAt = (x: number, y: number): HandShadow => {
  const hand = createHandShadow('right');
  hand.tracked = true;
  hand.tipX = x;
  hand.tipY = y;
  hand.pinch = 'start';
  return hand;
};
const freshZoo = (species: 'rabbit' | 'dog' = 'rabbit', x = 0) => {
  const zoo = new Zoo(shapes, mulberry32(11));
  const events: GameEvent[] = [];
  const creature = zoo.add({ species, x, y: 0, size: 0.3, scale: 1 }, events);
  return { zoo, events, creature };
};
const step = (zoo: Zoo, seconds: number, hands: HandShadow[], events: GameEvent[], worn: Worn | null = null) => {
  for (let t = 0; t < seconds; t += 1 / 60) zoo.update(1 / 60, pool, hands, worn, events);
};

describe('updateHandShadow', () => {
  it('projects a tracked hand, finds its fingertip shadow and detects a pinch', () => {
    const projector = new ShadowProjector();
    projector.setup([0, 0, 1], stage);
    const joints = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [0, 0, 0]);
    const hand = createHandShadow('left');
    updateHandShadow(hand, joints, projector, 1 / 60);
    expect(hand.tracked).toBe(true);
    expect(hand.count).toBeGreaterThan(20);
    expect(hand.drawCount).toBe(hand.count + 1);
    expect(hand.tipY).toBeGreaterThan(hand.palmY);
    expect(hand.pinch).toBeNull();
    const pinched = copyJointSet(joints);
    pinched.pos.set(joints.pos.subarray(J.indexTip * 3, J.indexTip * 3 + 3), J.thumbTip * 3);
    updateHandShadow(hand, pinched, projector, 1 / 60);
    expect(hand.pinch).toBe('start');
    updateHandShadow(hand, null, projector, 1 / 60);
    expect(hand.tracked).toBe(false);
    expect(hand.pinch).toBe('end');
  });
});

describe('Visitors', () => {
  it('reveals the visitor once the hand shadow matches it, then brings the next', () => {
    const visitors = new Visitors(shapes, sil, ['rabbit', 'dog'], 0.5);
    const hands = [shaped('rabbit')];
    let revealed = null;
    for (let t = 0; t < 5 && !revealed; t += 1 / 60) revealed = visitors.update(1 / 60, hands);
    expect(revealed?.species).toBe('rabbit');
    expect(revealed!.scale).toBeCloseTo(1, 1);
    for (let t = 0; t < 3; t += 1 / 60) visitors.update(1 / 60, hands);
    expect(visitors.current?.def.id).toBe('dog');
  });

  it('never reveals without a tracked hand', () => {
    const visitors = new Visitors(shapes, sil, ['rabbit'], 0);
    const hand = shaped('rabbit');
    hand.tracked = false;
    for (let t = 0; t < 5; t += 1 / 60) expect(visitors.update(1 / 60, [hand])).toBeNull();
  });
});

describe('Zoo', () => {
  it('reveals a creature with an event and unlocks its species', () => {
    const { zoo, events } = freshZoo();
    expect(events[0]).toMatchObject({ type: 'reveal', species: 'rabbit' });
    expect(zoo.unlocked.has('rabbit')).toBe(true);
  });

  it('a pinch releases a firefly that a creature chases and eats', () => {
    const { zoo, events, creature } = freshZoo();
    step(zoo, 1.5, [], events);
    const hand = pinchAt(0.3, 0.1);
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(events.some((e) => e.type === 'firefly')).toBe(true);
    hand.pinch = null;
    step(zoo, 8, [hand], events);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    expect(creature.bond).toBeGreaterThanOrEqual(1);
    expect(zoo.fireflies.list).toHaveLength(0);
  });

  it('resting your hand shadow on a creature pets it', () => {
    const { zoo, events, creature } = freshZoo('dog');
    step(zoo, 1.5, [], events);
    const hand = createHandShadow('left');
    hand.tracked = true;
    hand.count = 1;
    for (let t = 0; t < 1.3; t += 1 / 60) {
      const y = creature.y + creature.lift;
      hand.caps.set([creature.x - 0.02, y, 0.03, creature.x + 0.02, y, 0.03]);
      zoo.update(1 / 60, pool, [hand], null, events);
    }
    expect(events.some((e) => e.type === 'pet')).toBe(true);
    expect(creature.bond).toBe(1);
  });

  it('wearing the dog and barking makes rabbits flee', () => {
    const { zoo, events, creature } = freshZoo('rabbit', 0.1);
    step(zoo, 1.5, [], events);
    const worn: Worn = { species: 'dog', side: 'right', eyeX: 0, eyeY: 0, tipX: 0, tipY: 0, voice: true };
    zoo.update(1 / 60, pool, [], worn, events);
    expect(creature.mode).toBe('flee');
    expect(events.some((e) => e.type === 'voice' && e.species === 'dog')).toBe(true);
    expect(events.some((e) => e.type === 'flee' && e.species === 'rabbit')).toBe(true);
  });

  it('a worn crocodile can snap up a nearby firefly', () => {
    const { zoo, events } = freshZoo('dog', -0.5);
    step(zoo, 1.5, [], events);
    zoo.update(1 / 60, pool, [pinchAt(0.3, 0.2)], null, events);
    const f = zoo.fireflies.list[0];
    const worn: Worn = { species: 'crocodile', side: 'left', eyeX: f.x, eyeY: f.y, tipX: f.x, tipY: f.y, voice: true };
    zoo.update(1 / 60, pool, [], worn, events);
    expect(zoo.fireflies.list).toHaveLength(0);
    expect(events.filter((e) => e.type === 'eat' && e.species === 'crocodile')).toHaveLength(1);
  });

  it('a pinch feeds unless the worn creature speaks by pinching', () => {
    const { zoo, events } = freshZoo('dog', -0.5);
    const wornAs = (species: 'dog' | 'crocodile'): Worn => ({ species, side: 'right', eyeX: 0, eyeY: 0, tipX: 0, tipY: 0, voice: false });
    zoo.update(1 / 60, pool, [pinchAt(0.3, 0.2)], wornAs('dog'), events);
    expect(zoo.fireflies.list).toHaveLength(1);
    zoo.update(1 / 60, pool, [pinchAt(0.1, 0.2)], wornAs('crocodile'), events);
    expect(zoo.fireflies.list).toHaveLength(1);
  });

  it('a big visitor needs a bigger shadow, and timing is reported', () => {
    const visitors = new Visitors(shapes, sil, [], 0);
    const size = shapes.get('rabbit')!.target.frame.size;
    visitors.enqueue('rabbit', { minSize: size * 1.4 });
    expect(visitors.busy).toBe(true);
    const small = [shaped('rabbit')];
    for (let t = 0; t < 3; t += 1 / 60) expect(visitors.update(1 / 60, small)).toBeNull();
    const big = shaped('rabbit');
    for (let i = 0; i < big.caps.length; i++) big.caps[i] *= 1.6;
    let revealed = null;
    for (let t = 0; t < 3 && !revealed; t += 1 / 60) revealed = visitors.update(1 / 60, [big]);
    expect(revealed?.species).toBe('rabbit');
    expect(visitors.lastElapsed).toBeGreaterThan(3);
    expect(visitors.busy).toBe(false);
  });
});
