import type { Twist } from '../core/daily.js';
import { creatureDef, type CreatureId } from '../core/library.js';

/** First-time teaching steps: make the rabbit, feed it, pet it. */
export type Step = 'make' | 'feed' | 'pet' | 'done';

/** Seconds without progress before a hint appears. */
const HINT_AFTER = 6;
const HINT_BELOW = 0.6;

export class Onboarding {
  step: Step;

  constructor(firstTime: boolean) {
    this.step = firstTime ? 'make' : 'done';
  }

  onReveal(): void {
    if (this.step === 'make') this.step = 'feed';
  }

  onEat(): void {
    if (this.step === 'feed') this.step = 'pet';
  }

  onPet(): void {
    if (this.step === 'pet') this.step = 'done';
  }
}

export interface CaptionInput {
  readonly step: Step;
  readonly visitor: CreatureId | null;
  readonly twist: Twist | null;
  readonly visitorElapsed: number;
  readonly visitorProgress: number;
  readonly handsMissing: number;
  readonly welcome: number;
  readonly streak: number;
  /** A moment's news, such as who just joined the zoo; it outranks every other line while it lasts. */
  readonly announce?: string | null;
}

const stuck = (s: CaptionInput): boolean => s.visitorElapsed > HINT_AFTER && s.visitorProgress < HINT_BELOW;

/** The one short line shown on the wall right now, or null. */
export function captionFor(s: CaptionInput): string | null {
  if (s.announce) return s.announce;
  if (s.handsMissing > 3) return 'Show your hands to the lantern';
  if (s.welcome > 0) return s.streak > 1 ? `Welcome back! ${s.streak} nights in a row` : 'Welcome back!';
  if (s.visitor) {
    if (s.twist === 'big') return 'A big visitor! Move your hand toward the light';
    if (s.twist === 'steady') return 'A shy visitor. Hold the shape steady';
    if (s.step === 'make') return 'Make a rabbit with your hand';
    if (creatureDef(s.visitor).pair) return 'Use both hands: hook your thumbs together';
    return stuck(s) ? 'Copy the glowing shape' : null;
  }
  if (s.step === 'feed') return 'Pinch to give it a firefly';
  if (s.step === 'pet') return 'Rest your shadow on it';
  return null;
}

/** Whether the glowing ghost hand should demonstrate the visitor's shape. */
export const showGhost = (s: CaptionInput): boolean => s.visitor !== null && (s.step === 'make' || stuck(s));
