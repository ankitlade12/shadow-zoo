import type { AssistLevel } from '../core/matcher.js';
import type { HandPreference, Settings } from '../core/save.js';

export type SettingKey = 'assist' | 'hand' | 'sound' | 'motion' | 'view';

const ASSISTS: readonly AssistLevel[] = ['gentle', 'normal', 'expert'];
const HANDS: readonly HandPreference[] = ['auto', 'left', 'right'];
const next = <T>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length];
const title = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Advances one setting to its next value. */
export function cycleSetting(s: Settings, key: SettingKey): void {
  switch (key) {
    case 'assist':
      s.assist = next(ASSISTS, s.assist);
      break;
    case 'hand':
      s.hand = next(HANDS, s.hand);
      break;
    case 'sound':
      s.sound = !s.sound;
      break;
    case 'motion':
      s.reducedMotion = !s.reducedMotion;
      break;
    case 'view':
      s.narrow = !s.narrow;
      break;
  }
}

/** The button label for one setting (plain ASCII for the UI font). */
export function settingLabel(s: Settings, key: SettingKey): string {
  switch (key) {
    case 'assist':
      return `Assist: ${title(s.assist)}`;
    case 'hand':
      return `Hand: ${title(s.hand)}`;
    case 'sound':
      return `Sound: ${s.sound ? 'On' : 'Off'}`;
    case 'motion':
      return `Motion: ${s.reducedMotion ? 'Reduced' : 'Full'}`;
    case 'view':
      return `View: ${s.narrow ? 'Narrow' : 'Wide'}`;
  }
}

/** Two taps within `window` seconds confirm a destructive action. */
export class ConfirmGuard {
  private armedAt = -Infinity;

  constructor(private readonly window = 4) {}

  isArmed(now: number): boolean {
    return now - this.armedAt <= this.window;
  }

  tap(now: number): 'armed' | 'confirmed' {
    if (this.isArmed(now)) {
      this.armedAt = -Infinity;
      return 'confirmed';
    }
    this.armedAt = now;
    return 'armed';
  }
}
