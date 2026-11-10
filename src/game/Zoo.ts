import { Creature, type CreatureEvent, type Pool } from '../core/creature.js';
import { spreadSpot, zooSize } from '../core/crowd.js';
import { Fireflies } from '../core/fireflies.js';
import { capsulesNear } from '../core/interact.js';
import { J } from '../core/joints.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { HEART, Particles, SPARK } from '../core/particles.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import type { Worn } from './Puppeteer.js';

const PET_SECONDS = 1;
const PET_COOLDOWN = 2;
const PET_MAX_SPEED = 0.9;
const MAX_BOND = 5;
/** Creatures that scatter when the player's dog barks. */
const PREY: ReadonlySet<CreatureId> = new Set<CreatureId>(['rabbit', 'peacock', 'turtle']);

/** The living zoo: creatures, fireflies, particles and every hand interaction. Pure game logic. */
export class Zoo {
  readonly creatures: Creature[] = [];
  readonly fireflies = new Fireflies();
  readonly particles = new Particles();
  private readonly unlockedSet = new Set<CreatureId>();
  private readonly petTimers = new Map<number, number>();
  private readonly creatureEvents: CreatureEvent[] = [];
  /** Restored creatures take their zoo fit at once instead of shrinking into it. */
  private readonly snapFit = new Set<Creature>();
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
    this.feed(hands, worn, pool, events);
    if (worn?.voice) this.onVoice(worn, pool, events);
    this.assignFireflies();
    this.creatureEvents.length = 0;
    for (const creature of this.creatures) {
      if (creature.mode === 'chase') this.followFirefly(creature);
      this.updatePet(creature, dt, hands, events);
      creature.update(dt, pool, this.creatureEvents);
    }
    for (const event of this.creatureEvents) {
      const c = event.creature;
      c.bond = Math.min(MAX_BOND, c.bond + 1);
      this.particles.emit(HEART, c.x, c.y + c.size * 0.4, 2, c.size * 0.5, this.rng);
      events.push({ type: 'eat', species: c.species, x: c.x, y: c.y });
    }
    this.fireflies.update(dt, pool);
    this.particles.update(dt);
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

  private feed(hands: readonly HandShadow[], worn: Worn | null, pool: Pool, events: GameEvent[]): void {
    for (const hand of hands) {
      if (hand.pinch !== 'start' || this.pinchIsVoice(worn, hand)) continue;
      const firefly = this.fireflies.spawn(hand.tipX, hand.tipY, pool, this.rng);
      if (!firefly) continue;
      this.particles.emit(SPARK, firefly.x, firefly.y, 5, 0.12, this.rng);
      events.push({ type: 'firefly', x: firefly.x, y: firefly.y });
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
    let t = this.petTimers.get(c.id) ?? 0;
    if (t < 0) {
      this.petTimers.set(c.id, Math.min(0, t + dt));
      return;
    }
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
