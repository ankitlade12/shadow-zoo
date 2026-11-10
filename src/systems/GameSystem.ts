import { createSystem } from '@iwsdk/core';
import { HopperCreature } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes, CREATURES, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING } from '../core/matcher.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import { createFrame, matchScore, Silhouettes, type ShapeFrame } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { SIDES, store } from '../runtime/store.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;
const HAND_CAPACITY = BONES.length + 1;

/** Visitors, matching, reveals and the living zoo. Fills the shadow canvas each frame. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly handCaps = {
    left: new Float32Array(HAND_CAPACITY * CAPSULE_STRIDE),
    right: new Float32Array(HAND_CAPACITY * CAPSULE_STRIDE),
  };
  private readonly handCount = { left: 0, right: 0 };
  private readonly frame = createFrame();
  private readonly bestFrame: ShapeFrame = createFrame();
  private readonly drawCaps = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly matcher = new Matcher(TUNING.normal);
  private readonly rng = mulberry32(20261109);
  private readonly creatures: HopperCreature[] = [];
  private visitorIndex = 0;
  private visitor: CreatureShape | null = null;
  private nextVisitorIn = 1.2;
  private pending = 0;
  private time = 0;
  private stageVersion = -1;
  private magnification = 3;

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) return;
    if (this.stageVersion !== store.stageVersion) this.onStage(stage);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    canvas.begin();
    this.drawHands(canvas);
    this.updateVisitor(canvas, delta);
    this.updateZoo(canvas, stage, delta);
    canvas.end();
  }

  private onStage(stage: Stage): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.creatures.length = 0;
    this.visitor = null;
    this.visitorIndex = 0;
    this.nextVisitorIn = 1.2;
    this.matcher.reset();
  }

  private drawHands(canvas: ShadowCanvas): void {
    for (const side of SIDES) {
      const hand = store.hands[side];
      const caps = this.handCaps[side];
      this.handCount[side] = 0;
      if (!hand.tracked) continue;
      const n = this.projector.projectBones(hand.joints, caps, 0);
      const arm = this.projector.projectForearm(hand.joints, caps, n);
      this.handCount[side] = n;
      canvas.addCapsules(caps, 0, n + arm, CH_SHADOW, 1);
    }
  }

  private updateVisitor(canvas: ShadowCanvas, delta: number): void {
    if (!this.visitor) {
      this.nextVisitorIn -= delta;
      if (this.nextVisitorIn <= 0) {
        this.visitor = this.shapes.get(CREATURES[this.visitorIndex % CREATURES.length].id)!;
        this.matcher.reset();
      }
      return;
    }
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * this.matcher.progress());
    this.drawShape(canvas, this.visitor, 0, 0, this.magnification, 1, CH_TARGET, pulse);
    this.pending += delta;
    if (this.pending < MATCH_INTERVAL) return;
    const dt = this.pending;
    this.pending = 0;
    let best: number | null = null;
    for (const side of SIDES) {
      if (this.handCount[side] === 0) continue;
      const score = matchScore(this.sil, this.handCaps[side], 0, this.handCount[side], this.visitor.target, this.frame);
      if (best === null || score > best) {
        best = score;
        this.bestFrame.cx = this.frame.cx;
        this.bestFrame.cy = this.frame.cy;
        this.bestFrame.size = this.frame.size;
      }
    }
    if (this.matcher.update(dt, best) === 'matched') this.reveal(this.visitor);
  }

  private reveal(shape: CreatureShape): void {
    const scale = this.bestFrame.size / shape.target.frame.size;
    this.creatures.push(new HopperCreature(shape.def.id, this.bestFrame.cx, this.bestFrame.cy, scale, this.bestFrame.size, this.rng));
    this.visitor = null;
    this.visitorIndex++;
    this.nextVisitorIn = NEXT_VISITOR_DELAY;
  }

  private updateZoo(canvas: ShadowCanvas, stage: Stage, delta: number): void {
    const pool = { u: stage.poolU * 0.8, v: stage.poolV * 0.7 };
    for (const creature of this.creatures) {
      creature.update(delta, pool);
      const shape = this.shapes.get(creature.id)!;
      this.drawShape(canvas, shape, creature.x, creature.y + creature.hop, creature.scale, creature.facing, CH_SHADOW, 1);
      const ex = (shape.eye[0] - shape.target.frame.cx) * creature.scale * creature.facing + creature.x;
      const ey = (shape.eye[1] - shape.target.frame.cy) * creature.scale + creature.y + creature.hop;
      canvas.addDot(ex, ey, 0.006 * creature.scale, CH_GLOW, 1);
    }
  }

  /** Draws a canonical silhouette centered at (x, y) with the given scale and facing (-1 mirrors). */
  private drawShape(canvas: ShadowCanvas, shape: CreatureShape, x: number, y: number, scale: number, facing: number, channel: number, strength: number): void {
    const { cx, cy } = shape.target.frame;
    const src = shape.caps;
    const out = this.drawCaps;
    for (let i = 0; i < shape.count; i++) {
      const o = i * CAPSULE_STRIDE;
      out[o] = (src[o] - cx) * scale * facing + x;
      out[o + 1] = (src[o + 1] - cy) * scale + y;
      out[o + 2] = src[o + 2] * scale;
      out[o + 3] = (src[o + 3] - cx) * scale * facing + x;
      out[o + 4] = (src[o + 4] - cy) * scale + y;
      out[o + 5] = src[o + 5] * scale;
    }
    canvas.addCapsules(out, 0, shape.count, channel, strength);
  }
}
