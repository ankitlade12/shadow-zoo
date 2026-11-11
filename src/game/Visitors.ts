import { BONES } from '../core/joints.js';
import { CREATURES, type CreatureId, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING, type MatchTuning } from '../core/matcher.js';
import { CAPSULE_STRIDE } from '../core/projector.js';
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
  /** Both hands' shadows together, for a two-handed visitor. */
  private readonly both = new Float32Array(2 * (BONES.length + 1) * CAPSULE_STRIDE);
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
    const score = (caps: Float32Array, count: number): void => {
      let value = matchScore(this.sil, caps, 0, count, this.current!.target, this.frame);
      if (this.options.minSize && this.frame.size < this.options.minSize) value = Math.min(value, SMALL_SHADOW_CAP);
      if (bestScore === null || value > bestScore) {
        bestScore = value;
        this.best.cx = this.frame.cx;
        this.best.cy = this.frame.cy;
        this.best.size = this.frame.size;
      }
    };
    if (this.current.def.pair) {
      // A two-handed visitor is both hands' shadows at once; one hand alone scores nothing.
      const tracked = hands.filter((h) => h.tracked && h.count > 0);
      if (tracked.length >= 2) {
        const [a, b] = tracked;
        this.both.set(a.caps.subarray(0, a.count * CAPSULE_STRIDE), 0);
        this.both.set(b.caps.subarray(0, b.count * CAPSULE_STRIDE), a.count * CAPSULE_STRIDE);
        score(this.both, a.count + b.count);
      } else if (tracked.length === 1) bestScore = 0;
    } else {
      for (const hand of hands) if (hand.tracked && hand.count > 0) score(hand.caps, hand.count);
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
