import { groundY, halfWidthAt, type Pool } from '../core/creature.js';
import { localDay, visitToday, type Greeting } from '../core/daily.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { TUNING } from '../core/matcher.js';
import type { ShadowProjector } from '../core/projector.js';
import { SaveStore, type HandPreference, type Settings, type StoragePort } from '../core/save.js';
import type { Silhouettes } from '../core/silhouette.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import { captionFor, Onboarding, showGhost, type CaptionInput, type Step } from './Onboarding.js';
import { Progression, type VisitorPlan } from './Progression.js';
import { Puppeteer, type Worn } from './Puppeteer.js';
import { Visitors } from './Visitors.js';
import { Zoo } from './Zoo.js';

const WELCOME_SECONDS = 4;
/** Seconds an onboarding step may hold back the next visitor. */
const ONBOARDING_PATIENCE = 20;
/** A "big" visitor needs a shadow this much larger than the usual size. */
const BIG_FACTOR = 1.3;
const STEADY_HOLD = 2;
const REDUCED_MOTION_SCALE = 0.35;

export interface SessionView {
  caption: string | null;
  ghost: CreatureId | null;
  worn: Worn | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** One play session: save, progression, onboarding, visitors, wearing and the zoo. Pure game logic. */
export class Session {
  readonly saves: SaveStore;
  readonly progression: Progression;
  readonly onboarding: Onboarding;
  readonly visitors: Visitors;
  readonly zoo: Zoo;
  readonly greeting: Greeting;
  private readonly puppeteer: Puppeteer;
  private readonly view: SessionView = { caption: null, ghost: null, worn: null };
  private readonly input: Mutable<CaptionInput>;
  private readonly handSets: Record<HandPreference, HandShadow[]> = { auto: [], left: [], right: [] };
  private plan: VisitorPlan | null = null;
  private restored = false;
  private magnification = 3;
  private handsMissing = 0;
  private welcome = 0;
  private stepTime = 0;
  private lastStep: Step;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    sil: Silhouettes,
    storage: StoragePort | null,
    now: Date,
    rng: () => number,
  ) {
    this.saves = new SaveStore(storage);
    const today = localDay(now);
    this.greeting = visitToday(this.saves.data, today);
    this.saves.save();
    const data = this.saves.data;
    this.progression = new Progression(data, today);
    this.onboarding = new Onboarding(data.unlocked.length === 0);
    this.lastStep = this.onboarding.step;
    this.visitors = new Visitors(shapes, sil, [], 1.2, TUNING[data.settings.assist]);
    this.zoo = new Zoo(shapes, rng);
    this.zoo.setMotionScale(data.settings.reducedMotion ? REDUCED_MOTION_SCALE : 1);
    this.puppeteer = new Puppeteer(shapes, sil);
    if (data.unlocked.length > 0 && this.greeting !== 'same-day') this.welcome = WELCOME_SECONDS;
    this.input = { step: this.onboarding.step, visitor: null, twist: null, visitorElapsed: 0, visitorProgress: 0, handsMissing: 0, welcome: 0, streak: data.streak };
  }

  get settings(): Settings {
    return this.saves.data.settings;
  }

  /** Re-applies settings after a change and saves them. */
  applySettings(): void {
    this.visitors.setTuning(TUNING[this.settings.assist]);
    this.zoo.setMotionScale(this.settings.reducedMotion ? REDUCED_MOTION_SCALE : 1);
    this.saves.save();
  }

  /** Called whenever a stage exists; the first time it restores the saved zoo along the ground line. */
  onStage(pool: Pool, magnification: number): void {
    this.magnification = magnification;
    if (this.restored) return;
    this.restored = true;
    const data = this.saves.data;
    const n = data.unlocked.length;
    data.unlocked.forEach((species, i) => {
      const shape = this.shapes.get(species);
      if (!shape) return;
      const x = ((i + 0.5) / n - 0.5) * 2 * halfWidthAt(pool, groundY(pool));
      this.zoo.add({ species, x, y: 0, size: shape.target.frame.size * magnification, scale: magnification }, [], { silent: true, bond: data.bonds[species] ?? 0 });
    });
  }

  update(dt: number, hands: readonly HandShadow[], projector: ShadowProjector, pool: Pool, events: GameEvent[]): SessionView {
    const active = this.activeHands(hands);
    this.progression.tick(dt);
    this.updateTimers(dt, active);
    this.schedule();
    const revealed = this.visitors.update(dt, active);
    if (revealed && this.plan) this.onReveal(revealed, events);
    const worn = this.puppeteer.update(dt, active, this.zoo.unlocked, this.visitors.current?.def.id ?? null, projector);
    const before = events.length;
    this.zoo.update(dt, pool, active, worn, events);
    this.afterZoo(events, before);
    const input = this.input;
    input.step = this.onboarding.step;
    input.visitor = this.visitors.current?.def.id ?? null;
    input.twist = input.visitor ? (this.plan?.twist ?? null) : null;
    input.visitorElapsed = this.visitors.elapsed;
    input.visitorProgress = this.visitors.current ? this.visitors.matcher.progress() : 0;
    input.handsMissing = this.handsMissing;
    input.welcome = this.welcome;
    input.streak = this.saves.data.streak;
    this.view.caption = captionFor(input);
    this.view.ghost = showGhost(input) ? input.visitor : null;
    this.view.worn = worn;
    return this.view;
  }

  private activeHands(hands: readonly HandShadow[]): readonly HandShadow[] {
    const preference = this.settings.hand;
    if (preference === 'auto') return hands;
    const set = this.handSets[preference];
    if (set.length === 0) for (const h of hands) if (h.side === preference) set.push(h);
    return set;
  }

  private updateTimers(dt: number, hands: readonly HandShadow[]): void {
    let tracked = false;
    for (const h of hands) if (h.tracked) tracked = true;
    this.handsMissing = tracked ? 0 : this.handsMissing + dt;
    this.welcome = Math.max(0, this.welcome - dt);
    if (this.onboarding.step !== this.lastStep) {
      this.lastStep = this.onboarding.step;
      this.stepTime = 0;
    } else {
      this.stepTime += dt;
    }
  }

  private schedule(): void {
    if (this.visitors.busy || this.welcome > 0) return;
    const step = this.onboarding.step;
    if ((step === 'feed' || step === 'pet') && this.stepTime < ONBOARDING_PATIENCE) return;
    const plan = this.progression.nextVisitor();
    if (!plan) return;
    this.plan = plan;
    if (plan.twist === 'steady') this.visitors.enqueue(plan.species, { hold: STEADY_HOLD });
    else if (plan.twist === 'big') {
      const size = this.shapes.get(plan.species)!.target.frame.size * this.magnification;
      this.visitors.enqueue(plan.species, { minSize: size * BIG_FACTOR });
    } else this.visitors.enqueue(plan.species);
  }

  private onReveal(revealed: Revealed, events: GameEvent[]): void {
    const plan = this.plan!;
    this.plan = null;
    const stars = this.progression.onRevealed(plan, this.visitors.lastElapsed);
    if (plan.kind === 'new') this.zoo.add(revealed, events);
    else this.zoo.cheer(plan.species, revealed.x, revealed.y, events);
    this.zoo.celebrate(revealed.x, revealed.y, stars, revealed.size);
    this.onboarding.onReveal();
    this.saves.save();
  }

  private afterZoo(events: readonly GameEvent[], from: number): void {
    let changed = false;
    for (let i = from; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'eat') {
        this.progression.onEat();
        this.onboarding.onEat();
        changed = true;
      } else if (e.type === 'pet') {
        this.onboarding.onPet();
        changed = true;
      }
    }
    if (!changed) return;
    const bonds = this.saves.data.bonds;
    for (const c of this.zoo.creatures) bonds[c.species] = Math.max(bonds[c.species] ?? 0, c.bond);
    this.saves.save();
  }
}
