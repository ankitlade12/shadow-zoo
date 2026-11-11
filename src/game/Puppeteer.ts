import type { CreatureId, CreatureShape } from '../core/library.js';
import type { Handedness } from '../core/poses.js';
import type { ShadowProjector } from '../core/projector.js';
import { openness, WornState } from '../core/puppet.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { HandShadow } from './hands.js';

const SCORE_INTERVAL = 1 / 6;

/** The creature a hand is wearing this frame, with its eye and fingertip on the stage. */
export interface Worn {
  species: CreatureId;
  side: Handedness;
  eyeX: number;
  eyeY: number;
  tipX: number;
  tipY: number;
  /** True on the frame the creature's action snaps shut. */
  voice: boolean;
}

/** Detects when a hand's shadow becomes an unlocked creature, then turns its finger motion into a voice. */
export class Puppeteer {
  private readonly states: Record<Handedness, WornState> = { left: new WornState(), right: new WornState() };
  private readonly sizes: Record<Handedness, number> = { left: 0, right: 0 };
  private readonly frame = createFrame();
  private readonly worn: Worn = { species: 'rabbit', side: 'right', eyeX: 0, eyeY: 0, tipX: 0, tipY: 0, voice: false };
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
  ) {}

  update(dt: number, hands: readonly HandShadow[], unlocked: ReadonlySet<CreatureId>, exclude: CreatureId | null, projector: ShadowProjector): Worn | null {
    this.pending += dt;
    const tick = this.pending >= SCORE_INTERVAL ? this.pending : 0;
    if (tick > 0) this.pending = 0;
    let result: Worn | null = null;
    for (const hand of hands) {
      const state = this.states[hand.side];
      if (!hand.tracked || !hand.joints) {
        state.clear();
        continue;
      }
      if (tick > 0) {
        let best: CreatureId | null = null;
        let bestScore = 0;
        for (const id of unlocked) {
          if (id === exclude) continue;
          const shape = this.shapes.get(id);
          // A two-handed creature can't be worn with one hand.
          if (!shape || shape.def.pair) continue;
          const score = matchScore(this.sil, hand.caps, 0, hand.count, shape.target, this.frame);
          if (score > bestScore) {
            bestScore = score;
            best = id;
            this.sizes[hand.side] = this.frame.size;
          }
        }
        state.updateMatch(tick, best, bestScore);
      }
      if (!state.species || result) continue;
      const shape = this.shapes.get(state.species)!;
      const voice = state.updateAction(dt, openness(hand.joints, shape.actuator));
      const e = shape.def.eye.joint * 3;
      const p = hand.joints.pos;
      if (!projector.project(p[e], p[e + 1], p[e + 2])) continue;
      const w = this.worn;
      w.species = state.species;
      w.side = hand.side;
      w.voice = voice;
      w.eyeX = projector.x + shape.def.eye.dx * this.sizes[hand.side];
      w.eyeY = projector.y + shape.def.eye.dy * this.sizes[hand.side];
      w.tipX = hand.tipX;
      w.tipY = hand.tipY;
      result = w;
    }
    return result;
  }
}
