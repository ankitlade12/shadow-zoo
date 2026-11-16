import { groundY, halfWidthAt, type Pool } from './creature.js';
import { mulberry32 } from './rng.js';

export interface Firefly {
  readonly id: number;
  x: number;
  y: number;
  age: number;
  claimed: boolean;
  readonly seed: number;
  /** Its own flash: every `period` seconds it lights up for `lit` of the period, `twice` or once. */
  readonly period: number;
  readonly lit: number;
  readonly twice: boolean;
}

const MAX_FIREFLIES = 6;
const LIFETIME = 25;
/** Fireflies flash every 4-9 s, lit for 16-28% of it; three in ten flash twice. */
const PERIOD = [4, 9] as const;
const LIT = [0.16, 0.28] as const;
const TWICE = 0.3;
/** The glow between flashes, dim but always there, so a firefly can be seen and fed; a flash peaks at 1. */
const BASE = 0.4;
/** A double flash's second light, against its first. */
const SECOND = 0.75;
/** Reduced motion: a soft single swell between these. */
const GENTLE_BASE = 0.55;
const GENTLE_PEAK = 0.8;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One light: rises quickly from 0, peaks at 0.3 of the way, and fades slowly back to 0 at 1. */
const swell = (k: number): number => (k < 0.3 ? Math.sin((Math.PI / 2) * (k / 0.3)) ** 2 : Math.cos((Math.PI / 2) * ((k - 0.3) / 0.7)) ** 2);

/**
 * How brightly a firefly glows now (0..1): its dim glow, lit by its own flash, which starts as it is
 * released and comes round every period. `gentle` (reduced motion) keeps every flash a soft single swell.
 */
export function fireflyGlow(f: Firefly, gentle = false): number {
  const k = (f.age % f.period) / (f.period * f.lit);
  const flash = k >= 1 ? 0 : gentle || !f.twice ? swell(k) : k < 0.5 ? swell(2 * k) : SECOND * swell(2 * k - 1);
  return gentle ? GENTLE_BASE + (GENTLE_PEAK - GENTLE_BASE) * flash : BASE + (1 - BASE) * flash;
}

/** Glowing snacks released by a pinch; they sink gently toward the creatures. */
export class Fireflies {
  readonly list: Firefly[] = [];
  private nextId = 1;

  spawn(x: number, y: number, pool: Pool, rng: () => number): Firefly | null {
    if (this.list.length >= MAX_FIREFLIES) return null;
    const seed = rng() * 10;
    // Its flash comes from its seed, so releasing one draws no more from the zoo's random numbers.
    const own = mulberry32(Math.floor(seed * 0x10000000));
    const firefly: Firefly = {
      id: this.nextId++,
      x,
      y,
      age: 0,
      claimed: false,
      seed,
      period: PERIOD[0] + (PERIOD[1] - PERIOD[0]) * own(),
      lit: LIT[0] + (LIT[1] - LIT[0]) * own(),
      twice: own() < TWICE,
    };
    this.keepInside(firefly, pool);
    this.list.push(firefly);
    return firefly;
  }

  get(id: number): Firefly | null {
    for (const f of this.list) if (f.id === id) return f;
    return null;
  }

  remove(id: number): void {
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].id === id) {
        this.list.splice(i, 1);
        return;
      }
    }
  }

  /** Nearest firefly within `radius`; with `freeOnly`, ignores claimed ones. */
  nearest(x: number, y: number, radius = Infinity, freeOnly = false): Firefly | null {
    let best: Firefly | null = null;
    let bestDist = radius;
    for (const f of this.list) {
      if (freeOnly && f.claimed) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  /** `wind` (light-pool half-heights per second squared, from the place) drifts them gently downwind. */
  update(dt: number, pool: Pool, wind = 0): void {
    // Settle at head height for the zoo's smallest creatures, so a full zoo can still reach them.
    const settle = groundY(pool) + 0.1 * pool.v;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      if (f.age > LIFETIME) {
        this.list.splice(i, 1);
        continue;
      }
      f.y += (settle - f.y) * Math.min(1, dt * 0.35);
      f.x += Math.sin(f.age * 1.7 + f.seed) * 0.03 * dt + wind * 0.15 * pool.v * dt;
      this.keepInside(f, pool);
    }
  }

  private keepInside(f: Firefly, pool: Pool): void {
    f.y = clamp(f.y, -0.85 * pool.v, 0.85 * pool.v);
    const hw = halfWidthAt(pool, f.y);
    f.x = clamp(f.x, -hw, hw);
  }
}
