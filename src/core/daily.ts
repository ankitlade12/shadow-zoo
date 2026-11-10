import type { CreatureId } from './library.js';
import type { SaveData } from './save.js';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The player's local calendar day as YYYY-MM-DD. */
export const localDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Whole days from day a to day b (YYYY-MM-DD). */
export function dayDiff(a: string, b: string): number {
  const t = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type Greeting = 'first' | 'same-day' | 'next-day' | 'returning';

/** Records today's visit and updates the lantern streak. */
export function visitToday(save: SaveData, today: string): Greeting {
  const last = save.lastDay;
  save.lastDay = today;
  if (!last) {
    save.streak = 1;
    return 'first';
  }
  const diff = dayDiff(last, today);
  if (diff <= 0) {
    save.streak = Math.max(1, save.streak);
    return 'same-day';
  }
  if (diff === 1) {
    save.streak += 1;
    return 'next-day';
  }
  save.streak = 1;
  return 'returning';
}

/** "steady": hold the shape longer. "big": cast a bigger shadow by moving the hand toward the light. */
export type Twist = 'steady' | 'big';

export interface DailyVisitor {
  readonly species: CreatureId;
  readonly twist: Twist;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Today's special visitor: one of the player's creatures with a twist, the same all day. */
export function dailyVisitor(today: string, unlocked: readonly CreatureId[]): DailyVisitor | null {
  if (unlocked.length === 0) return null;
  const h = hash(today);
  return { species: unlocked[h % unlocked.length], twist: (h >>> 8) % 2 === 0 ? 'steady' : 'big' };
}
