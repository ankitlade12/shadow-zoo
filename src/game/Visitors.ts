import { CREATURES, type CreatureId, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING, type MatchTuning } from '../core/matcher.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { Revealed } from './events.js';
import type { HandShadow } from './hands.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;

/** Creature outlines waiting to be matched, one at a time. */
export class Visitors {
  current: CreatureShape | null = null;
  readonly matcher: Matcher;
  private readonly queue: CreatureId[];
  private readonly frame = createFrame();
  private readonly best = createFrame();
  private wait: number;
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
    order: readonly CreatureId[] = CREATURES.map((c) => c.id),
    firstDelay = 1.2,
    tuning: MatchTuning = TUNING.normal,
  ) {
    this.queue = [...order];
    this.wait = firstDelay;
    this.matcher = new Matcher(tuning);
  }

  enqueue(id: CreatureId): void {
    this.queue.push(id);
  }

  update(dt: number, hands: readonly HandShadow[]): Revealed | null {
    if (!this.current) {
      if (this.queue.length === 0) return null;
      this.wait -= dt;
      if (this.wait > 0) return null;
      this.current = this.shapes.get(this.queue.shift()!) ?? null;
      this.matcher.reset();
      this.pending = 0;
      return null;
    }
    this.pending += dt;
    if (this.pending < MATCH_INTERVAL) return null;
    const tick = this.pending;
    this.pending = 0;
    let bestScore: number | null = null;
    for (const hand of hands) {
      if (!hand.tracked || hand.count === 0) continue;
      const score = matchScore(this.sil, hand.caps, 0, hand.count, this.current.target, this.frame);
      if (bestScore === null || score > bestScore) {
        bestScore = score;
        this.best.cx = this.frame.cx;
        this.best.cy = this.frame.cy;
        this.best.size = this.frame.size;
      }
    }
    if (this.matcher.update(tick, bestScore) !== 'matched') return null;
    const shape = this.current;
    this.current = null;
    this.wait = NEXT_VISITOR_DELAY;
    return {
      species: shape.def.id,
      x: this.best.cx,
      y: this.best.cy,
      size: this.best.size,
      scale: this.best.size / shape.target.frame.size,
    };
  }
}
