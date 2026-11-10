import { groundY, halfWidthAt, type Pool } from './creature.js';

export interface Firefly {
  readonly id: number;
  x: number;
  y: number;
  age: number;
  claimed: boolean;
  readonly seed: number;
}

const MAX_FIREFLIES = 6;
const LIFETIME = 25;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Glowing snacks released by a pinch; they sink gently toward the creatures. */
export class Fireflies {
  readonly list: Firefly[] = [];
  private nextId = 1;

  spawn(x: number, y: number, pool: Pool, rng: () => number): Firefly | null {
    if (this.list.length >= MAX_FIREFLIES) return null;
    const firefly: Firefly = { id: this.nextId++, x, y, age: 0, claimed: false, seed: rng() * 10 };
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

  update(dt: number, pool: Pool): void {
    const settle = groundY(pool) + 0.18 * pool.v;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      if (f.age > LIFETIME) {
        this.list.splice(i, 1);
        continue;
      }
      f.y += (settle - f.y) * Math.min(1, dt * 0.35);
      f.x += Math.sin(f.age * 1.7 + f.seed) * 0.03 * dt;
      this.keepInside(f, pool);
    }
  }

  private keepInside(f: Firefly, pool: Pool): void {
    f.y = clamp(f.y, -0.85 * pool.v, 0.85 * pool.v);
    const hw = halfWidthAt(pool, f.y);
    f.x = clamp(f.x, -hw, hw);
  }
}
