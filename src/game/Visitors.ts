import { CREATURES, type CreatureId, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING, type MatchTuning } from '../core/matcher.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { Revealed } from './events.js';
import type { HandShadow } from './hands.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;
/** A too-small shadow can't score above this for a "big" visitor. */
const SMALL_SHADOW_CAP = 0.3;

/** Per-visitor twists: hold the shape longer, or cast a bigger shadow. */
export interface VisitorOptions {
  readonly hold?: number;
  readonly minSize?: number;
}

interface Entry {
  readonly species: CreatureId;
  readonly options: VisitorOptions;
}

/** Creature outlines waiting to be matched, one at a time. */
export class Visitors {
  current: CreatureShape | null = null;
  options: VisitorOptions = {};
  /** Seconds the current visitor has been showing. */
  elapsed = 0;
  /** How long the last revealed visitor took to match (seconds). */
  lastElapsed = 0;
  readonly matcher: Matcher;
  private readonly queue: Entry[];
  private readonly frame = createFrame();
  private readonly best = createFrame();
  private wait: number;
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
    order: readonly CreatureId[] = CREATURES.map((c) => c.id),
    firstDelay = 1.2,
    private tuning: MatchTuning = TUNING.normal,
  ) {
    this.queue = order.map((species) => ({ species, options: {} }));
    this.wait = firstDelay;
    this.matcher = new Matcher(tuning);
  }

  /** True while a visitor is showing or waiting to appear. */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  enqueue(species: CreatureId, options: VisitorOptions = {}): void {
    this.queue.push({ species, options });
  }

  /** Changes the assist level; a visitor's own hold twist still applies. */
  setTuning(tuning: MatchTuning): void {
    this.tuning = tuning;
    this.matcher.setTuning(this.options.hold ? { ...tuning, hold: this.options.hold } : tuning);
  }

  update(dt: number, hands: readonly HandShadow[]): Revealed | null {
    if (!this.current) {
      if (this.queue.length === 0) return null;
      this.wait -= dt;
      if (this.wait > 0) return null;
      const entry = this.queue.shift()!;
      this.current = this.shapes.get(entry.species) ?? null;
      this.options = entry.options;
      this.setTuning(this.tuning);
      this.matcher.reset();
      this.pending = 0;
      this.elapsed = 0;
      return null;
    }
    this.elapsed += dt;
    this.pending += dt;
    if (this.pending < MATCH_INTERVAL) return null;
    const tick = this.pending;
    this.pending = 0;
    let bestScore: number | null = null;
    for (const hand of hands) {
      if (!hand.tracked || hand.count === 0) continue;
      let score = matchScore(this.sil, hand.caps, 0, hand.count, this.current.target, this.frame);
      if (this.options.minSize && this.frame.size < this.options.minSize) score = Math.min(score, SMALL_SHADOW_CAP);
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
    this.options = {};
    this.lastElapsed = this.elapsed;
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
