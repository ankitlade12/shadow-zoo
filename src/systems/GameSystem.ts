import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes } from '../core/library.js';
import { HEART } from '../core/particles.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import { Silhouettes } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../game/hands.js';
import { Puppeteer, type Worn } from '../game/Puppeteer.js';
import { Visitors } from '../game/Visitors.js';
import { Zoo } from '../game/Zoo.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

/** Runs the game each frame (hands, visitors, wearing, the zoo) and draws it into the shadow canvas. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly hands: readonly HandShadow[] = [createHandShadow('left'), createHandShadow('right')];
  private readonly rng = mulberry32(20261109);
  private readonly visitors = new Visitors(this.shapes, this.sil);
  private readonly zoo = new Zoo(this.shapes, this.rng);
  private readonly puppeteer = new Puppeteer(this.shapes, this.sil);
  private readonly blendBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly drawBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly point: Point = { x: 0, y: 0 };
  private pool: Pool = { u: 1, v: 1 };
  private stageVersion = -1;
  private time = 0;
  private magnification = 3;

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) return;
    if (this.stageVersion !== store.stageVersion) this.onStage(stage);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    for (const hand of this.hands) {
      const sample = store.hands[hand.side];
      updateHandShadow(hand, sample.tracked ? sample.joints : null, this.projector, delta);
    }
    const revealed = this.visitors.update(delta, this.hands);
    if (revealed) this.zoo.add(revealed, store.events);
    const worn = this.puppeteer.update(delta, this.hands, this.zoo.unlocked, this.visitors.current?.def.id ?? null, this.projector);
    this.zoo.update(delta, this.pool, this.hands, worn, store.events);
    canvas.begin();
    this.drawHands(canvas, worn);
    this.drawVisitor(canvas);
    this.drawZoo(canvas, stage);
    canvas.end();
  }

  private onStage(stage: Stage): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.pool = { u: stage.poolU, v: stage.poolV };
  }

  private drawHands(canvas: ShadowCanvas, worn: Worn | null): void {
    for (const hand of this.hands) if (hand.tracked) canvas.addCapsules(hand.caps, 0, hand.drawCount, CH_SHADOW, 1);
    if (worn) canvas.addDot(worn.eyeX, worn.eyeY, 0.004 * this.magnification, CH_GLOW, 1);
  }

  private drawVisitor(canvas: ShadowCanvas): void {
    const visitor = this.visitors.current;
    if (!visitor) return;
    const progress = this.visitors.matcher.progress();
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * progress);
    const { cx, cy } = visitor.target.frame;
    placeCapsules(visitor.caps, visitor.count, cx, cy, 0, 0, this.magnification, 1, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, visitor.count, CH_TARGET, pulse);
  }

  private drawZoo(canvas: ShadowCanvas, stage: Stage): void {
    for (const creature of this.zoo.creatures) this.drawCreature(canvas, creature, stage);
    // Glows scale with the shadow magnification so they read the same on near and far walls.
    const m = this.magnification;
    for (const f of this.zoo.fireflies.list) {
      const flicker = 0.65 + 0.35 * Math.sin(f.age * 9 + f.seed);
      canvas.addDot(f.x, f.y, 0.0034 * m, CH_GLOW, flicker);
      canvas.addDot(f.x, f.y, 0.009 * m, CH_GLOW, 0.18 * flicker);
    }
    const p = this.zoo.particles;
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
    blendCapsules(shape.caps, shape.actCaps, c.act, shape.count, this.blendBuf);
    placeCapsules(this.blendBuf, shape.count, cx, cy, c.x, y, scale, c.facing, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, shape.count, CH_SHADOW, 1);
    if (c.motion === 'dangle') {
      const top = stage.poolV * Math.sqrt(Math.max(0, 1 - (c.x / stage.poolU) ** 2));
      const thread = 0.0007 * this.magnification;
      canvas.addCapsule(c.x, y + c.size * 0.35, thread, c.x, top, thread, CH_SHADOW, 0.85);
    }
    if (c.eyeOpen > 0) {
      placePoint(shape.eye[0], shape.eye[1], cx, cy, c.x, y, scale, c.facing, this.point);
      canvas.addDot(this.point.x, this.point.y, 0.026 * c.size, CH_GLOW, 1);
    }
  }

  /** Two tapered capsules from round lobes to a point make a small heart. */
  private drawHeart(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number): void {
    canvas.addCapsule(x - r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
    canvas.addCapsule(x + r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
  }
}
