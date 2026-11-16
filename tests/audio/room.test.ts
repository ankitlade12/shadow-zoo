import { describe, expect, it } from 'vitest';
import { roomImpulse } from '../../src/audio/room.js';
import { mulberry32 } from '../../src/core/rng.js';

const RATE = 48000;
const energy = (x: Float32Array, from = 0, to = x.length): number => {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return e;
};
/** Share of a stretch's energy in its sample-to-sample changes: higher is brighter. */
const brightness = (x: Float32Array, from: number, to: number): number => {
  let d = 0;
  for (let i = from + 1; i < to; i++) d += (x[i] - x[i - 1]) ** 2;
  return d / energy(x, from, to);
};
const firstSound = (x: Float32Array): number => x.findIndex((v) => v !== 0);
const at = (seconds: number): number => Math.round(seconds * RATE);
/** x through an octave-wide band-pass around f (a biquad, 0 dB at its peak), left to ring out. */
const octave = (x: Float32Array, f: number): Float32Array => {
  const w = (2 * Math.PI * f) / RATE;
  const alpha = Math.sin(w) / (2 * Math.SQRT2);
  const a0 = 1 + alpha;
  const [b0, a1, a2] = [alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
  const y = new Float32Array(x.length + at(0.2));
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < y.length; i++) {
    const v = i < x.length ? x[i] : 0;
    y[i] = b0 * v - b0 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, v, y1, y[i]];
  }
  return y;
};
/** How loudly the impulse passes an octave around f, against a flat unit response (dB). */
const bandGainDb = (x: Float32Array, f: number): number => {
  const flat = new Float32Array(1);
  flat[0] = 1;
  return 10 * Math.log10(energy(octave(x, f)) / energy(octave(flat, f)));
};

describe('roomImpulse', () => {
  const [left, right] = roomImpulse(RATE);

  it('rings for about half a second, the same room every time', () => {
    expect(left.length).toBe(right.length);
    expect(left.length / RATE).toBeGreaterThanOrEqual(0.4);
    expect(left.length / RATE).toBeLessThanOrEqual(0.6);
    const [again] = roomImpulse(RATE);
    expect(again).toEqual(left);
    const [other] = roomImpulse(RATE, mulberry32(99));
    expect(other).not.toEqual(left);
  });

  it("returns the game's sounds at the level they are sent, and the highs quieter", () => {
    expect([...left, ...right].every(Number.isFinite)).toBe(true);
    for (const ear of [left, right]) {
      for (const f of [250, 500, 1000, 2000, 4000]) expect(Math.abs(bandGainDb(ear, f))).toBeLessThan(1.5);
      expect(bandGainDb(ear, 16000)).toBeLessThan(bandGainDb(ear, 1000) - 3);
    }
  });

  it('starts with a few sharp early reflections, heard a little apart by the two ears', () => {
    expect(firstSound(left) / RATE).toBeGreaterThan(0.003);
    expect(firstSound(left) / RATE).toBeLessThan(0.015);
    expect(firstSound(right)).not.toBe(firstSound(left));
    // Distinct peaks standing well clear of the tail building up around them.
    for (const ear of [left, right]) {
      const early = ear.subarray(0, at(0.04));
      const loudest = Math.max(...[...early].map(Math.abs));
      let peaks = 0;
      let last = -Infinity;
      for (let i = 0; i < early.length; i++) {
        if (Math.abs(early[i]) < 0.4 * loudest || i - last < at(0.002)) continue;
        peaks++;
        last = i;
      }
      expect(peaks).toBeGreaterThanOrEqual(4);
      expect(peaks).toBeLessThanOrEqual(8);
    }
  });

  it('decays, and its tail darkens as it does', () => {
    const late = at(0.3);
    expect(energy(left, late)).toBeLessThan(0.01 * energy(left, at(0.05), at(0.15)));
    expect(brightness(left, late, at(0.45))).toBeLessThan(0.5 * brightness(left, at(0.05), at(0.15)));
  });

  it('sounds different in each ear, so the room is wide', () => {
    let lr = 0;
    for (let i = at(0.05); i < left.length; i++) lr += left[i] * right[i];
    const tail = Math.sqrt(energy(left, at(0.05)) * energy(right, at(0.05)));
    expect(Math.abs(lr / tail)).toBeLessThan(0.3);
  });
});
