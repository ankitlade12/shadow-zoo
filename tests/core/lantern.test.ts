import { describe, expect, it } from 'vitest';
import { createFlicker, lanternFlicker, penumbra } from '../../src/core/lantern.js';

describe('penumbra', () => {
  it('is sharp on the wall and softens as the hand nears the light, like a real flame', () => {
    expect(penumbra(1)).toBe(0);
    expect(penumbra(3)).toBeGreaterThan(0);
    expect(penumbra(6)).toBeGreaterThan(penumbra(3));
  });

  it('stays within a readable softness', () => {
    expect(penumbra(1000)).toBeLessThanOrEqual(0.05);
    expect(penumbra(0.5)).toBe(0);
  });
});

describe('lanternFlicker', () => {
  const sample = (calm: boolean) => {
    const f = createFlicker();
    let lo = Infinity;
    let hi = -Infinity;
    let sway = 0;
    for (let i = 0; i < 6000; i++) {
      lanternFlicker(i / 60, calm, f);
      lo = Math.min(lo, f.brightness);
      hi = Math.max(hi, f.brightness);
      sway = Math.max(sway, Math.hypot(f.swayX, f.swayY));
    }
    return { lo, hi, sway };
  };

  it('wobbles gently, like a candle', () => {
    const { lo, hi, sway } = sample(false);
    expect(lo).toBeGreaterThan(0.85);
    expect(hi).toBeLessThan(1.12);
    expect(hi - lo).toBeGreaterThan(0.08);
    expect(sway).toBeGreaterThan(0.002);
    expect(sway).toBeLessThan(0.006);
  });

  it('holds still for reduced motion, keeping only a faint glow change', () => {
    const { lo, hi, sway } = sample(true);
    expect(sway).toBe(0);
    expect(hi - lo).toBeLessThan(0.05);
  });

  it('is the same at the same moment', () => {
    const a = lanternFlicker(12.34, false, createFlicker());
    const b = lanternFlicker(12.34, false, createFlicker());
    expect(a).toEqual(b);
  });
});
