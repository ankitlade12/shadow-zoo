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
