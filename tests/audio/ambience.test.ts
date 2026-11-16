import { describe, expect, it } from 'vitest';
import { AMBIENCE, cricketChorus, renderChorus, type Chorus } from '../../src/audio/ambience.js';
import { mulberry32 } from '../../src/core/rng.js';

/** Gaps between one cricket's chirps, round the loop. */
const gaps = (chirps: readonly number[], loop: number): number[] => {
  const t = [...chirps].sort((a, b) => a - b);
  return t.map((v, i) => (i + 1 < t.length ? t[i + 1] : t[0] + loop) - v);
};

describe('cricketChorus', () => {
  const home = cricketChorus(AMBIENCE.home, mulberry32(3));

  it('is the same chorus for the same seed, and another for another', () => {
    expect(cricketChorus(AMBIENCE.home, mulberry32(3))).toEqual(home);
    expect(cricketChorus(AMBIENCE.home, mulberry32(4))).not.toEqual(home);
  });

  it("is six or seven crickets, a few hundred hertz apart around the place's pitch, near and far", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const chorus = cricketChorus(AMBIENCE.home, mulberry32(seed));
      expect(chorus.crickets.length).toBeGreaterThanOrEqual(6);
      expect(chorus.crickets.length).toBeLessThanOrEqual(7);
      const pitches = chorus.crickets.map((c) => c.pitch);
      for (const f of pitches) expect(Math.abs(f - AMBIENCE.home.cricketFreq)).toBeLessThan(400);
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(100);
      const levels = chorus.crickets.map((c) => c.level);
      expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.3);
    }
  });

  it('sings like house crickets at home: 3-4 pulses of 11-18 ms, 8-13 ms apart, a chirp every 0.42-0.85 s give or take 5%', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const chorus = cricketChorus(AMBIENCE.home, mulberry32(seed));
      expect(chorus.seconds).toBeGreaterThanOrEqual(6);
      expect(chorus.seconds).toBeLessThanOrEqual(8);
      for (const c of chorus.crickets) {
        expect([3, 4]).toContain(c.pulses);
        expect(c.on).toBeGreaterThanOrEqual(0.011);
        expect(c.on).toBeLessThanOrEqual(0.018);
        expect(c.off).toBeGreaterThanOrEqual(0.008);
        expect(c.off).toBeLessThanOrEqual(0.013);
        expect(c.period).toBeGreaterThanOrEqual(0.42);
        expect(c.period).toBeLessThanOrEqual(0.85);
        // A whole number of chirps fills the loop, so it repeats without a seam.
        expect(c.chirps.length * c.period).toBeCloseTo(chorus.seconds, 9);
        for (const t of c.chirps) {
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThan(chorus.seconds);
        }
        for (const g of gaps(c.chirps, chorus.seconds)) {
          expect(g).toBeGreaterThanOrEqual(0.9 * c.period - 1e-9);
          expect(g).toBeLessThanOrEqual(1.1 * c.period + 1e-9);
        }
      }
    }
  });

  it('keeps the crickets out of step with one another', () => {
    const firsts = home.crickets.map((c) => Math.min(...c.chirps) % c.period);
    const periods = new Set(home.crickets.map((c) => c.period.toFixed(4)));
    expect(periods.size).toBeGreaterThan(3);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeGreaterThan(0.1);
  });

  it("sings each place's own song: slower and lower in the Amazon, quicker and higher in the Outback", () => {
    const amazon = cricketChorus(AMBIENCE.amazon, mulberry32(3));
    const outback = cricketChorus(AMBIENCE.outback, mulberry32(3));
    const mean = (c: Chorus, k: 'pitch' | 'period' | 'on') => c.crickets.reduce((s, x) => s + x[k], 0) / c.crickets.length;
    expect(mean(amazon, 'pitch')).toBeLessThan(mean(home, 'pitch'));
    expect(mean(outback, 'pitch')).toBeGreaterThan(mean(home, 'pitch'));
    expect(mean(amazon, 'period')).toBeGreaterThan(1.5 * mean(home, 'period'));
    expect(mean(amazon, 'on')).toBeGreaterThan(1.5 * mean(home, 'on'));
    expect(mean(outback, 'period')).toBeLessThan(mean(home, 'period'));
  });
});

describe('renderChorus', () => {
  const rate = 48000;
  const chorus = cricketChorus(AMBIENCE.home, mulberry32(3));
  const loop = renderChorus(chorus, rate);

  it('renders the whole loop at a steady level', () => {
    expect(loop.length).toBe(Math.round(chorus.seconds * rate));
    expect(loop.every(Number.isFinite)).toBe(true);
    const rms = Math.sqrt(loop.reduce((s, v) => s + v * v, 0) / loop.length);
    expect(rms).toBeGreaterThan(0.06);
    expect(rms).toBeLessThan(0.1);
    expect(loop.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(1);
  });

  it("sings each chirp as the cricket's pulses at its pitch, quiet between, wrapping round the loop", () => {
    const one: Chorus = {
      seconds: 1,
      crickets: [{ pitch: 4000, level: 1, pulses: 3, on: 0.015, off: 0.01, period: 0.5, chirps: [0.1, 0.96] }],
    };
    const x = renderChorus(one, rate);
    const peak = (from: number, to: number) => {
      let p = 0;
      for (let i = Math.round(from * rate); i < Math.round(to * rate); i++) p = Math.max(p, Math.abs(x[i]));
      return p;
    };
    const loudest = peak(0, 1);
    // The first chirp: three pulses, each 15 ms with 10 ms between.
    for (const start of [0.1, 0.125, 0.15]) {
      expect(peak(start + 0.004, start + 0.011)).toBeGreaterThan(0.5 * loudest);
      expect(peak(start + 0.016, start + 0.024)).toBe(0);
    }
    expect(peak(0.176, 0.95)).toBe(0);
    // The second chirp's last pulse runs past the loop's end and comes round to its start.
    expect(peak(0.0105, 0.0155)).toBeGreaterThan(0.5 * loudest);
    // Two zero crossings per cycle of the pitch.
    let crossings = 0;
    for (let i = Math.round(0.1 * rate) + 1; i < Math.round(0.115 * rate); i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++;
    expect(crossings / 0.015).toBeGreaterThan(2 * 4000 * 0.9);
    expect(crossings / 0.015).toBeLessThan(2 * 4000 * 1.1);
  });
});
