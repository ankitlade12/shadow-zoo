import { AudioEngine } from '../../audio/AudioEngine.js';
import { soundFor } from '../../audio/events.js';
import type { SoundName } from '../../audio/recipes.js';
import { groundY, type Creature } from '../../core/creature.js';
import { buildCreatureShapes, type CreatureId, type CreatureShape } from '../../core/library.js';
import { SPARK } from '../../core/particles.js';
import { mulberry32 } from '../../core/rng.js';
import { Silhouettes } from '../../core/silhouette.js';
import { WeatherField } from '../../core/weather.js';
import { placeOf, type PlaceId } from '../../core/world.js';
import type { GameEvent } from '../../game/events.js';
import type { HandShadow } from '../../game/hands.js';
import { Zoo } from '../../game/Zoo.js';
import { PointerHand } from './hand.js';
import { cameraFor, enclosureAt, poolAt, walkLayout, walkToward, type Enclosure } from './layout.js';
import { CreaturePainter, drawFireflies, drawParticles, glow, ShadowLayer, type View } from './painter.js';
import { BAND, Scenery } from './scenery.js';

/** The zoo walk's names for each zoo. */
export const WALK_NAMES: Readonly<Record<PlaceId, { readonly title: string; readonly gate: string; readonly short: string }>> = {
  home: { title: 'The Shadow Zoo at home', gate: 'At home', short: 'the home zoo' },
  arctic: { title: 'The Arctic Shadow Zoo', gate: 'The Arctic', short: 'the Arctic zoo' },
  sahara: { title: 'The Sahara Shadow Zoo', gate: 'The Sahara', short: 'the Sahara zoo' },
  amazon: { title: 'The Amazon Shadow Zoo', gate: 'The Amazon', short: 'the Amazon zoo' },
  outback: { title: 'The Outback Shadow Zoo', gate: 'The Outback', short: 'the Outback zoo' },
  moon: { title: 'The Shadow Zoo on the Moon', gate: 'On the Moon', short: 'the Moon zoo' },
};

/** What the zoo walk asks of the page around it. */
export interface WalkHooks {
  /** The visitor went back to the atlas. */
  onClose(): void;
  /** Light the lantern in this zoo; false when this browser can't play (the walk says why). */
  onStart(place: PlaceId): boolean;
  /** Why this browser can't start the game, for the lantern house. */
  startNote(): string;
  /** Fills the lantern house's plaque with the zoo's seal and name. */
  label(button: HTMLButtonElement, place: PlaceId): void;
}

interface Pen {
  readonly enclosure: Enclosure;
  readonly zoo: Zoo;
  readonly events: GameEvent[];
}

const WALK_SPEED = 1.7;
const TRAVEL_SPEED = 3.6;
/** How large a creature's shadow is cast before its pen fits it (meters). */
const CAST_SIZE = 0.34;
/** Reduced motion: hops and bounces scaled as in the game's own setting. */
const STILL_MOTION = 0.35;
const reducedMotion = (): boolean => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Walking into a zoo on the page: a lantern-lit night zoo along a wall, an enclosure for every creature,
 * each enclosure running the game's own zoo, physics and rules with a mouse or finger as the hand.
 */
export class ZooWalk {
  private readonly layout = walkLayout();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer = new ShadowLayer();
  private readonly hand = new PointerHand(0.32);
  /** The helping hand the Pet button lends: it rests on a creature for you. */
  private readonly helper = new PointerHand(0.32, 'left');
  private readonly weather = new WeatherField(mulberry32(5));
  private readonly audio = new AudioEngine();
  private readonly rng = mulberry32(11);
  private shapes: Map<CreatureId, CreatureShape> | null = null;
  private painter: CreaturePainter | null = null;
  private scenery: Scenery | null = null;
  private pens: Pen[] = [];
  private place: PlaceId = 'home';
  private visitorX = this.layout.start;
  private target: number | null = null;
  private heading = 0;
  private facing = 1;
  private stride = 0;
  private moving = false;
  private camX = this.layout.start;
  private gate = 0;
  private time = 0;
  private pointer: { x: number; y: number } | null = null;
  private lift = false;
  private dragFrom: number | null = null;
  private captured: Pen | null = null;
  /** A press just ended: its enclosure still gets this frame's release, so a throw keeps its speed. */
  private releasing = false;
  private handPen: Pen | null = null;
  private gateHeard = false;
  private assist: { pen: Pen; creature: Creature; left: number } | null = null;
  private readonly fed = new Set<CreatureId>();
  private readonly petted = new Set<CreatureId>();
  private complete = false;
  private running = false;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: WalkHooks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.captured && this.dragFrom === null) this.pointer = null;
    });
    document.addEventListener('keydown', (e) => this.key(e, true));
    document.addEventListener('keyup', (e) => this.key(e, false));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-goto]')) {
      b.addEventListener('click', () => {
        const e = this.layout.enclosures[Number(b.dataset.goto)];
        this.target = e ? e.x : b.dataset.goto === 'home' ? this.layout.house : this.layout.gate + 0.6;
      });
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-do]')) b.addEventListener('click', () => this.act(b.dataset.do ?? ''));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-step]')) {
      const dir = Number(b.dataset.step);
      const hold = (on: boolean): void => {
        this.heading = on ? dir : this.heading === dir ? 0 : this.heading;
        if (on) this.target = null;
      };
      b.addEventListener('pointerdown', () => hold(true));
      b.addEventListener('pointerup', () => hold(false));
      b.addEventListener('pointerleave', () => hold(false));
      b.addEventListener('click', (e) => {
        // A keyboard press (no pointer) walks to the next enclosure that way.
        if ((e as PointerEvent).pointerType) return;
        this.stepTo(dir);
      });
    }
    root.querySelector<HTMLButtonElement>('[data-walk="back"]')?.addEventListener('click', () => this.close());
    // Development builds let scripts that film the walk find its creatures on screen.
    if (import.meta.env.DEV) (globalThis as { __zooWalk?: unknown }).__zooWalk = this;
    root.querySelector<HTMLButtonElement>('#walk-start')?.addEventListener('click', () => {
      if (!this.hooks.onStart(this.place)) this.text('walk-note', this.hooks.startNote());
    });
    const sound = root.querySelector<HTMLButtonElement>('[data-walk="sound"]');
    sound?.addEventListener('click', () => {
      const on = sound.getAttribute('aria-pressed') !== 'true';
      sound.setAttribute('aria-pressed', String(on));
      this.audio.setMuted(!on);
      if (on) this.audio.unlock();
    });
  }

  get isOpen(): boolean {
    return this.running;
  }

  /** Walks into a zoo: its gate, its enclosures, its light, weather and rules. */
  open(place: PlaceId): void {
    this.place = place;
    this.shapes ??= buildCreatureShapes(new Silhouettes());
    this.painter ??= new CreaturePainter(this.shapes);
    this.scenery = new Scenery(place, this.layout);
    const rules = placeOf(place).rules;
    const still = reducedMotion();
    this.pens = this.layout.enclosures.map((enclosure) => {
      const zoo = new Zoo(this.shapes!, this.rng);
      zoo.rules = rules;
      zoo.chaos = true;
      zoo.clapReady = true;
      if (still) zoo.setMotionScale(STILL_MOTION);
      const shape = this.shapes!.get(enclosure.species)!;
      const scale = CAST_SIZE / shape.target.frame.size;
      for (let i = 0; i < enclosure.count; i++) {
        const x = ((i + 0.5) / enclosure.count - 0.5) * 1.3 * this.layout.pool.u;
        const air = shape.def.motion === 'fly' || shape.def.motion === 'dangle';
        const y = air ? (0.15 + 0.2 * this.rng()) * this.layout.pool.v : groundY(this.layout.pool);
        zoo.add({ species: enclosure.species, x, y, size: CAST_SIZE, scale }, [], { silent: true });
      }
      return { enclosure, zoo, events: [] };
    });
    this.visitorX = this.layout.start;
    this.camX = this.layout.start;
    this.target = this.layout.gate + 0.6;
    this.heading = 0;
    this.gate = still ? 1 : 0;
    this.gateHeard = still;
    this.time = 0;
    this.fed.clear();
    this.petted.clear();
    this.complete = false;
    this.assist = null;
    this.shown = '';
    const names = WALK_NAMES[place];
    this.text('walk-title', names.title);
    const plaque = this.root.querySelector<HTMLButtonElement>('#walk-start');
    if (plaque) this.hooks.label(plaque, place);
    this.text('walk-note', '');
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-goto]')) {
      b.removeAttribute('data-fed');
      b.removeAttribute('data-petted');
    }
    this.root.hidden = false;
    document.body.classList.add('walking');
    // The page behind the zoo can't be reached while you're inside it.
    document.querySelector('.desk')?.setAttribute('inert', '');
    this.audio.unlock();
    this.audio.startAmbient([this.camX, 0, 0], place);
    this.root.querySelector<HTMLElement>('[data-walk="back"]')?.focus({ preventScroll: true });
    this.trail();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  /** Back to the atlas. */
  close(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.audio.stopAmbient();
    this.root.hidden = true;
    document.body.classList.remove('walking');
    document.querySelector('.desk')?.removeAttribute('inert');
    this.pointer = null;
    this.captured = null;
    this.dragFrom = null;
    this.hooks.onClose();
  }

  private text(id: string, value: string): void {
    const el = this.root.querySelector(`#${id}`);
    if (el && el.textContent !== value) el.textContent = value;
  }

  /** Development builds: where each creature of the enclosure nearest the visitor is on screen (CSS pixels). */
  debugCreatures(): { species: CreatureId; x: number; y: number; mode: string }[] {
    if (!import.meta.env.DEV) return [];
    const v = this.view();
    const here = enclosureAt(this.layout, this.visitorX, 3);
    const pen = here ? this.penFor(here) : null;
    if (!pen) return [];
    return pen.zoo.creatures.map((c) => ({
      species: c.species,
      x: v.w / 2 + (pen.enclosure.x + c.x - v.camX) * v.scale,
      y: v.originY - (this.layout.poolY + c.y + c.lift) * v.scale,
      mode: c.mode,
    }));
  }

  private view(): View {
    const scale = Math.min(this.h / (BAND.top - BAND.bottom), this.w / 2.2);
    const middle = (BAND.top + BAND.bottom) / 2;
    return { w: this.w, h: this.h, scale, camX: this.camX, originY: this.h / 2 + middle * scale };
  }

  private toWall(px: number, py: number, v: View): { x: number; y: number } {
    return { x: v.camX + (px - v.w / 2) / v.scale, y: (v.originY - py) / v.scale };
  }

  private penFor(enclosure: Enclosure): Pen | null {
    return this.pens.find((p) => p.enclosure === enclosure) ?? null;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  private down(e: PointerEvent): void {
    this.audio.unlock();
    this.pointer = this.local(e);
    this.lift = false;
    this.canvas.setPointerCapture(e.pointerId);
    const wall = this.toWall(this.pointer.x, this.pointer.y, this.view());
    const hit = poolAt(this.layout, wall.x, wall.y);
    if (hit) {
      this.captured = this.penFor(hit.enclosure);
      this.hand.press();
      return;
    }
    // Off the enclosures, a drag walks the visitor along the path.
    this.dragFrom = e.clientX;
    this.target = null;
  }

  private move(e: PointerEvent): void {
    this.pointer = this.local(e);
    if (this.dragFrom === null) return;
    const dx = e.clientX - this.dragFrom;
    this.dragFrom = e.clientX;
    const before = this.visitorX;
    this.visitorX = walkToward(this.layout, this.visitorX, this.visitorX - dx / this.view().scale, 1, Infinity);
    this.walked(this.visitorX - before);
  }

  private up(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.captured) {
      this.hand.release();
      this.releasing = true;
    }
    this.dragFrom = null;
    // A finger leaves the wall when it lifts (after its release reaches the zoo).
    if (e.pointerType !== 'mouse') this.lift = true;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (!this.running || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') {
      this.heading = down ? -1 : this.heading === -1 ? 0 : this.heading;
      if (down) this.target = null;
    } else if (k === 'arrowright' || k === 'd') {
      this.heading = down ? 1 : this.heading === 1 ? 0 : this.heading;
      if (down) this.target = null;
    } else if (down && k === 'escape') this.close();
    else if (down && !e.repeat && ['f', 'p', 't', 'c'].includes(k)) {
      this.act({ f: 'feed', p: 'pet', t: 'toss', c: 'clap' }[k as 'f' | 'p' | 't' | 'c']);
    } else return;
    e.preventDefault();
  }

  /** Walks to the next enclosure (or the gate, or the lantern house) in a direction. */
  private stepTo(dir: number): void {
    const stops = [this.layout.gate + 0.6, ...this.layout.enclosures.map((e) => e.x), this.layout.house];
    const from = this.target ?? this.visitorX;
    const next = dir > 0 ? stops.find((x) => x > from + 0.2) : [...stops].reverse().find((x) => x < from - 0.2);
    if (next !== undefined) this.target = next;
  }

  private walked(dx: number): void {
    if (Math.abs(dx) < 1e-5) return;
    this.facing = dx > 0 ? 1 : -1;
    this.stride += Math.abs(dx);
    this.moving = true;
  }

  /** The buttons (and F, P, T, C) at the enclosure the visitor stands at. */
  private act(what: string): void {
    this.audio.unlock();
    const here = enclosureAt(this.layout, this.visitorX);
    const pen = here ? this.penFor(here) : null;
    if (!pen) return;
    const pool = this.layout.pool;
    const zoo = pen.zoo;
    const free = zoo.creatures.filter((c) => c.mode === 'rest' || c.mode === 'wander');
    const pick = (list: Creature[]): Creature | null => (list.length ? list[Math.floor(this.rng() * list.length)] : null);
    if (what === 'feed') {
      const c = pick(free) ?? pick(zoo.creatures);
      const x = c ? c.x + (this.rng() - 0.5) * 0.2 : 0;
      const y = c ? Math.min(pool.v * 0.6, c.y + c.size * 0.9) : 0.2;
      for (let k = 0; k < zoo.rules.fireflies; k++) {
        const f = zoo.fireflies.spawn(x + (k ? (this.rng() - 0.5) * 0.12 : 0), y + (k ? (this.rng() - 0.5) * 0.08 : 0), pool, this.rng);
        if (!f) break;
        zoo.particles.emit(SPARK, f.x, f.y, 5, 0.12, this.rng);
        if (k === 0) pen.events.push({ type: 'firefly', x: f.x, y: f.y });
      }
    } else if (what === 'pet') {
      const c = pick(free);
      if (c) this.assist = { pen, creature: c, left: 1.35 };
    } else if (what === 'toss') {
      const c = pick(zoo.creatures.filter((k) => k.canBeHit));
      if (!c) return;
      const dir = c.x > 0 ? -1 : 1;
      c.knock(dir * (0.5 + 0.7 * this.rng()) * pool.v, (2.2 + 0.8 * this.rng()) * pool.v, pool);
      pen.events.push({ type: 'fling', species: c.species, x: c.x, y: c.y });
    } else if (what === 'clap') zoo.thunderclap(0, 0.1 * pool.v, pool, pen.events);
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.resize();
    if (this.time > 0.35 && this.gate < 1) this.gate = Math.min(1, this.gate + dt / 1.3);
    if (this.gate > 0 && !this.gateHeard) {
      this.gateHeard = true;
      this.play('gate', this.layout.gate, 0);
    }
    this.walk(dt);
    let v = this.view();
    const goal = cameraFor(this.layout, this.visitorX, v.w / 2 / v.scale);
    this.camX += (goal - this.camX) * Math.min(1, dt * 5);
    v = this.view();
    this.audio.setListener(this.camX, 0, 2.2, 0, 0, -1);
    this.steer(dt, v);
    this.updatePens(dt, v);
    this.weather.update(dt, this.field(v), placeOf(this.place).rules.wind);
    this.draw(v);
    this.hud();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private walk(dt: number): void {
    const before = this.visitorX;
    // The gate must open before anyone walks in.
    const limit = this.gate < 0.7 ? this.layout.gate - 0.5 : Infinity;
    if (this.heading !== 0) this.visitorX = walkToward(this.layout, this.visitorX, this.visitorX + this.heading * 50, dt, WALK_SPEED);
    else if (this.target !== null) {
      this.visitorX = walkToward(this.layout, this.visitorX, Math.min(this.target, limit), dt, TRAVEL_SPEED);
      if (Math.abs(this.visitorX - this.target) < 1e-3) this.target = null;
    }
    this.visitorX = Math.min(this.visitorX, Math.max(limit, before));
    this.moving = false;
    this.walked(this.visitorX - before);
  }

  /** The pointer's hand, and the Pet button's helping hand, on the enclosure they are over. */
  private steer(dt: number, v: View): void {
    let pen: Pen | null = null;
    let at: { x: number; y: number } | null = null;
    if (this.pointer) {
      const wall = this.toWall(this.pointer.x, this.pointer.y, v);
      if (this.captured) {
        pen = this.captured;
        at = { x: wall.x - pen.enclosure.x, y: wall.y - this.layout.poolY };
      } else {
        const hit = poolAt(this.layout, wall.x, wall.y);
        if (hit) {
          pen = this.penFor(hit.enclosure);
          at = { x: hit.x, y: hit.y };
        }
      }
    }
    this.hand.update(at, dt, pen !== this.handPen);
    this.handPen = pen;
    if (this.releasing) {
      this.releasing = false;
      this.captured = null;
    }
    if (this.lift) {
      this.lift = false;
      this.pointer = null;
    }
    const a = this.assist;
    if (a) {
      a.left -= dt;
      const c = a.creature;
      if (a.left <= 0 || c.mode === 'tumble' || c.mode === 'held') {
        this.assist = null;
        this.helper.update(null, dt);
      } else this.helper.update({ x: c.x + c.size * 0.05, y: c.y + c.lift + c.size * 0.35 }, dt, false);
    }
  }

  /** Plays a sound on the wall; development builds trace it, as the game's sound system does. */
  private play(sound: SoundName, x: number, y: number): void {
    this.audio.play(sound, [x, y, 0]);
    if (import.meta.env.DEV) console.info(`[ShadowZoo] sound ${sound} (walk) @ ${x.toFixed(2)} ${y.toFixed(2)} 0.00`);
  }

  private updatePens(dt: number, v: View): void {
    const half = v.w / 2 / v.scale + 2.5;
    for (const pen of this.pens) {
      if (Math.abs(pen.enclosure.x - this.camX) > half) continue;
      const hands: HandShadow[] = [];
      if (pen === this.handPen) hands.push(this.hand.shadow);
      if (this.assist?.pen === pen && this.helper.shadow.tracked) hands.push(this.helper.shadow);
      pen.zoo.update(dt, this.layout.pool, hands, null, pen.events);
      for (const e of pen.events) {
        this.play(soundFor(e), pen.enclosure.x + e.x, this.layout.poolY + e.y);
        if (e.type === 'eat') this.fed.add(pen.enclosure.species);
        else if (e.type === 'pet') this.petted.add(pen.enclosure.species);
        else continue;
        this.trail();
      }
      pen.events.length = 0;
    }
  }

  /** Feed and pet every creature: the walk's trail. Done, the whole zoo celebrates. */
  private trail(): void {
    const n = this.layout.enclosures.length;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-goto]')) {
      const e = this.layout.enclosures[Number(b.dataset.goto)];
      if (!e) continue;
      b.toggleAttribute('data-fed', this.fed.has(e.species));
      b.toggleAttribute('data-petted', this.petted.has(e.species));
    }
    this.text('walk-trail', `Fed ${this.fed.size} of ${n} · Petted ${this.petted.size} of ${n}`);
    if (this.complete || this.fed.size < n || this.petted.size < n) return;
    this.complete = true;
    for (const pen of this.pens) for (const c of pen.zoo.creatures) c.celebrate();
    this.play('stamp', this.visitorX, 0);
    this.shown = '';
  }

  private field(v: View): { u: number; v: number } {
    return { u: v.w / 2 / v.scale, v: v.h / 2 / v.scale };
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (box.width === this.w && box.height === this.h && dpr === this.dpr) return;
    this.w = box.width;
    this.h = box.height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    const v = this.view();
    this.weather.set(placeOf(this.place).weather, this.field(v));
  }

  private draw(v: View): void {
    const ctx = this.ctx;
    const scenery = this.scenery;
    const painter = this.painter;
    if (!scenery || !painter || this.w === 0) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    scenery.drawSky(ctx, v, this.time);
    scenery.drawWall(ctx, v, this.time, this.layout.enclosures.map((e) => e.name));
    const still = reducedMotion();
    const visible = this.pens.filter((p) => Math.abs(p.enclosure.x - this.camX) < v.w / 2 / v.scale + 1.2);
    const pool = this.layout.pool;
    const oy = this.layout.poolY;
    this.layer.begin(this.w, this.h, this.dpr);
    const eyes: { x: number; y: number }[] = [];
    for (const pen of visible) {
      for (const c of pen.zoo.creatures) {
        const eye = painter.draw(this.layer, c, pen.enclosure.x, oy, pool, v, still);
        if (eye) eyes.push(eye);
      }
    }
    for (const [hand, pen] of [
      [this.hand, this.handPen],
      [this.helper, this.assist?.pen ?? null],
    ] as const) {
      if (pen && hand.shadow.tracked) this.layer.capsules(hand.shadow.caps, 0, hand.shadow.drawCount, pen.enclosure.x, oy, v);
    }
    this.layer.composite(ctx, this.w, this.h, Math.max(0.6, v.scale * 0.004));
    for (const pen of visible) {
      drawFireflies(ctx, pen.zoo.fireflies.list, pen.enclosure.x, oy, v, still);
      drawParticles(ctx, pen.zoo.particles, pen.enclosure.x, oy, v, this.time);
    }
    for (const eye of eyes) glow(ctx, eye.x, eye.y, Math.max(2, 0.008 * v.scale), 1);
    scenery.drawPath(ctx, v);
    scenery.drawRailing(ctx, v);
    const names = WALK_NAMES[this.place];
    scenery.drawGate(ctx, v, this.gate, 'Shadow Zoo', names.gate, this.time);
    scenery.drawHouse(ctx, v, this.time);
    scenery.drawVisitor(ctx, v, this.visitorX, this.facing, this.stride, this.moving);
    scenery.drawWeather(ctx, v, this.weather, this.field(v), placeOf(this.place).rules.wind, (BAND.top + BAND.bottom) / 2 + 0);
  }

  /** The card for where the visitor stands: the gate, an enclosure, between them, or the lantern house. */
  private hud(): void {
    const L = this.layout;
    const here = enclosureAt(L, this.visitorX);
    const atHouse = this.visitorX > L.house - 1.2;
    const atGate = this.visitorX < L.gate + 1;
    const key = this.complete ? 'done' : here ? here.species : atHouse ? 'house' : atGate ? 'gate' : 'path';
    if (key === this.shown) return;
    this.shown = key;
    const names = WALK_NAMES[this.place];
    const next = L.enclosures.find((e) => e.x > this.visitorX);
    let title = '';
    let line = '';
    if (key === 'done') {
      title = 'Everyone fed and petted';
      line = `You fed and petted every creature in ${names.short}. Take the zoo home: light the lantern at the end of the path.`;
    } else if (here) {
      title = here.name;
      line = here.fact;
    } else if (atHouse) {
      title = 'The lantern house';
      line = 'Take this zoo home: light the lantern, and the shadows come alive on your own wall.';
    } else if (atGate) {
      title = `Welcome to ${names.title.replace(/^The /, 'the ')}`;
      line = 'Walk along the path to visit every enclosure.';
    } else {
      title = next ? `On to the ${next.name}` : 'The lantern house is ahead';
      line = 'Keep walking: every enclosure has its own creatures to feed, pet and throw.';
    }
    this.text('walk-here', title);
    this.text('walk-fact', line);
    this.root.dataset.at = here ? 'pen' : atHouse ? 'house' : 'path';
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-do]')) b.disabled = !here;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-goto]')) {
      const e = L.enclosures[Number(b.dataset.goto)];
      if (e === here || (b.dataset.goto === 'home' && atHouse) || (b.dataset.goto === 'gate' && atGate)) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
    }
  }
}
