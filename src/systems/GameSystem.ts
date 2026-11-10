import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes } from '../core/library.js';
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
  private readonly blendBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly drawBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly point: Point = { x: 0, y: 0 };
  private pool: Pool = { u: 1, v: 1 };
  private stageVersion = -1;
  private time = 0;
  private magnification = 3;

  init(): void {
    this.world.createTransformEntity(this.caption.mesh);
    this.world.createTransformEntity(this.ghost.group);
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
      return;
    }
    if (this.stageVersion !== store.stageVersion) this.onStage(stage, canvas);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    for (const hand of this.hands) {
      const sample = store.hands[hand.side];
      updateHandShadow(hand, sample.tracked ? sample.joints : null, this.projector, delta);
    }
    const view = this.session.update(delta, this.hands, this.projector, this.pool, store.events);
    this.caption.show(view.caption);
    this.caption.update(delta);
    if (view.ghost) this.ghost.show(this.shapes.get(view.ghost)!.def, stage, this.session.settings.hand === 'left');
    else this.ghost.hide();
    this.ghost.update(delta);
    canvas.begin();
    this.drawHands(canvas, view.worn);
    this.drawVisitor(canvas);
    this.drawZoo(canvas, stage);
    this.drawEmbers(canvas, stage);
    canvas.end();
  }

  private onStage(stage: Stage, canvas: ShadowCanvas): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.pool = { u: stage.poolU, v: stage.poolV };
    this.session.onStage(this.pool, this.magnification);
    this.caption.place(stage);
    canvas.setLight(0.24 + 0.015 * Math.min(8, this.session.saves.data.streak));
  }

  private drawHands(canvas: ShadowCanvas, worn: Worn | null): void {
    for (const hand of this.hands) if (hand.tracked) canvas.addCapsules(hand.caps, 0, hand.drawCount, CH_SHADOW, 1);
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
    canvas.addCapsules(this.drawBuf, 0, shape.count, CH_SHADOW, 1);
    if (c.motion === 'dangle') {
      const top = stage.poolV * Math.sqrt(Math.max(0, 1 - (c.x / stage.poolU) ** 2));
      const thread = 0.0007 * this.magnification;
      canvas.addCapsule(c.x, y + c.size * 0.35, thread, c.x, top, thread, CH_SHADOW, 0.85);
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
