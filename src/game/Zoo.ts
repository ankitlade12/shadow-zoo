import { Creature, type CreatureEvent, type Pool } from '../core/creature.js';
import { spreadSpot, zooSize } from '../core/crowd.js';
import { Fireflies } from '../core/fireflies.js';
import { capsulesNear, ClapDetector, palmGap } from '../core/interact.js';
import { J } from '../core/joints.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { HEART, Particles, SPARK, STAR } from '../core/particles.js';
import type { Handedness } from '../core/poses.js';
import { HOME_RULES, type Rules } from '../core/world.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import type { Worn } from './Puppeteer.js';

const PET_SECONDS = 1;
const PET_COOLDOWN = 2;
const PET_MAX_SPEED = 0.9;
const MAX_BOND = 5;
/** Creatures that scatter when the player's dog barks. */
const PREY: ReadonlySet<CreatureId> = new Set<CreatureId>(['rabbit', 'peacock', 'turtle']);
// Speeds below are in light-pool half-heights per second, so they feel the same on any wall.
/** A pinch this close to a creature's middle (in its sizes) picks it up. */
const GRAB_REACH = 0.6;
/** The fastest a creature can be thrown or knocked. */
const MAX_FLING = 5;
/** A release faster than this is a throw, not a drop. */
const FLING_SPEED = 1.2;
/** A hand shadow moving faster than this knocks creatures it sweeps through. */
const SWAT_SPEED = 3;
const SWAT_GAIN = 0.9;
/** Every bonk pops a little upward, so even a sideways swipe sends it flying. */
const SWAT_POP = 0.9;
/** A tumbling creature faster than this knocks the creatures it flies into. */
const CHAIN_SPEED = 1.3;
/** Share of its speed a flying creature passes to the one it hits. Under 1, so every pile-up dies out. */
const CHAIN_SHARE = 0.6;
/** Hits within this many seconds of each other build a combo. */
const COMBO_WINDOW = 1.6;

/** The living zoo: creatures, fireflies, particles and every hand interaction. Pure game logic. */
export class Zoo {
  readonly creatures: Creature[] = [];
  readonly fireflies = new Fireflies();
  readonly particles = new Particles();
  /** Grabbing, swatting and clapping. Off while the first-time tutorial teaches feeding and petting. */
  chaos = false;
  /** Whether a clap counts (not while the player brings both hands together for a two-handed shape). */
  clapReady = true;
  /** The place's rules: gravity, bounce, ice, wind and fireflies per pinch. */
  rules: Rules = HOME_RULES;
  private readonly unlockedSet = new Set<CreatureId>();
  private readonly petTimers = new Map<number, number>();
  private readonly creatureEvents: CreatureEvent[] = [];
  /** Restored creatures take their zoo fit at once instead of shrinking into it. */
  private readonly snapFit = new Set<Creature>();
  /** The creature each hand holds by a pinch. */
  private readonly held = new Map<Handedness, Creature>();
  private readonly clap = new ClapDetector();
  private combo = 0;
  private comboLeft = 0;
  private nextId = 1;
  private motionScale = 1;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly rng: () => number,
  ) {}

  get unlocked(): ReadonlySet<CreatureId> {
    return this.unlockedSet;
  }

  add(revealed: Revealed, events: GameEvent[], options: { readonly silent?: boolean; readonly bond?: number } = {}): Creature {
    const def = this.shapes.get(revealed.species)!.def;
    const creature = new Creature(this.nextId++, revealed.species, def.motion, revealed.x, revealed.y, revealed.scale, revealed.size, this.rng);
    creature.bond = options.bond ?? 0;
    creature.motionScale = this.motionScale;
    creature.pickSpot = (self, halfWidth, jitter) => spreadSpot(self, this.creatures, halfWidth, jitter);
    if (options.silent) this.snapFit.add(creature);
    this.creatures.push(creature);
    this.unlockedSet.add(revealed.species);
    if (!options.silent) {
      this.particles.emit(SPARK, revealed.x, revealed.y, 16, revealed.size * 0.9, this.rng);
      events.push({ type: 'reveal', species: revealed.species, x: revealed.x, y: revealed.y });
    }
    return creature;
  }

  /** The whole zoo is found: everyone celebrates with a trick under a shower of sparks. */
  finale(pool: Pool): void {
    for (const c of this.creatures) c.celebrate();
    for (let i = 0; i < 9; i++) {
      const x = (i / 8 - 0.5) * 1.4 * pool.u;
      const y = (0.2 + 0.4 * this.rng()) * pool.v;
      this.particles.emit(SPARK, x, y, 10, 0.25 * pool.v, this.rng);
    }
  }

  /** Today's visitor matched: the zoo's creature of that species cheers. */
  cheer(species: CreatureId, x: number, y: number, events: GameEvent[]): void {
    for (const c of this.creatures) {
      if (c.species !== species) continue;
      c.pet();
      this.particles.emit(HEART, c.x, c.y + c.size * 0.45, 4, c.size * 0.5, this.rng);
    }
    this.particles.emit(SPARK, x, y, 16, 0.3, this.rng);
    events.push({ type: 'reveal', species, x, y });
  }

  /** Star sparkles for a matched visitor: more stars, more sparkle. */
  celebrate(x: number, y: number, stars: number, size: number): void {
    this.particles.emit(SPARK, x, y, stars * 5, size * 0.7, this.rng);
  }

  /** Reduced motion: scales hops and bounces for every creature, present and future. */
  setMotionScale(scale: number): void {
    this.motionScale = scale;
    for (const c of this.creatures) c.motionScale = scale;
  }

  update(dt: number, pool: Pool, hands: readonly HandShadow[], worn: Worn | null, events: GameEvent[]): void {
    this.fitToPool(pool);
    this.carry(hands, pool, events);
    this.feed(hands, worn, pool, events);
    if (worn?.voice) this.onVoice(worn, pool, events);
    if (this.chaos) {
      this.swat(hands, pool, events);
      this.listenForClap(dt, hands, pool, events);
    }
    this.assignFireflies();
    this.creatureEvents.length = 0;
    for (const creature of this.creatures) {
      if (creature.mode === 'chase') this.followFirefly(creature);
      this.updatePet(creature, dt, hands, events);
      creature.update(dt, pool, this.creatureEvents, this.rules);
    }
    this.collide(pool, events);
    for (const event of this.creatureEvents) {
      const c = event.creature;
      if (event.type === 'landed') {
        this.particles.emit(STAR, c.x, c.y + c.size * 0.45, 3, c.size * 0.4, this.rng);
        events.push({ type: 'land', species: c.species, x: c.x, y: c.y });
        continue;
      }
      c.bond = Math.min(MAX_BOND, c.bond + 1);
      this.particles.emit(HEART, c.x, c.y + c.size * 0.4, 2, c.size * 0.5, this.rng);
      events.push({ type: 'eat', species: c.species, x: c.x, y: c.y });
    }
    this.comboLeft = Math.max(0, this.comboLeft - dt);
    if (this.comboLeft === 0) this.combo = 0;
    this.fireflies.update(dt, pool, this.rules.wind);
    this.particles.update(dt);
  }

  /** The creature a hand holds, if any. */
  holding(side: Handedness): Creature | null {
    return this.held.get(side) ?? null;
  }

  /** Everyone jumps: walkers leap away from the clap and fliers scatter. */
  thunderclap(x: number, y: number, pool: Pool, events: GameEvent[]): void {
    for (const c of this.creatures) {
      if (c.mode === 'appear' || c.mode === 'held') continue;
      this.freeFirefly(c);
      const away = c.x >= x ? 1 : -1;
      c.knock(away * (0.4 + 0.6 * this.rng()) * pool.v, (1.6 + 0.6 * this.rng()) * pool.v, pool);
    }
    this.particles.emit(SPARK, x, y, 14, 0.25 * pool.v, this.rng);
    events.push({ type: 'clap', x, y });
  }

  /** Held creatures follow their pinch; letting go (or losing the hand) throws them with the fingertip's speed. */
  private carry(hands: readonly HandShadow[], pool: Pool, events: GameEvent[]): void {
    for (const [side, c] of this.held) {
      let hand: HandShadow | null = null;
      for (const h of hands) if (h.side === side) hand = h;
      if (hand && hand.tracked && hand.detector.pinched && c.mode === 'held') {
        c.hold(hand.tipX, hand.tipY - c.size * 0.3);
        continue;
      }
      this.held.delete(side);
      if (c.mode === 'held') this.fling(c, hand?.tracked ? hand.tipVX : 0, hand?.tracked ? hand.tipVY : 0, pool, events);
    }
  }

  private fling(c: Creature, vx: number, vy: number, pool: Pool, events: GameEvent[]): void {
    const speed = Math.hypot(vx, vy);
    const k = speed > MAX_FLING * pool.v ? (MAX_FLING * pool.v) / speed : 1;
    c.knock(vx * k, vy * k, pool);
    if (speed * k > FLING_SPEED * pool.v) events.push({ type: 'fling', species: c.species, x: c.x, y: c.y });
  }

  /** The creature nearest a pinch, if the pinch is on it. */
  private reachable(hand: HandShadow): Creature | null {
    let best: Creature | null = null;
    let bestDist = Infinity;
    for (const c of this.creatures) {
      if (c.mode === 'appear' || c.mode === 'held') continue;
      const d = Math.hypot(c.x - hand.tipX, c.y + c.lift - hand.tipY);
      if (d <= c.size * GRAB_REACH && d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /** A fast hand shadow knocks every creature it sweeps through, even ones already in the air. */
  private swat(hands: readonly HandShadow[], pool: Pool, events: GameEvent[]): void {
    for (const hand of hands) {
      if (!hand.tracked || this.held.has(hand.side)) continue;
      const speed = Math.hypot(hand.vx, hand.vy);
      if (speed < SWAT_SPEED * pool.v) continue;
      const k = speed > MAX_FLING * pool.v ? (MAX_FLING * pool.v) / speed : 1;
      for (const c of this.creatures) {
        if (!c.canBeHit || !capsulesNear(hand.caps, 0, hand.count, c.x, c.y + c.lift, c.size * 0.3)) continue;
        this.freeFirefly(c);
        c.knock(hand.vx * SWAT_GAIN * k, hand.vy * SWAT_GAIN * k + SWAT_POP * pool.v, pool);
        this.bump(c, events);
      }
    }
  }

  /**
   * A creature flying fast knocks the ones it hits: throw one into the others and they all go. The one
   * hit flies on along the thrower's path, tipped upward, with only a share of its speed, and the
   * thrower slows too, so each generation of a pile-up is slower than the last and it always settles.
   */
  private collide(pool: Pool, events: GameEvent[]): void {
    for (const a of this.creatures) {
      if (a.mode !== 'tumble' || a.speed < CHAIN_SPEED * pool.v) continue;
      for (const b of this.creatures) {
        if (b === a || !b.canBeHit) continue;
        const reach = (a.size + b.size) * 0.4;
        if (Math.hypot(a.x - b.x, a.y - (b.y + b.lift)) > reach) continue;
        const share = a.speed * CHAIN_SHARE;
        const dy = Math.abs(a.vy) + 0.35 * Math.abs(a.vx);
        const len = Math.hypot(a.vx, dy) || 1;
        this.freeFirefly(b);
        b.knock((a.vx / len) * share, (dy / len) * share, pool);
        a.vx *= 0.5;
        a.vy *= 0.5;
        this.bump(b, events);
        if (a.speed < CHAIN_SPEED * pool.v) break;
      }
    }
  }

  /** A hit: sparks, and the combo grows while hits keep coming. */
  private bump(c: Creature, events: GameEvent[]): void {
    this.combo = this.comboLeft > 0 ? this.combo + 1 : 1;
    this.comboLeft = COMBO_WINDOW;
    this.particles.emit(SPARK, c.x, c.y, 6, c.size * 0.6, this.rng);
    events.push({ type: 'bonk', species: c.species, x: c.x, y: c.y, combo: this.combo });
  }

  private listenForClap(dt: number, hands: readonly HandShadow[], pool: Pool, events: GameEvent[]): void {
    let a: HandShadow | null = null;
    let b: HandShadow | null = null;
    for (const h of hands) {
      if (!h.tracked || !h.joints) continue;
      if (!a) a = h;
      else if (!b) b = h;
    }
    const gap = a && b ? palmGap(a.joints!, b.joints!) : Infinity;
    if (this.clap.update(dt, gap) && this.clapReady && a && b) this.thunderclap((a.palmX + b.palmX) / 2, (a.palmY + b.palmY) / 2, pool, events);
  }

  /** A creature knocked or picked up mid-chase lets its firefly go, so another creature can catch it. */
  private freeFirefly(c: Creature): void {
    if (c.fireflyId < 0) return;
    const firefly = this.fireflies.get(c.fireflyId);
    if (firefly) firefly.claimed = false;
  }

  /** The more creatures, the smaller each one gets, so a full zoo still reads as six animals. */
  private fitToPool(pool: Pool): void {
    const size = zooSize(pool, this.creatures.length);
    for (const c of this.creatures) c.fitTarget = Math.min(1, size / c.baseSize);
    for (const c of this.snapFit) c.fit = c.fitTarget;
    this.snapFit.clear();
  }

  /** True when the worn creature's action is itself a thumb–index pinch (its voice, not a feed). */
  private pinchIsVoice(worn: Worn | null, hand: HandShadow): boolean {
    if (!worn || worn.side !== hand.side) return false;
    const { a, b } = this.shapes.get(worn.species)!.actuator;
    return (a === J.thumbTip && b === J.indexTip) || (a === J.indexTip && b === J.thumbTip);
  }

  /** A pinch on a creature picks it up (once the tutorial is done); a pinch anywhere else releases a firefly. */
  private feed(hands: readonly HandShadow[], worn: Worn | null, pool: Pool, events: GameEvent[]): void {
    for (const hand of hands) {
      if (hand.pinch !== 'start' || this.pinchIsVoice(worn, hand)) continue;
      const target = this.chaos && !this.held.has(hand.side) ? this.reachable(hand) : null;
      if (target) {
        this.freeFirefly(target);
        target.grab();
        this.held.set(hand.side, target);
        events.push({ type: 'grab', species: target.species, x: target.x, y: target.y });
        continue;
      }
      // Some places release a swarm: the extra fireflies scatter a little around the pinch.
      for (let k = 0; k < this.rules.fireflies; k++) {
        const dx = k === 0 ? 0 : (this.rng() * 2 - 1) * 0.06 * pool.v;
        const dy = k === 0 ? 0 : (this.rng() * 2 - 1) * 0.06 * pool.v;
        const firefly = this.fireflies.spawn(hand.tipX + dx, hand.tipY + dy, pool, this.rng);
        if (!firefly) break;
        this.particles.emit(SPARK, firefly.x, firefly.y, 5, 0.12, this.rng);
        if (k === 0) events.push({ type: 'firefly', x: firefly.x, y: firefly.y });
      }
    }
  }

  private assignFireflies(): void {
    for (const firefly of this.fireflies.list) {
      if (firefly.claimed) continue;
      let best: Creature | null = null;
      let bestDist = Infinity;
      for (const c of this.creatures) {
        if (c.busy) continue;
        const d = Math.abs(c.x - firefly.x) + Math.abs(c.y - firefly.y) * 0.5;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (!best) return;
      firefly.claimed = true;
      best.chase(firefly.id, firefly.x, firefly.y);
    }
  }

  private followFirefly(c: Creature): void {
    const firefly = this.fireflies.get(c.fireflyId);
    if (!firefly) {
      c.calm();
      return;
    }
    c.updateChaseTarget(firefly.x, firefly.y);
    if (c.reached()) {
      this.fireflies.remove(firefly.id);
      c.startEat();
    }
  }

  private updatePet(c: Creature, dt: number, hands: readonly HandShadow[], events: GameEvent[]): void {
    let touching = false;
    if (c.mode === 'rest' || c.mode === 'wander') {
      const cy = c.y + c.lift;
      const radius = c.size * 0.45;
      for (const hand of hands) {
        if (hand.tracked && hand.speed < PET_MAX_SPEED && capsulesNear(hand.caps, 0, hand.count, c.x, cy, radius)) {
          touching = true;
          break;
        }
      }
    }
    // A creature under a resting hand shadow stays put, even between pets.
    if (touching) c.stay();
    let t = this.petTimers.get(c.id) ?? 0;
    if (t < 0) {
      this.petTimers.set(c.id, Math.min(0, t + dt));
      return;
    }
    t = touching ? t + dt : 0;
    if (t >= PET_SECONDS) {
      c.bond = Math.min(MAX_BOND, c.bond + 1);
      c.pet();
      this.particles.emit(HEART, c.x, c.y + c.size * 0.45, 3, c.size * 0.5, this.rng);
      events.push({ type: 'pet', species: c.species, x: c.x, y: c.y });
      t = -PET_COOLDOWN;
    }
    this.petTimers.set(c.id, t);
  }

  private onVoice(worn: Worn, pool: Pool, events: GameEvent[]): void {
    events.push({ type: 'voice', species: worn.species, x: worn.eyeX, y: worn.eyeY });
    this.particles.emit(SPARK, worn.eyeX, worn.eyeY, 4, 0.1, this.rng);
    for (const c of this.creatures) {
      if (worn.species === 'dog' && PREY.has(c.species) && Math.abs(c.x - worn.tipX) < pool.u) {
        c.flee(worn.tipX);
        events.push({ type: 'flee', species: c.species, x: c.x, y: c.y });
      } else if (c.species === worn.species) {
        c.pet();
      }
    }
    if (worn.species === 'crocodile') {
      const firefly = this.fireflies.nearest(worn.tipX, worn.tipY, 0.2);
      if (firefly) {
        this.fireflies.remove(firefly.id);
        this.particles.emit(SPARK, firefly.x, firefly.y, 8, 0.15, this.rng);
        events.push({ type: 'eat', species: 'crocodile', x: firefly.x, y: firefly.y });
      }
    }
  }
}
