import { describe, expect, it } from 'vitest';
import { Matcher, TUNING } from '../../src/core/matcher.js';

const run = (m: Matcher, seconds: number, score: number | null, dt = 1 / 15) => {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += dt) events.push(m.update(dt, score));
  return events;
};

describe('Matcher', () => {
  it('matches once after holding above threshold', () => {
    const m = new Matcher(TUNING.normal);
    const events = run(m, 2, 0.9);
    expect(events.filter((e) => e === 'matched')).toHaveLength(1);
    expect(m.matched).toBe(true);
  });

  it('does not match below threshold', () => {
    const m = new Matcher(TUNING.normal);
    expect(run(m, 3, 0.4)).not.toContain('matched');
  });

  it('lost tracking resets the smoothed score and the hold', () => {
    const m = new Matcher(TUNING.normal);
    run(m, 0.5, 0.9);
    run(m, 0.2, null);
    expect(m.smoothed).toBe(0);
    expect(m.held).toBe(0);
  });

  it('relaxes the threshold after a while but never below the floor', () => {
    const m = new Matcher(TUNING.normal);
    run(m, TUNING.normal.relaxAfter + 5, 0.1);
    expect(m.threshold()).toBeCloseTo(TUNING.normal.threshold - 5 * TUNING.normal.relaxRate, 2);
    run(m, 200, 0.1);
    expect(m.threshold()).toBe(TUNING.normal.floor);
  });

  it('expert never relaxes', () => {
    const m = new Matcher(TUNING.expert);
    run(m, 60, 0.1);
    expect(m.threshold()).toBe(TUNING.expert.threshold);
  });

  it('reports progress toward the threshold and can be reset', () => {
    const m = new Matcher(TUNING.normal);
    run(m, 1, 0.31);
    expect(m.progress()).toBeGreaterThan(0.4);
    expect(m.progress()).toBeLessThan(0.6);
    m.reset();
    expect(m.progress()).toBe(0);
    expect(m.matched).toBe(false);
  });
});
