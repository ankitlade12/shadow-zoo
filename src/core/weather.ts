import type { Pool } from './creature.js';
import type { Weather } from './world.js';

const COUNT = 60;

/**
 * A place's weather in the lantern's light: snow sways down, rain falls fast, sand streaks along the
 * wind, Moon dust barely drifts. Positions are stage meters inside the light pool, in fixed arrays.
 */
export class WeatherField {
  readonly x = new Float32Array(COUNT);
  readonly y = new Float32Array(COUNT);
  /** Each particle's own speed and sway, 0 to 1. */
  private readonly seed = new Float32Array(COUNT);
  kind: Weather = 'none';
  private time = 0;
  /** Reused for each particle's velocity, so a frame allocates nothing. */
  private readonly v: [number, number] = [0, 0];

  constructor(private readonly rng: () => number) {
    for (let i = 0; i < COUNT; i++) this.seed[i] = rng();
  }

  get count(): number {
    return this.kind === 'none' ? 0 : COUNT;
  }

  /** Switches the weather, scattering the particles across the light. */
  set(kind: Weather, pool: Pool): void {
    this.kind = kind;
    for (let i = 0; i < COUNT; i++) {
      this.x[i] = (this.rng() * 2 - 1) * pool.u;
      this.y[i] = (this.rng() * 2 - 1) * pool.v;
    }
  }

  /** Velocity of particle i (stage meters per second) in this weather and wind. */
  velocity(i: number, pool: Pool, wind: number): readonly [number, number] {
    const s = this.seed[i];
    const v = this.v;
    switch (this.kind) {
      case 'snow':
        v[0] = Math.sin(this.time * (0.8 + s) + s * 9) * 0.08 * pool.v + wind * 0.2 * pool.v;
        v[1] = -(0.12 + 0.12 * s) * pool.v;
        break;
      case 'rain':
        v[0] = wind * 0.4 * pool.v + 0.15 * pool.v;
        v[1] = -(2.2 + 0.8 * s) * pool.v;
        break;
      case 'sand':
        v[0] = (1.2 + 0.8 * s) * pool.v + wind * 0.5 * pool.v;
        v[1] = -(0.05 + 0.15 * s) * pool.v;
        break;
      case 'dust':
        v[0] = Math.sin(this.time * 0.3 + s * 7) * 0.02 * pool.v;
        v[1] = (0.01 + 0.03 * s) * pool.v;
        break;
      default:
        v[0] = 0;
        v[1] = 0;
    }
    return v;
  }

  update(dt: number, pool: Pool, wind: number): void {
    if (this.kind === 'none') return;
    this.time += dt;
    for (let i = 0; i < COUNT; i++) {
      const [vx, vy] = this.velocity(i, pool, wind);
      this.x[i] += vx * dt;
      this.y[i] += vy * dt;
      // Particles that leave the light come back in on the far side.
      if (this.y[i] < -pool.v) this.y[i] += 2 * pool.v;
      else if (this.y[i] > pool.v) this.y[i] -= 2 * pool.v;
      if (this.x[i] > pool.u) this.x[i] -= 2 * pool.u;
      else if (this.x[i] < -pool.u) this.x[i] += 2 * pool.u;
    }
  }

  /** Whether particle i is inside the light (the only place it shows). */
  lit(i: number, pool: Pool): boolean {
    return (this.x[i] / pool.u) ** 2 + (this.y[i] / pool.v) ** 2 < 0.92;
  }
}
