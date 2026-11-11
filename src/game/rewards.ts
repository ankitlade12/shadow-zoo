import { CREATURES } from '../core/library.js';
import type { SaveData } from '../core/save.js';

/** A match's stars out of three, as the wall shows them. */
export const starText = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));

/** The line on the wall when a visitor comes alive: who joined (or visited), with the stars it earned. */
export function revealMessage(name: string, kind: 'new' | 'daily', stars: number, complete: boolean): string {
  if (complete) return `Your zoo is complete! ${starText(stars)}`;
  return kind === 'new' ? `${name} joins your zoo! ${starText(stars)}` : `${name} came back to visit! ${starText(stars)}`;
}

/** Every creature has been found. */
export const zooComplete = (save: SaveData): boolean => CREATURES.every((c) => save.unlocked.includes(c.id));

/**
 * How far along the zoo is: creatures found out of all, and the stars earned so far. Plain words, for
 * the menu's font, which has no star glyph.
 */
export function zooProgress(save: SaveData): string {
  const found = `${save.unlocked.length} of ${CREATURES.length} creatures found`;
  const stars = Object.values(save.stars).reduce((sum, n) => sum + (n ?? 0), 0);
  return stars > 0 ? `${found}, ${stars} ${stars === 1 ? 'star' : 'stars'}` : found;
}
