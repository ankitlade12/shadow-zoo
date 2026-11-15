import { describe, expect, it } from 'vitest';
import { CAPSULE_STRIDE } from '../../src/core/projector.js';
import { PointerHand } from '../../src/ui/zoowalk/hand.js';

const nearestEnd = (hand: PointerHand, x: number, y: number): number => {
  const { caps, count } = hand.shadow;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * CAPSULE_STRIDE;
    best = Math.min(best, Math.hypot(caps[o] - x, caps[o + 1] - y), Math.hypot(caps[o + 3] - x, caps[o + 4] - y));
  }
  return best;
};

describe('the pointer hand on the zoo walk', () => {
  it("casts an open hand's shadow with its index fingertip on the pointer", () => {
    const hand = new PointerHand(0.3);
    hand.update({ x: 0.2, y: 0.1 }, 1 / 60);
    const s = hand.shadow;
    expect(s.tracked).toBe(true);
    expect(s.count).toBeGreaterThan(10);
    expect(s.drawCount).toBeGreaterThan(s.count);
    expect([s.tipX, s.tipY]).toEqual([0.2, 0.1]);
    expect(nearestEnd(hand, 0.2, 0.1)).toBeLessThan(1e-6);
    // About as tall as asked, palm below the fingertips.
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 0; i < s.count; i++) {
      const o = i * CAPSULE_STRIDE;
      top = Math.max(top, s.caps[o + 1], s.caps[o + 4]);
      bottom = Math.min(bottom, s.caps[o + 1], s.caps[o + 4]);
    }
    expect(top - bottom).toBeGreaterThan(0.24);
    expect(top - bottom).toBeLessThan(0.36);
    expect(s.palmY).toBeLessThan(s.tipY);
  });

  it('pinches once on a press and lets go on release', () => {
    const hand = new PointerHand(0.3);
    hand.update({ x: 0, y: 0 }, 1 / 60);
    hand.press();
    hand.update({ x: 0, y: 0 }, 1 / 60);
    expect(hand.shadow.pinch).toBe('start');
    expect(hand.shadow.detector.pinched).toBe(true);
    hand.update({ x: 0, y: 0 }, 1 / 60);
    expect(hand.shadow.pinch).toBeNull();
    expect(hand.shadow.detector.pinched).toBe(true);
    hand.release();
    hand.update({ x: 0, y: 0 }, 1 / 60);
    expect(hand.shadow.pinch).toBe('end');
    expect(hand.shadow.detector.pinched).toBe(false);
  });

  it("doesn't pinch when a press off the wall slides onto it", () => {
    const hand = new PointerHand(0.3);
    hand.press();
    hand.update(null, 1 / 60);
    expect(hand.shadow.tracked).toBe(false);
    expect(hand.shadow.count).toBe(0);
    hand.update({ x: 0, y: 0 }, 1 / 60);
    expect(hand.shadow.pinch).toBeNull();
  });

  it('a fast sweep gives the shadow speed, but jumping to another enclosure does not', () => {
    const hand = new PointerHand(0.3);
    hand.update({ x: 0, y: 0 }, 1 / 60);
    hand.update({ x: 0.3, y: 0 }, 0.1);
    expect(hand.shadow.speed).toBeCloseTo(3);
    expect(hand.shadow.vx).toBeGreaterThan(0.5);
    expect(hand.shadow.tipVX).toBe(hand.shadow.vx);
    hand.update({ x: -0.6, y: 0.2 }, 1 / 60, true);
    expect(hand.shadow.speed).toBe(0);
    expect(hand.shadow.vx).toBe(0);
  });
});
