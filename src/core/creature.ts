import type { CreatureId, Motion } from './library.js';

/** Light-pool ellipse half-axes on the stage (meters). */
export interface Pool {
  readonly u: number;
  readonly v: number;
}

export type Mode = 'appear' | 'rest' | 'wander' | 'chase' | 'eat' | 'happy' | 'flee';

export interface CreatureEvent {
  readonly type: 'ate';
  readonly creature: Creature;
}

/** Walking speed per motion style, in body sizes per second. */
const SPEED: Readonly<Record<Motion, number>> = { hop: 1.2, trot: 1.5, slither: 0.8, strut: 0.7, dangle: 0.9, creep: 0.3 };
const APPEAR_TIME = 0.8;

/** The line that walking creatures' silhouette centers follow, below the middle of the pool. */
export const groundY = (pool: Pool): number => -0.5 * pool.v;

/** Usable half-width of the pool at height y, kept clear of the soft edge. */
export function halfWidthAt(pool: Pool, y: number): number {
  const k = 1 - (y / pool.v) ** 2;
  return k > 0 ? pool.u * Math.sqrt(k) * 0.82 : 0;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeOut = (k: number): number => 1 - (1 - k) ** 3;

function gaitLift(motion: Motion, t: number, size: number): number {
  switch (motion) {
    case 'hop':
      return Math.abs(Math.sin(t * 6.5)) * 0.32 * size;
    case 'trot':
      return Math.abs(Math.sin(t * 12)) * 0.04 * size;
    case 'strut':
      return Math.abs(Math.sin(t * 6)) * 0.05 * size;
    case 'creep':
      return Math.abs(Math.sin(t * 3)) * 0.015 * size;
    default:
      return 0;
  }
}

function gaitAct(motion: Motion, t: number): number {
  switch (motion) {
    case 'hop':
      return 0.3 * Math.abs(Math.sin(t * 6.5));
    case 'trot':
      return 0.25 * Math.abs(Math.sin(t * 12));
    case 'slither':
      return 0.3 + 0.3 * Math.sin(t * 6);
    case 'strut':
      return Math.max(0, Math.sin(t * 0.9) - 0.8) * 5;
    default:
      return 0;
  }
}

/** Occasional idle action (ear twitch, jaw, tail) while resting. */
function idleTwitch(t: number, id: number): number {
  const s = Math.sin(t * 1.7 + id * 1.3);
  return s > 0.93 ? (s - 0.93) / 0.07 : 0;
}

/** A living shadow creature on the stage. Pure simulation: no rendering, no IWSDK. */
export class Creature {
  mode: Mode = 'appear';
  facing: 1 | -1 = 1;
  /** Height above the path from hops and bobs (stage meters). */
  lift = 0;
  /** Blend 0..1 toward the creature's act pose. */
  act = 0;
  /** Scale multiplier during the appear bounce. */
  bounce = 1;
  /** 1 while the eye shows, 0 during a blink. */
  eyeOpen = 1;
  /** Hearts earned (0–5). */
  bond = 0;
  fireflyId = -1;
  private timer = APPEAR_TIME;
  private phase = 0;
  private targetX: number;
  private targetY: number;
  private readonly startY: number;
  private blinkIn: number;
  private blinkLeft = 0;
  private fleeFrom = 0;

  constructor(
    readonly id: number,
    readonly species: CreatureId,
    readonly motion: Motion,
    public x: number,
    public y: number,
    /** Canonical silhouette meters to stage meters. */
    public scale: number,
    /** Silhouette size on the wall (sqrt of area, meters). */
    readonly size: number,
    private readonly rng: () => number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.startY = y;
    this.blinkIn = 2 + rng() * 3;
  }

  /** Busy creatures ignore new fireflies and petting. */
  get busy(): boolean {
    return this.mode === 'appear' || this.mode === 'chase' || this.mode === 'eat' || this.mode === 'flee';
  }

  chase(fireflyId: number, x: number, y: number): void {
    this.mode = 'chase';
    this.fireflyId = fireflyId;
    this.targetX = x;
    this.targetY = y;
  }

  updateChaseTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Close enough to eat the chased firefly. */
  reached(): boolean {
    if (Math.abs(this.targetX - this.x) >= this.size * 0.3) return false;
    const reachY = this.motion === 'dangle' ? 0.3 : 0.9;
    return Math.abs(this.targetY - this.y) < this.size * reachY;
  }

  pet(): void {
    if (this.mode === 'rest' || this.mode === 'wander' || this.mode === 'happy') {
      this.mode = 'happy';
      this.timer = 1.1;
    }
  }

  flee(fromX: number): void {
    if (this.mode === 'appear' || this.mode === 'eat') return;
    this.mode = 'flee';
    this.timer = 1.2;
    this.fleeFrom = fromX;
    this.fireflyId = -1;
  }

  /** Stops chasing or fleeing. */
  calm(): void {
    if (this.mode === 'chase' || this.mode === 'flee') this.settle();
  }

  startEat(): void {
    this.mode = 'eat';
    this.timer = 0.75;
    this.fireflyId = -1;
  }

  update(dt: number, pool: Pool, events: CreatureEvent[]): void {
    this.phase += dt;
    this.blink(dt);
    switch (this.mode) {
      case 'appear':
        this.appear(dt, pool);
        break;
      case 'rest':
        this.lift = 0;
        this.act = idleTwitch(this.phase, this.id);
        this.timer -= dt;
        if (this.timer <= 0) this.wander(pool);
        break;
      case 'eat':
        this.timer -= dt;
        this.lift = 0;
        this.act = Math.abs(Math.sin(this.timer * 22));
        if (this.timer <= 0) {
          this.act = 0;
          this.mode = 'happy';
          this.timer = 0.8;
          events.push({ type: 'ate', creature: this });
        }
        break;
      case 'happy':
        this.timer -= dt;
        this.lift = Math.abs(Math.sin(this.phase * 11)) * 0.1 * this.size;
        this.act = 0.5 + 0.5 * Math.sin(this.phase * 14);
        if (this.timer <= 0) this.settle();
        break;
      default:
        this.move(dt, pool);
    }
    this.keepInside(pool);
  }

  private appear(dt: number, pool: Pool): void {
    this.timer -= dt;
    const k = 1 - Math.max(0, this.timer) / APPEAR_TIME;
    this.bounce = 1 + 0.2 * Math.sin(Math.PI * k) * (1 - k);
    const goal = this.motion === 'dangle' ? this.startY : groundY(pool);
    this.y = this.startY + (goal - this.startY) * easeOut(k);
    this.act = 0.5 * Math.sin(k * Math.PI * 3) ** 2;
    this.lift = 0;
    if (this.timer <= 0) {
      this.bounce = 1;
      this.settle();
    }
  }

  private settle(): void {
    this.mode = 'rest';
    this.timer = 0.6 + this.rng() * 1.6;
    this.act = 0;
    this.lift = 0;
    this.fireflyId = -1;
  }

  private wander(pool: Pool): void {
    this.mode = 'wander';
    if (this.motion === 'dangle') {
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, 0.3 * pool.v);
      this.targetY = -0.4 * pool.v + this.rng() * 0.9 * pool.v;
    } else {
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, groundY(pool));
      this.targetY = groundY(pool);
    }
  }

  private move(dt: number, pool: Pool): void {
    let goalX = this.targetX;
    let mult = 1;
    if (this.mode === 'chase') mult = 1.7;
    else if (this.mode === 'flee') {
      mult = 2.4;
      goalX = this.x + (this.x >= this.fleeFrom ? 1 : -1) * pool.u;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.settle();
        return;
      }
    }
    const step = SPEED[this.motion] * this.size * mult * dt;
    const dx = goalX - this.x;
    this.x += clamp(dx, -step, step);
    if (Math.abs(dx) > 1e-4) this.facing = dx > 0 ? 1 : -1;
    if (this.motion === 'dangle') {
      const goalY = this.mode === 'flee' ? 0.5 * pool.v : this.targetY;
      const dy = goalY - this.y;
      this.y += clamp(dy, -step, step);
      const moving = Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004;
      this.lift = 0;
      this.act = moving ? 0.5 + 0.5 * Math.sin(this.phase * 16) : 0.1;
      if (this.mode === 'wander' && !moving) this.settle();
      return;
    }
    this.y += (groundY(pool) - this.y) * Math.min(1, dt * 4);
    const moving = Math.abs(dx) > 0.004;
    this.lift = moving ? gaitLift(this.motion, this.phase * mult, this.size) : 0;
    this.act = moving ? gaitAct(this.motion, this.phase) : 0;
    if (this.mode === 'wander' && !moving) this.settle();
  }

  private blink(dt: number): void {
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      this.eyeOpen = this.blinkLeft > 0 ? 0 : 1;
      return;
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.12;
      this.eyeOpen = 0;
      this.blinkIn = 2.5 + this.rng() * 3;
    }
  }

  private keepInside(pool: Pool): void {
    this.y = clamp(this.y, -0.85 * pool.v, 0.85 * pool.v);
    const hw = halfWidthAt(pool, this.y);
    this.x = clamp(this.x, -hw, hw);
  }
}
