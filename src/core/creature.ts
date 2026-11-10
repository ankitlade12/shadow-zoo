import type { CreatureId } from './library.js';

/** Ellipse half-axes (stage meters) the creature must stay inside. */
export interface PoolBounds {
  readonly u: number;
  readonly v: number;
}

/** A living shadow that wanders the light pool in hops and rests between them. */
export class HopperCreature {
  facing: 1 | -1 = 1;
  hop = 0;
  resting = false;
  private targetX: number;
  private targetY: number;
  private phase = 0;
  private rest = 0.8;

  constructor(
    readonly id: CreatureId,
    public x: number,
    public y: number,
    /** Scale from canonical silhouette meters to stage meters. */
    public scale: number,
    /** Typical silhouette size on the wall (meters), sets speed and hop height. */
    readonly size: number,
    private readonly rng: () => number,
  ) {
    this.targetX = x;
    this.targetY = y;
  }

  update(dt: number, pool: PoolBounds): void {
    this.clampInside(pool);
    if (this.rest > 0) {
      this.resting = true;
      this.hop = 0;
      this.rest -= dt;
      if (this.rest <= 0) this.pickTarget(pool);
      return;
    }
    this.resting = false;
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.005) {
      this.rest = 0.6 + this.rng() * 1.6;
      return;
    }
    const step = Math.min(dist, this.size * 1.4 * dt);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    if (Math.abs(dx) > 1e-4) this.facing = dx > 0 ? 1 : -1;
    this.phase += dt * 6;
    this.hop = Math.abs(Math.sin(this.phase)) * this.size * 0.3;
  }

  private pickTarget(pool: PoolBounds): void {
    const angle = this.rng() * Math.PI * 2;
    const radius = Math.sqrt(this.rng()) * 0.7;
    this.targetX = Math.cos(angle) * radius * pool.u;
    this.targetY = Math.sin(angle) * radius * pool.v;
  }

  private clampInside(pool: PoolBounds): void {
    const e = (this.x / pool.u) ** 2 + (this.y / pool.v) ** 2;
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      this.x *= k;
      this.y *= k;
    }
  }
}
