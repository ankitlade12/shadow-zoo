import type { CreatureId } from './library.js';
import { jointDistance, type JointSet } from './poses.js';

/** Match score needed to start wearing a creature, and the score that keeps it on. */
export const WEAR_ON = 0.66;
export const WEAR_OFF = 0.5;
const WEAR_HOLD = 0.3;
const WEAR_LOSE = 0.6;

export interface Actuator {
  readonly a: number;
  readonly b: number;
  readonly open: number;
  readonly closed: number;
}

/** 1 when the actuator joints are as far apart as in the base pose, 0 when as close as in the act pose. */
export function openness(js: JointSet, act: Actuator): number {
  const span = act.open - act.closed;
  if (Math.abs(span) < 1e-6) return 1;
  const v = (jointDistance(js, act.a, act.b) - act.closed) / span;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wear state for one hand: which creature it is wearing, and voice triggers from its action. */
export class WornState {
  species: CreatureId | null = null;
  private candidate: CreatureId | null = null;
  private hold = 0;
  private lose = 0;
  private open = 1;
  private armed = true;
  private cooldown = 0;

  /** Call at the scoring rate with the best-matching unlocked creature and its score. */
  updateMatch(dt: number, best: CreatureId | null, score: number): void {
    if (this.species) {
      if (best === this.species && score >= WEAR_OFF) this.lose = 0;
      else {
        this.lose += dt;
        if (this.lose >= WEAR_LOSE) this.clear();
      }
      return;
    }
    if (best && score >= WEAR_ON) {
      if (best === this.candidate) {
        this.hold += dt;
        if (this.hold >= WEAR_HOLD) {
          this.species = best;
          this.lose = 0;
          this.open = 1;
          this.armed = true;
        }
      } else {
        this.candidate = best;
        this.hold = 0;
      }
    } else {
      this.candidate = null;
      this.hold = 0;
    }
  }

  /** Call every frame with the actuator openness; true when the action snaps shut (a voice). */
  updateAction(dt: number, open: number): boolean {
    this.cooldown -= dt;
    this.open += (open - this.open) * Math.min(1, dt * 18);
    if (this.open >= 0.6) this.armed = true;
    if (this.armed && this.open <= 0.4 && this.cooldown <= 0) {
      this.armed = false;
      this.cooldown = 0.2;
      return true;
    }
    return false;
  }

  clear(): void {
    this.species = null;
    this.candidate = null;
    this.hold = 0;
    this.lose = 0;
  }
}
