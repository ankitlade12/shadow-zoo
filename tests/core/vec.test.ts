import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng.js';
import { add, cross, dot, length, normalize, scale, sub } from '../../src/core/vec.js';

describe('vec', () => {
  it('does basic arithmetic', () => {
    expect(add([1, 2, 3], [1, 1, 1])).toEqual([2, 3, 4]);
    expect(sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(length([3, 4, 0])).toBe(5);
  });

  it('normalizes and survives zero vectors', () => {
    const n = normalize([0, 3, 4]);
    expect(n[1]).toBeCloseTo(0.6);
    expect(n[2]).toBeCloseTo(0.8);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
