/**
 * The lantern as a real flame: a small light source, so shadows have soft edges that widen with
 * magnification, and a flame that flickers and sways.
 */

/** Effective flame size (meters): how much soft edge a shadow gains per unit of magnification. */
const FLAME_SIZE = 0.005;
/** Softest edge allowed (meters), so shapes stay readable. */
const MAX_SOFTNESS = 0.05;

/**
 * Soft-edge width (meters on the wall) of a shadow cast at `magnification` (the wall's distance from
 * the lantern over the caster's). A hand near the wall casts a sharp shadow; nearer the lantern, its
 * shadow grows and blurs, as under a candle.
 */
export function penumbra(magnification: number): number {
  return Math.min(MAX_SOFTNESS, Math.max(0, FLAME_SIZE * (magnification - 1)));
}

export interface Flicker {
  /** Light-pool brightness multiplier, around 1. */
  brightness: number;
  /** Shadow sway on the wall (meters): the flame moving a little. */
  swayX: number;
  swayY: number;
}

export const createFlicker = (): Flicker => ({ brightness: 1, swayX: 0, swayY: 0 });

const TAU = Math.PI * 2;

/**
 * A candle-like flicker at `time` (seconds): a few overlapping wobbles and, every several seconds, a
 * brief dip as if from a draft. `calm` (reduced motion) keeps only a faint brightness change.
 */
export function lanternFlicker(time: number, calm: boolean, out: Flicker): Flicker {
  const t = time;
  const draft = Math.max(0, Math.sin(TAU * 0.13 * t)) ** 12;
  const wobble =
    0.03 * Math.sin(TAU * 1.3 * t) + 0.02 * Math.sin(TAU * 2.9 * t + 1.7) + 0.012 * Math.sin(TAU * 6.1 * t + 0.4) - 0.05 * draft;
  out.brightness = 1 + (calm ? 0.25 : 1) * wobble;
  out.swayX = calm ? 0 : 0.0026 * Math.sin(TAU * 0.7 * t) + 0.0014 * Math.sin(TAU * 1.9 * t + 0.5) + 0.0015 * draft;
  out.swayY = calm ? 0 : 0.0018 * Math.sin(TAU * 1.1 * t + 2.1);
  return out;
}
