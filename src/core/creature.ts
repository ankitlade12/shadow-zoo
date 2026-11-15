import type { CreatureId, Motion } from './library.js';

/** Light-pool ellipse half-axes on the stage (meters). */
export interface Pool {
  readonly u: number;
  readonly v: number;
}

/** 'held' dangles from a pinch, 'tumble' flies after a throw or a bonk, 'dizzy' sits stunned after landing. */
export type Mode = 'appear' | 'rest' | 'wander' | 'chase' | 'eat' | 'happy' | 'flee' | 'held' | 'tumble' | 'dizzy';

export interface CreatureEvent {
  readonly type: 'ate' | 'landed';
  readonly creature: Creature;
}

/** Walking speed per motion style, in body sizes per second. */
const SPEED: Readonly<Record<Motion, number>> = { hop: 1.2, trot: 1.5, slither: 0.8, strut: 0.7, dangle: 0.9, creep: 0.3, fly: 1.4 };
const APPEAR_TIME = 0.8;
const TRICK_TIME = 0.9;
/** How quickly a creature eases toward its zoo fit (per second). */
const FIT_RATE = 2.5;
/** Gravity on a tumbling walker, in light-pool half-heights per second squared (scales with the stage). */
const GRAVITY = 7;
/** Share of speed kept when bouncing off the edge of the light, and off the ground. */
const WALL_BOUNCE = 0.6;
const GROUND_BOUNCE = 0.42;
/** Below this falling speed (pool half-heights per second) a walker lands instead of bouncing. */
const LAND_SPEED = 0.9;
/** Fliers brake in the air instead of falling, and catch themselves below this speed. */
const AIR_DRAG = 2.2;
const AIR_SETTLE = 0.25;
const DIZZY_TIME = 1.1;
/** A creature that was just hit can't be hit again for a moment, so one swipe is one bonk. */
const HIT_COOLDOWN = 0.35;
/** How quickly a held creature follows the pinch (per second). */
const HOLD_FOLLOW = 22;

/** Creatures that live off the ground: the spider on its thread and the bird on the wing. */
export const airborne = (motion: Motion): boolean => motion === 'dangle' || motion === 'fly';

/** Wing beats: quick while flying, slower while hovering. */
const wingBeat = (t: number, flying: boolean): number => 0.5 + 0.5 * Math.sin(t * (flying ? 11 : 5.5));

/** The line that walking creatures' silhouette centers follow, below the middle of the pool. */
export const groundY = (pool: Pool): number => -0.42 * pool.v;

/** Usable half-width of the pool at height y, kept clear of the soft edge. */
export function halfWidthAt(pool: Pool, y: number): number {
  const k = 1 - (y / pool.v) ** 2;
  return k > 0 ? pool.u * Math.sqrt(k) * 0.82 : 0;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

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
  /** Trick rotation in radians (0 when not performing). */
  spin = 0;
  /** 1 = full motion; lower values calm hops and bounces (reduced motion). */
  motionScale = 1;
  /** Share of its cast size the creature shows now; eases toward fitTarget once it has appeared. */
  fit = 1;
  /** The share of its cast size the zoo has room for. */
  fitTarget = 1;
  /** Chooses where a walker wanders to on the ground line (the zoo spreads them out); jitter is -1..1. */
  pickSpot: ((self: Creature, halfWidth: number, jitter: number) => number) | null = null;
  /** Velocity while tumbling (stage meters per second). */
  vx = 0;
  vy = 0;
  private spinRate = 0;
  /** The tumbling roll, eased back upright after landing. */
  private roll = 0;
  private hitCooldown = 0;
  private holdX = 0;
  private holdY = 0;
  private trickTime = 0;
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
    /** Canonical silhouette meters to stage meters, as cast. */
    readonly baseScale: number,
    /** Silhouette size on the wall as cast (sqrt of area, meters). */
    readonly baseSize: number,
    private readonly rng: () => number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.startY = y;
    this.blinkIn = 2 + rng() * 3;
  }

  /** Canonical silhouette meters to stage meters, now. */
  get scale(): number {
    return this.baseScale * this.fit;
  }

  /** Silhouette size on the wall now (sqrt of area, meters). */
  get size(): number {
    return this.baseSize * this.fit;
  }

  /** Where the creature stands, or where it is walking to. */
  get spotX(): number {
    return this.mode === 'wander' ? this.targetX : this.x;
  }

  /** Busy creatures ignore new fireflies and petting. */
  get busy(): boolean {
    return this.mode !== 'rest' && this.mode !== 'wander' && this.mode !== 'happy';
  }

  /** Whether a swipe or a flying creature can knock it now (even in mid-air: juggling counts). */
  get canBeHit(): boolean {
    return this.hitCooldown <= 0 && this.mode !== 'appear' && this.mode !== 'held';
  }

  /** Tumbling speed (stage meters per second). */
  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Picked up by a pinch: it dangles and kicks until it is let go. */
  grab(): boolean {
    if (this.mode === 'appear' || this.mode === 'held') return false;
    this.mode = 'held';
    this.holdX = this.x;
    this.holdY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.fireflyId = -1;
    this.trickTime = 0;
    this.roll = 0;
    return true;
  }

  /** Where the pinch holds it this frame. */
  hold(x: number, y: number): void {
    this.holdX = x;
    this.holdY = y;
  }

  /** Sent flying by a throw, a swipe, a flying friend or a clap: it tumbles, bounces and lands dizzy. */
  knock(vx: number, vy: number, pool: Pool): boolean {
    if (this.mode === 'appear') return false;
    this.mode = 'tumble';
    this.vx = vx;
    this.vy = vy;
    this.fireflyId = -1;
    this.trickTime = 0;
    this.lift = 0;
    this.bounce = 1;
    if (Math.abs(vx) > 0.02) this.facing = vx > 0 ? 1 : -1;
    // A forward roll, faster for harder hits.
    this.spinRate = 4 + 2.5 * (Math.hypot(vx, vy) / pool.v);
    this.hitCooldown = HIT_COOLDOWN;
    return true;
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
    const reachY = this.motion === 'dangle' ? 0.3 : this.motion === 'fly' ? 0.35 : 0.9;
    return Math.abs(this.targetY - this.y) < this.size * reachY;
  }

  pet(): void {
    if (this.mode === 'rest' || this.mode === 'wander' || this.mode === 'happy') {
      this.mode = 'happy';
      this.timer = 1.1;
      if (this.bond >= 3) this.trickTime = TRICK_TIME;
    }
  }

  flee(fromX: number): void {
    if (this.mode === 'appear' || this.mode === 'eat' || this.mode === 'held' || this.mode === 'tumble') return;
    this.mode = 'flee';
    this.timer = 1.2;
    this.fleeFrom = fromX;
    this.fireflyId = -1;
  }

  /** The zoo is complete: a happy dance with a trick, whatever its hearts. */
  celebrate(): void {
    if (this.mode === 'appear' || this.mode === 'held' || this.mode === 'tumble') return;
    this.mode = 'happy';
    this.timer = 2;
    this.fireflyId = -1;
    this.trickTime = TRICK_TIME;
  }

  /** A hand shadow is resting on it: it stops wandering and keeps resting while the touch lasts. */
  stay(): void {
    if (this.mode === 'wander') this.settle();
    if (this.mode === 'rest') this.timer = Math.max(this.timer, 0.4);
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
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.blink(dt);
    if (this.trickTime > 0) {
      this.trickTime = Math.max(0, this.trickTime - dt);
      this.spin = this.trickTime > 0 ? Math.PI * 2 * easeInOut(1 - this.trickTime / TRICK_TIME) : 0;
    }
    switch (this.mode) {
      case 'appear':
        this.appear(dt, pool);
        break;
      case 'rest':
        // A resting bird hovers, wings beating slowly, with a gentle bob.
        this.lift = this.motion === 'fly' ? Math.sin(this.phase * 2.2) * 0.04 * this.size : 0;
        this.act = this.motion === 'fly' ? wingBeat(this.phase, false) : idleTwitch(this.phase, this.id);
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
      case 'held':
        this.carry(dt);
        break;
      case 'tumble':
        this.tumble(dt, pool, events);
        break;
      case 'dizzy':
        this.timer -= dt;
        // Rolls back upright, then wobbles while the stars circle.
        this.roll += (0 - this.roll) * Math.min(1, dt * 14);
        this.spin = this.roll + 0.12 * Math.sin(this.phase * 10) * Math.max(0, this.timer / DIZZY_TIME);
        this.lift = 0;
        this.act = 0.1;
        if (this.timer <= 0) this.settle();
        break;
      default:
        this.move(dt, pool);
    }
    if (this.mode !== 'appear') this.fit += (this.fitTarget - this.fit) * Math.min(1, dt * FIT_RATE);
    this.lift *= this.motionScale;
    this.bounce = 1 + (this.bounce - 1) * this.motionScale;
    this.keepInside(pool);
  }

  private appear(dt: number, pool: Pool): void {
    this.timer -= dt;
    const k = 1 - Math.max(0, this.timer) / APPEAR_TIME;
    this.bounce = 1 + 0.2 * Math.sin(Math.PI * k) * (1 - k);
    const goal = airborne(this.motion) ? this.startY : groundY(pool);
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
    this.roll = 0;
    if (this.trickTime <= 0) this.spin = 0;
  }

  /** Dangling from the pinch: it follows the hand, swings against the motion and kicks its legs. */
  private carry(dt: number): void {
    const k = 1 - Math.exp(-dt * HOLD_FOLLOW);
    const before = this.x;
    this.x += (this.holdX - this.x) * k;
    this.y += (this.holdY - this.y) * k;
    const vx = dt > 0 ? (this.x - before) / dt : 0;
    if (Math.abs(vx) > 0.05) this.facing = vx > 0 ? 1 : -1;
    const tilt = clamp((vx * 0.35) / Math.max(this.size, 0.05), -0.7, 0.7);
    this.roll += (-this.facing * tilt - this.roll) * Math.min(1, dt * 10);
    this.spin = this.roll;
    this.act = 0.5 + 0.5 * Math.sin(this.phase * 18);
    this.lift = 0;
  }

  /** Flying through the light: walkers fall and bounce, fliers brake in the air; the light's edge bounces everyone. */
  private tumble(dt: number, pool: Pool, events: CreatureEvent[]): void {
    const air = airborne(this.motion);
    if (air) {
      const drag = Math.exp(-AIR_DRAG * dt);
      this.vx *= drag;
      this.vy *= drag;
    } else this.vy -= GRAVITY * pool.v * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.roll += this.spinRate * dt;
    this.spin = this.roll;
    this.lift = 0;
    this.act = air ? wingBeat(this.phase, true) : 0.5 + 0.5 * Math.sin(this.phase * 18);
    const top = 0.85 * pool.v;
    if (this.y > top) {
      this.y = top;
      this.vy = -Math.abs(this.vy) * WALL_BOUNCE;
    } else if (air && this.y < -top) {
      this.y = -top;
      this.vy = Math.abs(this.vy) * WALL_BOUNCE;
    }
    const hw = halfWidthAt(pool, this.y);
    if (this.x > hw) {
      this.x = hw;
      this.vx = -Math.abs(this.vx) * WALL_BOUNCE;
    } else if (this.x < -hw) {
      this.x = -hw;
      this.vx = Math.abs(this.vx) * WALL_BOUNCE;
    }
    if (air) {
      if (this.speed < AIR_SETTLE * pool.v) this.recover(false, events);
      return;
    }
    const ground = groundY(pool);
    if (this.y <= ground && this.vy <= 0) {
      this.y = ground;
      if (-this.vy > LAND_SPEED * pool.v) {
        this.vy = -this.vy * GROUND_BOUNCE;
        this.vx *= 0.7;
        this.spinRate *= 0.7;
      } else this.recover(true, events);
    }
  }

  /** Back on its feet (walkers sit dizzy for a moment first). */
  private recover(dizzy: boolean, events: CreatureEvent[]): void {
    this.vx = 0;
    this.vy = 0;
    this.spinRate = 0;
    // The nearest upright pose, so it rolls back the short way.
    this.roll = Math.atan2(Math.sin(this.roll), Math.cos(this.roll));
    this.spin = this.roll;
    if (!dizzy) {
      this.settle();
      return;
    }
    this.mode = 'dizzy';
    this.timer = DIZZY_TIME;
    events.push({ type: 'landed', creature: this });
  }

  private wander(pool: Pool): void {
    this.mode = 'wander';
    if (this.motion === 'dangle') {
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, 0.3 * pool.v);
      this.targetY = -0.4 * pool.v + this.rng() * 0.9 * pool.v;
    } else if (this.motion === 'fly') {
      // Anywhere in the upper part of the light, well above the walkers.
      this.targetY = -0.1 * pool.v + this.rng() * 0.6 * pool.v;
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, this.targetY);
    } else {
      const hw = halfWidthAt(pool, groundY(pool));
      const jitter = this.rng() * 2 - 1;
      this.targetX = this.pickSpot ? this.pickSpot(this, hw, jitter) : jitter * hw;
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
    if (airborne(this.motion)) {
      const goalY = this.mode === 'flee' ? 0.5 * pool.v : this.targetY;
      const dy = goalY - this.y;
      this.y += clamp(dy, -step, step);
      const moving = Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004;
      if (this.motion === 'fly') {
        this.lift = Math.sin(this.phase * 2.2) * 0.04 * this.size;
        this.act = wingBeat(this.phase, moving);
      } else {
        this.lift = 0;
        this.act = moving ? 0.5 + 0.5 * Math.sin(this.phase * 16) : 0.1;
      }
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
