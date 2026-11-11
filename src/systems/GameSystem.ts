import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes, canonicalPair, CREATURES, type CreatureDef } from '../core/library.js';
import { penumbra } from '../core/lantern.js';
import { HEART } from '../core/particles.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import type { StoragePort } from '../core/save.js';
import { Silhouettes } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../game/hands.js';
import type { Worn } from '../game/Puppeteer.js';
import { Session } from '../game/Session.js';
import { Caption } from '../render/Caption.js';
import { GhostHand } from '../render/GhostHand.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

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
    canvas.begin();
    this.drawRow(canvas);
    this.drawHands(canvas, view.worn);
    this.drawVisitor(canvas);
    this.drawZoo(canvas, stage);
    this.drawEmbers(canvas, stage);
    canvas.end();
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
    canvas.setGolden(this.golden);
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
    for (const f of zoo.fireflies.list) {
      const flicker = 0.65 + 0.35 * Math.sin(f.age * 9 + f.seed);
      canvas.addDot(f.x, f.y, 0.0034 * m, CH_GLOW, flicker);
      canvas.addDot(f.x, f.y, 0.009 * m, CH_GLOW, 0.18 * flicker);
    }
    const p = zoo.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.life[i] / p.max[i];
      if (p.kind[i] === HEART) this.drawHeart(canvas, p.x[i], p.y[i], 0.006 * m, k);
      else canvas.addDot(p.x[i], p.y[i], (0.0006 + 0.0024 * k) * m, CH_GLOW, k);
    }
  }

  private drawCreature(canvas: ShadowCanvas, c: Creature, stage: Stage): void {
    const shape = this.shapes.get(c.species)!;
    const { cx, cy } = shape.target.frame;
    const y = c.y + c.lift;
    const scale = c.scale * c.bounce;
    const spin = this.session.settings.reducedMotion ? 0 : -c.facing * c.spin;
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

  /** Two tapered capsules from round lobes to a point make a small heart. */
  private drawHeart(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number): void {
    canvas.addCapsule(x - r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
    canvas.addCapsule(x + r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
  }
}
