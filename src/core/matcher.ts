export type AssistLevel = 'gentle' | 'normal' | 'expert';

export interface MatchTuning {
  /** IoU needed at the start of an attempt. */
  readonly threshold: number;
  /** Lowest IoU the threshold can relax to. */
  readonly floor: number;
  /** Seconds before relaxing begins. */
  readonly relaxAfter: number;
  /** Threshold drop per second once relaxing. */
  readonly relaxRate: number;
  /** Seconds the smoothed score must stay above threshold. */
  readonly hold: number;
  /** Score smoothing time constant (seconds). */
  readonly tau: number;
}

export const TUNING: Readonly<Record<AssistLevel, MatchTuning>> = {
  gentle: { threshold: 0.56, floor: 0.42, relaxAfter: 6, relaxRate: 0.012, hold: 0.45, tau: 0.2 },
  normal: { threshold: 0.62, floor: 0.5, relaxAfter: 12, relaxRate: 0.008, hold: 0.6, tau: 0.2 },
  expert: { threshold: 0.72, floor: 0.72, relaxAfter: Infinity, relaxRate: 0, hold: 0.8, tau: 0.2 },
};

export type MatchEvent = 'none' | 'matched';

/** Smooths per-tick scores, requires a short hold, and relaxes the threshold for players who are stuck. */
export class Matcher {
  smoothed = 0;
  held = 0;
  elapsed = 0;
  matched = false;

  constructor(private tuning: MatchTuning) {}

  setTuning(tuning: MatchTuning): void {
    this.tuning = tuning;
  }

  reset(): void {
    this.smoothed = 0;
    this.held = 0;
    this.elapsed = 0;
    this.matched = false;
  }

  threshold(): number {
    const t = this.tuning;
    const over = Math.max(0, this.elapsed - t.relaxAfter);
    return Math.max(t.floor, t.threshold - over * t.relaxRate);
  }

  /** score: best IoU this tick, or null when no hand is tracked. */
  update(dt: number, score: number | null): MatchEvent {
    if (this.matched) return 'none';
    this.elapsed += dt;
    if (score === null) {
      this.smoothed = 0;
      this.held = 0;
      return 'none';
    }
    this.smoothed += (score - this.smoothed) * (1 - Math.exp(-dt / this.tuning.tau));
    if (this.smoothed >= this.threshold()) {
      this.held += dt;
      if (this.held >= this.tuning.hold) {
        this.matched = true;
        return 'matched';
      }
    } else {
      this.held = Math.max(0, this.held - dt);
    }
    return 'none';
  }

  /** 0..1 closeness to the current threshold, for feedback glow. */
  progress(): number {
    return Math.min(1, this.smoothed / this.threshold());
  }
}
