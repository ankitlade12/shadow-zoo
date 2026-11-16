import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { fireflyGlow } from '../core/fireflies.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes, canonicalPair, CREATURES, type CreatureDef } from '../core/library.js';
import { penumbra } from '../core/lantern.js';
import { HEART, STAR } from '../core/particles.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import type { StoragePort } from '../core/save.js';
import { Silhouettes } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { WeatherField } from '../core/weather.js';
import { GLOBE_DOTS, placeOf, projectGlobe, type Place, type Projected } from '../core/world.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../game/hands.js';
import type { Worn } from '../game/Puppeteer.js';
import { Session } from '../game/Session.js';
import { Caption } from '../render/Caption.js';
import { GhostHand } from '../render/GhostHand.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

/** The lantern once every creature is found. */
const GOLD: readonly [number, number, number] = [1, 0.83, 0.38];

function browserStorage(): StoragePort | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Projects the hands, runs the session and draws everything: shadows, visitors, zoo, embers, caption, ghost. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly hands: readonly HandShadow[] = [createHandShadow('left'), createHandShadow('right')];
  private readonly session = new Session(this.shapes, this.sil, browserStorage(), new Date(), mulberry32(Date.now() >>> 0));
  private readonly caption = new Caption();
  private readonly ghost = new GhostHand();
  /** The second ghost hand, for two-handed shapes. */
  private readonly ghostPair = new GhostHand();
  /** Where a two-handed shape's left wrist sits along the wall from its center (meters), by creature. */
  private readonly pairWrist = new Map<string, number>();
  // Room for a two-handed creature's shadow.
  private readonly blendBuf = new Float32Array(2 * BONES.length * CAPSULE_STRIDE);
  private readonly drawBuf = new Float32Array(2 * BONES.length * CAPSULE_STRIDE);
  private readonly point: Point = { x: 0, y: 0 };
  private pool: Pool = { u: 1, v: 1 };
  private stageVersion = -1;
  private time = 0;
  private magnification = 3;
  private lastVisitor: string | null = null;
  /** Whether the lantern is golden now (the zoo is complete). */
  private golden = false;
  private readonly weather = new WeatherField(mulberry32(97));
  /** The lantern's color now, easing toward the place's; null until the first frame, which takes it at once. */
  private warm: [number, number, number] | null = null;
  private readonly globePoint: Projected = { x: 0, y: 0, depth: 0 };

  init(): void {
    this.world.createTransformEntity(this.caption.mesh);
    this.world.createTransformEntity(this.ghost.group);
    this.world.createTransformEntity(this.ghostPair.group);
    store.session = this.session;
  }

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) {
      this.caption.show(null);
      this.caption.update(delta);
      this.ghost.hide();
      this.ghost.update(delta);
      this.ghostPair.hide();
      this.ghostPair.update(delta);
      return;
    }
    if (this.stageVersion !== store.stageVersion) this.onStage(stage, canvas);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    for (const hand of this.hands) {
      const sample = store.hands[hand.side];
      updateHandShadow(hand, sample.tracked ? sample.joints : null, this.projector, delta);
    }
    // A pinch aimed at the menu is a click, not a firefly.
    if (store.uiHovered) for (const hand of this.hands) hand.pinch = null;
    const view = this.session.update(delta, this.hands, this.projector, this.pool, store.events);
    const visitor = this.session.visitors.current?.def.id ?? null;
    if (import.meta.env.DEV && visitor !== this.lastVisitor && visitor) {
      const { minSize, hold } = this.session.visitors.options;
      console.info(`[ShadowZoo] visitor ${visitor}${minSize ? ' big' : ''}${hold ? ' steady' : ''}`);
    }
    this.lastVisitor = visitor;
    this.caption.show(view.caption);
    this.caption.update(delta);
    this.showGhost(view.ghost ? this.shapes.get(view.ghost)!.def : null, stage);
    this.ghost.update(delta);
    this.ghostPair.update(delta);
    if (this.session.complete !== this.golden) this.light(canvas);
    const place = placeOf(this.session.saves.data.place);
    if (this.weather.kind !== place.weather) this.weather.set(place.weather, this.pool);
    if (!view.tour) this.weather.update(delta, this.pool, place.rules.wind);
    this.tint(canvas, place, delta);
    canvas.begin();
    if (view.tour) {
      // The World Tour: the globe takes the light while the zoo waits.
      this.drawGlobe(canvas);
      this.drawHands(canvas, null);
      this.drawPinchCursors(canvas);
    } else {
      this.drawRow(canvas);
      this.drawHands(canvas, view.worn);
      this.drawVisitor(canvas);
      this.drawZoo(canvas, stage);
      if (view.gate !== null) this.drawGate(canvas, view.gate);
      this.drawWeather(canvas, place);
      this.drawEmbers(canvas, stage);
    }
    canvas.end();
  }

  /** The lantern's color eases toward the place's: amber at home (gold once the zoo is complete), each place's own away. */
  private tint(canvas: ShadowCanvas, place: Place, dt: number): void {
    const target = place.id === 'home' && this.golden ? GOLD : place.light;
    if (!this.warm) this.warm = [target[0], target[1], target[2]];
    const k = Math.min(1, dt * 1.5);
    for (let i = 0; i < 3; i++) this.warm[i] += (target[i] - this.warm[i]) * k;
    canvas.setWarm(this.warm[0], this.warm[1], this.warm[2]);
  }

  /** Snow and Moon dust glint in the light; rain and blowing sand cast thin streaks of shadow. */
  private drawWeather(canvas: ShadowCanvas, place: Place): void {
    const w = this.weather;
    const m = this.magnification;
    for (let i = 0; i < w.count; i++) {
      if (!w.lit(i, this.pool)) continue;
      const x = w.x[i];
      const y = w.y[i];
      if (w.kind === 'snow') canvas.addDot(x, y, 0.0024 * m, CH_GLOW, 0.75);
      else if (w.kind === 'dust') canvas.addDot(x, y, 0.0012 * m, CH_GLOW, 0.5);
      else {
        const [vx, vy] = w.velocity(i, this.pool, place.rules.wind);
        const s = w.kind === 'rain' ? 0.03 : 0.045;
        canvas.addCapsule(x, y, 0.0006 * m, x - vx * s, y - vy * s, 0.0004 * m, CH_SHADOW, w.kind === 'rain' ? 0.3 : 0.22);
      }
    }
  }

  /** On the globe, a small light shows where each hand's pinch will land, so places can be aimed at. */
  private drawPinchCursors(canvas: ShadowCanvas): void {
    const r = this.session.tour.view(this.pool).r;
    for (const hand of this.hands) {
      if (!hand.tracked) continue;
      canvas.addDot(hand.pinchX, hand.pinchY, r * 0.025, CH_GLOW, 0.95);
      canvas.addDot(hand.pinchX, hand.pinchY, r * 0.06, CH_GLOW, 0.25);
    }
  }

  /** The World Tour's globe: an ocean of light, land in dots of shadow, glowing places, home's lantern and the Moon. */
  private drawGlobe(canvas: ShadowCanvas): void {
    const tour = this.session.tour;
    const view = tour.view(this.pool);
    const { cx, cy, r } = view;
    canvas.addDot(cx, cy, r, CH_GLOW, 0.1);
    const rim = r * 0.012;
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2;
      const a1 = ((i + 1) / 48) * Math.PI * 2;
      canvas.addCapsule(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, rim, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, rim, CH_SHADOW, 0.45);
    }
    // Land dots shrink and fade toward the rim, so the globe reads as round.
    const p = this.globePoint;
    const dot = r * 0.036;
    for (const d of GLOBE_DOTS) {
      projectGlobe(d.lat, d.lon, view, p);
      if (p.depth > 0) canvas.addDot(p.x, p.y, dot * (0.5 + 0.5 * p.depth), CH_SHADOW, 0.5 + 0.45 * p.depth);
    }
    const { place: here, stamps } = this.session.saves.data;
    for (const mk of tour.markers(this.pool)) {
      if (!mk.visible) continue;
      const hovered = mk.id === tour.hover;
      const pulse = 0.7 + 0.3 * Math.sin(this.time * 3.2 + mk.x * 17);
      let size: number;
      if (mk.id === 'moon') {
        size = r * 0.17;
        canvas.addDot(mk.x, mk.y, size, CH_GLOW, hovered ? 0.85 : 0.55);
        canvas.addDot(mk.x - size * 0.3, mk.y + size * 0.25, size * 0.22, CH_SHADOW, 0.35);
        canvas.addDot(mk.x + size * 0.35, mk.y - size * 0.1, size * 0.16, CH_SHADOW, 0.3);
        canvas.addDot(mk.x - size * 0.05, mk.y - size * 0.4, size * 0.12, CH_SHADOW, 0.3);
      } else {
        size = r * (hovered ? 0.075 : 0.05) * (mk.id === 'home' ? 1.3 : 0.6 + 0.4 * mk.facing);
        canvas.addDot(mk.x, mk.y, size, CH_GLOW, mk.id === here ? 1 : pulse);
        canvas.addDot(mk.x, mk.y, size * 2.6, CH_GLOW, (hovered ? 0.35 : 0.16) * pulse);
      }
      // A stamped place wears a thin ring of shadow, like the edge of a passport stamp.
      if (stamps.includes(mk.id)) {
        const ring = size * 1.7;
        for (let i = 0; i < 10; i++) {
          const a0 = (i / 10) * Math.PI * 2;
          const a1 = ((i + 0.6) / 10) * Math.PI * 2;
          canvas.addCapsule(mk.x + Math.cos(a0) * ring, mk.y + Math.sin(a0) * ring, rim * 0.7, mk.x + Math.cos(a1) * ring, mk.y + Math.sin(a1) * ring, rim * 0.7, CH_SHADOW, 0.5);
        }
      }
    }
  }

  /** The glowing ghost hand demonstrates a shape; a two-handed shape gets both hands, where the pair puts them. */
  private showGhost(def: CreatureDef | null, stage: Stage): void {
    if (!def) {
      this.ghost.hide();
      this.ghostPair.hide();
    } else if (def.pair) {
      let wristX = this.pairWrist.get(def.id);
      if (wristX === undefined) this.pairWrist.set(def.id, (wristX = canonicalPair(def).left.pos[0]));
      this.ghost.show(def, stage, true, wristX);
      this.ghostPair.show(def, stage, false, -wristX);
    } else {
      this.ghost.show(def, stage, this.session.settings.hand === 'left');
      this.ghostPair.hide();
    }
  }

  private onStage(stage: Stage, canvas: ShadowCanvas): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.pool = { u: stage.poolU, v: stage.poolV };
    this.session.onStage(this.pool, this.magnification);
    this.caption.place(stage);
    this.light(canvas);
  }

  /** The lantern warms with the streak and burns golden once every creature is found. */
  private light(canvas: ShadowCanvas): void {
    this.golden = this.session.complete;
    canvas.setLight(0.24 + 0.015 * Math.min(8, this.session.saves.data.streak) + (this.golden ? 0.04 : 0));
  }

  /**
   * The zoo row: every creature as a small silhouette along the bottom of the light, below where the
   * creatures walk, found ones as shadows and the rest as faint glowing outlines, so the goal is
   * always in view.
   */
  private drawRow(canvas: ShadowCanvas): void {
    const unlocked = this.session.saves.data.unlocked;
    if (unlocked.length === 0) return;
    const n = CREATURES.length;
    const span = 0.84 * this.pool.u;
    const icon = Math.min(0.085 * this.pool.u, (0.62 * span) / (n - 1));
    const y = -0.74 * this.pool.v;
    for (let i = 0; i < n; i++) {
      const shape = this.shapes.get(CREATURES[i].id)!;
      const { cx, cy, size } = shape.target.frame;
      placeCapsules(shape.caps, shape.count, cx, cy, (i / (n - 1) - 0.5) * span, y, icon / size, 1, this.drawBuf);
      const found = unlocked.includes(shape.def.id);
      canvas.addCapsules(this.drawBuf, 0, shape.count, found ? CH_SHADOW : CH_TARGET, found ? 0.8 : 0.22, found ? 0.002 : 0);
    }
  }

  private drawHands(canvas: ShadowCanvas, worn: Worn | null): void {
    for (const hand of this.hands) if (hand.tracked) canvas.addCapsules(hand.caps, 0, hand.drawCount, CH_SHADOW, 1, penumbra(hand.magnification));
    if (worn) canvas.addDot(worn.eyeX, worn.eyeY, 0.004 * this.magnification, CH_GLOW, 1);
  }

  private drawVisitor(canvas: ShadowCanvas): void {
    const visitors = this.session.visitors;
    const visitor = visitors.current;
    if (!visitor) return;
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * visitors.matcher.progress());
    const { cx, cy } = visitor.target.frame;
    const scale = this.magnification * (visitors.options.minSize ? 1.3 : 1);
    placeCapsules(visitor.caps, visitor.count, cx, cy, 0, 0, scale, 1, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, visitor.count, CH_TARGET, pulse);
  }

  private drawZoo(canvas: ShadowCanvas, stage: Stage): void {
    const zoo = this.session.zoo;
    for (const creature of zoo.creatures) this.drawCreature(canvas, creature, stage);
    const m = this.magnification;
    const gentle = this.session.settings.reducedMotion;
    for (const f of zoo.fireflies.list) {
      const glow = fireflyGlow(f, gentle);
      canvas.addDot(f.x, f.y, 0.0034 * m, CH_GLOW, glow);
      canvas.addDot(f.x, f.y, 0.009 * m, CH_GLOW, 0.18 * glow);
    }
    const p = zoo.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.life[i] / p.max[i];
      if (p.kind[i] === HEART) this.drawHeart(canvas, p.x[i], p.y[i], 0.006 * m, k);
      else if (p.kind[i] === STAR) this.drawStar(canvas, p.x[i], p.y[i], 0.0055 * m, k, this.time * 5 + i);
      else canvas.addDot(p.x[i], p.y[i], (0.0006 + 0.0024 * k) * m, CH_GLOW, k);
    }
  }

  private drawCreature(canvas: ShadowCanvas, c: Creature, stage: Stage): void {
    const shape = this.shapes.get(c.species)!;
    const { cx, cy } = shape.target.frame;
    const y = c.y + c.lift;
    const scale = c.scale * c.bounce;
    const spin = this.session.settings.reducedMotion ? 0 : -c.heading * c.spin;
    blendCapsules(shape.caps, shape.actCaps, c.act, shape.count, this.blendBuf);
    placeCapsules(this.blendBuf, shape.count, cx, cy, c.x, y, scale, c.facing, this.drawBuf);
    if (spin !== 0) rotateCapsules(this.drawBuf, shape.count, spin, c.x, y);
    // Creatures are shadows cast from the comfortable hand distance, so they share that softness.
    canvas.addCapsules(this.drawBuf, 0, shape.count, CH_SHADOW, 1, penumbra(this.magnification));
    if (c.motion === 'dangle') {
      const top = stage.poolV * Math.sqrt(Math.max(0, 1 - (c.x / stage.poolU) ** 2));
      const thread = 0.0007 * this.magnification;
      canvas.addCapsule(c.x, y + c.size * 0.35, thread, c.x, top, thread, CH_SHADOW, 0.85, penumbra(this.magnification) * 0.25);
    }
    if (c.eyeOpen > 0) {
      placePoint(shape.eye[0], shape.eye[1], cx, cy, c.x, y, scale, c.facing, this.point);
      if (spin !== 0) rotatePoint(this.point, spin, c.x, y);
      canvas.addDot(this.point.x, this.point.y, 0.026 * c.size, CH_GLOW, 1);
    }
  }

  /** Embers earned from daily visitors glow along the top of the lantern's pool. */
  private drawEmbers(canvas: ShadowCanvas, stage: Stage): void {
    const n = Math.min(12, this.session.saves.data.embers);
    for (let i = 0; i < n; i++) {
      const theta = Math.PI / 2 + (i - (n - 1) / 2) * 0.13;
      const x = Math.cos(theta) * stage.poolU * 0.9;
      const y = Math.sin(theta) * stage.poolV * 0.9;
      canvas.addDot(x, y, 0.0028 * this.magnification, CH_GLOW, 0.75 + 0.25 * Math.sin(this.time * 2 + i));
    }
  }

  /**
   * The zoo's gate as the lantern lights (or the zoo arrives somewhere new): two pillars with lanterns,
   * an arch, and barred doors that swing open toward you, then the whole gate fades into the zoo.
   */
  private drawGate(canvas: ShadowCanvas, k: number): void {
    const { u, v } = this.pool;
    const fade = k < 0.72 ? 1 : Math.max(0, 1 - (k - 0.72) / 0.28);
    const open = Math.min(1, Math.max(0, (k - 0.1) / 0.5));
    const swing = 1 - (1 - open) ** 3;
    const ink = 0.92 * fade;
    const px = 0.8 * u;
    const post = 0.034 * v;
    const bottom = -1.02 * v;
    const top = 0.6 * v;
    const crown = 0.88 * v;
    for (const side of [-1, 1]) {
      canvas.addCapsule(side * px, bottom, post, side * px, top, post, CH_SHADOW, ink);
      canvas.addCapsule(side * px - post * 1.4, top, post * 0.5, side * px + post * 1.4, top, post * 0.5, CH_SHADOW, ink);
      canvas.addDot(side * px, top + 0.07 * v, 0.026 * v, CH_GLOW, fade);
      canvas.addDot(side * px, top + 0.07 * v, 0.08 * v, CH_GLOW, 0.25 * fade);
    }
    // The arch between the pillars.
    const segments = 14;
    for (let i = 0; i < segments; i++) {
      const a = i / segments;
      const b = (i + 1) / segments;
      const ya = top + (crown - top) * Math.sin(Math.PI * a);
      const yb = top + (crown - top) * Math.sin(Math.PI * b);
      canvas.addCapsule(-px + 2 * px * a, ya, 0.016 * v, -px + 2 * px * b, yb, 0.016 * v, CH_SHADOW, ink);
    }
    // The doors narrow as they turn on their hinges toward you.
    const leaf = (px - post) * Math.cos((swing * Math.PI) / 2);
    if (leaf < 0.01 * u) return;
    const doorTop = 0.4 * v;
    for (const side of [-1, 1]) {
      const hinge = side * (px - post);
      const edge = hinge - side * leaf;
      canvas.addCapsule(hinge, doorTop, 0.011 * v, edge, doorTop, 0.011 * v, CH_SHADOW, ink);
      canvas.addCapsule(hinge, -0.15 * v, 0.009 * v, edge, -0.15 * v, 0.009 * v, CH_SHADOW, ink);
      for (let j = 0; j <= 5; j++) {
        const x = hinge - side * leaf * (j / 5);
        canvas.addCapsule(x, doorTop, 0.0075 * v, x, bottom, 0.0075 * v, CH_SHADOW, ink);
      }
    }
  }

  /** Two thin crossed capsules make a twinkling four-point star, turning as it rises. */
  private drawStar(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number, turn: number): void {
    const c = Math.cos(turn) * r;
    const s = Math.sin(turn) * r;
    const w = r * 0.17;
    canvas.addCapsule(x - c, y - s, w, x + c, y + s, w, CH_GLOW, alpha);
    canvas.addCapsule(x + s, y - c, w, x - s, y + c, w, CH_GLOW, alpha);
  }

  /** Two tapered capsules from round lobes to a point make a small heart. */
  private drawHeart(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number): void {
    canvas.addCapsule(x - r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
    canvas.addCapsule(x + r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
  }
}
