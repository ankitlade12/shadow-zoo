import { groundY, halfWidthAt, type Pool } from '../core/creature.js';
import { localDay, visitToday, type Greeting } from '../core/daily.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { TUNING } from '../core/matcher.js';
import type { ShadowProjector } from '../core/projector.js';
import { SaveStore, type HandPreference, type Settings, type StoragePort } from '../core/save.js';
import type { Silhouettes } from '../core/silhouette.js';
import { placeOf, type PlaceId } from '../core/world.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import { captionFor, Onboarding, showGhost, type CaptionInput, type Step } from './Onboarding.js';
import { Progression, type VisitorPlan } from './Progression.js';
import { Puppeteer, type Worn } from './Puppeteer.js';
import {
  ALL_FED,
  CHAOS_TIPS,
  comboMessage,
  FEEDING_CALL,
  passportMessage,
  plaqueMessage,
  revealMessage,
  SHOW_CALL,
  TOUR_TIP,
  welcomeMessage,
  zooComplete,
} from './rewards.js';
import { Tour } from './Tour.js';
import { Visitors } from './Visitors.js';
import { Zoo } from './Zoo.js';
import { ZooDay } from './ZooDay.js';

const WELCOME_SECONDS = 4;
/** How long the zoo's gate takes to swing open and fade as the lantern lights (or the zoo arrives somewhere). */
const GATE_SECONDS = 2.6;
/** Feeding time quietly ends if not everyone has eaten by then. */
const FEEDING_PATIENCE = 30;
/** Seconds an onboarding step may hold back the next visitor. */
const ONBOARDING_PATIENCE = 20;
/** A "big" visitor needs a shadow this much larger than the usual size. */
const BIG_FACTOR = 1.3;
const STEADY_HOLD = 2;
const REDUCED_MOTION_SCALE = 0.35;
/** Announcements: news (who joined) outranks a tip, which outranks a combo callout. */
const NEWS = 3;
const TIP = 2;
const CALLOUT = 1;
const TIP_SECONDS = 4.5;
const CALLOUT_SECONDS = 1.4;
/** Quiet seconds before the first tip, and between tips. */
const TIP_DELAY = 2;
const TIP_GAP = 12;

export interface SessionView {
  caption: string | null;
  ghost: CreatureId | null;
  worn: Worn | null;
  /** The World Tour's globe is open on the wall (the zoo waits meanwhile). */
  tour: boolean;
  /** The zoo's gate swinging open on the wall: 0 to 1 while it plays, null otherwise. */
  gate: number | null;
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
  readonly tour = new Tour();
  private readonly puppeteer: Puppeteer;
  private readonly view: SessionView = { caption: null, ghost: null, worn: null, tour: false, gate: null };
  private readonly input: Mutable<CaptionInput>;
  private readonly handSets: Record<HandPreference, HandShadow[]> = { auto: [], left: [], right: [] };
  private plan: VisitorPlan | null = null;
  private restored = false;
  private magnification = 3;
  private handsMissing = 0;
  private welcome = 0;
  /** The news of the moment on the wall (who joined, with its stars) and how long it stays. */
  private announce: string | null = null;
  private announceLeft = 0;
  private announcePriority = 0;
  /** The tips still to show this session, and the quiet seconds before the next one. */
  private readonly tips = [...CHAOS_TIPS, TOUR_TIP];
  private tipWait = TIP_DELAY;
  /** A line to show once the current announcement ends (a new passport stamp after an arrival). */
  private followUp: string | null = null;
  private stepTime = 0;
  private lastStep: Step;
  /** The zoo the homepage chose, travelled to once the game runs on the wall. */
  private startPlace: PlaceId | null = null;
  /** The zoo's day: feeding time and show time, in turn. */
  private readonly day = new ZooDay();
  /** Seconds left of the gate on the wall, and whether the first light's welcome has been given. */
  private gateLeft = 0;
  private welcomed = true;
  /** The creatures fed since the keeper called feeding time (null outside feeding time), and its patience. */
  private feeding: Set<CreatureId> | null = null;
  private feedingLeft = 0;

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
    this.zoo.rules = placeOf(data.place).rules;
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
    // The lantern lights on the zoo's gate swinging open.
    this.gateLeft = GATE_SECONDS;
    this.welcomed = false;
    const data = this.saves.data;
    const n = data.unlocked.length;
    data.unlocked.forEach((species, i) => {
      const shape = this.shapes.get(species);
      if (!shape) return;
      const x = ((i + 0.5) / n - 0.5) * 2 * halfWidthAt(pool, groundY(pool));
      this.zoo.add({ species, x, y: 0, size: shape.target.frame.size * magnification, scale: magnification }, [], { silent: true, bond: data.bonds[species] ?? 0 });
    });
  }

  /**
   * Starts the game in the zoo chosen on the homepage. The zoo travels there on the first frame on the
   * wall, so the arrival (and any new passport stamp) is seen and heard there; if it is there already,
   * nothing changes.
   */
  startAt(id: PlaceId): void {
    this.startPlace = id;
  }

  update(dt: number, hands: readonly HandShadow[], projector: ShadowProjector, pool: Pool, events: GameEvent[]): SessionView {
    let travelled = false;
    if (this.startPlace) {
      if (this.startPlace !== this.saves.data.place) {
        this.travel(this.startPlace, events);
        travelled = true;
      }
      this.startPlace = null;
    }
    // The first light's welcome; a trip on the first frame has its own arrival and fanfare instead.
    if (!this.welcomed) {
      this.welcomed = true;
      if (!travelled) {
        events.push({ type: 'gate', place: this.saves.data.place, x: 0, y: 0 });
        // A returning player's first night back opens on their welcome back and its streak instead.
        if (this.welcome <= 0) this.say(welcomeMessage(this.saves.data.place), NEWS, GATE_SECONDS);
      }
    }
    this.gateLeft = Math.max(0, this.gateLeft - dt);
    const active = this.activeHands(hands);
    this.progression.tick(dt);
    this.updateTimers(dt, active);
    if (this.tour.open) return this.updateTour(dt, active, pool, events);
    this.schedule();
    const revealed = this.visitors.update(dt, active);
    if (revealed && this.plan) this.onReveal(revealed, events, pool);
    const worn = this.puppeteer.update(dt, active, this.zoo.unlocked, this.visitors.current?.def.id ?? null, projector);
    const before = events.length;
    this.zoo.chaos = this.onboarding.step === 'done';
    this.zoo.clapReady = !(this.visitors.current?.def.pair ?? false);
    this.zoo.update(dt, pool, active, worn, events);
    this.afterZoo(events, before);
    this.zooDay(dt, pool, events);
    this.nextTip(dt);
    const input = this.input;
    input.step = this.onboarding.step;
    input.visitor = this.visitors.current?.def.id ?? null;
    input.twist = input.visitor ? (this.plan?.twist ?? null) : null;
    input.visitorElapsed = this.visitors.elapsed;
    input.visitorProgress = this.visitors.current ? this.visitors.matcher.progress() : 0;
    input.handsMissing = this.handsMissing;
    input.welcome = this.welcome;
    input.streak = this.saves.data.streak;
    this.announceLeft = Math.max(0, this.announceLeft - dt);
    input.announce = this.announceLeft > 0 ? this.announce : null;
    this.view.caption = captionFor(input);
    this.view.ghost = showGhost(input) ? input.visitor : null;
    this.view.worn = worn;
    this.view.tour = false;
    this.view.gate = this.gateProgress();
    return this.view;
  }

  private gateProgress(): number | null {
    return this.gateLeft > 0 ? 1 - this.gateLeft / GATE_SECONDS : null;
  }

  /**
   * The keeper's timetable: feeding time showers fireflies for everyone, show time has every creature do
   * its trick. Its clock runs only while the zoo is free for it: tutorial done, creatures to play with,
   * nothing being announced and nothing held.
   */
  private zooDay(dt: number, pool: Pool, events: GameEvent[]): void {
    const ready =
      this.onboarding.step === 'done' &&
      this.zoo.creatures.length >= 2 &&
      this.announceLeft <= 0 &&
      this.gateLeft <= 0 &&
      !this.zoo.holding('left') &&
      !this.zoo.holding('right');
    const moment = this.day.update(dt, ready);
    if (moment === 'feeding') {
      this.zoo.feedingTime(pool, events);
      this.say(FEEDING_CALL, NEWS, 2.5);
      this.feeding = new Set();
      this.feedingLeft = FEEDING_PATIENCE;
    } else if (moment === 'show') {
      this.zoo.showTime(pool, events);
      this.say(SHOW_CALL, NEWS, 3);
    }
    if (this.feeding) {
      this.feedingLeft -= dt;
      if (this.feedingLeft <= 0) this.feeding = null;
    }
  }

  /** Opens the World Tour's globe on the wall, turned toward where the zoo is now. */
  openTour(events: GameEvent[]): void {
    if (this.tour.open) return;
    this.tour.show(this.saves.data.place);
    events.push({ type: 'globe', x: 0, y: 0 });
  }

  /** While the globe is open the zoo and its visitors wait; the hands spin the globe and pick a place. */
  private updateTour(dt: number, hands: readonly HandShadow[], pool: Pool, events: GameEvent[]): SessionView {
    const action = this.tour.update(dt, hands, pool);
    if (action?.type === 'travel') this.travel(action.place, events);
    else if (action?.type === 'close') this.tour.hide();
    this.announceLeft = Math.max(0, this.announceLeft - dt);
    const view = this.view;
    if (this.tour.open) view.caption = this.tour.hover ? placeOf(this.tour.hover).hover : 'Spin the globe. Pinch a place to travel';
    else view.caption = this.announceLeft > 0 ? this.announce : null;
    view.ghost = null;
    view.worn = null;
    view.tour = this.tour.open;
    view.gate = this.tour.open ? null : this.gateProgress();
    return view;
  }

  /** Takes the zoo somewhere: its rules (and, through the place, its light, weather and sounds), with a stamp on a first visit. */
  private travel(id: PlaceId, events: GameEvent[]): void {
    const data = this.saves.data;
    const place = placeOf(id);
    this.tour.hide();
    // The new zoo's gate swings open as the zoo arrives.
    this.gateLeft = GATE_SECONDS;
    data.place = id;
    this.zoo.rules = place.rules;
    events.push({ type: 'travel', place: id, x: 0, y: 0 });
    this.say(place.arrival, NEWS, 3.5);
    if (id !== 'home' && !data.stamps.includes(id)) {
      data.stamps.push(id);
      events.push({ type: 'stamp', place: id, x: 0, y: 0 });
      this.followUp = passportMessage(data.stamps.length);
    }
    this.saves.save();
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
    // The first visitor waits for the gate to open.
    if (this.visitors.busy || this.welcome > 0 || this.gateLeft > 0) return;
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

  /** Every creature has been found: the lantern burns golden from then on. */
  get complete(): boolean {
    return zooComplete(this.saves.data);
  }

  private onReveal(revealed: Revealed, events: GameEvent[], pool: Pool): void {
    const plan = this.plan!;
    this.plan = null;
    const wasComplete = zooComplete(this.saves.data);
    const stars = this.progression.onRevealed(plan, this.visitors.lastElapsed);
    if (plan.kind === 'new') this.zoo.add(revealed, events);
    else this.zoo.cheer(plan.species, revealed.x, revealed.y, events);
    this.zoo.celebrate(revealed.x, revealed.y, stars, revealed.size);
    // The last creature found completes the zoo: a finale, and the news stays up a little longer.
    const finished = plan.kind === 'new' && !wasComplete && zooComplete(this.saves.data);
    if (finished) this.zoo.finale(pool);
    this.say(revealMessage(this.shapes.get(plan.species)!.def.name, plan.kind, stars, finished), NEWS, finished ? 5 : 3);
    this.onboarding.onReveal();
    this.saves.save();
  }

  /** Puts a line on the wall for a while, unless something more important is showing. */
  private say(text: string, priority: number, seconds: number): void {
    if (this.announceLeft > 0 && priority < this.announcePriority) return;
    this.announce = text;
    this.announceLeft = seconds;
    this.announcePriority = priority;
  }

  /** After the tutorial, teaches grabbing, then swatting and clapping, in a quiet moment with creatures to play with. */
  private nextTip(dt: number): void {
    if (this.announceLeft > 0) return;
    if (this.followUp) {
      this.say(this.followUp, TIP, 3);
      this.followUp = null;
      return;
    }
    if (this.tips.length === 0 || this.onboarding.step !== 'done' || this.welcome > 0 || this.zoo.creatures.length === 0) return;
    this.tipWait -= dt;
    if (this.tipWait > 0) return;
    this.say(this.tips.shift()!, TIP, TIP_SECONDS);
    this.tipWait = TIP_GAP;
  }

  /** During feeding time, counts who has eaten; once everyone has, the keeper says so. */
  private onFed(species: CreatureId): void {
    if (!this.feeding) return;
    this.feeding.add(species);
    if (!this.zoo.creatures.every((c) => this.feeding!.has(c.species))) return;
    this.feeding = null;
    this.say(ALL_FED, NEWS, 2.5);
  }

  private afterZoo(events: readonly GameEvent[], from: number): void {
    let changed = false;
    for (let i = from; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'bonk' && e.combo >= 2) this.say(comboMessage(e.combo), CALLOUT, CALLOUT_SECONDS);
      else if (e.type === 'clap') this.say('Thunderclap!', CALLOUT, CALLOUT_SECONDS);
      else if (e.type === 'eat') {
        this.progression.onEat();
        this.onboarding.onEat();
        changed = true;
        this.onFed(e.species);
      } else if (e.type === 'pet') {
        this.onboarding.onPet();
        changed = true;
        // A petted creature's name plaque: its name, and the hearts it has for you.
        const pet = this.zoo.creatures.find((c) => c.species === e.species);
        this.say(plaqueMessage(this.shapes.get(e.species)!.def.name, pet?.bond ?? 1), CALLOUT, 1.8);
      }
    }
    if (!changed) return;
    const bonds = this.saves.data.bonds;
    for (const c of this.zoo.creatures) bonds[c.species] = Math.max(bonds[c.species] ?? 0, c.bond);
    this.saves.save();
  }
}
