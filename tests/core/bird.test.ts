import { describe, expect, it } from 'vitest';
import { Creature, groundY } from '../../src/core/creature.js';
import { J } from '../../src/core/joints.js';
import { buildCreatureShapes, canonicalPair, creatureDef } from '../../src/core/library.js';
import { jointPos } from '../../src/core/poses.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshSave } from '../../src/core/save.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { captionFor } from '../../src/game/Onboarding.js';
import { Progression } from '../../src/game/Progression.js';
import { Puppeteer } from '../../src/game/Puppeteer.js';
import { Visitors } from '../../src/game/Visitors.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const bird = shapes.get('bird')!;
/** Capsules in one hand's shadow. */
const ONE = shapes.get('rabbit')!.count;

/** One hand of a perfect bird: the left or right half of its shadow. */
const half = (side: 'left' | 'right'): HandShadow => {
  const hand = createHandShadow(side);
  const start = side === 'left' ? 0 : ONE;
  hand.caps.set(bird.caps.subarray(start * CAPSULE_STRIDE, (start + ONE) * CAPSULE_STRIDE));
  hand.count = ONE;
  hand.drawCount = ONE;
  hand.tracked = true;
  return hand;
};

const reveal = (hands: HandShadow[], seconds = 5) => {
  const visitors = new Visitors(shapes, sil, ['bird'], 0);
  for (let t = 0; t < seconds; t += 1 / 30) {
    const revealed = visitors.update(1 / 30, hands);
    if (revealed) return revealed;
  }
  return null;
};

describe('the bird', () => {
  it('is cast with both hands: one hand and its mirror image, thumbs together', () => {
    expect(creatureDef('bird').pair).toBe(true);
    expect(bird.count).toBe(2 * ONE);
    for (let i = 0; i < ONE * CAPSULE_STRIDE; i += CAPSULE_STRIDE) {
      const r = i + ONE * CAPSULE_STRIDE;
      for (const k of [0, 3]) expect(bird.caps[r + k]).toBeCloseTo(-bird.caps[i + k], 5);
      for (const k of [1, 2, 4, 5]) expect(bird.caps[r + k]).toBeCloseTo(bird.caps[i + k], 5);
    }
    const { left, right } = canonicalPair(creatureDef('bird'));
    const a = jointPos(left, J.thumbTip);
    const b = jointPos(right, J.thumbTip);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.02);
  });

  it('comes alive when both hands make it, and not with one', () => {
    expect(reveal([half('left')])).toBeNull();
    expect(reveal([half('right')])).toBeNull();
    expect(reveal([half('left'), half('right')])?.species).toBe('bird');
  });

  it('flies: it lives up in the air and keeps its wings beating', () => {
    const pool = { u: 0.8, v: 0.6 };
    const c = new Creature(1, 'bird', 'fly', 0, 0.1, 1, 0.3, mulberry32(3));
    let lowest = Infinity;
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 20; t += 1 / 60) {
      c.update(1 / 60, pool, []);
      if (t < 1) continue;
      lowest = Math.min(lowest, c.y);
      lo = Math.min(lo, c.act);
      hi = Math.max(hi, c.act);
    }
    expect(lowest).toBeGreaterThan(groundY(pool) + 0.2 * pool.v);
    expect(lo).toBeLessThan(0.2);
    expect(hi).toBeGreaterThan(0.8);
  });

  it('arrives fourth, right after the three guided visitors', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile'];
    const progression = new Progression(save, '2026-11-10');
    progression.tick(60);
    expect(progression.nextVisitor()?.species).toBe('bird');
  });

  it("can't be worn: one hand alone is never the whole bird", () => {
    const puppeteer = new Puppeteer(shapes, sil);
    const projector = new ShadowProjector();
    projector.setup([0, 0, 40], { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });
    const hand = half('left');
    hand.joints = canonicalPair(creatureDef('bird')).left;
    let worn = null;
    for (let t = 0; t < 2; t += 1 / 30) worn = puppeteer.update(1 / 30, [hand], new Set(['bird'] as const), null, projector) ?? worn;
    expect(worn).toBeNull();
  });

  it('asks for both hands when it visits', () => {
    const caption = captionFor({ step: 'done', visitor: 'bird', twist: null, visitorElapsed: 1, visitorProgress: 0, handsMissing: 0, welcome: 0, streak: 1 });
    expect(caption).toMatch(/both hands/i);
  });
});
